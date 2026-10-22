import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const catalog = await readFile(new URL('src/data/storyCards.ts', root), 'utf8');
const migration = await readFile(new URL('supabase/migrations/20261022150000_rooms_story_game.sql', root), 'utf8');
const ids = [...catalog.matchAll(/\['([a-z0-9-]+)','[^']+','[^']+'\]/g)].map(match => match[1]);

test('the original story deck has 48 separate image files and database card IDs', async () => {
  assert.equal(ids.length, 48);
  assert.equal(new Set(ids).size, 48);
  const files = new Set(await readdir(new URL('public/cards/', root)));
  for (const id of ids) {
    assert.ok(files.has(`${id}.svg`), `Missing illustration for ${id}`);
    assert.ok(migration.includes(`'${id}'`), `Database deck is missing ${id}`);
  }
});

test('room writes and private game state stay behind member checked RPCs', () => {
  assert.match(migration, /code text not null unique/);
  assert.match(migration, /primary key \(room_id,user_id\)/);
  assert.match(migration, /for update/);
  assert.match(migration, /alter table public\.story_game_state enable row level security/);
  assert.match(migration, /revoke all on public\.game_rooms, public\.game_room_members, public\.story_game_state from anon, authenticated/);
  assert.match(migration, /grant execute on function public\.room_create/);
  assert.match(migration, /if tally>0 and tally<all_count/);
  assert.match(migration, /insert into public\.game_history/);
});
