// Builds the offline data bundle for MTG Auto from:
//  - Forge card scripts (oracle text, costs, types, deck-building hints)
//  - Forge edition files (sets, rarities, release dates)
//  - Forge draft rankings (limited pick order per set) + CubeCobra rankings (constructed power)
//  - Forge format files (legality)
//  - natewizz/mtg-rules JSON (Comprehensive Rules)
// Usage: node build/build-data.mjs <forge res dir> <rules.json> <out dir>
import fs from 'node:fs';
import path from 'node:path';

const [,, RES, RULES, OUT] = process.argv;
if (!RES || !RULES || !OUT) { console.error('usage: build-data.mjs <forgeRes> <rules.json> <outDir>'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const COLOR_WORD = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const WUBRG = 'WUBRG';
const sortColors = (s) => [...new Set(s)].filter(c => WUBRG.includes(c)).sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b)).join('');

function forgeCostToBraces(cost) {
  if (!cost || cost === 'no cost') return '';
  return cost.trim().split(/\s+/).map(t => {
    if (t.includes('/') || /^(\d+|[WUBRGCSXYZ])$/.test(t)) return `{${t}}`;
    const digits = (t.match(/^\d+/) || [''])[0];
    const letters = t.slice(digits.length).split('').filter(ch => ch !== 'P');
    const parts = [...(digits ? [digits] : []), ...letters, ...(t.includes('P') ? ['P'] : [])];
    return `{${parts.join('/')}}`;
  }).join('');
}
function cmcOf(braces) {
  let n = 0;
  for (const m of braces.matchAll(/\{([^}]+)\}/g)) {
    const s = m[1];
    if (/^\d+$/.test(s)) n += +s;
    else if (/^[XYZ]$/.test(s)) n += 0;
    else if (/^2\//.test(s)) n += 2;
    else if (s === 'S' || s === 'C' || /[WUBRG]/.test(s)) n += 1;
  }
  return n;
}
function colorsInCost(braces) {
  let out = '';
  for (const m of braces.matchAll(/\{([^}]+)\}/g)) for (const ch of m[1]) if (WUBRG.includes(ch)) out += ch;
  return out;
}
function stripReminder(t) { return t.replace(/\([^)]*\)/g, ''); }

function parseTypeLine(types) {
  // Forge: "Legendary Creature Human Wizard" -> supertypes/types/subtypes
  const SUPER = ['Basic', 'Legendary', 'Snow', 'World', 'Ongoing', 'Elite', 'Host'];
  const TYPES = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Instant', 'Kindred', 'Tribal', 'Land', 'Planeswalker', 'Sorcery', 'Conspiracy', 'Dungeon', 'Phenomenon', 'Plane', 'Scheme', 'Vanguard'];
  const parts = (types || '').trim().split(/\s+/);
  const sup = [], typ = [], sub = [];
  for (const p of parts) {
    if (SUPER.includes(p) && !typ.length) sup.push(p);
    else if (TYPES.includes(p) && !sub.length) typ.push(p);
    else if (p) sub.push(p);
  }
  const line = [...sup, ...typ].join(' ') + (sub.length ? ' — ' + sub.join(' ') : '');
  return { line, sup, typ, sub };
}

function parseFace(lines) {
  const f = { k: [], has: [], hints: [], needs: [] };
  for (const raw of lines) {
    const i = raw.indexOf(':');
    if (i < 0) continue;
    const key = raw.slice(0, i), val = raw.slice(i + 1);
    switch (key) {
      case 'Name': f.n = val.trim(); break;
      case 'ManaCost': f.mc = forgeCostToBraces(val.trim()); break;
      case 'Types': f.types = val.trim(); break;
      case 'PT': { const [p, t] = val.trim().split('/'); f.p = p; f.tg = t; break; }
      case 'Loyalty': f.l = val.trim(); break;
      case 'Defense': f.def = val.trim(); break;
      case 'Colors': f.colorInd = sortColors(val.split(',').map(w => COLOR_WORD[w.trim().toLowerCase()] || '').join('')); break;
      case 'K': f.k.push(val.trim()); break;
      case 'Oracle': f.o = val.replace(/\\n/g, '\n').trim(); break;
      case 'AlternateMode': f.lay = val.trim(); break;
      case 'DeckHas': f.has.push(val.trim()); break;
      case 'DeckHints': f.hints.push(val.trim()); break;
      case 'DeckNeeds': f.needs.push(val.trim()); break;
      case 'CopyFaceFrom': f.copyFrom = val.trim(); break;
    }
  }
  return f;
}

// Forge hint syntax: "Ability$Token|LifeGain & Type$Food|Bird"
function parseHints(arr) {
  const out = [];
  for (const s of arr) for (const part of s.split('&')) {
    const [k, v] = part.trim().split('$');
    if (!v) continue;
    for (const x of v.split('|')) out.push(`${k.trim().toLowerCase()}:${x.trim()}`);
  }
  return [...new Set(out)];
}

// ---------- editions ----------
const edDir = path.join(RES, 'editions');
const sets = {};             // code -> {n, d, t}
const cardSets = new Map();  // card name -> [{s, r, d}]
const RAR = { C: 'common', U: 'uncommon', R: 'rare', M: 'mythic', S: 'special', L: 'land', T: 'special' };
for (const file of fs.readdirSync(edDir)) {
  const txt = fs.readFileSync(path.join(edDir, file), 'utf8');
  const meta = {};
  let section = '';
  const entries = [];
  for (const line of txt.split(/\r?\n/)) {
    const sm = line.match(/^\[(.+)\]\s*$/);
    if (sm) { section = sm[1].toLowerCase(); continue; }
    if (section === 'metadata') { const i = line.indexOf('='); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim(); continue; }
    if (['tokens', 'other', 'rebalanced'].includes(section)) continue;
    const m = line.match(/^(\S+)\s+([CURMSLT])\s+(.+?)(?:\s+@.*)?$/);
    if (m) entries.push({ r: m[2], name: m[3].replace(/\s+\$.*$/, '').trim(), main: section === 'cards' });
  }
  const code = meta.Code; if (!code) continue;
  sets[code] = { n: meta.Name, d: meta.Date || '', t: meta.Type || '' };
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.name)) continue; seen.add(e.name);
    if (!cardSets.has(e.name)) cardSets.set(e.name, []);
    cardSets.get(e.name).push({ s: code, r: RAR[e.r] || 'common', d: meta.Date || '', t: meta.Type || '' });
  }
}

// ---------- rankings ----------
const limitedRank = new Map(); // name -> {SET: percentile}
const rkDir = path.join(RES, 'draft', 'rankings');
for (const file of fs.readdirSync(rkDir)) {
  const rows = fs.readFileSync(path.join(rkDir, file), 'utf8').split(/\r?\n/).filter(l => l.startsWith('#'));
  const N = rows.length;
  rows.forEach((l, i) => {
    const [, name, , set] = l.split('|');
    if (!name) return;
    const pct = +(1 - i / N).toFixed(3);
    const nm = name.trim();
    if (!limitedRank.has(nm)) limitedRank.set(nm, {});
    limitedRank.get(nm)[(set || file.replace('.rnk', '')).trim().toUpperCase()] = pct;
  });
}
const cubeRank = new Map();
{
  const rows = fs.readFileSync(path.join(RES, 'draft', 'rankings_cubecobra.txt'), 'utf8').split(/\r?\n/).filter(l => l.startsWith('#'));
  rows.forEach((l, i) => { const name = l.split('|')[1]; if (name && !cubeRank.has(name.trim())) cubeRank.set(name.trim(), i + 1); });
}

// ---------- formats ----------
function readFormat(file) {
  const o = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) o[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  const list = (s) => (s ? s.split(/;\s*/).map(x => x.trim()).filter(Boolean) : []);
  return { sets: o.Sets ? o.Sets.split(/,\s*/).map(s => s.trim()) : null, banned: new Set(list(o.Banned)), restricted: new Set(list(o.Restricted)), additional: new Set(list(o.Additional)), rarities: o.Rarities ? o.Rarities.split(/,\s*/) : null };
}
const FD = path.join(RES, 'formats');
const formats = {
  standard: readFormat(path.join(FD, 'Sanctioned/Standard.txt')),
  pioneer: readFormat(path.join(FD, 'Sanctioned/Pioneer.txt')),
  modern: readFormat(path.join(FD, 'Sanctioned/Modern.txt')),
  legacy: readFormat(path.join(FD, 'Sanctioned/Legacy.txt')),
  vintage: readFormat(path.join(FD, 'Sanctioned/Vintage.txt')),
  pauper: readFormat(path.join(FD, 'Sanctioned/Pauper.txt')),
  historic: readFormat(path.join(FD, 'Sanctioned/Historic.txt')),
  commander: readFormat(path.join(FD, 'Casual/Commander.txt')),
  brawl: readFormat(path.join(FD, 'Casual/Brawl.txt')),   // Arena "Brawl" (formerly Historic Brawl): 100 cards, Arena card pool, own ban list
};
// Standard Brawl: 60 cards, Standard-legal sets plus Arcane Signet and Command Tower, its own (currently empty) ban list
formats.standardbrawl = { sets: formats.standard.sets, banned: new Set(), restricted: new Set(), additional: new Set(['Arcane Signet', 'Command Tower']), rarities: null };
const RCODE = { common: 'C', uncommon: 'U', rare: 'R', mythic: 'M', land: 'L', special: 'S' };
function legalities(name, printings, isDigitalOnly) {
  const out = {};
  for (const [f, def] of Object.entries(formats)) {
    if (def.banned.has(name)) { out[f] = 'banned'; continue; }
    let ok;
    if (def.additional.has(name)) ok = true;
    else if (def.sets) ok = printings.some(p => def.sets.includes(p.s));
    else ok = printings.some(p => !['Online', 'Funny', 'Custom'].includes(p.t)) && !isDigitalOnly;
    if (ok && def.rarities) ok = printings.some(p => def.rarities.includes(RCODE[p.r]));
    out[f] = ok ? (def.restricted.has(name) ? 'restricted' : 'legal') : 'not_legal';
  }
  return out;
}

// ---------- cards ----------
const cards = [];
const cfDir = path.join(RES, 'cardsfolder');
// first pass: index front faces so CopyFaceFrom (e.g. Prepare cards) can be resolved
const frontIndex = new Map();
for (const letter of fs.readdirSync(cfDir)) {
  const dir = path.join(cfDir, letter); if (!fs.statSync(dir).isDirectory()) continue;
  for (const file of fs.readdirSync(dir)) {
    const txt = fs.readFileSync(path.join(dir, file), 'utf8');
    const f = parseFace(txt.split(/\r?\n\s*ALTERNATE\s*\r?\n/)[0].split(/\r?\n/));
    if (f.n && !frontIndex.has(f.n)) frontIndex.set(f.n, f);
  }
}
let skipped = 0;
for (const letter of fs.readdirSync(cfDir)) {
  const dir = path.join(cfDir, letter);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const file of fs.readdirSync(dir)) {
    const txt = fs.readFileSync(path.join(dir, file), 'utf8');
    const faceBlocks = txt.split(/\r?\n\s*ALTERNATE\s*\r?\n/);
    const faces = faceBlocks.map(b => parseFace(b.split(/\r?\n/))).map(f => (f.copyFrom && frontIndex.has(f.copyFrom)) ? { ...frontIndex.get(f.copyFrom), has: [], hints: [], needs: [] } : f);
    const front = faces[0];
    if (!front.n) { skipped++; continue; }
    const lay = (front.lay || 'normal').toLowerCase();
    const joined = ['split', 'adventure', 'modal', 'doublefaced', 'flip', 'omen', 'prepare'].includes(lay) && faces.length > 1;
    const fullName = joined ? faces.map(f => f.n).join(' // ') : front.n;
    const printings = cardSets.get(fullName) || cardSets.get(front.n);
    if (!printings) { skipped++; continue; } // not in any known product (playtest/custom)
    printings.sort((a, b) => (b.d || '').localeCompare(a.d || ''));
    const tl = parseTypeLine(front.types);
    // colours / identity
    let colors = front.colorInd || colorsInCost(front.mc || '');
    if (lay === 'split') colors += faces.map(f => colorsInCost(f.mc || '')).join('');
    let ident = colors;
    for (const f of faces) {
      ident += colorsInCost(f.mc || '') + (f.colorInd || '');
      ident += colorsInCost(stripReminder(f.o || ''));
    }
    const allHas = parseHints(faces.flatMap(f => f.has));
    const allHints = parseHints(faces.flatMap(f => f.hints));
    const allNeeds = parseHints(faces.flatMap(f => f.needs));
    const lr = limitedRank.get(fullName) || limitedRank.get(front.n);
    const digitalOnly = printings.every(p => p.t === 'Online') || /^A-/.test(front.n);
    const c = {
      n: fullName,
      mc: lay === 'split' ? faces.map(f => f.mc || '').join(' // ') : (front.mc || ''),
      cmc: lay === 'split' ? faces.reduce((a, f) => a + cmcOf(f.mc || ''), 0) : cmcOf(front.mc || ''),
      c: sortColors(colors),
      ci: sortColors(ident),
      t: tl.line,
      ty: tl.typ, st: tl.sub, sp: tl.sup,
      o: front.o || '',
    };
    if (front.p != null) { c.p = front.p; c.tg = front.tg; }
    if (front.l) c.l = front.l;
    if (front.k.length) c.k = [...new Set(front.k.map(k => k.split(':')[0]))];
    if (faces.length > 1) {
      c.lay = lay;
      c.f = faces.map(f => {
        const ft = parseTypeLine(f.types);
        const o = { n: f.n, mc: f.mc || '', t: ft.line, o: f.o || '' };
        if (f.p != null) { o.p = f.p; o.tg = f.tg; }
        if (f.l) o.l = f.l;
        return o;
      });
    }
    c.r = printings[0].r;
    c.s = printings.slice(0, 6).map(p => p.s);
    c.d = printings[printings.length - 1].d;
    if (allHas.length) c.hh = allHas;
    if (allHints.length) c.hn = allHints;
    if (allNeeds.length) c.hd = allNeeds;
    if (lr) c.lr = lr;
    const cr = cubeRank.get(fullName) || cubeRank.get(front.n);
    if (cr) c.cr = cr;
    if (digitalOnly) c.dig = 1;
    const lg = legalities(fullName, printings, digitalOnly);
    c.lg = Object.entries(lg).filter(([, v]) => v === 'legal' || v === 'restricted').map(([k, v]) => v === 'restricted' ? k + '*' : k);
    cards.push(c);
  }
}
cards.sort((a, b) => a.n.localeCompare(b.n));
// set -> card indices (complete, unlike the per-card recent-sets list)
const nameIdx = new Map(); cards.forEach((c, i) => { nameIdx.set(c.n, i); nameIdx.set(c.n.split(' // ')[0], i); });
for (const [name, prints] of cardSets) {
  const i = nameIdx.get(name); if (i == null) continue;
  for (const p of prints) { const st = sets[p.s]; if (!st) continue; (st.c ||= []).push(i); (st.rr ||= {})[i] = p.r[0]; }
}
for (const st of Object.values(sets)) { if (st.c) st.c = [...new Set(st.c)].sort((a, b) => a - b); }
const generated = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'cards.json'), JSON.stringify({ v: 1, source: 'forge', generated, count: cards.length, sets, cards }));

// ---------- rules ----------
const rules = JSON.parse(fs.readFileSync(RULES, 'utf8'));
const r = {
  effective: rules.metadata?.effectiveDate || rules.metadata?.effective_date || '',
  metadata: rules.metadata,
  sections: rules.sections,
  rules: Object.fromEntries(Object.entries(rules.rules).map(([id, v]) => [id, v.examples?.length ? [v.text, v.examples] : [v.text]])),
  glossary: Object.fromEntries(Object.entries(rules.glossary).map(([k, v]) => [k, v.text])),
};
fs.writeFileSync(path.join(OUT, 'rules.json'), JSON.stringify(r));
console.log(`cards: ${cards.length} (skipped ${skipped}), sets: ${Object.keys(sets).length}, rules: ${Object.keys(r.rules).length}`);
