// Combos: a small built-in list of well-known combos (works offline) plus Commander Spellbook lookups (online, cached).
import { normName } from './card.js';
import { idbGet, idbSet } from '../data/store.js';

export const BUILTIN_COMBOS = [
  { cards: ["Thassa's Oracle", 'Demonic Consultation'], result: 'Win the game (exile your library, then Oracle trigger)' },
  { cards: ["Thassa's Oracle", 'Tainted Pact'], result: 'Win the game (exile your library, then Oracle trigger)' },
  { cards: ['Splinter Twin', 'Pestermite'], result: 'Infinite hasty tokens' },
  { cards: ['Splinter Twin', 'Deceiver Exarch'], result: 'Infinite hasty tokens' },
  { cards: ['Kiki-Jiki, Mirror Breaker', 'Pestermite'], result: 'Infinite hasty tokens' },
  { cards: ['Kiki-Jiki, Mirror Breaker', 'Deceiver Exarch'], result: 'Infinite hasty tokens' },
  { cards: ['Kiki-Jiki, Mirror Breaker', 'Zealous Conscripts'], result: 'Infinite hasty tokens' },
  { cards: ['Kiki-Jiki, Mirror Breaker', 'Restoration Angel'], result: 'Infinite hasty tokens' },
  { cards: ['Saheeli Rai', 'Felidar Guardian'], result: 'Infinite tokens / ETB triggers' },
  { cards: ['Dramatic Reversal', 'Isochron Scepter'], result: 'Infinite mana (needs nonland mana rocks producing 3+ mana)' },
  { cards: ['Heliod, Sun-Crowned', 'Walking Ballista'], result: 'Infinite damage (give Ballista lifelink)' },
  { cards: ['Exquisite Blood', 'Sanguine Bond'], result: 'Infinite life drain' },
  { cards: ['Exquisite Blood', 'Vito, Thorn of the Dusk Rose'], result: 'Infinite life drain' },
  { cards: ['Devoted Druid', 'Vizier of Remedies'], result: 'Infinite green mana' },
  { cards: ["Painter's Servant", 'Grindstone'], result: "Mill an opponent's entire library" },
  { cards: ['Basalt Monolith', 'Rings of Brighthearth'], result: 'Infinite colourless mana' },
  { cards: ['Kinnan, Bonder Prodigy', 'Basalt Monolith'], result: 'Infinite colourless mana' },
  { cards: ['Dualcaster Mage', 'Twinflame'], result: 'Infinite hasty tokens' },
  { cards: ['Worldgorger Dragon', 'Animate Dead'], result: 'Infinite ETB/LTB loop and mana' },
  { cards: ['Niv-Mizzet, Parun', 'Curiosity'], result: 'Infinite damage on any card draw' },
  { cards: ['Niv-Mizzet, the Firemind', 'Curiosity'], result: 'Infinite damage on any card draw' },
  { cards: ['Peregrine Drake', 'Deadeye Navigator'], result: 'Infinite mana' },
  { cards: ['Bloodchief Ascension', 'Mindcrank'], result: 'Opponents lose all life (once Ascension has 3 quest counters)' },
  { cards: ['Mikaeus, the Unhallowed', 'Triskelion'], result: 'Infinite damage' },
  { cards: ['Scurry Oak', 'Ivy Lane Denizen'], result: 'Infinite Squirrel tokens' },
  { cards: ['Food Chain', 'Misthollow Griffin'], result: 'Infinite mana for creature spells' },
  { cards: ['Food Chain', 'Eternal Scourge'], result: 'Infinite mana for creature spells' },
  { cards: ['Sword of the Meek', 'Thopter Foundry'], result: 'Infinite Thopters and life (with spare mana)' },
  { cards: ['Pili-Pala', 'Grand Architect'], result: 'Infinite mana' },
  { cards: ['Earthcraft', 'Squirrel Nest'], result: 'Infinite Squirrel tokens' },
  { cards: ['Archaeomancer', 'Ghostly Flicker', 'Peregrine Drake'], result: 'Infinite mana' },
  { cards: ['Underworld Breach', "Lion's Eye Diamond", 'Brain Freeze'], result: 'Mill all opponents / storm' },
  { cards: ['Kitchen Finks', 'Melira, Sylvok Outcast', 'Viscera Seer'], result: 'Infinite life and sacrifice triggers' },
  { cards: ['Kitchen Finks', 'Melira, Sylvok Outcast', 'Carrion Feeder'], result: 'Infinite life and sacrifice triggers' },
];

export function combosInPool(poolCards, extra = []) {
  const keys = new Set();
  for (const c of poolCards) { keys.add(c.key); keys.add(normName(c.name.split(' // ')[0])); }
  const out = [];
  for (const cb of [...BUILTIN_COMBOS.map(c => ({ ...c, source: 'built-in' })), ...extra]) {
    if (cb.cards.every(n => keys.has(normName(n)))) out.push(cb);
  }
  return dedupe(out);
}
function dedupe(list) { const seen = new Set(); return list.filter(c => { const k = c.cards.map(normName).sort().join('|'); if (seen.has(k)) return false; seen.add(k); return true; }); }

// Commander Spellbook "find my combos" for a list of card names. Cached so it works offline afterwards.
export async function spellbookCombos(names, commanders = []) {
  const key = 'csb:' + [...names].map(normName).sort().join('|').slice(0, 2000) + '#' + names.length;
  try { const cached = await idbGet(key); if (cached) return { combos: cached, cached: true }; } catch { /* ignore */ }
  const body = { main: names.map(n => ({ card: n.split(' // ')[0] })), commanders: commanders.map(n => ({ card: n })) };
  const res = await fetch('https://backend.commanderspellbook.com/find-my-combos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error('Commander Spellbook returned ' + res.status);
  const data = await res.json();
  const results = data.results || data;
  const variants = [...(results.included || []), ...(results.includedByChangingCommanders || [])];
  const combos = variants.map(v => ({
    cards: (v.uses || []).map(u => u.card?.name || u.name).filter(Boolean),
    result: (v.produces || []).map(p => p.feature?.name || p.name).filter(Boolean).slice(0, 4).join('; '),
    requires: (v.requires || []).map(r => r.template?.name || r.name).filter(Boolean).join('; '),
    steps: v.description || '',
    url: v.id ? `https://commanderspellbook.com/combo/${v.id}/` : '',
    source: 'Commander Spellbook',
  })).filter(c => c.cards.length);
  try { await idbSet(key, combos); } catch { /* ignore */ }
  return { combos, cached: false };
}
