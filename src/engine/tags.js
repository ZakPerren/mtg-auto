// Oracle-text analysis: functional roles and synergy themes.
// Each theme has producers ("gives") and payoffs ("wants"); a producer and a payoff in the same deck synergise.

export const ROLE_LABEL = {
  removal: 'Removal', hardRemoval: 'Hard removal', softRemoval: 'Soft removal', wipe: 'Board wipe', counter: 'Counterspell',
  draw: 'Card advantage', cantrip: 'Cantrip', ramp: 'Ramp', fixing: 'Mana fixing', tutor: 'Tutor', evasion: 'Evasion',
  trick: 'Combat trick', protection: 'Protection', burn: 'Direct damage to players', recursion: 'Recursion', discard: 'Hand disruption',
  finisher: 'Finisher', lifegain: 'Life gain', etbValue: 'Enters-the-battlefield value', haste: 'Haste', flash: 'Flash', token: 'Token maker',
};

export const THEMES = {
  counters: { label: '+1/+1 counters', w: 1.0 },
  tokens: { label: 'Go-wide tokens', w: 0.9 },
  death: { label: 'Sacrifice / death triggers', w: 1.1 },
  lifegain: { label: 'Life gain payoffs', w: 1.0 },
  spells: { label: 'Instants & sorceries', w: 1.0 },
  artifacts: { label: 'Artifacts matter', w: 1.0 },
  enchantments: { label: 'Enchantments matter', w: 1.0 },
  graveyard: { label: 'Graveyard', w: 0.9 },
  landfall: { label: 'Landfall / extra lands', w: 1.0 },
  draw: { label: 'Card-draw triggers', w: 0.8 },
  blink: { label: 'Flicker / ETB', w: 0.9 },
  discard: { label: 'Discard / madness', w: 0.9 },
  cycling: { label: 'Cycling', w: 0.9 },
  voltron: { label: 'Equipment & Auras', w: 0.7 },
  attack: { label: 'Attack triggers', w: 0.6 },
  bigmana: { label: 'Ramp into big spells', w: 0.6 },
  energy: { label: 'Energy', w: 1.0 },
  food: { label: 'Food', w: 1.0 }, clue: { label: 'Clues', w: 1.0 }, treasure: { label: 'Treasure', w: 0.8 }, blood: { label: 'Blood tokens', w: 1.0 },
  untap: { label: 'Untap / tap abilities', w: 0.6 },
  mill: { label: 'Mill opponents', w: 0.9 },
  poison: { label: 'Poison / proliferate', w: 1.1 },
  legends: { label: 'Legends / historic', w: 0.8 },
  copy: { label: 'Copy spells', w: 0.8 },
  vehicles: { label: 'Vehicles & crew', w: 0.8 },
  flyers: { label: 'Flyers matter', w: 0.6 },
  multicolor: { label: 'Multicolour matters', w: 0.7 },
  lessons: { label: 'Lessons', w: 1.0 },
  opponentsDraw: { label: 'Opponents draw', w: 0.8 },
};

let KNOWN_TYPES = null;
const EVERGREEN = new Set(['flying', 'trample', 'vigilance', 'haste', 'reach', 'deathtouch', 'lifelink', 'menace', 'first strike', 'double strike', 'defender', 'hexproof', 'indestructible', 'flash', 'ward', 'enchant', 'equip', 'protection', 'prowess', 'kicker', 'scry', 'mill', 'fight', 'cycling', 'choose one', 'choose two', 'etbreplacement', 'changeling']);
const NOT_TYPAL = new Set(['creature', 'land', 'planeswalker', 'battle', 'kindred', 'tribal', 'card', 'token', 'permanent', 'spell', 'town', 'legendary', 'basic', 'snow']);
export function setKnownTypes(set) { KNOWN_TYPES = set; }

export function analyse(c) {
  const t = c.text;
  const roles = new Set();
  const gives = new Set();
  const wants = new Set();
  const kw = new Set((c.keywords || []).map(k => k.toLowerCase()));
  const kwHas = (k) => kw.has(k) || new RegExp(`(^|\\n|, )${k}(\\b|$)`).test(t);

  // ---------- roles ----------
  const targetsCreature = /(target|each|all) (creature|creatures|nonland permanent|permanent|artifact or creature|creature or planeswalker|creature or vehicle|attacking creature|blocking creature|attacking or blocking creature|tapped creature|creature an opponent controls|creature with|nonland permanents|permanents)/;
  for (const m of t.matchAll(/\b(destroy|exile) (target|up to one target|another target|up to two target|two target)([^.]*?)(creature|permanent|planeswalker|artifact|enchantment|battle)([^.]*)/g)) {
    const seg = m[3] + m[4] + m[5];
    if (/you control|you own|card from|cards? in|from (a|your|an opponent's) graveyard|, then return/.test(seg) && !/you don't control|an opponent controls/.test(seg)) continue;
    roles.add('removal'); roles.add('hardRemoval');
  }
  if (/(target opponent|each opponent|target player) (exiles|sacrifices) an? (creature|attacking creature|nonland permanent|creature or planeswalker)/.test(t)) { roles.add('removal'); roles.add('hardRemoval'); }
  if (/deals? (\d+|x|that much|damage equal to)[^.]*?(damage )?to (any target|target creature|target attacking|target blocking|target tapped|another target creature|target creature or planeswalker|target creature an opponent controls|up to one target creature|each creature your opponents control|target creature or vehicle)/.test(t)) { roles.add('removal'); }
  if (/(fights?|deals damage equal to its power to (target|up to one target|another target))/.test(t) && /target/.test(t)) roles.add('removal');
  if (/target creature[^.]*gets -\d+\/-\d+|target creature[^.]*gets -x\/-x|put (a|two|three|x) -1\/-1 counters? on target/.test(t)) roles.add('removal');
  if (/enchanted creature (can't attack or block|can't block, and its activated|doesn't untap|loses all abilities)|enchanted creature can't attack/.test(t) && c.subtypes.includes('Aura')) { roles.add('removal'); roles.add('softRemoval'); }
  if (/return target (creature|nonland permanent|permanent)[^.]*to (its|their) owner's hand/.test(t)) roles.add('softRemoval');
  if (/target (creature|player)[^.]*(sacrifices?|sacrifice) /.test(t) || /each opponent sacrifices/.test(t)) { roles.add('removal'); roles.add('hardRemoval'); }
  if (/(destroy|exile) (all|each) (creatures|nonland permanents|creature)|deals? \d+ damage to each creature|all creatures get -\d+\/-\d+|each creature gets -/.test(t)) roles.add('wipe');
  if (/counter target (spell|creature spell|noncreature spell|instant|activated|instant or sorcery)/.test(t)) roles.add('counter');
  if (/draws? (two|three|four|five|six|seven|x|that many) cards|draw cards equal|draw a card for each|investigate|draws? cards equal/.test(t)) roles.add('draw');
  else if (/(you )?draw a card/.test(t)) roles.add('cantrip');
  if (/exile the top (card|two cards|three cards|x cards)[^.]*\. (until|you may play|you may cast)/.test(t) || /look at the top (two|three|four|five|six|seven|x) cards[^.]*\.? ?put (two|three|up to two|any number)/.test(t)) roles.add('draw');
  if (!c.isLand && (/\{t\}: add|add (one|two|three) mana|add \{[wubrgc]\}|create (a|two|three|x) treasure|search your library for (a|up to two) basic land|put (a|up to one|up to two) (basic )?land cards? [^.]*onto the battlefield|you may play an additional land/.test(t))) roles.add('ramp');
  if ((c.produces || '').replace('C', '').length >= 2) roles.add('fixing');
  if (/search your library for an? (card|creature card|instant|sorcery|artifact card|enchantment card|legendary)/.test(t) && !/basic land/.test(t)) roles.add('tutor');
  if (['flying', 'menace', 'trample', 'shadow', 'fear', 'intimidate', 'skulk', 'horsemanship'].some(k => kw.has(k)) || /~ can't be blocked|can't be blocked except/.test(t)) roles.add('evasion');
  if (c.types.includes('Instant') && /target creature[^.]*gets \+\d+\/\+\d+|target creature[^.]*gains (indestructible|hexproof|first strike|double strike|protection)/.test(t)) roles.add('trick');
  if (/(hexproof|indestructible|protection from|phase out|shroud)/.test(t) && /(creatures you control|target creature you control|equipped creature|enchanted creature|target permanent you control)/.test(t)) roles.add('protection');
  if (/deals? (\d+|x) damage to (each opponent|target player|target opponent|any target|each player)|loses? (\d+|x) life/.test(t) && /(opponent|player|any target)/.test(t)) roles.add('burn');
  if (/return (target|up to one target|a|up to two target)[^.]*(creature|permanent|card)[^.]*from your graveyard to (your hand|the battlefield)/.test(t)) roles.add('recursion');
  if (/(target (player|opponent)|each opponent) (discards|reveals their hand)/.test(t)) roles.add('discard');
  if (c.isCreature && ((c.pw >= 5 && c.cmc >= 5) || (c.pw >= 4 && roles.has('evasion') && c.cmc >= 4))) roles.add('finisher');
  if (/(you )?gain (\d+|x|that much) life|lifelink/.test(t) || kw.has('lifelink')) roles.add('lifegain');
  if (/when (~|this) enters|when ~ enters the battlefield/.test(t) && c.isCreature) roles.add('etbValue');
  if (kw.has('haste')) roles.add('haste');
  if (kw.has('flash')) roles.add('flash');
  if (/create[^.]*token/.test(t)) roles.add('token');

  // ---------- themes ----------
  // +1/+1 counters
  if (/put (a|an|one|two|three|x|that many|\d+) \+1\/\+1 counters?|enters with (a|an|one|two|three|x|\d+) (additional )?\+1\/\+1 counter|\bproliferate\b/.test(t) || ['modular', 'evolve', 'adapt', 'bolster', 'support', 'outlast', 'training', 'mentor', 'riot', 'graft', 'backup', 'reinforce', 'monstrosity'].some(k => kwHas(k))) gives.add('counters');
  if (/with (a|one or more) \+1\/\+1 counters? on (it|them)|for each \+1\/\+1 counter|\+1\/\+1 counters? (is|are) put|whenever one or more \+1\/\+1 counters|creature you control with a counter/.test(t) || /\bproliferate\b/.test(t)) wants.add('counters');
  // tokens / go wide
  if (/create[^.]*creature token|create (a|an|one|two|three|four|x|that many|\d+) [^.]*\d+\/\d+[^.]*token/.test(t) || kwHas('populate') || kwHas('fabricate') || kwHas('amass')) gives.add('tokens');
  if (/creatures you control get \+|for each creature you control|other creatures you control get|whenever (a|one or more|another) (nontoken )?creatures? (you control )?enters|number of creatures you control|\bconvoke\b|creature tokens you control get/.test(t) || kwHas('convoke')) wants.add('tokens');
  // death / sacrifice
  if (/sacrifice (a|another|one or more|an? (creature|artifact|permanent))[^.:]*:/.test(t) || /sacrifice (a|another) creature/.test(t) || kwHas('exploit') || kwHas('casualty')) { gives.add('death'); }
  if (/when (~|this creature) dies|whenever ~ dies/.test(t) || kwHas('persist') || kwHas('undying') || kwHas('afterlife')) gives.add('death');
  if (/whenever (~ or )?(a|another|one or more)( nontoken)? (other )?creatures?( you control| an opponent controls)? (dies|die)|whenever you sacrifice|whenever (a|another) (creature|permanent) you control is put into a graveyard/.test(t)) wants.add('death');
  if (gives.has('tokens')) gives.add('death:fodder');
  // lifegain
  if (roles.has('lifegain')) gives.add('lifegain');
  if (/whenever you gain life|if you('ve| have)? gained life|you gained life this turn|life total is greater than/.test(t)) wants.add('lifegain');
  // spells
  if (c.isInstantSorcery) gives.add('spells');
  if (/spend this mana only to cast (an? )?instant (and|or) sorcery|instant and sorcery spells you cast cost/.test(t)) wants.add('spells');
  if (/sacrifice (a|an|another|two|three) (creature |artifact )?tokens?/.test(t)) wants.add('tokens');
  if (/whenever you cast an? (instant|sorcery|noncreature)|instant and sorcery spells you cast|whenever you cast a noncreature|noncreature spells you cast|\bmagecraft\b|\bprowess\b|instant and sorcery cards in your graveyard/.test(t) || kw.has('prowess')) wants.add('spells');
  // artifacts
  if (c.types.includes('Artifact') || /create[^.]*(artifact|treasure|clue|food|blood|map|powerstone|gold|junk|incubator)[^.]*token/.test(t)) gives.add('artifacts');
  if (/artifacts? you control|whenever (an|another|one or more) (nontoken )?artifacts? (you control )?enters|for each artifact|\baffinity for artifacts\b|\bimprovise\b|\bmetalcraft\b|artifact spells? you cast|whenever you cast an artifact/.test(t)) wants.add('artifacts');
  // enchantments
  if (c.types.includes('Enchantment')) gives.add('enchantments');
  if (/enchantments? you control|whenever (an|another) enchantment (you control )?enters|\bconstellation\b|for each enchantment|whenever you cast an enchantment|aura spells?|enchanted creatures? you control|for each aura/.test(t)) wants.add('enchantments');
  // graveyard
  if (/\bmill\b|\bsurveil\b|put the top [^.]* into your graveyard|discard (a|two) cards?|, then discard|\bself-mill\b|dredge/.test(t)) gives.add('graveyard');
  if (/(return|cast|play) (target|a|an|up to|all|each|any|another|one|two)[^.]*from your graveyard|cards? in your graveyard|\bthreshold\b|\bdelirium\b|\bdescend\b|\bescape\b|\bdelve\b|leaves? your graveyard|leave your graveyard/.test(t) || ['escape', 'delve'].some(k => kw.has(k))) wants.add('graveyard');
  // landfall
  if (/search your library for [^.]*land card|play an additional land|put (a|up to one|up to two) (basic )?land cards? [^.]*onto the battlefield|return [^.]*land card[^.]*to the battlefield/.test(t)) gives.add('landfall');
  if (/\blandfall\b|whenever a land (you control )?enters|whenever one or more lands (you control )?enter|for each land you control/.test(t) || kw.has('landfall')) wants.add('landfall');
  // draw triggers
  if (roles.has('draw') || roles.has('cantrip')) gives.add('draw');
  if (/whenever you draw (a|your second) card|draw your second card/.test(t)) wants.add('draw');
  // blink / etb
  if (/exile (target|another target|up to one target|up to two target|two target)[^.]*you control[^.]*(return|then return)|exile [^.]*, then return (it|that card|them|those cards) to the battlefield/.test(t)) gives.add('blink');
  if (roles.has('etbValue')) wants.add('blink');
  // discard / madness
  if (/(draw|draws) [^.]*, then discard|discard a card:|, discard a card|as an additional cost to cast this spell, discard/.test(t)) gives.add('discard');
  if (/\bmadness\b|whenever you discard|whenever you cycle or discard|discarded this turn/.test(t) || kw.has('madness')) wants.add('discard');
  // cycling
  if (kw.has('cycling') || /\bcycling \{/.test(t) || /landcycling/.test(t)) gives.add('cycling');
  if (/whenever you cycle/.test(t)) wants.add('cycling');
  // voltron
  if (c.subtypes.includes('Equipment') || (c.subtypes.includes('Aura') && /enchanted creature gets \+|enchanted creature has/.test(t))) gives.add('voltron');
  if (/equipped creatures? you control|whenever ~ becomes (the target|equipped)|for each (aura|equipment) attached|equipment you control|auras? you control|enchanted or equipped/.test(t)) wants.add('voltron');
  // attack triggers
  if (/whenever ~ attacks|whenever (one or more|a) creatures? you control attacks?|whenever you attack/.test(t)) wants.add('attack');
  if (/additional combat phase|untap all (attacking )?creatures|creatures you control (have|gain) (haste|menace|trample|flying)/.test(t)) gives.add('attack');
  // big mana
  if (roles.has('ramp')) gives.add('bigmana');
  if ((c.cmc >= 7 && !c.isLand) || (/\{x\}/.test((c.manaCost || '').toLowerCase()) && /\bx\b/.test(t))) wants.add('bigmana');
  // energy
  if (/you get \{e\}/.test(t)) gives.add('energy');
  if (/pay \{e\}|pay (an amount of|one or more) \{e\}|\{e\}\{e\}/.test(t) && /pay/.test(t)) wants.add('energy');
  // artifact sub-tokens
  for (const [tok, theme] of [['food', 'food'], ['clue', 'clue'], ['treasure', 'treasure'], ['blood', 'blood']]) {
    if (new RegExp(`create[^.]*\\b${tok}\\b[^.]*token|${tok} token`).test(t)) gives.add(theme);
    if (new RegExp(`sacrifice an? ${tok}|${tok}s? you control|whenever you sacrifice an? ${tok}|for each ${tok}`).test(t)) wants.add(theme);
  }
  // untap
  if (/untap (target|another target|all|each|up to)[^.]*(creature|permanent|artifact)/.test(t)) gives.add('untap');
  // mill opponents
  if (/(target (player|opponent)|each opponent) mills/.test(t)) { gives.add('mill'); }
  if (/cards? in (each|target) opponent's graveyard|opponents? (have|has) (eight|ten|twenty) or more cards in (their|his or her) graveyard|for each card in target opponent's graveyard/.test(t)) wants.add('mill');
  // poison
  if (kwHas('infect') || kwHas('toxic') || kwHas('poisonous') || /poison counter/.test(t)) gives.add('poison');
  if (/\bproliferate\b|poison counters?/.test(t) || kwHas('corrupted')) wants.add('poison');
  // legends / historic
  if (c.isLegendary || c.subtypes.includes('Saga')) gives.add('legends');
  if (/\bhistoric\b|legendary (creatures|spells|permanents) you control|whenever you cast a legendary|legendary spell/.test(t)) wants.add('legends');
  // copy
  if (/copy (target|that|it)[^.]*(instant|sorcery|spell)/.test(t)) wants.add('copy');
  // vehicles
  if (c.subtypes.includes('Vehicle')) wants.add('vehicles');
  if (/crew|vehicles? you control/.test(t) && !c.subtypes.includes('Vehicle')) wants.add('vehicles');
  if (c.subtypes.includes('Vehicle')) gives.add('vehicles');
  // flyers
  if (kw.has('flying') && c.isCreature) gives.add('flyers');
  if (/creatures? (you control )?with flying (you control )?get|for each creature (you control )?with flying|whenever a creature (you control )?with flying/.test(t)) wants.add('flyers');
  // multicolour
  if ((c.colors || '').length >= 2) gives.add('multicolor');
  if (/multicolou?red (spell|creature|permanent)|whenever you cast a multicolou?red/.test(t)) wants.add('multicolor');
  // opponents draw
  if (/each (player|opponent) draws|target opponent draws|each player draws/.test(t)) gives.add('opponentsDraw');
  if (/whenever an opponent draws|whenever a player draws/.test(t)) wants.add('opponentsDraw');

  // ---------- Forge deck-building hints ----------
  const H = { token: 'tokens', lifegain: 'lifegain', counters: 'counters', graveyard: 'graveyard', sacrifice: 'death', discard: 'discard', mill: 'graveyard', proliferate: 'counters', energy: 'energy', food: 'food', clue: 'clue', treasure: 'treasure', blood: 'blood', cycling: 'cycling', lesson: 'lessons' };
  const mapHint = (h) => { const [k, v] = h.split(':'); if (!v) return null; const key = v.toLowerCase(); return H[key] || null; };
  for (const h of c.hints?.has || []) { const th = mapHint(h); if (th) gives.add(th); }
  for (const h of [...(c.hints?.hints || []), ...(c.hints?.needs || [])]) { const th = mapHint(h); if (th) wants.add(th); }
  if (c.subtypes.includes('Lesson')) gives.add('lessons');
  if (/\blearn\b/.test(t)) wants.add('lessons');

  // typal: payoffs that care about a creature type
  const typal = new Set();
  const typeWants = [...t.matchAll(/(?:other |another )?([a-z]+) (?:you control|spells? you cast|creatures? you control)|whenever (?:a|another) ([a-z]+) (?:you control )?(?:enters|dies|attacks)|(?:choose|for each) ([a-z]+) you control/g)];
  for (const m of typeWants) {
    const w = (m[1] || m[2] || m[3] || '').toLowerCase();
    const sw = singular(w);
    if (w && w.length > 2 && !COMMON_WORDS.has(w) && !COMMON_WORDS.has(sw) && !NOT_TYPAL.has(sw) && (!KNOWN_TYPES || KNOWN_TYPES.has(sw))) typal.add(sw);
  }
  // Forge hints like Type$Elf
  for (const h of [...(c.hints?.hints || []), ...(c.hints?.needs || [])]) {
    const [k, v] = h.split(':'); if (k !== 'type' || !v) continue;
    for (const lv of v.toLowerCase().split(/[,.]/).filter(Boolean)) {
    const TYPE_THEME = { artifact: 'artifacts', enchantment: 'enchantments', instant: 'spells', sorcery: 'spells', equipment: 'voltron', aura: 'voltron', legendary: 'legends', vehicle: 'vehicles', saga: 'enchantments', lesson: 'lessons', food: 'food', clue: 'clue', treasure: 'treasure', blood: 'blood' };
    if (TYPE_THEME[lv]) wants.add(TYPE_THEME[lv]);
    else if (!NOT_TYPAL.has(lv) && (KNOWN_TYPES ? KNOWN_TYPES.has(lv) : true)) typal.add(lv);
    }
  }
  const isTypes = new Set([...c.subtypes, ...c.types].map(s => s.toLowerCase()));
  if ((c.keywords || []).some(k => /changeling/i.test(k)) || /\bchangeling\b/.test(t)) isTypes.add('*');

  // ---------- shared game plans (cards pulling toward the same goal, even without an explicit payoff) ----------
  const goals = new Set();
  if (roles.has('discard')) goals.add('handAttack');
  if (/destroy (target|all|each|up to one target) (nonbasic )?lands?|lands? (don't|doesn't) untap|(each|target) (player|opponent) sacrifices an? (untapped )?land/.test(t)) goals.add('landDenial');
  if (/spells? (your opponents|opponents) cast cost|cost \{\d\} more to (cast|activate)|cost(s)? \{\d\} more|can't cast more than|each opponent can't|your opponents can't|players can't (cast|draw|search|gain)|don't untap during (their|its controller's)/.test(t)) goals.add('tax');
  if (/(deals? (\d+|x) damage to each opponent|each opponent loses (\d+|x) life|target (player|opponent) loses (\d+|x) life)/.test(t)) goals.add('drain');
  if (gives.has('mill')) goals.add('mill');
  if (gives.has('poison')) goals.add('poison');
  if (gives.has('counters')) goals.add('counters');
  if (roles.has('lifegain') && !c.isLand) goals.add('lifegain');
  // ability words ("repartee —", "landfall —") and non-evergreen keywords: used to recognise a set's archetype mechanics
  const mechanics = new Set();
  for (const m of (c.fullText || '').toLowerCase().matchAll(/(?:^|\n)([a-z][a-z' ]{2,24}) — /g)) mechanics.add(m[1].trim());
  for (const k of c.keywords || []) { const kl = k.toLowerCase(); if (!EVERGREEN.has(kl)) mechanics.add(kl); }
  return { roles, gives, wants, typal, isTypes, goals, mechanics };
}

const COMMON_WORDS = new Set(['creature', 'creatures', 'permanent', 'permanents', 'land', 'lands', 'artifact', 'artifacts', 'enchantment', 'enchantments', 'spell', 'spells', 'card', 'cards', 'token', 'tokens', 'nontoken', 'other', 'another', 'each', 'the', 'and', 'that', 'this', 'one', 'two', 'three', 'more', 'all', 'opponent', 'player', 'you', 'they', 'equipment', 'aura', 'auras', 'planeswalker', 'planeswalkers', 'instant', 'sorcery', 'legendary', 'noncreature', 'nonland', 'colorless', 'multicolored', 'white', 'blue', 'black', 'red', 'green', 'basic', 'untapped', 'tapped', 'attacking', 'blocking', 'mana', 'its', 'their', 'equipped', 'enchanted', 'commander', 'vehicle', 'vehicles', 'food', 'clue', 'treasure', 'blood', 'saga', 'snow', 'historic', 'outlaw', 'battle', 'party', 'gate', 'gates', 'shrine', 'shrines', 'dragon', 'dragons']
  .filter(w => !['dragon', 'dragons', 'gate', 'gates', 'shrine', 'shrines'].includes(w)));

export const GOALS = {
  handAttack: 'Hand disruption', landDenial: 'Land denial', tax: 'Taxing / restricting opponents', drain: 'Direct damage / drain to face',
  mill: 'Mill opponents', poison: 'Poison', counters: '+1/+1 counters', lifegain: 'Life gain',
};
// Synergy between two analysed cards. Only counts:
//  - an enabler feeding an explicit payoff (A makes tokens -> B says "whenever a creature dies"),
//  - a creature-type payoff and a creature of that type,
//  - two cards pushing the same game plan (weaker).
// Returns {score, reasons[] (theme keys), links[] ({from, to, theme, kind})}
export function pairSynergy(a, b) {
  let s = 0; const why = []; const links = [];
  const feed = (x, y) => {
    for (const th of x.tags.gives) {
      const base = th.split(':')[0];
      if (y.tags.wants.has(base)) { s += (THEMES[base]?.w || 0.7) * (th.includes(':') ? 0.5 : 1); why.push(base); links.push({ from: x.name, to: y.name, theme: base, kind: 'payoff' }); }
    }
    for (const ty of x.tags.typal) if (y.isCreature && (y.tags.isTypes.has(ty) || y.tags.isTypes.has('*'))) { s += 1.2; why.push('typal:' + ty); links.push({ from: y.name, to: x.name, theme: 'typal:' + ty, kind: 'payoff' }); }
  };
  feed(a, b); feed(b, a);
  for (const g of a.tags.goals || []) if (b.tags.goals?.has(g)) { s += g === 'lifegain' ? 0.25 : 0.4; why.push('goal:' + g); links.push({ from: a.name, to: b.name, theme: 'goal:' + g, kind: 'plan' }); }
  const seen = new Set();
  return { score: Math.min(s, 3), reasons: [...new Set(why)], links: links.filter(l => { const k = l.from + l.to + l.theme; if (seen.has(k)) return false; seen.add(k); return true; }) };
}
// Plain-English sentence for one synergy link
export function linkText(l) {
  if (l.kind === 'plan') return `both push the ${GOALS[l.theme.slice(5)] || l.theme} plan`;
  if (l.theme.startsWith('typal:')) return `${l.from} is a ${cap(l.theme.slice(6))}, which ${l.to} rewards`;
  return `${l.from} ${GIVE_TEXT[l.theme] || 'enables'} → ${l.to} ${WANT_TEXT[l.theme] || 'pays it off'}`;
}
const cap = (x) => x[0].toUpperCase() + x.slice(1);
const GIVE_TEXT = { counters: 'adds +1/+1 counters', tokens: 'makes creature tokens', death: 'sacrifices / has creatures die', lifegain: 'gains life', spells: 'is an instant/sorcery', artifacts: 'is or makes an artifact', enchantments: 'is an enchantment', graveyard: 'fills your graveyard', landfall: 'puts extra lands into play', draw: 'draws cards', blink: 'flickers creatures', discard: 'discards cards', cycling: 'has cycling', voltron: 'is an Equipment/Aura', attack: 'boosts attacks', bigmana: 'ramps your mana', energy: 'makes energy', food: 'makes Food', clue: 'makes Clues', treasure: 'makes Treasure', blood: 'makes Blood', mill: 'mills opponents', poison: 'adds poison counters', legends: 'is legendary', copy: 'copies spells', vehicles: 'is a Vehicle', flyers: 'is a flyer', multicolor: 'is multicoloured', lessons: 'is a Lesson', opponentsDraw: 'makes opponents draw', untap: 'untaps permanents' };
const WANT_TEXT = { counters: 'gets better with counters', tokens: 'rewards having lots of creatures', death: 'triggers when creatures die', lifegain: 'triggers on life gain', spells: 'triggers on instants/sorceries', artifacts: 'rewards artifacts', enchantments: 'rewards enchantments', graveyard: 'uses cards in your graveyard', landfall: 'has landfall', draw: 'triggers on card draw', blink: 'has an enters-the-battlefield effect', discard: 'rewards discarding', cycling: 'triggers on cycling', voltron: 'rewards Equipment/Auras', attack: 'has attack triggers', bigmana: 'is a big mana sink', energy: 'spends energy', food: 'uses Food', clue: 'uses Clues', treasure: 'uses Treasure', blood: 'uses Blood', mill: "rewards opponents' full graveyards", poison: 'proliferates / uses poison', legends: 'cares about legendary/historic', copy: 'copies instants/sorceries', vehicles: 'crews / rewards Vehicles', flyers: 'rewards flyers', multicolor: 'rewards multicoloured spells', lessons: 'learns Lessons', opponentsDraw: 'punishes opponents drawing', untap: 'has tap abilities' };
function singular(w) { if (w.endsWith('ves')) return w.slice(0, -3) + 'f'; if (w.endsWith('ies')) return w.slice(0, -3) + 'y'; if (w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1); return w; }
export function themeLabel(th) { if (th.startsWith('goal:')) return 'Shared plan: ' + (GOALS[th.slice(5)] || th.slice(5)); if (th.startsWith('typal:')) { const x = th.slice(6); return x[0].toUpperCase() + x.slice(1) + ' typal'; } return THEMES[th]?.label || th; }
