import fs from 'node:fs';
import { fromBundle } from '../src/engine/card.js';
import { analyse } from '../src/engine/tags.js';
const db = JSON.parse(fs.readFileSync('public/data/cards.json','utf8'));
const by = new Map(db.cards.map(r => [r.n.split(' // ')[0], r]));
for (const n of process.argv.slice(2)) { const c = fromBundle(by.get(n)); const t = analyse(c); console.log(n, '|', c.text.replace(/\n/g,' / '), '\n  roles', [...t.roles], 'gives', [...t.gives], 'wants', [...t.wants], 'typal', [...t.typal], 'prod', c.produces); }
