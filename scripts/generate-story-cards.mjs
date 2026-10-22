import { mkdir, readFile, writeFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/data/storyCards.ts', import.meta.url), 'utf8');
const storyCards = [...source.matchAll(/\['([a-z0-9-]+)','([^']+)','([^']+)'\]/g)].map(([, id, title, description]) => ({ id, title, description }));

const palette = [
  ['#151d3b','#f2a86b','#a5d6c5','#342c60'],['#1c2c43','#f7d885','#78aeb1','#514c7a'],
  ['#33234c','#f39b85','#86bba7','#a14e70'],['#102d3b','#e9cc8b','#84c7bb','#31556d'],
  ['#282344','#f1b66f','#c1a9d9','#4b406b'],['#18363b','#ffcf89','#8db89f','#38635b'],
];
const motifs = [
  (c,x,y)=>`<circle cx="${x}" cy="${y}" r="40" fill="${c[1]}"/><path d="M0 460 Q150 310 300 445 T600 430 V900 H0Z" fill="${c[2]}"/>`,
  (c,x,y)=>`<path d="M${x-65} ${y+70} Q${x-85} ${y-35} ${x} ${y-55} Q${x+90} ${y-35} ${x+60} ${y+70}Z" fill="none" stroke="${c[1]}" stroke-width="20"/><circle cx="${x}" cy="${y+20}" r="24" fill="${c[2]}"/>`,
  (c,x,y)=>`<path d="M${x-95} ${y+95} L${x-95} ${y-75} Q${x} ${y-160} ${x+95} ${y-75} L${x+95} ${y+95}Z" fill="${c[1]}"/><path d="M${x-52} ${y+95} V${y-45} Q${x} ${y-95} ${x+52} ${y-45} V${y+95}" fill="${c[3]}"/>`,
  (c,x,y)=>`<path d="M${x-145} ${y+95} l65 -70 h50 l65 -75 h45 l65 -65" fill="none" stroke="${c[1]}" stroke-width="27" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${x+145}" cy="${y-115}" r="22" fill="${c[2]}"/>`,
  (c,x,y)=>`<ellipse cx="${x}" cy="${y}" rx="125" ry="66" fill="${c[2]}"/><path d="M${x-95} ${y+22} Q${x} ${y+140} ${x+125} ${y+40} Q${x+15} ${y+180} ${x-95} ${y+22}Z" fill="${c[1]}"/><circle cx="${x+80}" cy="${y-14}" r="8" fill="${c[0]}"/>`,
  (c,x,y)=>`<path d="M${x-130} ${y+80} Q${x-95} ${y-140} ${x} ${y-70} Q${x+95} ${y-140} ${x+130} ${y+80}Z" fill="${c[3]}"/><path d="M${x} ${y+80} V${y-28}" stroke="${c[1]}" stroke-width="13"/><circle cx="${x}" cy="${y-45}" r="21" fill="${c[1]}"/>`,
  (c,x,y)=>`<path d="M${x-125} ${y-40} Q${x} ${y-140} ${x+125} ${y-40} L${x+100} ${y+100} H${x-100}Z" fill="${c[1]}"/><path d="M${x-80} ${y+50} Q${x} ${y-30} ${x+80} ${y+50}" fill="none" stroke="${c[0]}" stroke-width="15"/><circle cx="${x}" cy="${y+35}" r="13" fill="${c[2]}"/>`,
  (c,x,y)=>`<path d="M${x-100} ${y+80} L${x-100} ${y-60} Q${x-100} ${y-105} ${x-55} ${y-105} H${x+55} Q${x+100} ${y-105} ${x+100} ${y-60} V${y+80}Z" fill="${c[3]}"/><path d="M${x-50} ${y+70} V${y-35} H${x+50} V${y+70}" fill="${c[1]}"/>`,
];
await mkdir(new URL('../public/cards/', import.meta.url), { recursive: true });
for (const [i, card] of storyCards.entries()) {
  const c = palette[i % palette.length], motif = motifs[i % motifs.length];
  const x = 170 + ((i * 47) % 260), y = 320 + ((i * 31) % 170);
  const stars = Array.from({length: 13}, (_, n) => {
    const sx = (37 + i * 71 + n * 83) % 560 + 20, sy = (23 + i * 43 + n * 59) % 430 + 20;
    return `<circle cx="${sx}" cy="${sy}" r="${n % 4 === 0 ? 4 : 2.5}" fill="#fff2d4" opacity=".${55 + (n * 3) % 40}"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="${c[0]}"/><stop offset="1" stop-color="${c[3]}"/></linearGradient><radialGradient id="glow"><stop stop-color="${c[1]}" stop-opacity=".55"/><stop offset="1" stop-color="${c[1]}" stop-opacity="0"/></radialGradient></defs><rect width="600" height="900" fill="url(#sky)"/><ellipse cx="${x}" cy="${y}" rx="245" ry="210" fill="url(#glow)"/>${stars}<path d="M0 610 Q120 520 240 620 T480 590 T720 620 V900 H0Z" fill="${c[3]}" opacity=".9"/><path d="M0 730 Q140 645 290 735 T600 705 V900 H0Z" fill="${c[2]}" opacity=".82"/>${motif(c,x,y)}<path d="M0 820 Q140 790 280 828 T600 812 V900 H0Z" fill="${c[0]}" opacity=".75"/><path d="M30 30 H570 V870 H30Z" fill="none" stroke="#fff4da" stroke-opacity=".19" stroke-width="2"/><circle cx="${(i*109)%500+50}" cy="${600+(i*37)%110}" r="7" fill="#ffe7a3" opacity=".8"/></svg>`;
  await writeFile(new URL(`../public/cards/${card.id}.svg`, import.meta.url), svg);
}
