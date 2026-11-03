import fs from 'node:fs';
import { Rules } from '../src/engine/rules.js';
import { fromBundle } from '../src/engine/card.js';
import { analyse } from '../src/engine/tags.js';
const R = new Rules(JSON.parse(fs.readFileSync('public/data/rules.json','utf8')));
console.log('keywords', R.keywords.length, R.effective);
const db = JSON.parse(fs.readFileSync('public/data/cards.json','utf8'));
const by = new Map(db.cards.map(r => [r.n.split(' // ')[0], r]));
const get = n => { const c = fromBundle(by.get(n)); c.tags = analyse(c); return c; };
for (const set of [['Blood Artist','Viscera Seer'],['Kitchen Finks','Melira, Sylvok Outcast'],['Questing Beast','Ram Through'],['Restoration Angel','Kiki-Jiki, Mirror Breaker']]) {
  const ex = R.explain(set.map(get));
  console.log('\n##', set.join(' + ')); ex.pairs.forEach(p=>console.log(' syn', p.why)); ex.notes.forEach(n=>console.log(' *', n.title, n.rules, n.rules.map(id=>R.text(id).slice(0,60))));
  ex.perCard.forEach(p=>console.log('  ', p.name, p.keywords.map(k=>k.id+' '+k.title).join(', ')));
}
// check every note's rule refs resolve
console.log(R.search('deathtouch trample').slice(0,3).map(x=>x.id+' '+R.text(x.id).slice(0,70)));
console.log(R.search('702.19').slice(0,3));
