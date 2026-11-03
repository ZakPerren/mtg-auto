import fs from 'node:fs';
import { fromBundle } from '../src/engine/card.js';
import { setKnownTypes } from '../src/engine/tags.js';
import { buildDecks, PRESETS } from '../src/engine/builder.js';
import { combosInPool } from '../src/engine/combos.js';
const db = JSON.parse(fs.readFileSync('public/data/cards.json','utf8'));
setKnownTypes(new Set(db.cards.filter(r=>r.ty.includes('Creature')).flatMap(r=>r.st.map(x=>x.toLowerCase()))));
// a "collection": 1200 random commander-legal cards + some known combo pieces + legends
let s=5; const rnd=()=> (s=(s*16807)%2147483647)/2147483647;
const legal = db.cards.filter(r=>r.lg?.includes('commander') && !r.ty.includes('Land') || (r.ty.includes('Land') && !r.sp.includes('Basic') && rnd()<0.05));
const picks = new Set(); while (picks.size<1200) picks.add(legal[Math.floor(rnd()*legal.length)]);
for (const n of ['Blood Artist','Viscera Seer','Kitchen Finks','Melira, Sylvok Outcast','Exquisite Blood','Sanguine Bond','Teysa Karlov','Sol Ring','Arcane Signet','Command Tower']) picks.add(db.cards.find(r=>r.n===n));
const entries=[...picks].map(r=>({card:fromBundle(r),count:1}));
const combos = combosInPool(entries.map(e=>e.card));
console.log('combos in pool', combos.map(c=>c.cards.join('+')));
const t0=Date.now();
const out = buildDecks(entries,{...PRESETS.commander, style:'auto', sets:[]}, combos);
console.log('ms', Date.now()-t0, out.error||'');
for (const r of out.results) console.log(r.run.commander.card.name, r.colors, r.score, r.stats.creatures, r.stats.avgCmc, r.L, r.cards.reduce((a,x)=>a+x.count,0)+r.manabase.nonbasics.length+Object.values(r.manabase.basics).reduce((a,b)=>a+b,0)+1, (r.combosIn||[]).map(c=>c.cards.join('+')));
