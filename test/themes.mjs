import fs from 'node:fs';
import { fromBundle } from '../src/engine/card.js';
import { analyse, setKnownTypes } from '../src/engine/tags.js';
const db = JSON.parse(fs.readFileSync('public/data/cards.json','utf8'));
setKnownTypes(new Set(db.cards.filter(r=>r.ty.includes('Creature')).flatMap(r=>r.st.map(x=>x.toLowerCase()))));
const th = process.argv[2], side = process.argv[3]||'wants', set = process.argv[4];
let cards = db.cards.filter(r=> !set || r.s.includes(set)).map(fromBundle);
let n=0; const out=[];
for (const c of cards) { const t = analyse(c); const s = side==='typal'? t.typal : t[side]; if ([...s].some(x=>x.split(':')[0]===th)) { n++; if (out.length<25) out.push(c.name+' | '+c.text.replace(/\n/g,' / ').slice(0,160)); } }
console.log(th, side, n, 'of', cards.length); out.forEach(x=>console.log(' -', x));
