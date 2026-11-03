// Comprehensive Rules access: lookup, search, keyword linking and a card-interaction explainer.
import { pairSynergy, themeLabel, linkText } from './tags.js';

export class Rules {
  constructor(data) {
    this.data = data;
    this.rules = data.rules;            // id -> [text, examples?]
    this.ids = Object.keys(this.rules);
    this.sections = data.sections;
    this.glossary = data.glossary;
    // keyword abilities (702.x) and keyword actions (701.x) by title
    this.keywords = [];
    for (const id of this.ids) {
      if (/^70[12]\.\d+$/.test(id)) {
        const title = this.rules[id][0].trim();
        if (title.length < 40) this.keywords.push({ id, title, kind: id.startsWith('701') ? 'action' : 'ability', re: new RegExp(`\\b${escapeRe(title.toLowerCase())}\\b`) });
      }
    }
    this.keywords.sort((a, b) => b.title.length - a.title.length);
    this.tokens = this.ids.map(id => tokenize(this.rules[id][0]));
  }
  get effective() { return this.data.effective || this.data.metadata?.effectiveDate || ''; }
  text(id) { return this.rules[id]?.[0] || ''; }
  examples(id) { return this.rules[id]?.[1] || []; }
  children(id) { return this.ids.filter(x => x !== id && (x.startsWith(id + '.') || (x.startsWith(id) && /^[a-z]$/.test(x.slice(id.length))))); }
  sectionTitle(id) { const s = id.split('.')[0]; return this.sections[s]?.title || this.sections[s[0]]?.title || ''; }

  // Find the first rule under `prefix` whose text contains every phrase.
  find(phrases, prefix = '') {
    const ps = phrases.map(p => p.toLowerCase());
    for (const id of this.ids) if (id.startsWith(prefix) && ps.every(p => this.rules[id][0].toLowerCase().includes(p))) return id;
    return null;
  }
  keyword(name) { const k = this.keywords.find(k => k.title.toLowerCase() === name.toLowerCase()); return k ? k.id : null; }

  // Keyword abilities/actions that appear on a card
  keywordsOn(card) {
    const t = (card.text || '').toLowerCase();
    const kws = new Set((card.keywords || []).map(k => k.toLowerCase()));
    const out = []; const seen = new Set();
    for (const k of this.keywords) {
      const tl = k.title.toLowerCase();
      if (seen.has(tl)) continue;
      if (kws.has(tl) || k.re.test(t)) {
        // avoid matching short generic words used non-keyword-ishly
        if (['attach', 'cast', 'counter', 'play', 'reveal', 'tap and untap', 'shuffle', 'vote', 'activate', 'double', 'exchange', 'create', 'exile'].includes(tl)) continue;
        if (tl === 'exile' && !/\bexile\b/.test(t)) continue;
        seen.add(tl); out.push(k);
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  }

  search(q, limit = 40) {
    const query = q.trim();
    if (!query) return [];
    if (/^\d{3}(\.\d+[a-z]?)?$/.test(query)) return this.ids.filter(id => id === query || id.startsWith(query + '.') || id.startsWith(query)).slice(0, limit).map(id => ({ id, score: 99 }));
    const qt = tokenize(query);
    if (!qt.length) return [];
    const phrase = query.toLowerCase();
    const scored = [];
    for (let i = 0; i < this.ids.length; i++) {
      const tk = this.tokens[i]; let s = 0;
      for (const w of qt) { const n = tk.filter(x => x === w).length; if (n) s += 1 + Math.log(n); else if (tk.some(x => x.startsWith(w))) s += 0.5; }
      if (!s) continue;
      const text = this.rules[this.ids[i]][0].toLowerCase();
      if (text.includes(phrase)) s += 3;
      if (/^70[12]\.\d+$/.test(this.ids[i]) && text.trim() === phrase) s += 10;
      s /= Math.sqrt(1 + tk.length / 40);
      scored.push({ id: this.ids[i], score: s });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  glossarySearch(q, limit = 10) {
    const s = q.toLowerCase().trim(); if (!s) return [];
    return Object.entries(this.glossary).filter(([k]) => k.toLowerCase().includes(s)).sort((a, b) => a[0].length - b[0].length).slice(0, limit).map(([term, text]) => ({ term, text }));
  }

  // ---- interaction explainer for 2+ cards ----
  explain(cards) {
    const notes = [];
    const anyHas = (fn) => cards.some(fn);
    const pairs = [];
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
      const r = pairSynergy(cards[i], cards[j]);
      if (r.score > 0) pairs.push({ a: cards[i].name, b: cards[j].name, why: r.reasons.map(themeLabel), text: r.links.map(linkText) });
    }
    for (const n of INTERACTIONS) {
      if (n.test(cards, anyHas)) notes.push({ title: n.title, text: n.text, rules: n.rules.map(r => this.find(r.find, r.pre || '')).filter(Boolean) });
    }
    const perCard = cards.map(c => ({ name: c.name, keywords: this.keywordsOn(c) }));
    return { pairs, notes, perCard };
  }
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or', 'is', 'in', 'that', 'it', 'its', 'on', 'for', 'as', 'be', 'by', 'with', 'if', 'this', 'are', 'can', 'from', 'at', 'any', 'which', 'has', 'have', 'than', 'what', 'how', 'does', 'do', 'when', 'i', 'my']);
function tokenize(s) { return (s.toLowerCase().match(/[a-z0-9+\-/]+/g) || []).filter(w => !STOP.has(w) && w.length > 1); }

// helpers for interaction tests
const kw = (c, k) => (c.keywords || []).some(x => x.toLowerCase() === k) || new RegExp(`(^|\\n|, )${k}(\\b|,|$)`).test(c.text) || new RegExp(`(gains?|have|has) [^.]*\\b${k}\\b`).test(c.text);
const txt = (c, re) => re.test(c.text);
const two = (cards, f, g) => cards.some((a, i) => f(a) && cards.some((b, j) => (j !== i || cards.length === 1) && g(b))) || cards.some(a => f(a) && g(a));

const INTERACTIONS = [
  { title: 'Deathtouch + trample', test: (cs) => two(cs, c => kw(c, 'deathtouch'), c => kw(c, 'trample')),
    text: 'With deathtouch, 1 damage counts as lethal damage when assigning combat damage. A trampler with deathtouch only has to assign 1 damage to each blocker and can assign the rest to the player.', rules: [{ find: ['deathtouch'], pre: '702.19' }, { find: ['lethal damage'], pre: '702.2c' }] },
  { title: 'Deathtouch + first strike / double strike', test: (cs) => two(cs, c => kw(c, 'deathtouch'), c => kw(c, 'first strike') || kw(c, 'double strike')),
    text: 'First-strike damage is dealt in its own combat damage step. A first striker with deathtouch destroys its blockers (or attackers) before they deal regular damage back.', rules: [{ find: ['first strike'], pre: '702.7b' }, { find: ['deathtouch'], pre: '702.2' }] },
  { title: 'Deathtouch + fight / "deals damage"', test: (cs) => two(cs, c => kw(c, 'deathtouch'), c => txt(c, /fights?|deals damage equal to its power/)),
    text: 'Any amount of damage from a source with deathtouch destroys the creature it was dealt to — that includes fight and "bite" damage, not just combat.', rules: [{ find: ['deathtouch'], pre: '702.2b' }] },
  { title: 'Sacrifice and "dies"', test: (cs) => two(cs, c => txt(c, /sacrifice/), c => txt(c, /dies|is put into a graveyard from the battlefield/)),
    text: '"Dies" means put into a graveyard from the battlefield. Sacrificing a creature makes it die, so death triggers fire. Sacrifice also gets around indestructible and regeneration.', rules: [{ find: ['dies means'], pre: '700.4' }, { find: ['sacrifice'], pre: '701.21a' }] },
  { title: 'Indestructible', test: (cs) => cs.some(c => kw(c, 'indestructible')),
    text: 'Indestructible permanents ignore "destroy" effects and lethal damage, but still leave play to sacrifice, exile, bounce, or toughness reduced to 0 or less (e.g. -X/-X).', rules: [{ find: ['indestructible'], pre: '702.12b' }, { find: ['toughness 0 or less'], pre: '704.5f' }] },
  { title: 'Tokens leaving the battlefield', test: (cs) => two(cs, c => c.tags?.roles.has('token'), c => txt(c, /return [^.]*(to (its|their) owner's hand|to the battlefield)|exile [^.]*then return/)),
    text: 'A token that leaves the battlefield ceases to exist. Bounced or flickered tokens do not come back; tokens in the graveyard still count as "dying" first, so death triggers do fire.', rules: [{ find: ['token', 'ceases to exist'], pre: '111' }, { find: ['token that has left the battlefield'], pre: '111' }] },
  { title: '+1/+1 and -1/-1 counters cancel out', test: (cs) => two(cs, c => txt(c, /\+1\/\+1 counter/), c => txt(c, /-1\/-1 counter|\bpersist\b|\bwither\b|\binfect\b/) || kw(c, 'persist')),
    text: 'If a permanent has both +1/+1 and -1/-1 counters, pairs are removed as a state-based action. A persist creature that gets a +1/+1 counter loses its -1/-1 counter and can persist again — the basis of many sacrifice loops.', rules: [{ find: ['+1/+1 counter and a -1/-1 counter'], pre: '704.5' }, { find: ['persist'], pre: '702.79' }] },
  { title: 'Undying and +1/+1 counters', test: (cs) => two(cs, c => kw(c, 'undying'), c => txt(c, /-1\/-1 counter/)),
    text: 'Undying only returns a creature that had no +1/+1 counter on it. Removing that counter (for example with a -1/-1 counter) lets it return again.', rules: [{ find: ['undying'], pre: '702.93' }] },
  { title: 'Legend rule', test: (cs) => cs.some(c => c.isLegendary && c.isPermanent) && (cs.length > 1 && new Set(cs.map(c => c.name)).size < cs.length || cs.some(c => /create a token that's a copy|copy of (target|another)/.test(c.text))),
    text: 'If you control two or more legendary permanents with the same name, you choose one and put the rest into the graveyard (state-based action). Copying your own legend usually only gives a quick ETB/"dies" trigger.', rules: [{ find: ['legendary permanents with the same name'], pre: '704.5' }] },
  { title: 'Hexproof, ward and your own spells', test: (cs) => two(cs, c => kw(c, 'hexproof') || kw(c, 'ward'), c => txt(c, /target creature/)),
    text: 'Hexproof only stops opponents from targeting, and ward only taxes opponents\' spells and abilities. You can still target your own hexproof/ward creatures with Auras, pump spells and abilities.', rules: [{ find: ['hexproof'], pre: '702.11b' }, { find: ['ward'], pre: '702.21a' }] },
  { title: 'Protection (DEBT)', test: (cs) => cs.some(c => /protection from/.test(c.text)),
    text: 'Protection stops Damage, Enchanting/Equipping, Blocking and Targeting by things with that quality. Your own Aura or Equipment of that quality falls off too.', rules: [{ find: ['protection'], pre: '702.16' }] },
  { title: 'Lifelink and life-gain triggers', test: (cs) => two(cs, c => kw(c, 'lifelink'), c => txt(c, /whenever you gain life/)),
    text: 'Lifelink damage causes life gain at the same time as the damage. Each separate damage event (for example first-strike and regular damage) triggers "whenever you gain life" separately.', rules: [{ find: ['lifelink'], pre: '702.15b' }] },
  { title: 'Double strike multiplies triggers', test: (cs) => two(cs, c => kw(c, 'double strike'), c => txt(c, /whenever ~ deals (combat )?damage|deals combat damage to a player/) || kw(c, 'lifelink') || kw(c, 'deathtouch')),
    text: 'Double strike deals damage in both combat damage steps, so "deals combat damage" triggers and lifelink happen twice.', rules: [{ find: ['double strike'], pre: '702.4b' }] },
  { title: 'Flicker and enters-the-battlefield triggers', test: (cs) => two(cs, c => c.tags?.gives.has('blink'), c => c.tags?.roles.has('etbValue') || txt(c, /when ~ enters/)),
    text: 'An exiled-and-returned permanent comes back as a new object: its enters trigger fires again, but counters, Auras, damage and "until end of turn" effects on the old object are gone.', rules: [{ find: ['becomes a new object'], pre: '400.7' }, { find: ['zone-change triggers'], pre: '603.6' }] },
  { title: 'Death payoffs see creatures that die at the same time', test: (cs) => two(cs, c => c.tags?.wants.has('death'), c => c.tags?.roles.has('wipe') || c.tags?.gives.has('death')),
    text: 'Leaves-the-battlefield and "dies" triggers "look back in time": a payoff that dies in the same board wipe still triggers for every other creature that died alongside it.', rules: [{ find: ['look back in time'], pre: '603.10' }] },
  { title: 'Prowess / magecraft and copies', test: (cs) => two(cs, c => kw(c, 'prowess') || /magecraft|whenever you cast/.test(c.text), c => /copy (target|that|it)/.test(c.text)),
    text: 'Copying a spell is not casting it. Prowess and "whenever you cast" do not trigger for copies; magecraft explicitly triggers on cast or copy.', rules: [{ find: ['prowess'], pre: '702.108' }, { find: ['copy of a spell', 'cast'], pre: '707.10' }] },
  { title: 'Aura falls off when its creature leaves', test: (cs) => cs.some(c => c.subtypes?.includes('Aura')),
    text: 'An Aura attached to an illegal object or nothing is put into its owner\'s graveyard as a state-based action — removal on the creature costs you both cards (Equipment stays on the battlefield instead).', rules: [{ find: ['aura', 'illegal object'], pre: '704.5' }] },
  { title: 'Convoke and tokens', test: (cs) => two(cs, c => kw(c, 'convoke'), c => c.tags?.gives.has('tokens')),
    text: 'Each creature tapped for convoke pays for {1} or one mana of its colour; summoning-sick tokens can convoke.', rules: [{ find: ['convoke'], pre: '702.51' }] },
  { title: 'Food, Clues, Treasure are artifacts', test: (cs) => two(cs, c => /(food|clue|treasure|blood|map) token/.test(c.text), c => c.tags?.wants.has('artifacts')),
    text: 'Food, Clue, Treasure, Blood and Map tokens are artifacts, so they count for artifact payoffs (affinity, improvise, metalcraft, "artifact enters").', rules: [{ find: ['food'], pre: '111.10' }] },
  { title: 'Proliferate adds every counter kind', test: (cs) => cs.some(c => /\bproliferate\b/.test(c.text)),
    text: 'Proliferate adds one more of each kind of counter already there on any permanents and players you choose — +1/+1, loyalty, poison, oil, etc.', rules: [{ find: ['proliferate'], pre: '701.34a' }] },
  { title: 'Counterspells vs "can\'t be countered"', test: (cs) => two(cs, c => c.tags?.roles.has('counter'), c => /can't be countered/.test(c.text)),
    text: '"Can\'t be countered" spells can still be targeted by a counterspell, but the counter effect does nothing to them.', rules: [{ find: ["can’t be countered"], pre: '' }] },
  { title: 'Adventure cards', test: (cs) => cs.some(c => c.layout === 'adventure'),
    text: 'Casting the Adventure half puts the card into exile when it resolves; you may later cast the creature from exile. If the Adventure is countered it goes to the graveyard instead.', rules: [{ find: ['adventure'], pre: '715.3' }] },
  { title: 'Persist with -1/-1 counter prevention', test: (cs) => two(cs, c => kw(c, 'persist'), c => /can't have -1\/-1 counters|-1\/-1 counters can't be put|if one or more -1\/-1 counters would be put/.test(c.text)),
    text: 'Persist returns the creature with a -1/-1 counter only if it had none. If -1/-1 counters can\'t be placed (or are removed), it returns clean every time — with a free sacrifice outlet that is an infinite loop.', rules: [{ find: ['persist'], pre: '702.79' }] },
];
