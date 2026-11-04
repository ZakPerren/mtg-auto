// Colour consistency maths: how likely is each spell to have the right coloured sources by the time you want to cast it?
// Uses the hypergeometric distribution over the cards you've seen (opening 7 + draws), on the play.
import { pips } from './card.js';

const lnFact = (() => { const t = [0]; for (let i = 1; i <= 400; i++) t[i] = t[i - 1] + Math.log(i); return (n) => t[n]; })();
const lnC = (n, k) => (k < 0 || k > n) ? -Infinity : lnFact(n) - lnFact(k) - lnFact(n - k);

// P(X >= k) when drawing n cards from a deck of N containing S successes
export function atLeast(N, S, n, k) {
  if (k <= 0) return 1;
  if (S < k) return 0;
  n = Math.min(n, N);
  let p = 0;
  for (let x = k; x <= Math.min(S, n); x++) p += Math.exp(lnC(S, x) + lnC(N - S, n - x) - lnC(N, n));
  return Math.min(1, p);
}

// Required coloured pips for the cheapest-to-cast half of a card. Hybrid pips count towards whichever deck colour has more sources.
function requirement(card, sources) {
  const halves = card.manaCost.split(' // ');
  let best = null;
  for (const h of halves) {
    const p = pips(h); const need = { W: p.W, U: p.U, B: p.B, R: p.R, G: p.G };
    for (const hy of p.hybrid) {
      const opts = hy.filter(x => 'WUBRG'.includes(x));
      if (hy.includes('generic') || hy.includes('life')) continue; // payable without the colour
      const pick = opts.sort((a, b) => (sources[b] || 0) - (sources[a] || 0))[0];
      if (pick) need[pick]++;
    }
    const total = Object.values(need).reduce((a, b) => a + b, 0);
    if (!best || total < best.total) best = { need, total };
  }
  return best?.need || {};
}

// P(all coloured requirements met after seeing n cards). Colours are treated as independent (a slight approximation).
function castProb(need, sources, N, n) {
  let p = 1;
  for (const [c, k] of Object.entries(need)) if (k > 0) p *= atLeast(N, sources[c] || 0, n, k);
  return p;
}

// deckSpells: [{card, count}], sources: {W..G: count}, N: deck size
export function consistency(deckSpells, sources, N) {
  let wOn = 0, wLate = 0, tot = 0, loss = 0;
  const worst = [];
  for (const { card, count } of deckSpells) {
    const need = requirement(card, sources);
    if (!Object.values(need).some(Boolean)) { wOn += count; wLate += count; tot += count; continue; }
    const turn = Math.max(1, Math.round(card.cmc) || 1);
    const seenOn = 7 + turn - 1;           // on the play
    const pOn = castProb(need, sources, N, seenOn);
    const pLate = castProb(need, sources, N, seenOn + 2);
    wOn += pOn * count; wLate += pLate * count; tot += count;
    loss += count * (card.__value || 60) * (0.35 * (1 - pOn) + 0.6 * (1 - pLate));
    worst.push({ name: card.name, need, turn, pOn, pLate });
  }
  worst.sort((a, b) => a.pOn - b.pOn);
  const onCurve = tot ? wOn / tot : 1, within2 = tot ? wLate / tot : 1;
  const risk = onCurve >= 0.85 ? 'Low' : onCurve >= 0.75 ? 'Medium' : 'High';
  return { onCurve, within2, risk, loss, worst: worst.slice(0, 5) };
}
