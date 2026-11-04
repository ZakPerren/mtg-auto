// Goldfish playtester: shuffle the built deck, draw, mulligan (London), play cards, tap, track life and turns.
import { esc, manaHtml, textHtml } from './util.js';
import { imageUrl } from '../data/scryfall.js';

let G = null;        // game state
let root = null;
let uid = 0;

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

let persist = null; // callback(state|null) so the game survives the app being reloaded (e.g. unfolding the Fold)
export function setPlaytestPersistence(fn) { persist = fn; }

export function openPlaytest(deckList, title = 'Playtest') {
  // deckList: [{card, count}]
  G = { deckList, title, life: 20, opp: 20, turn: 0, library: [], hand: [], battlefield: [], graveyard: [], exile: [], mulligans: 0, bottomNeeded: 0, log: [] };
  mount();
  newGame();
}
function mount() {
  root = document.createElement('div');
  root.className = 'ptest';
  document.body.appendChild(root);
  document.body.classList.add('pt-open');
}

// Serialise / restore by card name so the saved game is small and survives a reload
const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile'];
function snapshot() {
  const z = (list) => list.map(o => o.token ? { t: 1, n: o.card.name, p: o.card.power, tg: o.card.toughness, tp: o.tapped, c: o.counters } : { n: o.card.name, tp: o.tapped, c: o.counters });
  return { title: G.title, life: G.life, opp: G.opp, turn: G.turn, phase: G.phase, mulligans: G.mulligans, bottomNeeded: G.bottomNeeded, landPlayed: G.landPlayed,
    deck: G.deckList.map(x => [x.card.name, x.count]), ...Object.fromEntries(ZONES.map(k => [k, z(G[k])])) };
}
export function restorePlaytest(saved, getCard) {
  try {
    const deckList = saved.deck.map(([n, count]) => ({ card: getCard(n), count })).filter(x => x.card);
    G = { deckList, title: saved.title, life: saved.life, opp: saved.opp, turn: saved.turn, phase: saved.phase, mulligans: saved.mulligans, bottomNeeded: saved.bottomNeeded, landPlayed: saved.landPlayed, log: [] };
    for (const k of ZONES) G[k] = (saved[k] || []).map(o => o.t
      ? { id: ++uid, token: true, tapped: o.tp, counters: o.c, card: tokenCard(o.n, o.p, o.tg) }
      : { id: ++uid, card: getCard(o.n), tapped: o.tp, counters: o.c }).filter(o => o.card);
    mount(); render();
    return true;
  } catch { return false; }
}
function tokenCard(name, p, t) { return { name, manaCost: '', typeLine: 'Token Creature', oracle: '', fullText: '', faces: [], power: p, toughness: t, isLand: false, isInstantSorcery: false }; }

function close() { root?.remove(); root = null; document.body.classList.remove('pt-open'); persist?.(null); }

function newGame() {
  G.library = shuffle(G.deckList.flatMap(({ card, count }) => Array.from({ length: count }, () => ({ id: ++uid, card, tapped: false, counters: 0 }))));
  G.hand = []; G.battlefield = []; G.graveyard = []; G.exile = []; G.life = 20; G.opp = 20; G.turn = 0; G.mulligans = 0; G.bottomNeeded = 0; G.landPlayed = false;
  draw(7); G.phase = 'mulligan';
  render();
}
function mulligan() {
  G.library = shuffle([...G.library, ...G.hand]); G.hand = [];
  G.mulligans++; draw(7); G.phase = 'mulligan'; render();
}
function keep() {
  G.bottomNeeded = G.mulligans;
  G.phase = G.bottomNeeded ? 'bottom' : 'play';
  if (!G.bottomNeeded) startTurn(true);
  render();
}
function draw(n = 1) { for (let i = 0; i < n && G.library.length; i++) G.hand.push(G.library.shift()); }
function startTurn(first = false) {
  G.turn++; G.landPlayed = false;
  for (const c of G.battlefield) c.tapped = false;
  if (!first) draw(1); // on the play: no draw turn 1
}

function move(id, to, opts = {}) {
  const zones = ['hand', 'battlefield', 'graveyard', 'exile', 'library'];
  let obj = null;
  for (const z of zones) { const i = G[z].findIndex(x => x.id === id); if (i >= 0) { obj = G[z].splice(i, 1)[0]; break; } }
  if (!obj) return;
  obj.tapped = false; if (to !== 'battlefield') obj.counters = 0;
  if (obj.token && to !== 'battlefield') return; // tokens cease to exist
  if (to === 'library') { if (opts.top) G.library.unshift(obj); else G.library.push(obj); }
  else G[to].push(obj);
}

function imgFor(card) {
  return `<img src="${navigator.onLine || 'caches' in window ? imageUrl(card.name) : ''}" alt="" loading="lazy" onerror="this.remove()">`;
}
function cardFace(o, size = '') {
  const c = o.card;
  return `<div class="pc ${size} ${o.tapped ? 'tapped' : ''}" data-id="${o.id}">
    <div class="pc-text"><div class="pc-top"><b>${esc(c.name.split(' // ')[0])}</b><span>${manaHtml(c.manaCost.split(' // ')[0])}</span></div>
      <div class="pc-type">${esc(c.typeLine)}</div><div class="pc-body">${textHtml((c.faces[0]?.oracle || c.oracle || '').slice(0, 220))}</div>
      ${c.power != null ? `<div class="pc-pt">${esc(c.power)}/${esc(c.toughness)}</div>` : ''}</div>
    ${o.token ? '' : imgFor(c)}
    ${o.counters ? `<span class="pc-ctr">+${o.counters}</span>` : ''}
  </div>`;
}

function render() {
  if (!root) return;
  const lands = G.battlefield.filter(o => o.card.isLand);
  const others = G.battlefield.filter(o => !o.card.isLand);
  const untappedLands = lands.filter(o => !o.tapped).length;
  const handLands = G.hand.filter(o => o.card.isLand).length;
  root.innerHTML = `
  <div class="pt-bar">
    <button data-a="close" aria-label="Close">✕</button>
    <div class="pt-stat"><small>Turn</small><b>${G.turn || '–'}</b></div>
    <div class="pt-life"><button data-a="life-">−</button><div><small>You</small><b>${G.life}</b></div><button data-a="life+">+</button></div>
    <div class="pt-life opp"><button data-a="opp-">−</button><div><small>Opp</small><b>${G.opp}</b></div><button data-a="opp+">+</button></div>
    <div class="pt-stat"><small>Library</small><b>${G.library.length}</b></div>
  </div>
  ${G.phase === 'mulligan' ? `<div class="pt-banner">Opening hand${G.mulligans ? ` (mulligan ${G.mulligans})` : ''}: ${handLands} land${handLands === 1 ? '' : 's'}, ${G.hand.length - handLands} spells
      <div class="row"><button class="primary" data-a="keep">Keep</button><button data-a="mull">Mulligan</button></div></div>`
    : G.phase === 'bottom' ? `<div class="pt-banner">Tap ${G.bottomNeeded} card${G.bottomNeeded > 1 ? 's' : ''} in your hand to put on the bottom.</div>` : ''}
  <div class="pt-field">
    <div class="pt-zone-label">Battlefield <small>${others.length} permanents · ${untappedLands}/${lands.length} lands untapped</small></div>
    <div class="pt-row perms">${others.map(o => cardFace(o, 'mid')).join('') || '<p class="muted">Cast something…</p>'}</div>
    <div class="pt-row lands">${lands.map(o => cardFace(o, 'small')).join('')}</div>
  </div>
  <div class="pt-piles">
    <button data-a="zone" data-z="graveyard">Graveyard <b>${G.graveyard.length}</b></button>
    <button data-a="zone" data-z="exile">Exile <b>${G.exile.length}</b></button>
    <button data-a="draw">Draw</button>
    <button data-a="token">Token</button>
    <button data-a="untap">Untap all</button>
    <button data-a="new">New game</button>
  </div>
  <div class="pt-hand-bar"><span>Hand ${G.hand.length}${G.landPlayed ? ' · land played' : ''}</span><button class="primary" data-a="next" ${G.phase !== 'play' ? 'disabled' : ''}>Next turn ▸</button></div>
  <div class="pt-row hand">${G.hand.map(o => cardFace(o, 'big')).join('')}</div>`;
  root.onclick = onClick;
  persist?.(snapshot());
}

function onClick(e) {
  const a = e.target.closest('[data-a]');
  if (a) {
    const act = a.dataset.a;
    if (act === 'close') return close();
    if (act === 'keep') return keep();
    if (act === 'mull') return mulligan();
    if (act === 'new') return newGame();
    if (act === 'next') { startTurn(); return render(); }
    if (act === 'draw') { draw(1); return render(); }
    if (act === 'untap') { G.battlefield.forEach(o => { o.tapped = false; }); return render(); }
    if (act === 'life-') { G.life--; return render(); }
    if (act === 'life+') { G.life++; return render(); }
    if (act === 'opp-') { G.opp--; return render(); }
    if (act === 'opp+') { G.opp++; return render(); }
    if (act === 'zone') return showZone(a.dataset.z);
    if (act === 'token') return makeToken();
    return;
  }
  const pc = e.target.closest('.pc'); if (!pc) return;
  const id = +pc.dataset.id;
  const where = ['hand', 'battlefield'].find(z => G[z].some(x => x.id === id));
  const obj = G[where]?.find(x => x.id === id); if (!obj) return;
  if (G.phase === 'bottom' && where === 'hand') { move(id, 'library'); if (--G.bottomNeeded <= 0) { G.phase = 'play'; startTurn(true); } return render(); }
  if (where === 'battlefield' && !e.target.closest('.pt-menu')) { menu(obj, 'battlefield'); return; }
  if (where === 'hand') menu(obj, 'hand');
}

function menu(obj, zone) {
  const c = obj.card;
  const opts = zone === 'hand'
    ? [[c.isLand ? 'Play land' : (c.isInstantSorcery ? 'Cast (→ graveyard)' : 'Cast'), 'play'], ['Discard', 'graveyard'], ['Exile', 'exile'], ['Top of library', 'top'], ['Bottom of library', 'bottom'], ['View card', 'view']]
    : [[obj.tapped ? 'Untap' : 'Tap', 'tap'], ['+1/+1 counter', 'ctr+'], ['Remove counter', 'ctr-'], ['To graveyard (dies)', 'graveyard'], ['Exile', 'exile'], ['Return to hand', 'hand'], ['View card', 'view']];
  const m = sheet(`<div class="pt-menu-head">${cardFace({ ...obj, tapped: false }, 'big')}<div><b>${esc(c.name)}</b><br><small>${esc(c.typeLine)}</small></div></div>
    <div class="pt-menu-grid">${opts.map(([label, k]) => `<button data-k="${k}">${label}</button>`).join('')}</div>`);
  m.onclick = (e) => {
    const b = e.target.closest('[data-k]'); if (!b) { if (e.target === m) m.remove(); return; }
    const k = b.dataset.k; m.remove();
    switch (k) {
      case 'play':
        if (c.isLand) { if (G.landPlayed && !confirmExtraLand()) return; G.landPlayed = true; }
        move(obj.id, c.isInstantSorcery ? 'graveyard' : 'battlefield'); break;
      case 'tap': obj.tapped = !obj.tapped; break;
      case 'ctr+': obj.counters++; break;
      case 'ctr-': obj.counters = Math.max(0, obj.counters - 1); break;
      case 'top': move(obj.id, 'library', { top: true }); break;
      case 'bottom': move(obj.id, 'library'); break;
      case 'view': viewCard(c); return;
      default: move(obj.id, k);
    }
    render();
  };
}
function confirmExtraLand() { return true; } // goldfish: allow it, the banner shows a land was already played

function sheet(html) {
  const m = document.createElement('div');
  m.className = 'pt-sheet';
  m.innerHTML = `<div class="pt-menu">${html}<button class="ghost pt-cancel">Cancel</button></div>`;
  m.querySelector('.pt-cancel').onclick = () => m.remove();
  root.appendChild(m);
  return m;
}
function viewCard(c) {
  const m = sheet(`<div class="pt-view"><img src="${imageUrl(c.name, 'large')}" alt="" onerror="this.remove()"><h3>${esc(c.name)} ${manaHtml(c.manaCost)}</h3><p class="muted">${esc(c.typeLine)}</p><p>${textHtml(c.fullText)}</p>${c.power != null ? `<p><b>${esc(c.power)}/${esc(c.toughness)}</b></p>` : ''}</div>`);
  m.onclick = (e) => { if (e.target === m) m.remove(); };
}
function showZone(z) {
  const list = G[z];
  const m = sheet(`<h3>${z === 'graveyard' ? 'Graveyard' : 'Exile'} (${list.length})</h3><div class="pt-row zone">${list.map(o => cardFace(o, 'mid')).join('') || '<p class="muted">Empty</p>'}</div><p class="hint">Tap a card to return it to your hand.</p>`);
  m.onclick = (e) => {
    const pc = e.target.closest('.pc');
    if (pc) { move(+pc.dataset.id, 'hand'); m.remove(); render(); return; }
    if (e.target === m) m.remove();
  };
}
function makeToken() {
  const m = sheet(`<h3>Create token</h3><div class="row"><input id="tkName" placeholder="Name e.g. Soldier" value="Token"><input id="tkPT" placeholder="P/T" value="1/1" class="short"></div><div class="row"><label class="inline">How many <input id="tkN" type="number" value="1" min="1" max="20" class="tiny"></label><button class="primary" id="tkGo">Create</button></div>`);
  m.querySelector('#tkGo').onclick = () => {
    const name = m.querySelector('#tkName').value || 'Token';
    const [p, t] = (m.querySelector('#tkPT').value || '1/1').split('/');
    const n = Math.max(1, Math.min(20, +m.querySelector('#tkN').value || 1));
    for (let i = 0; i < n; i++) G.battlefield.push({ id: ++uid, token: true, tapped: false, counters: 0, card: tokenCard(name, p, t) });
    m.remove(); render();
  };
  m.onclick = (e) => { if (e.target === m) m.remove(); };
}

// Ask the browser to fetch every card image once (the service worker keeps them for offline use).
export function precacheImages(cards, onDone) {
  let done = 0; const names = [...new Set(cards.map(c => c.name))];
  for (const n of names) { const im = new Image(); im.onload = im.onerror = () => { if (++done === names.length) onDone?.(done); }; im.src = imageUrl(n); }
  return names.length;
}
