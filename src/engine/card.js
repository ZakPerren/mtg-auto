// Card normalisation shared by the bundled (Forge-derived) data and Scryfall data.
export const WUBRG = ['W', 'U', 'B', 'R', 'G'];
export const COLOR_NAME = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colourless' };
export const sortColors = (s) => [...new Set(s)].filter(c => WUBRG.includes(c)).sort((a, b) => WUBRG.indexOf(a) - WUBRG.indexOf(b)).join('');

export function normName(n) {
  return n.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
}

// Mana symbols in a cost string -> list of symbol bodies
export function symbols(cost) { return [...(cost || '').matchAll(/\{([^}]+)\}/g)].map(m => m[1]); }

// Coloured pip requirement for one face/cost. Hybrid symbols are returned as alternatives.
export function pips(cost) {
  const out = { W: 0, U: 0, B: 0, R: 0, G: 0, hybrid: [] , phyrexian: 0, generic: 0 };
  for (const s of symbols(cost)) {
    if (/^\d+$/.test(s)) { out.generic += +s; continue; }
    if (/^[XYZ]$/.test(s)) continue;
    const parts = s.split('/');
    if (parts.includes('P')) { out.phyrexian++; const col = parts.find(p => 'WUBRG'.includes(p)); if (col) out.hybrid.push([col, 'life']); continue; }
    if (parts.length === 2) {
      if (/^\d$/.test(parts[0])) { out.hybrid.push([parts[1], 'generic']); continue; } // {2/W}
      out.hybrid.push(parts.filter(p => 'WUBRGC'.includes(p)));
      continue;
    }
    if (out[s] != null && s.length === 1) out[s]++;
  }
  return out;
}

// Can a cost be paid with only these colours? Returns {ok, penalty}
export function castableWith(cost, colors) {
  const p = pips(cost);
  for (const c of WUBRG) if (p[c] > 0 && !colors.includes(c)) return { ok: false };
  let penalty = 0;
  for (const h of p.hybrid) {
    if (h.includes('life') || h.includes('generic')) { if (!colors.includes(h[0])) penalty += h.includes('life') ? 2 : 1; continue; }
    if (!h.some(c => colors.includes(c) || c === 'C')) return { ok: false };
  }
  return { ok: true, penalty };
}

const BASIC_COLOR = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G', Wastes: 'C' };

export function cleanText(text) {
  return (text || '').replace(/\([^)]*\)/g, '').replace(/[ \t]+/g, ' ').trim();
}

// Build the engine-facing card object from a bundled record.
export function fromBundle(r) {
  const faces = r.f || [{ n: r.n, mc: r.mc, t: r.t, o: r.o, p: r.p, tg: r.tg, l: r.l }];
  return finish({
    name: r.n, layout: r.lay || 'normal', manaCost: r.mc || '', cmc: r.cmc || 0,
    colors: r.c || '', identity: r.ci || '', typeLine: r.t || '',
    types: r.ty || [], subtypes: r.st || [], supertypes: r.sp || [],
    oracle: r.o || '', power: r.p, toughness: r.tg, loyalty: r.l,
    keywords: r.k || [], rarity: r.r || 'common', sets: r.s || [], released: r.d || '',
    faces: faces.map(f => ({ name: f.n, manaCost: f.mc || '', typeLine: f.t || '', oracle: f.o || '', power: f.p, toughness: f.tg, loyalty: f.l })),
    limitedRank: r.lr || null, cubeRank: r.cr || null, edhrecRank: r.er || null,
    hints: { has: r.hh || [], hints: r.hn || [], needs: r.hd || [] },
    legal: r.lg || [], digital: !!r.dig, source: r.src || 'bundle',
  });
}

const SF_LAYOUT_MAP = { transform: 'doublefaced', modal_dfc: 'modal', split: 'split', adventure: 'adventure', flip: 'flip', meld: 'meld' };
// Convert a Scryfall card object into the compact bundle record format (so it can be stored and merged).
export function scryfallToRecord(sf) {
  const faces = sf.card_faces && sf.card_faces.length > 1 ? sf.card_faces : null;
  const front = faces ? faces[0] : sf;
  const parseType = (tl) => {
    const [left, right] = (tl || '').split(' — ');
    const words = (left || '').split(' ').filter(Boolean);
    const SUPER = ['Basic', 'Legendary', 'Snow', 'World', 'Ongoing', 'Elite', 'Host'];
    return { sp: words.filter(w => SUPER.includes(w)), ty: words.filter(w => !SUPER.includes(w)), st: right ? right.split(' ').filter(Boolean) : [] };
  };
  const tt = parseType(front.type_line || sf.type_line);
  const rec = {
    n: sf.name, mc: sf.mana_cost != null && sf.mana_cost !== '' ? sf.mana_cost : (faces ? (sf.layout === 'split' ? faces.map(f => f.mana_cost).join(' // ') : front.mana_cost || '') : ''),
    cmc: sf.cmc || 0, c: sortColors((sf.colors || front.colors || []).join('')), ci: sortColors((sf.color_identity || []).join('')),
    t: front.type_line || sf.type_line || '', ty: tt.ty, st: tt.st, sp: tt.sp, o: front.oracle_text || sf.oracle_text || '',
    r: sf.rarity, s: [String(sf.set || '').toUpperCase()], d: sf.released_at || '', src: 'scryfall',
  };
  if (front.power != null) { rec.p = front.power; rec.tg = front.toughness; }
  if (front.loyalty) rec.l = front.loyalty;
  if (sf.keywords?.length) rec.k = sf.keywords;
  if (faces) { rec.lay = SF_LAYOUT_MAP[sf.layout] || sf.layout; rec.f = faces.map(f => ({ n: f.name, mc: f.mana_cost || '', t: f.type_line || '', o: f.oracle_text || '', p: f.power, tg: f.toughness, l: f.loyalty })); }
  if (sf.edhrec_rank) rec.er = sf.edhrec_rank;
  if (sf.legalities) rec.lg = Object.entries(sf.legalities).filter(([, v]) => v === 'legal' || v === 'restricted').map(([k, v]) => v === 'restricted' ? k + '*' : k);
  if (sf.digital) rec.dig = 1;
  return rec;
}

function finish(c) {
  c.key = normName(c.name);
  c.isLand = c.types.includes('Land');
  c.isCreature = c.types.includes('Creature');
  c.isBasic = c.supertypes.includes('Basic') && c.isLand;
  c.isLegendary = c.supertypes.includes('Legendary');
  c.isInstantSorcery = c.types.includes('Instant') || c.types.includes('Sorcery');
  c.isPermanent = !c.isInstantSorcery;
  const shortName = c.name.split(' // ')[0];
  const nameVariants = [shortName, ...c.faces.map(f => f.name)];
  if (shortName.includes(',')) nameVariants.push(shortName.split(',')[0]);
  const allText = c.faces.map(f => f.oracle).join('\n') || c.oracle;
  let t = cleanText(allText).toLowerCase();
  for (const nv of nameVariants.filter(Boolean).sort((a, b) => b.length - a.length)) t = t.split(nv.toLowerCase()).join('~');
  t = t.replace(/\bthis (creature|artifact|enchantment|land|permanent|spell|card|planeswalker|vehicle|equipment|aura|saga|battle)\b/g, '~');
  c.text = t;
  c.fullText = allText;
  c.pw = num(c.power); c.tough = num(c.toughness);
  // A deck may contain any number of …
  c.anyNumber = /a deck can have any number of cards named/i.test(allText) || c.isBasic;
  c.canBeCommander = (c.isLegendary && (c.isCreature || /vehicle|spacecraft/i.test(c.typeLine))) || /can be your commander/i.test(allText);
  // Fixing that isn't a land: landcycling and spells/abilities that fetch basic lands
  const BT = { plains: 'W', island: 'U', swamp: 'B', mountain: 'R', forest: 'G' };
  c.landcycle = '';
  if (/basic landcycling|\blandcycling/.test(t)) c.landcycle = 'WUBRG';
  for (const [k, v] of Object.entries(BT)) if (new RegExp(`\\b${k}cycling`).test(t)) c.landcycle += v;
  c.fetchBasic = '';
  if (!c.isLand && /search your library for (a|up to (one|two)) basic land cards?/.test(t)) c.fetchBasic = 'WUBRG';
  else if (!c.isLand) { const fm = t.match(/search your library for an? (plains|island|swamp|mountain|forest)( or (plains|island|swamp|mountain|forest))* card/); if (fm) for (const [k, v] of Object.entries(BT)) if (fm[0].includes(k)) c.fetchBasic += v; }
  c.produces = c.isLand || /\badd \{|add (one|two|three) mana|mana of any/i.test(t) ? manaProduced(c) : '';
  return c;
}
function num(x) { if (x == null) return null; const n = parseInt(x, 10); return Number.isNaN(n) ? 0 : n; }

// Which colours of mana does this permanent produce (lands/rocks/dorks)? 'C' for colourless.
export function manaProduced(c) {
  let out = '';
  for (const st of c.subtypes) if (BASIC_COLOR[st]) out += BASIC_COLOR[st];
  const t = c.text;
  if (/mana of any (one )?colou?r|any colou?r of mana|mana of any type/.test(t)) out += 'WUBRG';
  for (const m of t.matchAll(/add ([^.]*)/g)) for (const s of symbols(m[1].toUpperCase())) {
    for (const ch of s.split('/')) if ('WUBRGC'.includes(ch)) out += ch;
  }
  // fetch lands: "search your library for a forest or plains card"
  const fm = t.match(/search your library for an? ((?:basic )?(?:plains|island|swamp|mountain|forest)(?: or (?:plains|island|swamp|mountain|forest))*)/);
  if (fm) for (const [k, v] of Object.entries(BASIC_COLOR)) if (fm[1].includes(k.toLowerCase())) out += v;
  if (/search your library for a basic land card/.test(t) && c.isLand) out += 'WUBRG';
  return [...new Set(out)].join('');
}
