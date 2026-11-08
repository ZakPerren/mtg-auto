// Card database: bundled data + Scryfall overlay (IndexedDB). Works offline once loaded.
import { fromBundle, normName } from '../engine/card.js';
import { setKnownTypes } from '../engine/tags.js';
import { idbGet } from './store.js';

// Lower-case, accent-free, punctuation-free key for name search
export function searchKey(s) { return normName(s).replace(/[-/]+/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }

export class CardDB {
  constructor() { this.records = []; this.cards = []; this.byKey = new Map(); this.sets = {}; this.meta = {}; }

  async load(fetchJson, onStatus) {
    onStatus?.('Loading card database…');
    const bundle = await fetchJson('data/cards.json');
    this.meta = { generated: bundle.generated, source: bundle.source, bundled: bundle.count };
    this.sets = bundle.sets;
    this.records = bundle.cards;
    let overlay = null;
    try { overlay = await idbGet('scryfall-overlay'); } catch { /* no IndexedDB (e.g. Node) */ }
    if (overlay?.cards?.length) this.applyOverlay(overlay, false);
    this.index();
    onStatus?.(`${this.cards.length.toLocaleString()} cards ready`);
    return this;
  }

  applyOverlay(overlay, reindex = true) {
    const pos = new Map(this.records.map((r, i) => [r.n, i]));
    let added = 0, updated = 0;
    for (const r of overlay.cards) {
      const i = pos.get(r.n);
      if (i == null) { pos.set(r.n, this.records.length); this.records.push(r); added++; }
      else {
        // keep bundled deck-building hints & rankings; take Scryfall's text/legality/edhrec
        const old = this.records[i];
        this.records[i] = { ...old, ...r, s: [...new Set([...(r.s || []), ...(old.s || [])])].slice(0, 8), hh: old.hh, hn: old.hn, hd: old.hd, lr: old.lr, cr: old.cr };
        updated++;
      }
      for (const s of r.s || []) {
        const idx = pos.get(r.n);
        const st = (this.sets[s] ||= { n: r.setName || s, d: r.d || '', t: 'Expansion', c: [] });
        st.c ||= [];
        if (!st.c.includes(idx)) st.c.push(idx);
        if (r.r) (st.rr ||= {})[idx] = r.r[0];
      }
    }
    this.meta.overlay = { at: overlay.at, added, updated, total: overlay.cards.length };
    if (reindex) this.index();
    return { added, updated };
  }

  index() {
    this.cards = this.records.map(fromBundle);
    this.cards.forEach((c, i) => { c.idx = i; });
    this.byKey = new Map();
    const put = (k, c) => { const key = normName(k); if (!this.byKey.has(key)) this.byKey.set(key, c); };
    for (const c of this.cards) put(c.name, c);
    for (const c of this.cards) { put(c.name.split(' // ')[0], c); for (const f of c.faces) put(f.name, c); }
    // Alchemy rebalanced cards: allow "A-Name" lookups
    const types = new Set();
    for (const r of this.records) if (r.ty?.includes('Creature') || r.ty?.includes('Kindred')) for (const st of r.st || []) types.add(st.toLowerCase());
    setKnownTypes(types);
    this.searchIndex = this.cards.map(c => searchKey(c.name));
  }

  get(name) { return this.byKey.get(normName(name)) || null; }

  setList() {
    return Object.entries(this.sets)
      .filter(([, s]) => s.c?.length)
      .map(([code, s]) => ({ code, name: s.n, date: s.d, type: s.t, count: s.c.length }))
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  cardsInSets(codes) {
    if (!codes?.length) return null;
    const out = new Set();
    for (const code of codes) for (const i of this.sets[code]?.c || []) out.add(i);
    return out;
  }

  rarityIn(card, codes) {
    for (const code of codes || []) { const r = this.sets[code]?.rr?.[card.idx]; if (r) return { c: 'common', u: 'uncommon', r: 'rare', m: 'mythic', s: 'special', l: 'land', t: 'special' }[r] || card.rarity; }
    return card.rarity;
  }

  // Autocomplete: prefix, word-prefix, substring, then typo-tolerant matches. Punctuation is ignored ("ajanis" finds "Ajani's").
  // With a set restriction, falls back to every set (results flagged .outside) when the set has no match.
  search(q, { sets = null, limit = 12, filter = null } = {}) {
    const query = searchKey(q || '');
    if (!query) return [];
    if (sets) {
      const inSet = this._search(query, this.cardsInSets(sets), limit, filter);
      if (inSet.length) return inSet;
      return this._search(query, null, limit, filter).map(c => Object.assign(Object.create(c), { outside: true }));
    }
    return this._search(query, null, limit, filter);
  }
  _search(query, allowed, limit, filter) {
    const pre = [], word = [], sub = [], anyOrder = [];
    const qWords = query.split(' ').filter(Boolean);
    const pool = allowed ? [...allowed] : this.cards.map((_, i) => i);
    for (const i of pool) {
      const nm = this.searchIndex[i];
      const c = this.cards[i];
      if (filter && !filter(c)) continue;
      if (nm.startsWith(query)) pre.push(c);
      else if (nm.includes(' ' + query) || nm.includes('-' + query)) word.push(c);
      else if (query.length >= 3 && nm.includes(query)) sub.push(c);
      else if (qWords.length > 1 && qWords.every(w => nm.split(' ').some(x => x.startsWith(w)))) anyOrder.push(c);
      if (pre.length >= limit) break;
    }
    const byLen = (a, b) => a.name.length - b.name.length;
    const out = [...pre.sort(byLen), ...word.sort(byLen), ...sub.sort(byLen), ...anyOrder.sort(byLen)].slice(0, limit);
    if (out.length || query.length < 4) return out;
    // nothing matched: typo-tolerant pass (letter-pair similarity against the start of each name)
    const grams = (s) => { const g = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); g.set(k, (g.get(k) || 0) + 1); } return g; };
    const qg = grams(query); const qn = Math.max(1, query.length - 1);
    const scored = [];
    for (const i of pool) {
      const c = this.cards[i]; if (filter && !filter(c)) continue;
      const nm = this.searchIndex[i].slice(0, query.length + 2);
      const ng = grams(nm); let hit = 0;
      for (const [k, v] of qg) hit += Math.min(v, ng.get(k) || 0);
      const sim = (2 * hit) / (qn + Math.max(1, nm.length - 1));
      if (sim >= 0.6) scored.push([sim, c]);
    }
    return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map(x => Object.assign(Object.create(x[1]), { fuzzy: true }));
  }

  // Full-text card search used by the card browser: supports t:, o:, c:, s:, r:, mv<=, name text
  query(q, limit = 200) {
    const terms = (q || '').match(/(\w+(?:<=|>=|[:<>=])"[^"]*"|\w+(?:<=|>=|[:<>=])\S+|"[^"]*"|\S+)/g) || [];
    const tests = [];
    let setFilter = null;
    for (let term of terms) {
      const neg = term.startsWith('-'); if (neg) term = term.slice(1);
      const m = term.match(/^(\w+)(<=|>=|[:<>=])(.+)$/);
      let fn;
      if (m) {
        const [, k, op, raw] = m; const v = raw.replace(/^"|"$/g, '').toLowerCase();
        const cmp = (x, y) => op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : op === '>=' ? x >= y : x === y;
        switch (k.toLowerCase()) {
          case 't': case 'type': fn = c => c.typeLine.toLowerCase().includes(v) || c.faces.some(f => f.typeLine.toLowerCase().includes(v)); break;
          case 'o': case 'oracle': fn = c => c.fullText.toLowerCase().includes(v); break;
          case 'c': case 'color': fn = c => { const cs = v.toUpperCase().replace('C', ''); if (v === 'c') return !c.colors; return op === '=' ? c.colors === cs : [...cs].every(x => c.colors.includes(x)); }; break;
          case 'id': fn = c => [...c.identity].every(x => v.toUpperCase().includes(x)); break;
          case 's': case 'set': setFilter = (setFilter || []).concat(v.toUpperCase()); continue;
          case 'r': case 'rarity': fn = c => c.rarity.startsWith(v); break;
          case 'mv': case 'cmc': fn = c => cmp(c.cmc, +v); break;
          case 'pow': fn = c => c.pw != null && cmp(c.pw, +v); break;
          case 'kw': case 'keyword': fn = c => c.keywords.some(k => k.toLowerCase() === v) || new RegExp(`\\b${v}\\b`).test(c.text); break;
          case 'f': case 'format': fn = c => c.legal.some(l => l.replace('*', '') === v); break;
          default: fn = c => c.name.toLowerCase().includes(term.toLowerCase());
        }
      } else { const v = searchKey(term.replace(/^"|"$/g, '')); fn = c => searchKey(c.name).includes(v); }
      tests.push(neg ? (c => !fn(c)) : fn);
    }
    const allowed = setFilter ? this.cardsInSets(setFilter) : null;
    const out = [];
    const src = allowed ? [...allowed].map(i => this.cards[i]) : this.cards;
    for (const c of src) { if (tests.every(t => t(c))) { out.push(c); if (out.length >= limit) break; } }
    return out;
  }
}
