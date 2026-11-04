// Set archetypes, worked out from the set itself so it works for any set (including brand-new ones):
// each two-colour pair's gold cards (especially the gold uncommon "signposts") say what that pair wants to do.
import { analyse, themeLabel, GOALS, THEMES } from './tags.js';
const THEME_KEYS = new Set(Object.keys(THEMES));

const PAIRS = ['WU', 'UB', 'BR', 'RG', 'WG', 'WB', 'UR', 'BG', 'WR', 'UG'];
const TRIPLES = ['WUB', 'UBR', 'BRG', 'WRG', 'WUG', 'WBG', 'WUR', 'UBG', 'WBR', 'URG'];
// Official names for colour combinations (guilds, shards, wedges)
export const COMBO_NAME = {
  WU: 'Azorius', UB: 'Dimir', BR: 'Rakdos', RG: 'Gruul', WG: 'Selesnya', WB: 'Orzhov', UR: 'Izzet', BG: 'Golgari', WR: 'Boros', UG: 'Simic',
  WUB: 'Esper', UBR: 'Grixis', BRG: 'Jund', WRG: 'Naya', WUG: 'Bant', WBG: 'Abzan', WUR: 'Jeskai', UBG: 'Sultai', WBR: 'Mardu', URG: 'Temur',
};
// Set-specific faction names, where a set names its archetypes
const SET_NAMES = {
  STX: { WB: 'Silverquill', UR: 'Prismari', BG: 'Witherbloom', WR: 'Lorehold', UG: 'Quandrix' },
  SOS: { WB: 'Silverquill', UR: 'Prismari', BG: 'Witherbloom', WR: 'Lorehold', UG: 'Quandrix' },
  BLB: { WU: 'Birds', UB: 'Rats', BR: 'Lizards', RG: 'Raccoons', WG: 'Rabbits', WB: 'Bats', UR: 'Otters', BG: 'Squirrels', WR: 'Mice', UG: 'Frogs' },
  SNC: { WUB: 'Obscura', UBR: 'Maestros', BRG: 'Riveteers', WRG: 'Cabaretti', WUG: 'Brokers' },
  KTK: { WBG: 'Abzan Houses', WUR: 'Jeskai Way', UBG: 'Sultai Brood', WBR: 'Mardu Horde', URG: 'Temur Frontier' },
  TDM: { WBG: 'Abzan Houses', WUR: 'Jeskai Way', UBG: 'Sultai Brood', WBR: 'Mardu Horde', URG: 'Temur Frontier' },
};
export function comboName(combo, codes) {
  for (const c of codes || []) if (SET_NAMES[c]?.[combo]) return SET_NAMES[c][combo];
  return COMBO_NAME[combo] || combo;
}
const PAIR_ORDER = (p) => 'WUBRG'.split('').filter(c => p.includes(c)).join('');
// "gives" themes that every card of a type has; they only matter when something wants them
const PASSIVE = new Set(['multicolor', 'legends', 'spells', 'artifacts', 'enchantments', 'flyers', 'bigmana', 'draw', 'vehicles', 'voltron', 'lessons']);

const cache = new Map();

export function setArchetypes(db, codes) {
  const key = (codes || []).join(',');
  if (cache.has(key)) return cache.get(key);
  const out = {};
  for (const pair of [...PAIRS, ...TRIPLES]) out[PAIR_ORDER(pair)] = { pair: PAIR_ORDER(pair), score: new Map(), signposts: [], cards: 0 };
  // how common is each mechanic across the whole set (to tell set-wide mechanics from pair-specific ones)
  const setWide = new Map(); let setCount = 0;
  for (const code of codes || []) {
    const st = db.sets[code]; if (!st?.c) continue;
    for (const idx of st.c) {
      const c = db.cards[idx]; if (!c || c.isLand) continue;
      c.tags ||= analyse(c);
      setCount++;
      for (const m of c.tags.mechanics) setWide.set(m, (setWide.get(m) || 0) + 1);
      if (c.colors.length !== 2 && c.colors.length !== 3) continue;
      const a = out[PAIR_ORDER(c.colors)]; if (!a) continue;
      const rar = st.rr?.[idx] || c.rarity[0];
      const w = rar === 'u' ? 2 : 1; // gold uncommons are the designed signposts
      a.cards++;
      if (rar === 'u' || (c.colors.length === 3 && rar !== 'm')) a.signposts.push(c.name);
      const add = (k, v) => a.score.set(k, (a.score.get(k) || 0) + v * w);
      const norm = (k) => k === 'goal:lifegain' ? 'lifegain' : k === 'goal:counters' ? 'counters' : (k.startsWith('mech:') && THEME_KEYS.has(k.slice(5))) ? k.slice(5) : k;
      const seen = new Set();
      const add1 = (k, v) => { k = norm(k); if (seen.has(k)) return; seen.add(k); add(k, v); };
      for (const t of c.tags.wants) if (!t.includes(':') && t !== 'blink') add1(t, 2);
      for (const t of c.tags.gives) if (!t.includes(':') && !PASSIVE.has(t)) add1(t, 1);
      for (const g of c.tags.goals) add1('goal:' + g, 1.5);
      for (const ty of c.tags.typal) add1('typal:' + ty, 2);
      for (const m of c.tags.mechanics) if (!/^etb|^enchant|^equip|^partner|^more than meets/.test(m)) add1('mech:' + m, 1.5);
      if (c.isCreature) for (const st of c.subtypes) (a.types ||= new Map()).set(st.toLowerCase(), ((a.types?.get(st.toLowerCase())) || 0) + w);
    }
  }
  // three-colour archetypes only count in sets that actually support them (several tri-colour cards in that combination)
  for (const k of Object.keys(out)) if (!out[k].cards || (k.length === 3 && out[k].cards < 4)) delete out[k];
  for (const a of Object.values(out)) {
    // a mechanic on most of the set's cards isn't specific to one pair
    for (const [k] of a.score) if (k.startsWith('mech:') && (setWide.get(k.slice(5)) || 0) > setCount * 0.25) a.score.delete(k);
    // a creature type that dominates the pair's gold creatures is its typal theme (e.g. Bloomburrow's animal pairs)
    if (a.types) { const top = [...a.types.entries()].sort((x, y) => y[1] - x[1])[0]; if (top && top[1] >= 3 && !['human', 'wizard', 'warrior', 'soldier', 'cleric', 'rogue', 'shaman', 'druid', 'citizen', 'advisor', 'scout'].includes(top[0])) a.score.set('typal:' + top[0], (a.score.get('typal:' + top[0]) || 0) + top[1] * 2); delete a.types; }
    const ranked = [...a.score.entries()].sort((x, y) => y[1] - x[1]).filter(([, v]) => v >= 3);
    a.themes = ranked.slice(0, 3).map(([k]) => k);
    a.name = comboName(a.pair, codes);
    a.label = a.themes.length ? a.themes.map(archetypeThemeLabel).join(' · ') : 'Good-stuff (no clear theme)';
    delete a.score;
  }
  cache.set(key, out);
  return out;
}

export function archetypeThemeLabel(k) {
  if (k.startsWith('mech:')) { const m = k.slice(5); return m[0].toUpperCase() + m.slice(1); }
  if (k.startsWith('goal:')) return GOALS[k.slice(5)] || k.slice(5);
  return themeLabel(k).replace('Shared plan: ', '');
}

// Does this card help a given archetype? Returns 0..1
export function fitsArchetype(card, arch) {
  if (!arch?.themes?.length) return 0;
  const t = card.tags || (card.tags = analyse(card));
  let hit = 0;
  for (const k of arch.themes) {
    if (k.startsWith('mech:')) { if (t.mechanics.has(k.slice(5))) hit++; continue; }
    if (k.startsWith('goal:')) { if (t.goals.has(k.slice(5))) hit++; continue; }
    if (k.startsWith('typal:')) { const ty = k.slice(6); if (t.isTypes.has(ty) || t.typal.has(ty)) hit++; continue; }
    if (t.wants.has(k) || t.gives.has(k)) hit++;
  }
  return Math.min(1, hit / Math.min(2, arch.themes.length));
}
