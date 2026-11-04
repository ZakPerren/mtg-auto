import fs from 'node:fs';
import { fromBundle } from '../src/engine/card.js';
import { setKnownTypes } from '../src/engine/tags.js';
import { setArchetypes } from '../src/engine/archetypes.js';
const raw = JSON.parse(fs.readFileSync('public/data/cards.json','utf8'));
setKnownTypes(new Set(raw.cards.filter(r=>r.ty.includes('Creature')).flatMap(r=>r.st.map(x=>x.toLowerCase()))));
const db = { sets: raw.sets, cards: raw.cards.map(fromBundle) };
for (const code of process.argv.slice(2)) { console.log('==', code); for (const a of Object.values(setArchetypes(db, [code]))) console.log(a.pair, a.name, '|', a.label, '| signposts:', a.signposts.slice(0,3).join(', ')); }
