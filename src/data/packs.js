// Random booster generator for sealed practice.
// Each pack: 13 cards, no duplicates inside a pack, at least 1 and never more than 3 rares/mythics.
// Slots: 1 rare/mythic (mythic ~1 in 7), 3 uncommons, 7 commons, 2 wildcards (any rarity).
const SLOT_WILD = [['c', 55], ['u', 30], ['r', 12], ['m', 3]];
export const PACK_SIZE = 13;
export const MAX_RARE = 3;

function pickWeighted(rng, weights) {
  const total = weights.reduce((a, [, w]) => a + w, 0);
  let x = rng() * total;
  for (const [k, w] of weights) { if ((x -= w) < 0) return k; }
  return weights[weights.length - 1][0];
}

// sheets: { c: [cardIdx], u: [...], r: [...], m: [...] } for one set
export function setSheets(db, code) {
  const st = db.sets[code];
  const sheets = { c: [], u: [], r: [], m: [] };
  if (!st?.c) return sheets;
  for (const idx of st.c) {
    const card = db.cards[idx];
    if (!card || card.isBasic) continue;
    const r = st.rr?.[idx] || card.rarity?.[0] || 'c';
    if (sheets[r]) sheets[r].push(idx);
    else if (r === 'l' && !card.isBasic) sheets.c.push(idx); // nonbasic "land" rarity → common slot
  }
  return sheets;
}

export function openPack(sheets, rng = Math.random) {
  const used = new Set();
  const cards = [];
  let rares = 0;
  const draw = (rar) => {
    // fall back down/up the rarity ladder if a sheet is empty or exhausted
    const order = { m: ['m', 'r', 'u', 'c'], r: ['r', 'm', 'u', 'c'], u: ['u', 'c', 'r'], c: ['c', 'u'] }[rar];
    for (const r of order) {
      if ((r === 'r' || r === 'm') && rares >= MAX_RARE) continue;
      const pool = sheets[r].filter(i => !used.has(i));
      if (!pool.length) continue;
      const idx = pool[Math.floor(rng() * pool.length)];
      used.add(idx); if (r === 'r' || r === 'm') rares++;
      cards.push({ idx, rarity: r });
      return true;
    }
    return false;
  };
  draw(rng() < 1 / 7 && sheets.m.length ? 'm' : 'r');
  for (let k = 0; k < 3; k++) draw('u');
  for (let k = 0; k < 7; k++) draw('c');
  for (let k = 0; k < 2; k++) draw(pickWeighted(rng, SLOT_WILD));
  // guarantee at least one rare/mythic (only impossible if the set has none at all)
  if (!rares && !draw('r')) { /* set has no rares or mythics */ }
  while (cards.length > PACK_SIZE) cards.splice(cards.findIndex(x => x.rarity === 'c'), 1);
  // top up if a small set ran out of cards
  while (cards.length < PACK_SIZE && draw('c')) { /* keep filling */ }
  return cards;
}

// Opens `count` packs, cycling through the chosen sets (e.g. 6 packs over 2 sets = 3 + 3).
export function openPacks(db, setCodes, count, rng = Math.random) {
  const sheetsBySet = Object.fromEntries(setCodes.map(s => [s, setSheets(db, s)]));
  const packs = [];
  for (let p = 0; p < count; p++) {
    const set = setCodes[p % setCodes.length];
    packs.push({ set, cards: openPack(sheetsBySet[set], rng) });
  }
  return packs;
}
