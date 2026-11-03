import fs from 'node:fs';
import { fromBundle } from '../src/engine/card.js';
import { analyse, setKnownTypes, pairSynergy } from '../src/engine/tags.js';
const db = JSON.parse(fs.readFileSync('public/data/cards.json','utf8'));
setKnownTypes(new Set(db.cards.filter(r=>r.ty.includes('Creature')).flatMap(r=>r.st.map(x=>x.toLowerCase()))));
const set = process.argv[2];
const cards = db.cards.filter(r=>!set||r.s.includes(set)).map(fromBundle).filter(c=>!c.isLand); cards.forEach(c=>c.tags=analyse(c));
const reasons = {}; const ex = {}; let pairs=0, hits=0;
let s=3; const rnd=()=> (s=(s*16807)%2147483647)/2147483647;
for (let k=0;k<20000;k++){ const a=cards[Math.floor(rnd()*cards.length)], b=cards[Math.floor(rnd()*cards.length)]; if(a===b) continue; pairs++; const r=pairSynergy(a,b); if(r.score>0){hits++; for(const w of r.reasons){reasons[w]=(reasons[w]||0)+1; (ex[w]||=[]).length<3 && ex[w].push(a.name+' + '+b.name);} } }
console.log('pairs',pairs,'with synergy',hits, (100*hits/pairs).toFixed(1)+'%');
for (const [w,n] of Object.entries(reasons).sort((a,b)=>b[1]-a[1]).slice(0,30)) console.log(String(n).padStart(5), w, '|', ex[w].join(' ; '));
