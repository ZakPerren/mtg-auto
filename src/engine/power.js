// Card strength estimate on a 0–100 scale.
// Limited: driven by per-set pick-order rankings where available, otherwise an oracle-text heuristic.
// Constructed/Commander: CubeCobra / EDHREC ranks where available, otherwise the heuristic.

const KW_BONUS = { flying: 6, deathtouch: 4, lifelink: 3, 'first strike': 3, 'double strike': 7, trample: 2, vigilance: 1, menace: 3, hexproof: 3, haste: 2, flash: 2, ward: 3, reach: 1, indestructible: 5, prowess: 2 };
const RARITY_BASE = { common: 44, uncommon: 50, rare: 57, mythic: 60, special: 55, land: 30 };

export function heuristicPower(c) {
  const roles = c.tags.roles;
  if (c.isLand) {
    if (c.isBasic) return 30;
    const cols = (c.produces || '').replace('C', '').length;
    return 35 + cols * 6 + (/(draw|create|deals|destroy|exile|\+1\/\+1)/.test(c.text) ? 6 : 0);
  }
  let p = RARITY_BASE[c.rarity] ?? 45;
  const t = c.text;
  if (c.isCreature) {
    const stats = (c.pw || 0) + (c.tough || 0);
    const expected = c.cmc * 2 + 1;
    p += Math.max(-10, Math.min(8, (stats - expected) * 2.2));
    const kws = new Set((c.keywords || []).map(k => k.toLowerCase()));
    for (const [k, v] of Object.entries(KW_BONUS)) if (kws.has(k)) p += v;
    if (roles.has('etbValue')) p += 4;
    if (/\{t\}:|\{\d\}:|\{[wubrg]\}:/.test(t)) p += 2;
    if (c.pw === 0 && !roles.size) p -= 6;
  }
  if (roles.has('hardRemoval')) p += 16;
  else if (roles.has('removal')) p += 12;
  else if (roles.has('softRemoval')) p += 5;
  if (roles.has('wipe')) p += 8;
  if (roles.has('counter')) p += 3;
  if (roles.has('draw')) p += 7;
  else if (roles.has('cantrip')) p += 2;
  if (roles.has('token') && !c.isCreature) p += 4;
  if (roles.has('trick')) p += 1;
  if (roles.has('recursion')) p += 2;
  if (roles.has('tutor')) p += 3;
  if (c.subtypes.includes('Aura') && !roles.has('removal')) p -= 4;
  if (c.subtypes.includes('Equipment')) p += 1;
  if (c.types.includes('Planeswalker')) p += 14;
  if (c.cmc >= 7 && !roles.has('wipe') && !roles.has('draw')) p -= 4;
  if (c.cmc === 0 && !c.isCreature) p -= 2;
  // text with only a vanilla effect on non-creatures
  if (!c.isCreature && !roles.size && !c.tags.gives.size) p -= 6;
  return Math.max(10, Math.min(92, p));
}

// mode: 'limited' | 'constructed' | 'commander'. sets: preferred set codes (the pool's sets)
export function powerOf(c, mode, sets) {
  const h = heuristicPower(c);
  if (mode === 'limited') {
    if (c.limitedRank && !c.isBasic) {
      let pct = null;
      for (const s of sets || []) if (c.limitedRank[s] != null) { pct = c.limitedRank[s]; break; }
      if (pct == null) {
        const vals = Object.entries(c.limitedRank).sort((a, b) => (c.sets.indexOf(a[0]) + 99) % 99 - (c.sets.indexOf(b[0]) + 99) % 99);
        pct = vals.length ? vals[0][1] : null;
      }
      if (pct != null) {
        // rankings rank rares/mythics high even when narrow; blend with heuristic a little
        const ranked = 30 + 65 * pct;
        return { value: Math.round(ranked * 0.8 + h * 0.2), source: 'ranking' };
      }
    }
    return { value: Math.round(h), source: 'heuristic' };
  }
  let best = h, source = 'heuristic';
  if (c.cubeRank) { const v = 62 + 36 * (1 - c.cubeRank / 4000); if (v > best) { best = v; source = 'cube'; } }
  if (c.edhrecRank && mode === 'commander') { const v = 96 - 46 * (Math.log(c.edhrecRank) / Math.log(30000)); if (v > best) { best = v; source = 'edhrec'; } }
  return { value: Math.round(Math.min(98, best)), source };
}
