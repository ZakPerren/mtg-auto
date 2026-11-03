import fs from 'node:fs';
import { fromBundle } from '../src/engine/card.js';
import { openPacks } from '../src/data/packs.js';
const raw = JSON.parse(fs.readFileSync('public/data/cards.json','utf8'));
const db = { sets: raw.sets, cards: raw.cards.map(fromBundle) };
let bad = 0, rm = [0,0,0,0], sizes = new Set(), dup = 0;
for (let t = 0; t < 2000; t++) {
  for (const pk of openPacks(db, ['SOS','EOE','TDM','FDN'], 6)) {
    sizes.add(pk.cards.length);
    const r = pk.cards.filter(x => x.rarity==='r'||x.rarity==='m').length; rm[r]++; if (r>3 || r<1) bad++;
    if (new Set(pk.cards.map(x=>x.idx)).size !== pk.cards.length) dup++;
    if (pk.cards.some(x => db.cards[x.idx].isBasic)) bad++;
  }
}
console.log('violations', bad, 'dups', dup, 'sizes', [...sizes], 'R/M per pack distribution (0..3)', rm);
const one = openPacks(db, ['SOS'], 1)[0]; console.log(one.cards.map(x=>x.rarity+' '+db.cards[x.idx].name).join('\n'));
