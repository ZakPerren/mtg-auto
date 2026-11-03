import fs from 'node:fs';
import { fromBundle } from '../src/engine/card.js';
import { buildDecks, PRESETS } from '../src/engine/builder.js';
import { setKnownTypes } from "../src/engine/tags.js";
const db = JSON.parse(fs.readFileSync('public/data/cards.json','utf8'));
setKnownTypes(new Set(db.cards.filter(r=>r.ty.includes("Creature")||r.ty.includes("Kindred")).flatMap(r=>r.st.map(x=>x.toLowerCase()))));
const byName = new Map(db.cards.map(r => [r.n, r]));
const byFront = new Map(db.cards.map(r => [r.n.split(' // ')[0], r]));
const set = process.argv[2] || 'SOS'; const seed = +(process.argv[3]||1);
const ed = fs.readdirSync('/home/claude/ext/forge/forge-gui/res/editions').map(f=>fs.readFileSync('/home/claude/ext/forge/forge-gui/res/editions/'+f,'utf8')).find(t=>t.includes(`\nCode=${set}\n`) || t.includes(`Code=${set}\r`));
const lines = ed.split('[cards]')[1].split(/\n\[/)[0].split('\n');
const R = {C:[],U:[],R:[],M:[]};
for (const l of lines) { const m = l.match(/^(\S+)\s+([CURM])\s+(.+?)(?:\s+@.*)?$/); if (m && !/^(Plains|Island|Swamp|Mountain|Forest)$/.test(m[3])) R[m[2]].push(m[3]); }
let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
const pick = a => a[Math.floor(rnd()*a.length)];
const pool = new Map();
for (let p=0;p<6;p++){ for(let k=0;k<10;k++) pool.set(pick(R.C),(pool.get(pick(R.C))||0)); }
// simpler: build list then count
const list=[]; for (let p=0;p<6;p++){ for(let k=0;k<10;k++) list.push(pick(R.C)); for(let k=0;k<3;k++) list.push(pick(R.U)); list.push(rnd()<0.14&&R.M.length?pick(R.M):pick(R.R)); }
const counts = new Map(); for (const n of list) counts.set(n,(counts.get(n)||0)+1);
const entries = []; for (const [n,k] of counts) { const r = byName.get(n)||byFront.get(n); if(!r){console.log('MISSING',n);continue;} entries.push({card: fromBundle(r), count:k}); }
const t0=Date.now();
const out = buildDecks(entries, { ...PRESETS.sealed, style: process.argv[4]||'auto', sets:[set] }, []);
console.log('time', Date.now()-t0, 'ms; pool', out.poolSize);
for (const r of out.results.slice(0,8)) console.log(r.main + (r.splash?'+'+r.splash:''), r.score, JSON.stringify(Object.fromEntries(Object.entries(r.breakdown).filter(([k])=>k!=='combosIn').map(([k,v])=>[k,Math.round(v)]))));
const b = out.results[0];
console.log('\nBEST', b.colors, b.archetype, b.stats);
for (const c of b.cards) console.log(String(c.count).padStart(2), c.card.cmc, c.card.name.padEnd(36), c.card.manaCost.padEnd(14), 'v'+c.value, 'syn'+c.synergy, c.splash?'SPLASH':'', c.roles.join(','));
console.log('lands', b.manabase.nonbasics.map(c=>c.name), b.manabase.basics, 'sources', b.manabase.sources);
console.log('themes', b.themes); console.log('pairs', b.topPairs.slice(0,5).map(p=>`${p.a} + ${p.b}: ${p.why}`));
console.log('warn', b.warnings); console.log('side', b.sideboard.slice(0,15).map(x=>`${x.card.name} ${x.value} ${x.reason}`));
if (process.env.POOL) { for (const e of entries.sort((a,b)=>a.card.colors.localeCompare(b.card.colors))) console.log(e.count, e.card.colors.padEnd(3), e.card.isCreature?'CRE':'   ', e.card.cmc, e.card.name); }
