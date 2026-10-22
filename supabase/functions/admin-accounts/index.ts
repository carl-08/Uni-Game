import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: 'Server configuration is incomplete.' }, 500);

  const authorization = request.headers.get('Authorization');
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) return jsonResponse({ error: 'Sign in with an administrator account.' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
  if (authError || !authData.user) return jsonResponse({ error: 'Your session is invalid or expired. Sign in again.' }, 401);

  const actorId = authData.user.id;
  const { data: membership, error: membershipError } = await admin
    .from('admin_users')
    .select('user_id')
    .eq('user_id', actorId)
    .maybeSingle();
  if (membershipError || !membership) return jsonResponse({ error: 'This account is not authorized to manage players.' }, 403);

  const { data: activeBan, error: banCheckError } = await admin
    .from('user_bans')
    .select('user_id')
    .eq('user_id', actorId)
    .is('revoked_at', null)
    .maybeSingle();
  if (banCheckError) return jsonResponse({ error: 'Could not verify administrator status.' }, 500);
  if (activeBan) return jsonResponse({ error: 'Banned accounts cannot perform administrator actions.' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  if (body.action === 'list') {
    const query = typeof body.query === 'string' ? body.query.trim().slice(0, 120) : '';
    const [{ data: accounts, error: searchError }, { data: audit, error: auditError }] = await Promise.all([
      admin.rpc('admin_search_accounts', { search_term: query, p_actor_id: actorId }),
      admin.from('account_admin_audit')
        .select('id,actor_id,target_user_id,target_email,action,reason,occurred_at,status')
        .order('occurred_at', { ascending: false })
        .limit(50),
    ]);
    if (searchError || auditError) return jsonResponse({ error: 'Could not load account management data. Apply the account-management migration.' }, 500);
    return jsonResponse({ accounts: accounts ?? [], audit: audit ?? [], truncated: (accounts?.length ?? 0) === 250 });
  }

  const action = body.action;
  const targetUserId = typeof body.target_user_id === 'string' ? body.target_user_id : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  if (!['ban', 'unban', 'delete'].includes(String(action))) return jsonResponse({ error: 'Unsupported account action.' }, 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
    return jsonResponse({ error: 'Invalid target user ID.' }, 400);
  }
  if (action === 'ban' && !reason) return jsonResponse({ error: 'A reason is required to ban an account.' }, 400);
  if (targetUserId === actorId) return jsonResponse({ error: 'You cannot ban or delete your own administrator account.' }, 403);

  const { data: targetResult, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
  if (targetError || !targetResult.user) return jsonResponse({ error: 'The target account no longer exists.' }, 404);
  const targetEmail = targetResult.user.email ?? null;
  const { data: targetAdmin, error: targetAdminError } = await admin
    .from('admin_users')
    .select('user_id')
    .eq('user_id', targetUserId)
    .maybeSingle();
  if (targetAdminError) return jsonResponse({ error: 'Could not verify whether the target is an administrator.' }, 500);
  if (targetAdmin) return jsonResponse({ error: 'Administrator accounts are protected from player-management actions.' }, 403);

  if (action === 'unban') {
    const { data: existingBan, error: existingBanError } = await admin
      .from('user_bans')
      .select('user_id')
      .eq('user_id', targetUserId)
      .is('revoked_at', null)
      .maybeSingle();
    if (existingBanError) return jsonResponse({ error: 'Could not check the account ban status.' }, 500);
    if (!existingBan) return jsonResponse({ error: 'This account is not currently banned.' }, 409);

    const { error: authUpdateError } = await admin.auth.admin.updateUserById(targetUserId, { ban_duration: 'none' });
    if (authUpdateError) return jsonResponse({ error: 'Could not restore sign-in access. The account remains banned.' }, 500);
  }

  const { data: auditId, error: actionError } = await admin.rpc('admin_begin_account_action', {
    p_actor_id: actorId,
    p_target_user_id: targetUserId,
    p_action: action,
    p_target_email: targetEmail,
    p_reason: reason || null,
  });
  if (actionError || !auditId) {
    const actionMessage = actionError?.message ?? '';
    if (actionMessage.includes('cannot_manage_admin')) return jsonResponse({ error: 'Administrator accounts are protected. Remove admin access separately before account deletion.' }, 403);
    if (actionMessage.includes('not_authorized')) return jsonResponse({ error: 'Your administrator access is no longer active.' }, 403);
    if (actionMessage.includes('not_banned')) return jsonResponse({ error: 'This account is not currently banned.' }, 409);
    if (actionMessage.includes('cannot_manage_self')) return jsonResponse({ error: 'You cannot manage your own account.' }, 403);
    return jsonResponse({ error: 'Could not record this administrator action.' }, 500);
  }

  if (action === 'delete') {
    const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId);
    if (deleteError) {
      await admin.rpc('admin_finish_account_action', { p_audit_id: auditId, p_status: 'failed', p_actor_id: actorId });
      return jsonResponse({ error: 'Account deletion failed. No profile or game history was intentionally removed.' }, 500);
    }
  } else if (action === 'ban') {
    const { error: authBanError } = await admin.auth.admin.updateUserById(targetUserId, { ban_duration: '876000h' });
    if (authBanError) {
      await admin.rpc('admin_finish_account_action', { p_audit_id: auditId, p_status: 'partial', p_actor_id: actorId });
      return jsonResponse({
        success: true,
        warning: 'The persistent ban is active and protected database access is blocked, but Auth session revocation did not complete.',
      });
    }
  }

  const { error: finishError } = await admin.rpc('admin_finish_account_action', { p_audit_id: auditId, p_status: 'applied', p_actor_id: actorId });
  if (finishError) return jsonResponse({ success: true, warning: 'The action completed, but its audit status could not be updated.' });
  return jsonResponse({ success: true });
});
