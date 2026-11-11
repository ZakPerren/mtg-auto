// Deck optimiser: picks colours, spells and a mana base from a card pool under user constraints.
import { WUBRG, sortColors, castableWith, pips } from './card.js';
import { analyse, pairSynergy, themeLabel, linkText, ROLE_LABEL } from './tags.js';
import { powerOf } from './power.js';
import { consistency } from './mana.js';
import { fitsArchetype } from './archetypes.js';

export const PRESETS = {
  sealed: { mode: 'limited', deckSize: 40, basicsFree: true, singleton: false, maxColors: 3, splash: true, legality: '', brawl: false, life: 20, label: 'Sealed / Prerelease (40)' },
  draft: { mode: 'limited', deckSize: 40, basicsFree: true, singleton: false, maxColors: 3, splash: true, legality: '', brawl: false, life: 20, label: 'Draft (40)' },
  constructed: { mode: 'constructed', deckSize: 60, basicsFree: true, singleton: false, maxColors: 3, splash: false, brawl: false, life: 20, label: 'Constructed (60)' },
  standardbrawl: { mode: 'commander', deckSize: 60, basicsFree: true, singleton: true, maxColors: 5, splash: false, legality: 'standardbrawl', brawl: true, life: 25, label: 'Standard Brawl (60, Standard cards)' },
  brawl: { mode: 'commander', deckSize: 100, basicsFree: true, singleton: true, maxColors: 5, splash: false, legality: 'brawl', brawl: true, life: 25, label: 'Brawl — Arena (100, all Arena cards)' },
  commander: { mode: 'commander', deckSize: 100, basicsFree: true, singleton: true, maxColors: 5, splash: false, legality: '', brawl: false, life: 40, label: 'Commander (100, singleton)' },
};

const STYLE = {
  auto: { creatures: 15, curve: 'mid', syn: 1 },
  aggro: { creatures: 17, curve: 'low', syn: 1 },
  midrange: { creatures: 15, curve: 'mid', syn: 1 },
  control: { creatures: 12, curve: 'high', syn: 1 },
  tempo: { creatures: 14, curve: 'low', syn: 1 },
  synergy: { creatures: 14, curve: 'mid', syn: 1.8 },
};
// Desired number of nonland cards at each mana value, for 23 nonland cards. [min, max]
const CURVES = {
  low: { 1: [1, 4], 2: [6, 9], 3: [4, 7], 4: [2, 4], 5: [0, 2], 6: [0, 1] },
  mid: { 1: [0, 2], 2: [4, 7], 3: [4, 6], 4: [3, 5], 5: [1, 3], 6: [0, 2] },
  high: { 1: [0, 2], 2: [3, 6], 3: [3, 5], 4: [3, 5], 5: [2, 4], 6: [1, 3] },
};

function styleAdjust(c, style) {
  const r = c.tags.roles; let a = 0;
  switch (style) {
    case 'aggro':
      if (c.isCreature && c.cmc <= 3) a += 4;
      if (c.isCreature && (c.pw || 0) > c.cmc) a += 2;
      if (r.has('haste') || (r.has('evasion') && c.cmc <= 3)) a += 3;
      if (r.has('burn')) a += 3;
      if (c.cmc >= 5) a -= 6;
      if (r.has('counter')) a -= 4;
      if (r.has('wipe')) a -= 8;
      break;
    case 'control':
      if (r.has('removal')) a += 4;
      if (r.has('wipe')) a += 6;
      if (r.has('draw')) a += 4;
      if (r.has('counter')) a += 3;
      if (r.has('finisher')) a += 3;
      if (c.isCreature && c.cmc <= 2 && !r.size) a -= 3;
      break;
    case 'tempo':
      if (r.has('flash')) a += 3;
      if (r.has('softRemoval')) a += 3;
      if (r.has('counter')) a += 2;
      if (r.has('evasion') && c.cmc <= 3) a += 3;
      if (c.cmc >= 5) a -= 3;
      break;
  }
  return a;
}

export function prepareCards(poolEntries, opts) {
  // poolEntries: [{card, count}] -> analysed entries
  const mode = opts.mode;
  return poolEntries.map((e, i) => {
    const c = e.card;
    if (!c.tags) c.tags = analyse(c);
    const pw = powerOf(c, mode, opts.sets);
    return { i, card: c, count: e.count, power: pw.value, powerSource: pw.source };
  });
}

function landCountFor(opts, avgCmc, rampCount) {
  if (opts.landCount) return opts.landCount;
  const size = opts.deckSize;
  if (opts.mode === 'commander') {
    const base = size >= 100 ? 37 : 24;
    return Math.max(size >= 100 ? 33 : 21, base - Math.floor(rampCount / 4) + (avgCmc > 3.6 ? 1 : 0));
  }
  const frac = size <= 40 ? 17 / 40 : 24 / 60;
  let L = Math.round(size * frac);
  if (avgCmc <= 2.3) L -= 1;
  if (avgCmc <= 2.0) L -= 1;
  if (avgCmc >= 3.3) L += 1;
  if (rampCount >= 4) L -= 1;
  return L;
}

// ---------------- colour options ----------------
function subsets(colors, k) {
  const out = [];
  const rec = (start, cur) => { if (cur.length === k) { out.push(cur.join('')); return; } for (let i = start; i < colors.length; i++) rec(i + 1, [...cur, colors[i]]); };
  rec(0, []);
  return out;
}

function colourOptions(entries, opts) {
  const must = sortColors(opts.mustColors || '');
  const banned = new Set((opts.excludeColors || '').split(''));
  // colours forced by must-include cards
  let forced = must;
  for (const e of entries) if (opts.mustSet.has(e.card.key) && !e.card.isLand) forced = sortColors(forced + forcedColorsOf(e.card));
  const avail = WUBRG.filter(c => !banned.has(c));
  const opts2 = [];
  if (opts.mode === 'commander') return [];
  const maxC = Math.max(1, Math.min(5, opts.maxColors || 2));
  for (let k = 1; k <= maxC; k++) for (const s of subsets(avail, k)) if ([...forced].every(c => s.includes(c))) opts2.push({ main: s, splash: '' });
  if (opts.splash && opts.mode === 'limited') {
    for (const o of [...opts2]) if (o.main.length === maxC || o.main.length === 2) for (const x of avail) if (!o.main.includes(x)) opts2.push({ main: o.main, splash: x });
  }
  if (!opts2.length && forced.length) opts2.push({ main: forced, splash: '' });
  return opts2;
}
function forcedColorsOf(c) {
  // colours a card definitely needs (ignoring hybrid/phyrexian flexibility)
  const p = pips(c.manaCost.split(' // ')[0]);
  return WUBRG.filter(x => p[x] > 0).join('');
}

// ---------------- the optimiser ----------------
export function buildDecks(poolEntries, rawOpts, combos = [], onProgress) {
  const opts = { ...rawOpts };
  opts.mustSet = new Set((opts.mustInclude || []).map(s => s.toLowerCase()));
  opts.excludeSet = new Set((opts.exclude || []).map(s => s.toLowerCase()));
  const style = STYLE[opts.style] ? opts.style : 'auto';
  const entries = prepareCards(poolEntries, opts).filter(e => !opts.excludeSet.has(e.card.key));
  if (opts.legality) for (const e of entries) e.illegal = !e.card.isBasic && !e.card.legal.some(l => l.replace('*', '') === opts.legality);
  const usable = entries.filter(e => !e.illegal);
  let spells = usable.filter(e => !e.card.isLand);
  // Big pools (e.g. a whole Arena collection): keep the strongest cards per colour plus the most synergy-hungry ones,
  // so the synergy maths stays fast on a phone. Must-includes are always kept.
  let pruned = 0;
  const MAX_PER_GROUP = 150, MAX_SYNERGY = 150;
  if (spells.length > 7 * MAX_PER_GROUP) {
    const banned = opts.excludeColors || '';
    const val = (e) => e.power + styleAdjust(e.card, style);
    const keep = new Set(spells.filter(e => opts.mustSet.has(e.card.key)));
    const groups = new Map();
    for (const e of spells) {
      if ([...banned].some(c => e.card.colors.includes(c))) continue;
      const g = e.card.colors.length > 1 ? 'M' : (e.card.colors || 'C');
      if (!groups.has(g)) groups.set(g, []); groups.get(g).push(e);
    }
    for (const list of groups.values()) list.sort((a, b) => val(b) - val(a)).slice(0, MAX_PER_GROUP).forEach(e => keep.add(e));
    spells.filter(e => !keep.has(e) && (e.card.tags.wants.size || e.card.tags.typal.size)).sort((a, b) => val(b) - val(a)).slice(0, MAX_SYNERGY).forEach(e => keep.add(e));
    pruned = spells.length - keep.size;
    spells = spells.filter(e => keep.has(e));
  }
  const lands = usable.filter(e => e.card.isLand);
  const n = spells.length;

  // synergy matrix (dense, spells only)
  const syn = new Float32Array(n * n);
  const synWhy = new Map();
  for (let a = 0; a < n; a++) for (let b = a; b < n; b++) {
    if (a === b && spells[a].count < 2) continue;
    const r = pairSynergy(spells[a].card, spells[b].card);
    if (r.score > 0) { syn[a * n + b] = syn[b * n + a] = r.score; synWhy.set(a * n + b, r); synWhy.set(b * n + a, r); }
  }
  const synW = (opts.synergyWeight ?? 1) * STYLE[style].syn;
  const values = spells.map(e => e.power + styleAdjust(e.card, style));

  const results = [];
  const runs = [];
  if (opts.mode === 'commander') {
    const commanders = pickCommanderCandidates(entries, opts);
    for (const cmd of commanders) runs.push({ main: cmd.card.identity, splash: '', commander: cmd });
    if (!commanders.length) return { results: [], error: 'No legal commander found in the pool. Add a legendary creature, or choose Constructed.' };
  } else {
    for (const o of colourOptions(usable, opts)) runs.push(o);
  }

  // quick pre-score to prune colour options
  const ctxBase = { opts, style, spells, lands, syn, synW, values, n, combos };
  const scored = runs.map(r => ({ r, est: estimate(ctxBase, r) })).sort((a, b) => b.est - a.est);
  // keep the best few of each shape (mono, two-colour, two+splash, three+, ...) so no shape is crowded out before the real mana maths runs
  let chosenRuns;
  if (opts.mode === 'commander') chosenRuns = scored.slice(0, 4).map(x => x.r);
  else {
    const byShape = new Map();
    for (const x of scored) { const k = x.r.main.length + (x.r.splash ? 's' : ''); if (!byShape.has(k)) byShape.set(k, []); byShape.get(k).push(x.r); }
    chosenRuns = [...byShape.values()].flatMap(list => list.slice(0, 5));
  }
  const limit = chosenRuns.length;
  for (let k = 0; k < limit; k++) {
    const run = chosenRuns[k];
    onProgress?.((k + 1) / limit, run);
    const res = optimise(ctxBase, run);
    if (res) results.push(res);
  }
  results.sort((a, b) => b.score - a.score);
  // explain
  for (const r of results) { r.synWhy = synWhy; explain(r.ctx, r, synWhy); }
  return { results, poolSize: entries.reduce((a, e) => a + e.count, 0), ignored: entries.filter(e => e.illegal).map(e => e.card.name), pruned };
}

// Commander: legendary creature (or Vehicle/Spacecraft, or "can be your commander"). Brawl also allows any legendary planeswalker.
export function isCommanderFor(card, opts) { return card.canBeCommander || (!!opts?.brawl && card.isLegendary && card.types.includes('Planeswalker')); }
function pickCommanderCandidates(entries, opts) {
  let cands = entries.filter(e => isCommanderFor(e.card, opts) && !e.illegal);
  if (opts.commander && opts.commander !== 'auto') cands = cands.filter(e => e.card.key === opts.commander.toLowerCase());
  const must = sortColors(opts.mustColors || '');
  const banned = opts.excludeColors || '';
  cands = cands.filter(e => [...must].every(c => e.card.identity.includes(c)) && ![...banned].some(c => e.card.identity.includes(c)));
  return cands.sort((a, b) => b.power - a.power).slice(0, 8);
}

function inColours(card, colors, opts) {
  if (opts.mode === 'commander') {
    if (![...card.identity].every(c => colors.includes(c))) return { ok: false };
    return { ok: true, penalty: 0 };
  }
  const cost = card.manaCost.split(' // ');
  // split/adventure/MDFC: castable if any half is castable
  let best = null;
  for (const half of cost) { const r = castableWith(half, colors); if (r.ok && (!best || r.penalty < best.penalty)) best = r; }
  return best || { ok: false };
}

function estimate(ctx, run) {
  const colors = run.main + run.splash;
  const vals = [];
  ctx.spells.forEach((e, i) => { const ok = inColours(e.card, colors, ctx.opts); if (ok.ok) for (let k = 0; k < Math.min(e.count, 2); k++) vals.push(ctx.values[i] - (run.splash && !inColours(e.card, run.main, ctx.opts).ok ? 8 : 0)); });
  vals.sort((a, b) => b - a);
  const N = ctx.opts.deckSize - landCountFor(ctx.opts, 3, 0) - (run.commander ? 1 : 0);
  let s = 0; for (let k = 0; k < N; k++) s += vals[k] ?? -30;
  if (run.commander) s += run.commander.power * 2;
  return s;
}

function optimise(ctx0, run) {
  // set archetype guidance: cards that fit the archetype of the deck's colour pair(s) get a bonus
  const archs = archetypesFor(ctx0, run);
  const bonus = ctx0.spells.map(e => archs.reduce((b, a) => Math.max(b, fitsArchetype(e.card, a)), 0) * ARCH_WEIGHT * (ctx0.opts.synergyWeight ?? 1));
  // fixing (landcycling, basic-land fetchers) is worth more the more colours you're in
  const nCol = run.main.length + (run.splash ? 1 : 0);
  const fixW = nCol >= 4 ? 8 : nCol === 3 ? 5 : 0;
  const ctx = { ...ctx0, values: ctx0.values.map((v, i) => v + bonus[i] + ((ctx0.spells[i].card.landcycle || ctx0.spells[i].card.fetchBasic) ? fixW : 0)) };
  run.archetypes = archs; run.archBonus = bonus;
  const { opts, spells, syn, n, values, style } = ctx;
  const colors = sortColors(run.main + run.splash);
  const singleton = opts.singleton;
  const isLimited = opts.mode === 'limited';
  // candidate availability
  const avail = new Int16Array(n);
  const splashCard = new Uint8Array(n);
  const castPenalty = new Float32Array(n);
  const forced = [];
  for (let i = 0; i < n; i++) {
    const e = spells[i]; const c = e.card;
    if (run.commander && c.key === run.commander.card.key) continue;
    const ok = inColours(c, colors, opts);
    const isMust = opts.mustSet.has(c.key);
    if (!ok.ok) { if (isMust && opts.mode !== 'commander') { /* must-include outside colours: still allowed (user's call) */ avail[i] = 1; forced.push(i); castPenalty[i] = 0; } continue; }
    // constructed decks: max 4 copies of a card (basics and "any number" cards excepted); limited uses what's in the pool
    avail[i] = (singleton && !c.anyNumber) ? 1 : (opts.mode === 'constructed' && !c.anyNumber) ? Math.min(4, e.count) : e.count;
    castPenalty[i] = ok.penalty * 2;
    if (run.splash && !inColours(c, run.main, opts).ok) {
      // splash discipline: one pip of the splash colour, and a card worth splashing (3+ mana or removal)
      const p = pips(c.manaCost.split(' // ')[0]);
      const okSplash = p[run.splash] === 1 && (c.cmc >= 3 || c.tags.roles.has('removal')) && !isMust ? true : isMust;
      if (!okSplash) { avail[i] = 0; continue; }
      splashCard[i] = 1;
    }
    if (isMust) forced.push(i);
  }
  const maxSplash = opts.maxSplashCards ?? 3;

  // pass 1 with a provisional land count, pass 2 with the land count implied by the chosen spells
  let deck = null, L = landCountFor(opts, 3, 0);
  for (let pass = 0; pass < 2; pass++) {
    const N = opts.deckSize - L - (run.commander ? 1 : 0);
    deck = greedy(ctx, run, avail, splashCard, castPenalty, forced, N, maxSplash);
    if (!deck) return null;
    localSearch(ctx, run, deck, avail, splashCard, castPenalty, forced, maxSplash);
    const avg = deck.list.reduce((a, i) => a + spells[i].card.cmc, 0) / Math.max(1, deck.list.length);
    const ramp = deck.list.filter(i => spells[i].card.tags.roles.has('ramp')).length;
    const L2 = landCountFor(opts, avg, ramp);
    if (L2 === L) break;
    L = L2;
  }
  // combo seeding: try forcing in any fully-available combo
  for (const combo of ctx.combos || []) {
    const idx = combo.cards.map(nm => spells.findIndex(e => e.card.key === nm.toLowerCase() || e.card.name.split(' // ')[0].toLowerCase() === nm.toLowerCase()));
    if (idx.some(i => i < 0 || !avail[i])) continue;
    if (idx.every(i => deck.list.includes(i))) continue;
    const trial = cloneDeck(deck);
    for (const i of idx) if (!trial.list.includes(i)) { const out = worstRemovable(ctx, run, trial, forced, idx); if (out == null) break; removeCard(ctx, trial, out); addCard(ctx, run, trial, i, splashCard); }
    if (deckScore(ctx, run, trial, castPenalty).total > deckScore(ctx, run, deck, castPenalty).total) deck = trial;
  }

  const manabase = buildManabase(ctx, run, deck, L);
  const sc = deckScore(ctx, run, deck, castPenalty);
  const total = sc.total + manabase.score;
  return { run, colors, main: run.main, splash: run.splash, deck, L, manabase, breakdown: { ...sc, mana: manabase.score }, score: Math.round(total), ctx, castPenalty };
}

const ARCH_WEIGHT = 6;
function archetypesFor(ctx, run) {
  const A = ctx.opts.archetypes; if (!A || ctx.opts.mode !== 'limited') return [];
  const m = run.main; const out = [];
  if (m.length === 3 && A[m]?.themes?.length) out.push(A[m]);   // the three-colour faction first (e.g. Mardu, Esper)
  for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) { const a = A[m[i] + m[j]]; if (a?.themes?.length) out.push(a); }
  return out;
}

// Landcyclers and basic-land fetchers aren't lands, but they find the colour you need: count each as part of a source
// (typecycling 0.6 of its colour; basic landcycling / "search for a basic land" 0.4 of each deck colour).
function effectiveSources(sources, deckSpells, nonbasics, colors) {
  const out = { ...sources }; const fixers = [];
  const add = (card, count, from) => {
    const cols = [...from].filter(x => colors.includes(x)); if (!cols.length) return;
    const each = from.length >= 5 ? 0.4 : 0.6;
    for (const x of cols) out[x] += each * count;
    fixers.push({ name: card.name, count });
  };
  for (const { card, count } of deckSpells) { if (card.landcycle) add(card, count, card.landcycle); else if (card.fetchBasic) add(card, count, card.fetchBasic); }
  for (const c of nonbasics) if (c.landcycle) add(c, 1, c.landcycle);
  return { sources: out, fixers };
}

function cloneDeck(d) { return { list: [...d.list], synWith: Float32Array.from(d.synWith), used: Int16Array.from(d.used), splashCount: d.splashCount, splash: d.splash }; }

function greedy(ctx, run, avail, splashCard, castPenalty, forced, N, maxSplash) {
  const { n } = ctx;
  const deck = { list: [], synWith: new Float32Array(n), used: new Int16Array(n), splashCount: 0 };
  for (const i of forced) { if (deck.list.length >= N) break; if (deck.used[i] < 1) addCard(ctx, run, deck, i, splashCard); }
  while (deck.list.length < N) {
    let best = -1, bestV = -Infinity;
    const base = compositionScore(ctx, run, deck, N);
    for (let i = 0; i < n; i++) {
      if (deck.used[i] >= avail[i]) continue;
      if (splashCard[i] && deck.splashCount >= maxSplash) continue;
      const v = marginal(ctx, run, deck, i, castPenalty, splashCard) + compositionDelta(ctx, run, deck, i, N, base);
      if (v > bestV) { bestV = v; best = i; }
    }
    if (best < 0) break;
    addCard(ctx, run, deck, best, splashCard);
  }
  return deck;
}

const synCurve = (s) => 1.2 * Math.min(s, 6) + 0.3 * Math.max(0, Math.min(s, 14) - 6);
function marginal(ctx, run, deck, i, castPenalty, splashCard) {
  const { syn, n, values, synW } = ctx;
  let v = values[i] - castPenalty[i] - (splashCard[i] ? splashCost(ctx, run, i) : 0);
  // synergy: own + partners' increments
  let own = deck.synWith[i];
  let partners = 0;
  for (const d of deck.list) { const s = syn[i * n + d]; if (s) { partners += synCurve(deck.synWith[d] + s) - synCurve(deck.synWith[d]); } }
  v += synW * (synCurve(own) + partners);
  if (run.commander) v += synW * 2.5 * commanderSyn(ctx, run, i);
  // diminishing returns on duplicate copies in limited (variance) – very small
  if (deck.used[i] >= 1) v -= (ctx.spells[i].card.cmc >= 5 ? 7 : 2) * deck.used[i];
  return v;
}
function commanderSyn(ctx, run, i) {
  if (!run.cmdSyn) {
    const cmd = run.commander.card; if (!cmd.tags) cmd.tags = analyse(cmd);
    run.cmdSyn = Float32Array.from(ctx.spells, e => pairSynergy(e.card, cmd).score);
  }
  return run.cmdSyn[i];
}
// Splashing is for high-impact, later-game cards: cheap or low-impact splash cards cost more.
function splashCost(ctx, run, i) {
  const e = ctx.spells[i]; const c = e.card;
  let cost = 2; // the mana-consistency maths already charges for the colour risk; this is just splash discipline
  if (c.cmc <= 2) cost += 6;
  if (e.power < 70) cost += 5;
  if (!c.tags.roles.has('removal') && !c.tags.roles.has('wipe') && e.power < 80) cost += 3;
  const p = pips(c.manaCost.split(' // ')[0]);
  if (run.splash && p[run.splash] >= 2) cost += 15;
  return cost;
}

function addCard(ctx, run, deck, i, splashCard) {
  const { syn, n } = ctx;
  for (const d of deck.list) { const s = syn[i * n + d]; if (s) { deck.synWith[d] += s; deck.synWith[i] += s; } }
  deck.list.push(i); deck.used[i]++;
  if (splashCard?.[i]) deck.splashCount++;
  deck.splash = deck.splash || splashCard;
}
function removeCard(ctx, deck, i) {
  const { syn, n } = ctx;
  const k = deck.list.indexOf(i); if (k < 0) return;
  deck.list.splice(k, 1); deck.used[i]--;
  for (const d of deck.list) { const s = syn[i * n + d]; if (s) { deck.synWith[d] -= s; deck.synWith[i] -= s; } }
  if (deck.splash?.[i]) deck.splashCount--;
}

function curveBucket(cmc) { return Math.max(1, Math.min(6, Math.round(cmc))); }
function compositionScore(ctx, run, deck, N) {
  const { spells, opts, style } = ctx;
  const scale = N / 23;
  let creatures = 0, removal = 0, draw = 0, ramp = 0, wipes = 0, interaction = 0;
  const curve = [0, 0, 0, 0, 0, 0, 0];
  for (const i of deck.list) {
    const c = spells[i].card; const r = c.tags.roles;
    if (c.isCreature) creatures++;
    if (r.has('removal')) removal++;
    if (r.has('draw')) draw++;
    if (r.has('ramp')) ramp++;
    if (r.has('wipe')) wipes++;
    if (r.has('counter') || r.has('softRemoval')) interaction++;
    curve[curveBucket(c.cmc)]++;
  }
  let s = 0;
  if (opts.mode === 'commander') {
    const big = opts.deckSize >= 100;
    const t = big ? { ramp: 10, draw: 9, removal: 8, wipes: 2, creatures: 22 } : { ramp: 5, draw: 5, removal: 6, wipes: 1, creatures: 15 };
    s -= 3 * Math.max(0, t.ramp - ramp) + 3 * Math.max(0, t.draw - draw) + 3 * Math.max(0, t.removal - removal - interaction * 0.5) + 2 * Math.max(0, t.wipes - wipes) + 1.5 * Math.max(0, t.creatures - creatures);
    const avg = deck.list.reduce((a, i) => a + spells[i].card.cmc, 0) / Math.max(1, deck.list.length);
    s -= 6 * Math.max(0, avg - 3.4) * deck.list.length / 10;
    return s;
  }
  const target = Math.round(STYLE[style].creatures * scale);
  const prog = Math.min(1, deck.list.length / N);
  s -= 10 * Math.max(0, target - 1 - creatures) * prog;
  s -= 1.5 * Math.max(0, creatures - (target + 5));
  const cv = CURVES[STYLE[style].curve];
  for (let b = 1; b <= 6; b++) {
    const [lo, hi] = cv[b];
    const loS = lo * scale * prog, hiS = Math.max(1, hi * scale);
    if (curve[b] < Math.floor(loS)) s -= (b === 2 ? 4 : 3) * (Math.floor(loS) - curve[b]);
    if (curve[b] > Math.ceil(hiS)) s -= (b >= 5 ? 7 : 3) * (curve[b] - Math.ceil(hiS));
  }
  s += 2 * Math.min(removal, Math.round(7 * scale));
  s += 1 * Math.min(draw, Math.round(3 * scale));
  return s;
}
function compositionDelta(ctx, run, deck, i, N, base) {
  deck.list.push(i);
  const after = compositionScore(ctx, run, deck, N);
  deck.list.pop();
  return after - base;
}

function deckScore(ctx, run, deck, castPenalty) {
  const { values, synW, spells } = ctx;
  let power = 0, synergy = 0, cast = 0, splash = 0;
  for (const i of deck.list) { power += values[i]; cast += castPenalty[i]; synergy += synCurve(deck.synWith[i]); if (deck.splash?.[i]) splash += splashCost(ctx, run, i); }
  for (let i = 0; i < deck.used.length; i++) if (deck.used[i] > 1) { const k = deck.used[i]; cast += (spells[i].card.cmc >= 5 ? 7 : 2) * k * (k - 1) / 2; }
  if (run.commander) for (const i of deck.list) synergy += 2.5 * commanderSyn(ctx, run, i);
  synergy *= synW;
  const comp = compositionScore(ctx, run, deck, deck.list.length);
  let combo = 0; const combosIn = [];
  for (const cb of ctx.combos || []) {
    const names = cb.cards.map(x => x.toLowerCase());
    const inDeck = names.every(nm => deck.list.some(i => spells[i].card.key === nm || spells[i].card.name.split(' // ')[0].toLowerCase() === nm) || (run.commander && run.commander.card.key === nm));
    if (inDeck) { combo += ctx.style === 'synergy' ? 25 : 12; combosIn.push(cb); }
  }
  return { total: power + synergy - cast - splash + comp + combo, power, synergy, composition: comp, splash: -splash, cast: -cast, combo, combosIn };
}

function worstRemovable(ctx, run, deck, forced, keep = []) {
  let worst = null, wv = Infinity;
  for (const i of new Set(deck.list)) {
    if (forced.includes(i) || keep.includes(i)) continue;
    const v = ctx.values[i] + ctx.synW * synCurve(deck.synWith[i]);
    if (v < wv) { wv = v; worst = i; }
  }
  return worst;
}

function localSearch(ctx, run, deck, avail, splashCard, castPenalty, forced, maxSplash) {
  const { n } = ctx;
  let cur = deckScore(ctx, run, deck, castPenalty).total;
  for (let iter = 0; iter < 80; iter++) {
    let bestGain = 0.5, bestSwap = null;
    const inDeck = [...new Set(deck.list)].filter(i => !forced.includes(i));
    // large pools: only consider the most promising outsiders
    let cands = [];
    for (let j = 0; j < n; j++) if (deck.used[j] < avail[j]) cands.push(j);
    if (cands.length > 90) cands = cands.map(j => [j, ctx.values[j] + ctx.synW * synCurve(deck.synWith[j]) + (run.cmdSyn ? 2.5 * run.cmdSyn[j] : 0)]).sort((a, b) => b[1] - a[1]).slice(0, 90).map(x => x[0]);
    for (const out of inDeck) {
      removeCard(ctx, deck, out);
      for (const j of cands) {
        if (j === out || deck.used[j] >= avail[j]) continue;
        if (splashCard[j] && deck.splashCount >= maxSplash) continue;
        addCard(ctx, run, deck, j, splashCard);
        const s = deckScore(ctx, run, deck, castPenalty).total;
        removeCard(ctx, deck, j);
        if (s - cur > bestGain) { bestGain = s - cur; bestSwap = [out, j]; }
      }
      addCard(ctx, run, deck, out, splashCard);
    }
    if (!bestSwap) break;
    removeCard(ctx, deck, bestSwap[0]); addCard(ctx, run, deck, bestSwap[1], splashCard);
    cur += bestGain;
  }
}

// ---------------- mana base ----------------
const BASIC_FOR = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
function buildManabase(ctx, run, deck, L) {
  const { spells, lands, opts } = ctx;
  const colors = sortColors(run.main + run.splash);
  const isLimited = opts.mode === 'limited';
  // pip demand
  const demand = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const maxPips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const i of deck.list) {
    const c = spells[i].card;
    const p = pips(c.manaCost.split(' // ')[0]);
    for (const x of WUBRG) if (p[x]) { demand[x] += p[x] * (c.cmc <= 3 ? 1.4 : 1); maxPips[x] = Math.max(maxPips[x], p[x]); }
    for (const h of p.hybrid) { const opt = h.filter(x => colors.includes(x)); if (opt.length === 1) demand[opt[0]] += 0.7; }
  }
  if (run.commander) { const p = pips(run.commander.card.manaCost); for (const x of WUBRG) if (p[x]) demand[x] += p[x] * 2; }
  const chosen = [];
  const warnings = [];
  // nonbasic lands from the pool
  const nb = [];
  for (const e of lands) {
    const c = e.card; if (c.isBasic) continue;
    const prod = c.produces || '';
    const onColour = [...prod].filter(x => colors.includes(x));
    const offOnly = prod.length && !onColour.length && !prod.includes('C');
    if (offOnly) continue;
    // only lands whose coloured mana is all useful: a U/B dual in a W/B/R deck is just a worse Swamp, so skip it.
    // Lands that make any colour (or fetch any basic) are fine — they'll only ever be used for your colours.
    const coloured = [...prod].filter(x => x !== 'C');
    const anyColour = new Set(coloured).size >= 5 || c.landcycle.length >= 5;
    if (opts.mode !== 'commander' && /commander's colou?r identity/.test(c.text)) continue; // e.g. Command Tower does nothing outside Commander
    if (!anyColour && coloured.some(x => !colors.includes(x))) continue;
    if (opts.mode === 'commander' && ![...c.identity].every(x => colors.includes(x))) continue;
    let v = onColour.length * 10 + (onColour.length >= 2 ? 15 : 0) + (run.splash && prod.includes(run.splash) ? 12 : 0);
    if (!prod) v = -5;
    if (prod === 'C') v = colors.length >= 2 ? 2 : 6;
    if (/enters (the battlefield )?tapped/.test(c.text) && !/unless/.test(c.text)) v -= 3;
    if (/(draw a card|create|deals? \d+ damage|destroy|\+1\/\+1|becomes? an? \d+\/\d+)/.test(c.text)) v += 6;
    if (colors.length === 1 && onColour.length <= 1 && !/(draw a card|create|deals|destroy|becomes)/.test(c.text)) v -= 8;
    const copies = opts.singleton && !c.anyNumber ? 1 : e.count;
    for (let k = 0; k < copies; k++) nb.push({ e, v: v - k * 2, prod });
  }
  nb.sort((a, b) => b.v - a.v);
  const maxNonbasic = opts.mode === 'commander' ? L : (colors.length >= 3 ? L - 6 : Math.ceil(L * 0.45));
  let colourlessCount = 0;
  for (const x of nb) {
    if (chosen.length >= maxNonbasic || x.v <= 0) break;
    if (x.prod === 'C' || !x.prod) { if (colourlessCount >= (colors.length >= 2 ? 1 : 3)) continue; colourlessCount++; }
    chosen.push(x.e.card);
  }
  // basics
  const remaining = L - chosen.length;
  const sources = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const c of chosen) for (const x of c.produces || '') if (sources[x] != null) sources[x]++;
  const basics = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const poolBasics = {};
  for (const e of lands) if (e.card.isBasic) for (const x of e.card.produces) poolBasics[x] = (poolBasics[x] || 0) + e.count;
  const totalDemand = colors.split('').reduce((a, x) => a + demand[x], 0) || 1;
  if (remaining > 0 && colors.length) {
    // splash colour: aim for 3 sources total in limited (4 in larger decks)
    const alloc = {};
    let left = remaining;
    if (run.splash) { const need = Math.max(0, (isLimited ? 3 : 4) - sources[run.splash]); alloc[run.splash] = Math.min(need, left); left -= alloc[run.splash]; }
    const mains = [...run.main];
    const mainDemand = mains.reduce((a, x) => a + demand[x], 0) || 1;
    const raw = mains.map(x => ({ x, q: left * demand[x] / mainDemand }));
    raw.forEach(r => { alloc[r.x] = Math.floor(r.q); });
    let rem = left - raw.reduce((a, r) => a + alloc[r.x], 0);
    raw.sort((a, b) => (b.q - Math.floor(b.q)) - (a.q - Math.floor(a.q)));
    for (let k = 0; k < rem; k++) alloc[raw[k % raw.length].x]++;
    // floor: every main colour gets a reasonable minimum
    for (const x of mains) {
      const minSrc = isLimited ? (maxPips[x] >= 2 ? 8 : 6) : (maxPips[x] >= 2 ? 11 : 8);
      while (alloc[x] + sources[x] < minSrc) {
        const donor = mains.filter(y => y !== x).sort((a, b) => (alloc[b] + sources[b]) - (alloc[a] + sources[a]))[0];
        if (!donor || alloc[donor] + sources[donor] <= minSrc) break;
        alloc[donor]--; alloc[x]++;
      }
    }
    for (const [x, q] of Object.entries(alloc)) basics[x] = q;
  }
  if (!opts.basicsFree) {
    for (const x of WUBRG) if (basics[x] > (poolBasics[x] || 0)) { warnings.push(`Pool only has ${poolBasics[x] || 0} ${BASIC_FOR[x]} – wanted ${basics[x]}.`); basics[x] = poolBasics[x] || 0; }
  }
  for (const x of WUBRG) sources[x] += basics[x];
  // Colour consistency: probability each spell has its coloured sources on curve / within 2 turns (hypergeometric).
  // This is a cost, not a ban: 3-5 colour decks still compete, they just pay for the real risk of colour screw.
  const counts = new Map(); for (const i of deck.list) counts.set(i, (counts.get(i) || 0) + 1);
  const deckSpells = [...counts].map(([i, count]) => { spells[i].card.__value = ctx.values[i]; return { card: spells[i].card, count }; });
  const eff = effectiveSources(sources, deckSpells, chosen, colors);
  const cons = consistency(deckSpells, eff.sources, opts.deckSize);
  const scale = deck.list.length / 23;
  // expected value lost to colour screw: each card's value × chance it's stuck on curve (light) or still stuck 2 turns later (heavy)
  let score = -cons.loss;
  const fixingLands = chosen.filter(c => [...(c.produces || '')].filter(x => colors.includes(x)).length >= 2).length;
  const shortfalls = [];
  for (const x of colors) {
    const need = maxPips[x] >= 3 ? (isLimited ? 10 : 15) : maxPips[x] >= 2 ? (isLimited ? 8 : 12) : maxPips[x] >= 1 ? (run.splash === x ? 3 : (isLimited ? 6 : 9)) : 0;
    if (sources[x] < need) shortfalls.push({ color: x, have: sources[x], want: need });
  }
  const totalLands = chosen.length + WUBRG.reduce((a, x) => a + basics[x], 0);
  if (totalLands < L) warnings.push(`Only ${totalLands} lands available — deck is ${L - totalLands} short.`);
  return { nonbasics: chosen, basics, sources, demand, score, shortfalls, warnings, L, consistency: cons, fixingLands, extraFixers: eff.fixers };
}

// ---------------- explanation ----------------
function explain(ctx, r, synWhy) {
  const { spells, n, syn, opts, values } = ctx;
  const d = r.deck;
  const inDeck = new Set(d.list);
  const counts = new Map(); for (const i of d.list) counts.set(i, (counts.get(i) || 0) + 1);
  r.cards = [...counts.entries()].map(([i, k]) => ({
    i, card: spells[i].card, count: k, onPlan: (r.run.archBonus?.[i] || 0) > 0, power: spells[i].power, powerSource: spells[i].powerSource, value: Math.round(values[i]),
    synergy: Math.round(d.synWith[i] * 10) / 10, splash: !!d.splash?.[i],
    roles: [...spells[i].card.tags.roles].map(x => ROLE_LABEL[x] || x),
  })).sort((a, b) => a.card.cmc - b.card.cmc || b.value - a.value);
  // themes
  const themeCount = new Map();
  const pairs = [];
  const uniq = [...inDeck];
  for (let a = 0; a < uniq.length; a++) for (let b = a + 1; b < uniq.length; b++) {
    const s = syn[uniq[a] * n + uniq[b]];
    if (s > 0) { const r = synWhy.get(uniq[a] * n + uniq[b]) || { reasons: [], links: [] }; pairs.push({ a: spells[uniq[a]].card.name, b: spells[uniq[b]].card.name, s, why: r.reasons.map(themeLabel), text: r.links.map(linkText) }); for (const w of r.reasons) themeCount.set(w, (themeCount.get(w) || 0) + 1); }
  }
  r.themes = [...themeCount.entries()].filter(([, k]) => k >= 3).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, k]) => ({ theme: themeLabel(t), links: k }));
  r.topPairs = pairs.sort((a, b) => b.s - a.s).slice(0, 10);
  // curve and stats
  const curve = [0, 0, 0, 0, 0, 0, 0, 0];
  let creatures = 0, removal = 0, draw = 0, cmcSum = 0;
  for (const i of d.list) { const c = spells[i].card; curve[Math.min(7, Math.round(c.cmc))]++; if (c.isCreature) creatures++; if (c.tags.roles.has('removal')) removal++; if (c.tags.roles.has('draw')) draw++; cmcSum += c.cmc; }
  r.stats = { curve, creatures, nonCreatures: d.list.length - creatures, removal, draw, avgCmc: Math.round(cmcSum / Math.max(1, d.list.length) * 100) / 100, lands: r.L, spells: d.list.length };
  // archetype
  const avg = r.stats.avgCmc;
  r.archetype = avg <= 2.6 && creatures >= 15 ? 'Aggro' : (removal + draw >= 9 && creatures <= 13) ? 'Control' : (r.themes[0] && r.themes[0].links >= 6) ? `${r.themes[0].theme.replace("Shared plan: ", "")} synergy` : 'Midrange';
  // sideboard: best excluded cards
  const colors = r.colors;
  r.sideboard = spells.map((e, i) => ({ e, i })).filter(({ e, i }) => !inDeck.has(i) || d.used[i] < e.count)
    .map(({ e, i }) => {
      const ok = inColours(e.card, colors, opts).ok;
      return { i, card: e.card, left: e.count - d.used[i], value: Math.round(values[i]), power: e.power, onColour: ok, reason: !ok ? `Off-colour (${e.card.colors || 'C'})` : d.used[i] > 0 ? 'Extra copy' : 'Cut for curve/synergy' };
    }).sort((a, b) => b.value - a.value);
  // warnings
  const w = [...r.manabase.warnings];
  if (opts.mode === 'limited') {
    if (creatures < 13) w.push(`Only ${creatures} creatures — most sealed decks want 14–17.`);
    if (curve[2] < 4) w.push(`Only ${curve[2]} two-drops — you may fall behind early.`);
    if (removal < 3) w.push('Light on removal — consider any playable interaction from the sideboard.');
  }
  const cons = r.manabase.consistency;
  const nCol = r.colors.length;
  if (nCol >= 3 && cons.risk !== 'Low') w.push(`${nCol}-colour deck with ${r.manabase.fixingLands} dual/fixing land${r.manabase.fixingLands === 1 ? '' : 's'}: about ${Math.round((1 - cons.onCurve) * 100)}% of spells won't have their colours on curve — real risk of colour screw. Pick up any fixing you can.`);
  else if (cons.risk === 'High') w.push(`Colour risk is high: about ${Math.round((1 - cons.onCurve) * 100)}% of spells won't have their colours on curve.`);
  for (const s of r.manabase.shortfalls) w.push(`${s.color} has ${s.have} sources; ${s.want} recommended for its heaviest cost.`);
  r.warnings = w;
  r.setArchetypes = (r.run.archetypes || []).map(a => ({ pair: a.pair, name: a.name, label: a.label, signposts: a.signposts.slice(0, 4), fits: r.cards.filter(x => x.onPlan).reduce((n, x) => n + x.count, 0) }));
  r.combosIn = r.breakdown.combosIn;
  delete r.deck.splash;
}


// ---------------- manual editing ----------------
// Re-score a result after the user edits it. r.deck.list holds spell indices; r.manual (optional) holds {nonbasics:[card], basics:{W..G}}.
export function rescore(r) {
  const ctx = r.ctx; const { spells } = ctx;
  // colours actually needed by the edited deck
  const need = { W: 0, U: 0, B: 0, R: 0, G: 0 }, heavy = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const i of r.deck.list) { const p = pips(spells[i].card.manaCost.split(' // ')[0]); for (const c of WUBRG) if (p[c]) { need[c]++; if (p[c] >= 2) heavy[c]++; } }
  const used = WUBRG.filter(c => need[c] > 0);
  let main = used.filter(c => need[c] > 3 || heavy[c] > 0);
  let splash = used.filter(c => !main.includes(c));
  if (splash.length > 1 || !main.length) { main = used; splash = []; }
  const run = { ...r.run, main: main.join(''), splash: splash.join(''), cmdSyn: r.run.cmdSyn };
  const colors = sortColors(run.main + run.splash);
  const splashCard = new Uint8Array(ctx.n); const castPenalty = new Float32Array(ctx.n);
  for (let i = 0; i < ctx.n; i++) {
    const ok = inColours(spells[i].card, colors, ctx.opts); castPenalty[i] = ok.ok ? ok.penalty * 2 : 0;
    if (run.splash && !inColours(spells[i].card, run.main, ctx.opts).ok) splashCard[i] = 1;
  }
  const deck = { list: [], synWith: new Float32Array(ctx.n), used: new Int16Array(ctx.n), splashCount: 0 };
  for (const i of r.deck.list) addCard(ctx, run, deck, i, splashCard);
  const mb = r.manual ? manualManabase(ctx, run, deck, r.manual) : buildManabase(ctx, run, deck, r.L);
  const sc = deckScore(ctx, run, deck, castPenalty);
  Object.assign(r, { run, colors, main: run.main, splash: run.splash, deck, manabase: mb, L: mb.L, breakdown: { ...sc, mana: mb.score }, score: Math.round(sc.total + mb.score), castPenalty });
  explain(ctx, r, r.synWhy);
  return r;
}

function manualManabase(ctx, run, deck, manual) {
  const colors = sortColors(run.main + run.splash);
  const sources = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const c of manual.nonbasics) for (const x of c.produces || '') if (sources[x] != null) sources[x]++;
  for (const x of WUBRG) sources[x] += manual.basics[x] || 0;
  const counts = new Map(); for (const i of deck.list) counts.set(i, (counts.get(i) || 0) + 1);
  const deckSpells = [...counts].map(([i, count]) => { ctx.spells[i].card.__value = ctx.values[i]; return { card: ctx.spells[i].card, count }; });
  const total = deck.list.length + manual.nonbasics.length + WUBRG.reduce((a, x) => a + (manual.basics[x] || 0), 0);
  const eff = effectiveSources(sources, deckSpells, manual.nonbasics, colors);
  const cons = consistency(deckSpells, eff.sources, Math.max(total, 1));
  const fixingLands = manual.nonbasics.filter(c => [...(c.produces || '')].filter(x => colors.includes(x)).length >= 2).length;
  const L = manual.nonbasics.length + WUBRG.reduce((a, x) => a + (manual.basics[x] || 0), 0);
  const shortfalls = [];
  const warnings = [];
  for (const x of colors) if (!sources[x]) warnings.push(`No ${x} sources at all for your ${x} cards.`);
  return { nonbasics: [...manual.nonbasics], basics: { ...manual.basics }, sources, score: -cons.loss, shortfalls, warnings, L, consistency: cons, fixingLands, extraFixers: eff.fixers };
}
