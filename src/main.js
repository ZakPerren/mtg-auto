import { CardDB } from './data/db.js';
import { ls, idbGet, idbSet } from './data/store.js';
import { parseList, resolveList, parseCsv, looksLikeCsv } from './data/pool.js';
import { openPacks, PACK_SIZE, MAX_RARE } from './data/packs.js';
import * as SF from './data/scryfall.js';
import { buildDecks, PRESETS, rescore, isCommanderFor } from './engine/builder.js';
import { setArchetypes, fitsArchetype } from './engine/archetypes.js';
import { analyse, ROLE_LABEL, themeLabel, GOALS } from './engine/tags.js';
import { powerOf } from './engine/power.js';
import { Rules } from './engine/rules.js';
import { combosInPool, spellbookCombos } from './engine/combos.js';
import { openPlaytest, precacheImages, setPlaytestPersistence, restorePlaytest } from './ui/playtest.js';
import { $, $$, esc, manaHtml, textHtml, colorGroup, GROUP_LABEL, COLOR_ORDER, pip, toast, debounce, rarityLetter } from './ui/util.js';

const APP_VERSION = '__VERSION__';
const db = new CardDB();
let rules = null;
const fetchJson = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); };

// ---------------- state ----------------
const DEFAULT_OPTS = { preset: 'sealed', ...PRESETS.sealed, style: 'auto', synergyWeight: 1, landCount: null, maxSplashCards: 3, mustInclude: [], exclude: [], mustColors: '', excludeColors: '', legality: '', commander: 'auto', onlineCombos: true };
// Older versions had one "Brawl (60)" preset that mixed Standard Brawl's size with Arena Brawl's card pool
function migrateOpts(o) {
  if (o.preset === 'brawl' && o.deckSize === 60) Object.assign(o, PRESETS.standardbrawl, { preset: 'standardbrawl' });
  if (o.preset && PRESETS[o.preset] && o.life == null) o.life = PRESETS[o.preset].life;
  return o;
}
const S = {
  pools: ls.get('pools', null) || [{ id: 'p1', name: 'My pool', sets: [], items: [] }],
  poolId: ls.get('poolId', 'p1'),
  opts: migrateOpts({ ...DEFAULT_OPTS, ...ls.get('opts', {}) }),
  result: null, resultIdx: 0,
  decks: ls.get('decks', []),
  tab: 'pool', poolMode: ls.get('poolMode', 'search'),
  browse: { color: '', rarity: '', q: '' },
  interact: ls.get('interact', []),
};
const save = () => { ls.set('pools', S.pools); ls.set('poolId', S.poolId); ls.set('opts', S.opts); ls.set('decks', S.decks); ls.set('poolMode', S.poolMode); };
const pool = () => S.pools.find(p => p.id === S.poolId) || S.pools[0];
function poolEntries() {
  const p = pool(); const out = [];
  for (const it of p.items) { const c = db.get(it.name); if (c && it.count > 0) out.push({ card: c, count: it.count }); }
  return out;
}
function addToPool(card, delta = 1) {
  const p = pool();
  const it = p.items.find(x => x.name === card.name);
  if (it) it.count = Math.max(0, it.count + delta); else if (delta > 0) p.items.push({ name: card.name, count: delta });
  p.items = p.items.filter(x => x.count > 0);
  save();
}
// Add many cards in one go (CSV/collection imports): one lookup map and a single save
function addManyToPool(entries) {
  const p = pool();
  const idx = new Map(p.items.map(x => [x.name, x]));
  for (const { card, count } of entries) {
    if (!count) continue;
    const it = idx.get(card.name);
    if (it) it.count += count; else { const n = { name: card.name, count }; p.items.push(n); idx.set(card.name, n); }
  }
  save();
}
let _cntCache = null, _cntKey = null;
const countInPool = (card) => {
  const p = pool();
  if (_cntKey !== p.items || !_cntCache || _cntCache.size !== p.items.length) { _cntCache = new Map(p.items.map(x => [x.name, x])); _cntKey = p.items; }
  return _cntCache.get(card.name)?.count || 0;
};
const poolTotal = () => pool().items.reduce((a, x) => a + x.count, 0);

// ---------------- boot ----------------
async function boot() {
  const status = $('#status');
  try {
    try {
      if ('serviceWorker' in navigator && location.protocol !== 'file:') {
        // when a new version (app or card data) has downloaded, switch to it straight away; your place is restored after the reload
        const hadController = !!navigator.serviceWorker.controller;
        navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !window.__reloading) { window.__reloading = true; toast('Updated — reloading…'); setTimeout(() => location.reload(), 600); } });
        navigator.serviceWorker.register('sw.js').catch(() => {});
      }
    } catch { /* not allowed here */ }
    await db.load(fetchJson, (m) => { status.textContent = m; });
    const override = await idbGet('rules-override').catch(() => null);
    rules = new Rules(override || await fetchJson('data/rules.json'));
    status.textContent = '';
    $('#netstate').textContent = navigator.onLine ? 'online' : 'offline';
    addEventListener('online', () => $('#netstate').textContent = 'online');
    addEventListener('offline', () => $('#netstate').textContent = 'offline');
    window.addEventListener('hashchange', route);
    setPlaytestPersistence((st) => ls.set('playtest', st));
    route();
    // keep each tab's scroll position, so a reload (e.g. unfolding the phone) lands where you were
    const view = $('#view');
    view.addEventListener('scroll', debounce(() => { const sc = ls.get('scroll', {}); sc[S.tab] = view.scrollTop; ls.set('scroll', sc); }, 200));
    const saved = ls.get('scroll', {})[S.tab]; if (saved) requestAnimationFrame(() => { view.scrollTop = saved; });
    const pt = ls.get('playtest', null); if (pt) restorePlaytest(pt, (n) => db.get(n));
  } catch (e) {
    status.textContent = 'Failed to load data: ' + e.message;
    console.error(e);
  }
}
function route() {
  const tab = (location.hash.replace('#', '') || 'pool').split('/')[0];
  S.tab = ['pool', 'build', 'deck', 'rules', 'cards', 'data'].includes(tab) ? tab : 'pool';
  $$('nav.tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === S.tab));
  render();
}
function render() {
  const v = $('#view');
  v.onclick = null;
  ({ pool: viewPool, build: viewBuild, deck: viewDeck, rules: viewRules, cards: viewCards, data: viewData })[S.tab](v);
  v.scrollTop = 0;
}

// ---------------- shared bits ----------------
function cardRow(c, { right = '', sub = '', cls = '' } = {}) {
  return `<div class="crow ${cls}" data-card="${esc(c.name)}">
    <span class="cost">${manaHtml(c.manaCost)}</span>
    <span class="cname"><span class="rar r-${rarityLetter(c.rarity)}"></span>${esc(c.name)}${sub ? `<small>${sub}</small>` : ''}</span>
    <span class="right">${right}</span></div>`;
}
function bindCardOpen(root) {
  root.onclick = ((e) => {
    if (e.target.closest('button, input, select, a')) return;
    const row = e.target.closest('[data-card]'); if (!row) return;
    const c = db.get(row.dataset.card); if (c) openCard(c);
  });
}
function modeForOpts() { return S.opts.mode || 'limited'; }

// ---------------- POOL ----------------
function viewPool(v) {
  const p = pool();
  const setNames = p.sets.map(s => `<span class="chip">${esc(s)} <button data-rmset="${esc(s)}" aria-label="remove set">×</button></span>`).join('');
  v.innerHTML = `
  <section class="card">
    <div class="row wrap">
      <select id="poolSel" aria-label="Pool">${S.pools.map(x => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
      <button id="poolNew" class="ghost">New</button><button id="poolRen" class="ghost">Rename</button><button id="poolDel" class="ghost danger">Delete</button>
    </div>
    <div class="row wrap sets"><b>Sets:</b> ${setNames || '<span class="muted">any set</span>'} <button id="addSet" class="ghost">+ Set</button></div>
    <div class="seg" role="tablist">
      ${['search', 'browse', 'paste', 'packs'].map(m => `<button data-mode="${m}" class="${S.poolMode === m ? 'on' : ''}">${{ search: 'Type', browse: 'Tap set', paste: 'Paste', packs: 'Random packs' }[m]}</button>`).join('')}
    </div>
    <div id="poolInput"></div>
  </section>
  <section class="card">
    <div class="row between"><h2>Pool <span class="muted">${poolTotal()} cards</span></h2>
      <div><button id="toBuild" class="primary" ${poolTotal() ? '' : 'disabled'}>Build deck →</button></div></div>
    <div id="poolSummary" class="summary"></div>
    <div id="poolList"></div>
    ${poolTotal() ? '<button id="poolClear" class="ghost danger small">Clear pool</button>' : ''}
  </section>`;
  $('#poolSel').onchange = (e) => { S.poolId = e.target.value; save(); render(); };
  $('#poolNew').onclick = async () => { const name = await askText('New pool name', 'Prerelease ' + new Date().toLocaleDateString('en-GB')); if (!name) return; const id = 'p' + Date.now(); S.pools.push({ id, name, sets: [...p.sets], items: [] }); S.poolId = id; save(); render(); };
  $('#poolRen').onclick = async () => { const name = await askText('Rename pool', p.name); if (name) { p.name = name; save(); render(); } };
  $('#poolDel').onclick = async () => { if (S.pools.length < 2) { if (await askConfirm('This is your only pool — empty it?')) { p.items = []; save(); render(); } return; } if (await askConfirm(`Delete "${p.name}"?`)) { S.pools = S.pools.filter(x => x.id !== p.id); S.poolId = S.pools[0].id; save(); render(); } };
  $('#addSet').onclick = () => openSetPicker();
  $$('[data-rmset]').forEach(b => b.onclick = () => { p.sets = p.sets.filter(s => s !== b.dataset.rmset); save(); render(); });
  $$('.seg button').forEach(b => b.onclick = () => { S.poolMode = b.dataset.mode; save(); render(); });
  $('#toBuild').onclick = () => { location.hash = 'build'; };
  if ($('#poolClear')) $('#poolClear').onclick = async () => { if (await askConfirm('Remove every card from this pool?')) { p.items = []; save(); render(); } };
  ({ search: poolSearchInput, browse: poolBrowseInput, paste: poolPasteInput, packs: poolPacksInput })[S.poolMode]($('#poolInput'));
  renderPoolList();
}

function renderPoolList() {
  const list = $('#poolList'); if (!list) return;
  const entries = poolEntries();
  const groups = {};
  for (const e of entries) (groups[colorGroup(e.card)] ||= []).push(e);
  // colour summary: count, creatures, removal, avg power
  const sum = [];
  for (const g of ['W', 'U', 'B', 'R', 'G']) {
    const es = entries.filter(e => e.card.colors.includes(g) && !e.card.isLand);
    if (!es.length) continue;
    const n = es.reduce((a, e) => a + e.count, 0);
    const cr = es.filter(e => e.card.isCreature).reduce((a, e) => a + e.count, 0);
    const rm = es.filter(e => (e.card.tags ||= analyse(e.card)).roles.has('removal')).reduce((a, e) => a + e.count, 0);
    sum.push(`<div class="sumcol">${pip(g)}<b>${n}</b><small>${cr} cre · ${rm} rem</small></div>`);
  }
  $('#poolSummary').innerHTML = sum.join('');
  const LIMIT = 60; S.openGroups ||= new Set();
  list.innerHTML = entries.length ? COLOR_ORDER.filter(g => groups[g]).map(g => {
    const rows = groups[g].sort((a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name));
    const shown = S.openGroups.has(g) ? rows : rows.slice(0, LIMIT);
    return `<h3 class="grp">${GROUP_LABEL[g]} <span class="muted">${groups[g].reduce((a, e) => a + e.count, 0)}${rows.length > LIMIT ? ` · ${rows.length} different` : ''}</span></h3>
    ${shown.map(e => cardRow(e.card, { right: stepper(e.card, e.count) })).join('')}
    ${rows.length > LIMIT && !S.openGroups.has(g) ? `<button class="ghost small" data-showall="${g}">Show all ${rows.length}</button>` : ''}`;
  }).join('')
    : `<p class="muted">No cards yet. Pick your set, then type names or tap cards from the set list.</p>`;
  bindSteppers(list, () => renderPoolList());
  $$('[data-showall]', list).forEach(b => b.onclick = () => { S.openGroups.add(b.dataset.showall); renderPoolList(); });
  bindCardOpen(list);
  const total = $('h2 .muted'); if (total) total.textContent = poolTotal() + ' cards';
  const tb = $('#toBuild'); if (tb) tb.disabled = !poolTotal();
}
function stepper(card, n) {
  return `<span class="stepper"><button data-dec="${esc(card.name)}" aria-label="remove one">−</button><b>${n}</b><button data-inc="${esc(card.name)}" aria-label="add one">+</button></span>`;
}
function bindSteppers(root, after) {
  root.querySelectorAll('[data-inc]').forEach(b => b.onclick = (e) => { e.stopPropagation(); addToPool(db.get(b.dataset.inc), 1); after(); });
  root.querySelectorAll('[data-dec]').forEach(b => b.onclick = (e) => { e.stopPropagation(); addToPool(db.get(b.dataset.dec), -1); after(); });
}

function poolSearchInput(box) {
  const p = pool();
  box.innerHTML = `
    <div class="ac">
      <input id="acIn" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${p.sets.length ? 'Card name in ' + p.sets.join(', ') : 'Card name'}…" enterkeyhint="done">
      <div id="acList" class="aclist"></div>
    </div>
    <p class="hint">Tap a suggestion to add it. Enter adds the top match. ${p.sets.length ? '' : 'Tip: add your set above to make suggestions faster and exact.'}</p>`;
  const inp = $('#acIn'), lst = $('#acList');
  let items = [];
  const show = () => {
    items = db.search(inp.value, { sets: p.sets.length ? p.sets : null, limit: 8 });
    const note = !inp.value.trim() ? '' : !items.length
      ? `<p class="hint warn">No card found${p.sets.length ? ` in ${p.sets.join(', ')} or any other set` : ''}. Check the spelling — or if it's a brand-new set, go to Data → "Get a set from Scryfall" while online.</p>`
      : items[0].outside ? `<p class="hint">Not in ${p.sets.join(', ')} — showing matches from other sets.${p.sets.length ? ' If this card is in your set, its list may be incomplete: Data → "Get a set from Scryfall".' : ''}</p>`
      : items[0].fuzzy ? '<p class="hint">No exact match — closest names:</p>' : '';
    lst.innerHTML = note + items.map((c, i) => `<button class="acitem ${i === 0 ? 'top' : ''}" data-i="${i}"><span class="cost">${manaHtml(c.manaCost)}</span><span class="cname"><span class="rar r-${rarityLetter(db.rarityIn(c, p.sets))}"></span>${esc(c.name)}<small>${esc(c.typeLine)}${c.outside ? ' · ' + esc((c.sets || []).slice(0, 2).join(', ')) : ''}</small></span><span class="badge">${countInPool(c) || ''}</span></button>`).join('');
  };
  const add = (c) => { c = db.get(c.name) || c; addToPool(c, 1); toast(`+1 ${c.name} (${countInPool(c)})`, 1400); inp.value = ''; lst.innerHTML = ''; inp.focus(); renderPoolList(); };
  inp.addEventListener('input', debounce(show, 60));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && items[0]) { e.preventDefault(); add(items[0]); } });
  lst.addEventListener('click', (e) => { const b = e.target.closest('.acitem'); if (b) add(items[+b.dataset.i]); });
  inp.focus();
}

function poolBrowseInput(box) {
  const p = pool();
  if (!p.sets.length) { box.innerHTML = `<p class="hint">Add your set first (<b>+ Set</b> above) — then every card in it is listed here; tap to add.</p>`; return; }
  const B = S.browse;
  box.innerHTML = `
    <div class="row wrap filters">
      <input id="brQ" type="search" placeholder="Filter…" value="${esc(B.q)}">
      <div class="seg small">${['', 'W', 'U', 'B', 'R', 'G', 'M', 'C', 'L'].map(c => `<button data-col="${c}" class="${B.color === c ? 'on' : ''}">${c ? (c.length === 1 && 'WUBRG'.includes(c) ? pip(c) : c) : 'All'}</button>`).join('')}</div>
      <div class="seg small">${['', 'c', 'u', 'r', 'm'].map(r => `<button data-rar="${r}" class="${B.rarity === r ? 'on' : ''}">${r ? r.toUpperCase() : 'Any'}</button>`).join('')}</div>
    </div>
    <div id="brList" class="brlist"></div>`;
  const draw = () => {
    const ids = db.cardsInSets(p.sets);
    let cards = [...ids].map(i => db.cards[i]).filter(c => !c.isBasic);
    if (B.color) cards = cards.filter(c => colorGroup(c) === B.color);
    if (B.rarity) cards = cards.filter(c => db.rarityIn(c, p.sets)[0] === B.rarity);
    if (B.q) { const q = B.q.toLowerCase(); cards = cards.filter(c => c.name.toLowerCase().includes(q) || c.typeLine.toLowerCase().includes(q)); }
    cards.sort((a, b) => COLOR_ORDER.indexOf(colorGroup(a)) - COLOR_ORDER.indexOf(colorGroup(b)) || a.cmc - b.cmc || a.name.localeCompare(b.name));
    $('#brList').innerHTML = cards.map(c => { const n = countInPool(c); return `<button class="brcard ${n ? 'has' : ''}" data-add="${esc(c.name)}"><span class="cost">${manaHtml(c.manaCost)}</span><span class="nm"><span class="rar r-${rarityLetter(db.rarityIn(c, p.sets))}"></span>${esc(c.name)}</span><span class="badge">${n || ''}</span></button>`; }).join('') || '<p class="muted">No cards match.</p>';
  };
  draw();
  $('#brQ').oninput = debounce((e) => { B.q = e.target.value; draw(); }, 120);
  $$('[data-col]', box).forEach(b => b.onclick = () => { B.color = b.dataset.col; poolBrowseInput(box); });
  $$('[data-rar]', box).forEach(b => b.onclick = () => { B.rarity = b.dataset.rar; poolBrowseInput(box); });
  $('#brList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-add]'); if (!b) return;
    const c = db.get(b.dataset.add); addToPool(c, 1);
    b.classList.add('has'); b.querySelector('.badge').textContent = countInPool(c);
    renderPoolList();
  });
  $('#brList').addEventListener('contextmenu', (e) => { const b = e.target.closest('[data-add]'); if (!b) return; e.preventDefault(); const c = db.get(b.dataset.add); addToPool(c, -1); b.querySelector('.badge').textContent = countInPool(c) || ''; b.classList.toggle('has', countInPool(c) > 0); renderPoolList(); });
  box.insertAdjacentHTML('beforeend', '<p class="hint">Tap = +1. Long-press = −1. Tap a card in the pool list below to read it.</p>');
}

function poolPacksInput(box) {
  const p = pool();
  if (!p.sets.length) { box.innerHTML = `<p class="hint">Add one or more sets first (<b>+ Set</b> above). Packs are shared out across the sets in order — e.g. 6 packs from 2 sets = 3 of each.</p>`; return; }
  const n = ls.get('packCount', 6);
  box.innerHTML = `
    <div class="row wrap">
      <label class="inline">Packs <input id="packN" type="number" min="1" max="36" value="${n}" class="tiny"></label>
      <label class="inline"><input type="checkbox" id="packReplace" ${poolTotal() ? '' : 'checked'}> Replace current pool</label>
    </div>
    <button id="packGo" class="primary big">Open ${n} pack${n > 1 ? 's' : ''} from ${p.sets.map(esc).join(' + ')}</button>
    <p class="hint">Each pack: ${PACK_SIZE} cards, no duplicates within a pack, at least 1 and at most ${MAX_RARE} rares/mythics — 1 rare-or-mythic slot (mythic about 1 in 7), 3 uncommons, 7 commons and 2 wildcard slots of any rarity. No basic lands (they're free when building).</p>
    <div id="packOut"></div>`;
  $('#packN').oninput = (e) => { const v = Math.max(1, Math.min(36, +e.target.value || 1)); ls.set('packCount', v); $('#packGo').textContent = `Open ${v} pack${v > 1 ? 's' : ''} from ${p.sets.join(' + ')}`; };
  $('#packGo').onclick = () => {
    const count = Math.max(1, Math.min(36, +$('#packN').value || 6));
    const packs = openPacks(db, p.sets, count);
    if (packs.every(pk => !pk.cards.length)) { $('#packOut').innerHTML = '<p class="warn">No card list for these sets — download the set in Data first.</p>'; return; }
    if ($('#packReplace').checked) p.items = [];
    addManyToPool(packs.flatMap(pk => pk.cards.map(x => ({ card: db.cards[x.idx], count: 1 }))));
    const RL = { c: 'C', u: 'U', r: 'R', m: 'M' };
    $('#packOut').innerHTML = packs.map((pk, i) => `<details ${i === 0 ? 'open' : ''}><summary>Pack ${i + 1} · ${esc(pk.set)} · ${pk.cards.length} cards · ${pk.cards.filter(x => x.rarity === 'r' || x.rarity === 'm').length} R/M</summary>
      ${pk.cards.slice().sort((a, b) => 'mruc'.indexOf(a.rarity) - 'mruc'.indexOf(b.rarity)).map(x => { const c = db.cards[x.idx]; return `<div class="crow" data-card="${esc(c.name)}"><span class="cost">${manaHtml(c.manaCost)}</span><span class="cname"><span class="rar r-${RL[x.rarity]}"></span>${esc(c.name)}</span><span class="right muted">${RL[x.rarity]}</span></div>`; }).join('')}</details>`).join('');
    bindCardOpen($('#packOut'));
    renderPoolList();
    toast(`Opened ${count} packs — ${count * PACK_SIZE} cards added`);
  };
}

function poolPasteInput(box) {
  box.innerHTML = `<textarea id="pasteIn" rows="7" placeholder="Paste an MTG Arena export, a CSV, or any list:\n1 Lightning Bolt (2X2) 117\n3x Island\nShock"></textarea>
    <div class="row wrap"><button id="pasteAdd" class="primary">Add to pool</button><button id="pasteReplace" class="ghost">Replace pool</button>
      <label class="ghost filebtn">Import CSV file<input type="file" id="csvFile" accept=".csv,.txt,.tsv,text/csv,text/plain" hidden></label></div>
    <p class="hint">CSV: MTG Arena collection exports (Id, Name, Set, Count…) and Moxfield / ManaBox / Deckbox / Archidekt style files with a Name and Count/Quantity column. Rows with a count of 0 are skipped.</p>
    <div id="pasteMsg"></div>`;
  const go = (replace, text = $('#pasteIn').value) => {
    if (looksLikeCsv(text)) return goCsv(replace, text);
    const items = parseList(text);
    const { entries, missing } = resolveList(db, items);
    const p = pool();
    if (replace) p.items = [];
    addManyToPool(entries);
    const sets = [...new Set(items.map(i => i.set).filter(s => s && db.sets[s]))];
    if (!p.sets.length && sets.length && sets.length <= 3) p.sets = sets;
    save();
    $('#pasteMsg').innerHTML = `<p>Added ${entries.reduce((a, e) => a + e.count, 0)} cards.${missing.length ? `<br><span class="warn">Not found (${missing.length}): ${missing.map(esc).join(', ')}</span><br><span class="hint">New set? Download it in Data → "Get a set from Scryfall".</span>` : ''}</p>`;
    renderPoolList();
  };
  const goCsv = (replace, text) => {
    const res = parseCsv(text);
    if (res.error) { $('#pasteMsg').innerHTML = `<p class="warn">${esc(res.error)}</p>`; return; }
    const { entries, missing } = resolveList(db, res.items);
    const p = pool();
    if (replace) p.items = [];
    addManyToPool(entries);
    const copies = entries.reduce((a, e) => a + e.count, 0);
    $('#pasteMsg').innerHTML = `<p><b>${esc(res.format)}</b>: ${res.rows.toLocaleString()} rows → ${entries.length.toLocaleString()} different cards (${copies.toLocaleString()} copies) added.${res.skippedZero ? ` ${res.skippedZero.toLocaleString()} rows with 0 owned skipped.` : ''}
      ${missing.length ? `<br><span class="warn">Not found (${missing.length}): ${missing.slice(0, 30).map(esc).join(', ')}${missing.length > 30 ? '…' : ''}</span><br><span class="hint">Usually Arena-only Alchemy cards or brand-new cards — Data → "Get new cards" may add them.</span>` : ''}
      ${entries.length > 300 ? `<br><span class="hint">That's a whole collection — on Build, pick <b>Constructed (60)</b> or <b>Brawl</b> and set the format (e.g. Standard / Historic) so only legal cards are used.</span>` : ''}</p>`;
    renderPoolList();
  };
  $('#pasteAdd').onclick = () => go(false);
  $('#pasteReplace').onclick = () => go(true);
  $('#csvFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $('#pasteMsg').innerHTML = '<div class="spinner"></div> Reading file…';
    const text = await f.text();
    const replace = !poolTotal() ? true : await askConfirm(`Replace the current pool (${poolTotal()} cards) with ${f.name}? Cancel adds to it instead.`);
    go(replace, text);
    e.target.value = '';
  };
}

function openSetPicker() {
  const list = db.setList();
  const typesMain = new Set(['Expansion', 'Core', 'Draft', 'Reprint', 'expansion', 'core', 'draft_innovation', 'masters']);
  const m = modal(`<h2>Choose set</h2><input id="setQ" type="search" placeholder="Search sets (name or code)"><label class="inline"><input type="checkbox" id="setAll"> show promos/online/other products</label><div id="setList" class="setlist"></div>`);
  const draw = () => {
    const q = $('#setQ', m).value.toLowerCase(); const all = $('#setAll', m).checked;
    $('#setList', m).innerHTML = list.filter(s => (all || typesMain.has(s.type)) && (!q || s.name.toLowerCase().includes(q) || s.code.toLowerCase() === q))
      .slice(0, 150).map(s => `<button data-set="${s.code}"><b>${esc(s.code)}</b> ${esc(s.name)} <small>${s.date?.slice(0, 7) || ''} · ${s.count}</small></button>`).join('');
  };
  draw();
  $('#setQ', m).oninput = draw; $('#setAll', m).onchange = draw;
  $('#setList', m).onclick = (e) => { const b = e.target.closest('[data-set]'); if (!b) return; const p = pool(); if (!p.sets.includes(b.dataset.set)) p.sets.push(b.dataset.set); save(); closeModal(); render(); };
  $('#setQ', m).focus();
}

// ---------------- BUILD ----------------
function viewBuild(v) {
  const o = S.opts;
  const entries = poolEntries();
  const legends = entries.filter(e => isCommanderFor(e.card, o));
  const colorState = (c) => o.mustColors.includes(c) ? 'must' : o.excludeColors.includes(c) ? 'no' : '';
  v.innerHTML = `
  <section class="card">
    <h2>Format</h2>
    <div class="grid2">
      <label>Preset<select id="preset">${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}" ${o.preset === k ? 'selected' : ''}>${p.label}</option>`).join('')}</select></label>
      <label>Play style<select id="style">${['auto', 'aggro', 'midrange', 'control', 'tempo', 'synergy'].map(s => `<option ${o.style === s ? 'selected' : ''} value="${s}">${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></label>
      <label>Deck size<input id="deckSize" type="number" min="20" max="250" value="${o.deckSize}"></label>
      <label>Lands<input id="landCount" type="number" min="0" max="60" placeholder="Auto" value="${o.landCount ?? ''}"></label>
      <label>Max colours<select id="maxColors">${[1, 2, 3, 4, 5].map(n => `<option ${o.maxColors === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Format legality<select id="legality"><option value="">Any (pool decides)</option>${[['standard', 'Standard'], ['pioneer', 'Pioneer'], ['modern', 'Modern'], ['legacy', 'Legacy'], ['vintage', 'Vintage'], ['pauper', 'Pauper'], ['historic', 'Historic (Arena)'], ['commander', 'Commander'], ['standardbrawl', 'Standard Brawl'], ['brawl', 'Brawl (Arena)']].map(([f, l]) => `<option value="${f}" ${o.legality === f ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    ${o.preset === 'standardbrawl' ? '<p class="hint">Standard Brawl: exactly 60 cards including the commander, singleton, Standard-legal cards plus Arcane Signet and Command Tower, 25 life. Commander: a legendary creature or planeswalker.</p>' : ''}
    ${o.preset === 'brawl' ? '<p class="hint">Brawl (Arena): exactly 100 cards including the commander, singleton, any card on MTG Arena (Alchemy included) except the Brawl ban list, 25 life. Commander: a legendary creature or planeswalker.</p>' : ''}
    <div class="toggles">
      <label class="inline"><input type="checkbox" id="basicsFree" ${o.basicsFree ? 'checked' : ''}> Unlimited basic lands</label>
      <label class="inline"><input type="checkbox" id="splash" ${o.splash ? 'checked' : ''}> Allow a splash</label>
      <label class="inline">Max splash cards <input id="maxSplash" type="number" min="1" max="6" value="${o.maxSplashCards}" class="tiny"></label>
      <label class="inline"><input type="checkbox" id="singleton" ${o.singleton ? 'checked' : ''}> Singleton</label>
    </div>
    ${o.mode === 'commander' ? `<label>Commander<select id="commander"><option value="auto">Auto – try every legal commander in the pool</option>${legends.map(e => `<option ${o.commander === e.card.key ? 'selected' : ''} value="${esc(e.card.key)}">${esc(e.card.name)}</option>`).join('')}</select></label>` : ''}
    <label>Synergy weight <output id="synOut">${o.synergyWeight.toFixed(1)}</output><input id="synergyWeight" type="range" min="0" max="2.5" step="0.1" value="${o.synergyWeight}"></label>
  </section>
  <section class="card">
    <h2>Colours</h2>
    <p class="hint">Tap: must include → exclude → either.</p>
    <div class="colorpick">${['W', 'U', 'B', 'R', 'G'].map(c => `<button data-color="${c}" class="cstate ${colorState(c)}">${pip(c)}<small>${({ must: 'must', no: 'no', '': 'any' })[colorState(c)]}</small></button>`).join('')}</div>
  </section>
  ${archPanel(entries)}
  <section class="card">
    <h2>Must include</h2>
    <div id="mustChips" class="chips">${o.mustInclude.map(n => `<span class="chip">${esc(n)} <button data-rmmust="${esc(n)}">×</button></span>`).join('') || '<span class="muted">none</span>'}</div>
    <div class="ac"><input id="mustIn" type="search" placeholder="Add a card from your pool…" autocomplete="off"><div id="mustList" class="aclist"></div></div>
    <h2>Never include</h2>
    <div id="exChips" class="chips">${o.exclude.map(n => `<span class="chip">${esc(n)} <button data-rmex="${esc(n)}">×</button></span>`).join('') || '<span class="muted">none</span>'}</div>
    <div class="ac"><input id="exIn" type="search" placeholder="Exclude a card…" autocomplete="off"><div id="exList" class="aclist"></div></div>
  </section>
  <section class="card">
    <label class="inline"><input type="checkbox" id="onlineCombos" ${o.onlineCombos ? 'checked' : ''}> Also check Commander Spellbook for combos when online</label>
    <button id="go" class="primary big" ${entries.length ? '' : 'disabled'}>Build the strongest deck from ${poolTotal()} cards</button>
    <div id="progress"></div>
    <p class="hint"><button id="resetOpts" class="ghost small">Reset options</button></p>
  </section>`;
  const set = (k, val) => { o[k] = val; save(); };
  $('#preset').onchange = (e) => { const p = PRESETS[e.target.value]; Object.assign(o, { preset: e.target.value, ...p, landCount: null }); save(); render(); };
  $('#style').onchange = (e) => set('style', e.target.value);
  $('#deckSize').onchange = (e) => set('deckSize', Math.max(20, +e.target.value || 40));
  $('#landCount').onchange = (e) => set('landCount', e.target.value === '' ? null : +e.target.value);
  $('#maxColors').onchange = (e) => set('maxColors', +e.target.value);
  $('#legality').onchange = (e) => set('legality', e.target.value);
  $('#basicsFree').onchange = (e) => set('basicsFree', e.target.checked);
  $('#splash').onchange = (e) => set('splash', e.target.checked);
  $('#maxSplash').onchange = (e) => set('maxSplashCards', +e.target.value || 3);
  $('#singleton').onchange = (e) => set('singleton', e.target.checked);
  $('#onlineCombos').onchange = (e) => set('onlineCombos', e.target.checked);
  if ($('#commander')) $('#commander').onchange = (e) => set('commander', e.target.value);
  $('#synergyWeight').oninput = (e) => { set('synergyWeight', +e.target.value); $('#synOut').textContent = (+e.target.value).toFixed(1); };
  $$('[data-color]').forEach(b => b.onclick = () => {
    const c = b.dataset.color; const st = colorState(c);
    o.mustColors = o.mustColors.replace(c, ''); o.excludeColors = o.excludeColors.replace(c, '');
    if (st === '') o.mustColors += c; else if (st === 'must') o.excludeColors += c;
    save(); render();
  });
  $$('[data-rmmust]').forEach(b => b.onclick = () => { o.mustInclude = o.mustInclude.filter(n => n !== b.dataset.rmmust); save(); render(); });
  $$('[data-rmex]').forEach(b => b.onclick = () => { o.exclude = o.exclude.filter(n => n !== b.dataset.rmex); save(); render(); });
  const poolFilterAc = (inId, listId, key) => {
    const inp = $('#' + inId), lst = $('#' + listId); let items = [];
    const names = new Set(entries.map(e => e.card.name));
    inp.oninput = debounce(() => {
      items = db.search(inp.value, { limit: 8, filter: c => names.has(c.name) });
      lst.innerHTML = items.map((c, i) => `<button class="acitem" data-i="${i}"><span class="cost">${manaHtml(c.manaCost)}</span><span class="cname">${esc(c.name)}</span></button>`).join('');
    }, 60);
    lst.onclick = (e) => { const b = e.target.closest('.acitem'); if (!b) return; const c = items[+b.dataset.i]; if (!o[key].includes(c.name)) o[key].push(c.name); save(); render(); };
  };
  poolFilterAc('mustIn', 'mustList', 'mustInclude');
  poolFilterAc('exIn', 'exList', 'exclude');
  $('#resetOpts').onclick = () => { S.opts = { ...DEFAULT_OPTS }; save(); render(); };
  $$('[data-arch]').forEach(b => b.onclick = () => { o.mustColors = b.dataset.arch; o.excludeColors = o.excludeColors.split('').filter(c => !b.dataset.arch.includes(c)).join(''); save(); render(); toast(`Colours set to ${b.dataset.arch} — tap Build`); });
  $('#go').onclick = runBuild;
}

function archPanel(entries) {
  const sets = pool().sets;
  if (S.opts.mode !== 'limited' || !sets.length) return '';
  const A = setArchetypes(db, sets);
  const rows = Object.values(A).filter(a => a.themes?.length).map(a => {
    let fit = 0, playable = 0;
    for (const e of entries) {
      const c = e.card; if (c.isLand) continue;
      const needs = [...(c.colors || '')];
      if (!needs.every(x => a.pair.includes(x))) continue;
      playable += e.count; if (fitsArchetype(c, a) > 0) fit += e.count;
    }
    return { a, fit, playable };
  }).sort((x, y) => y.fit - x.fit);
  if (!rows.length) return '';
  return `<section class="card"><h2>Set archetypes <span class="muted">${sets.map(esc).join(' + ')}</span></h2>
    <p class="hint">Worked out from each colour pair's gold cards. Numbers = your pool's cards that fit the plan / playable in those colours. Tap a pair to lock those colours.</p>
    ${rows.map(({ a, fit, playable }) => `<button class="archrow" data-arch="${a.pair}"><span class="pips">${[...a.pair].map(c => pip(c)).join('')}</span><span class="al"><b>${esc(a.name)}</b> — ${esc(a.label)}<small>${a.signposts.slice(0, 3).map(n => esc(n.split(' // ')[0])).join(', ')}</small></span><b>${fit}/${playable}</b></button>`).join('')}</section>`;
}

// ---- session restore: rebuild the last deck (deterministic) and re-apply edits ----
function poolSignature() { return JSON.stringify([pool().id, pool().items.map(x => [x.name, x.count]).sort()]); }
function saveSession() {
  if (!S.result) { ls.set('session', null); return; }
  const r = S.result.results[S.resultIdx];
  const edits = r.orig ? { list: r.deck.list.map(i => r.ctx.spells[i].card.name), manual: r.manual ? { nonbasics: r.manual.nonbasics.map(c => c.name), basics: r.manual.basics } : null } : null;
  ls.set('session', { sig: poolSignature(), opts: S.lastOpts, combos: S.result.combosInPool || [], resultIdx: S.resultIdx, editing: !!S.editing, edits, comboNote: S.result.comboNote });
}
function restoreSession() {
  const ss = ls.get('session', null);
  if (!ss || ss.sig !== poolSignature() || !ss.opts) return;
  try {
    const o = { ...ss.opts };
    if (o.mode === 'limited' && o.sets?.length) o.archetypes = setArchetypes(db, o.sets);
    const out = buildDecks(poolEntries(), o, ss.combos || []);
    if (!out.results?.length) return;
    out.opts = o; out.combosInPool = ss.combos || []; out.comboNote = ss.comboNote; out.ms = 0;
    S.result = out; S.lastOpts = ss.opts; S.resultIdx = Math.min(ss.resultIdx || 0, out.results.length - 1); S.editing = ss.editing;
    const r = out.results[S.resultIdx];
    if (ss.edits) {
      r.orig = { score: r.score, list: [...r.deck.list], L: r.L };
      const idx = (name) => r.ctx.spells.findIndex(e => e.card.name === name);
      r.deck.list = ss.edits.list.map(idx).filter(i => i >= 0);
      if (ss.edits.manual) r.manual = { nonbasics: ss.edits.manual.nonbasics.map(n => db.get(n)).filter(Boolean), basics: ss.edits.manual.basics };
      rescore(r);
    }
  } catch (e) { console.warn('session restore failed', e); }
}

async function runBuild() {
  const prog = $('#progress');
  const entries = poolEntries();
  if (!entries.length) return;
  prog.innerHTML = '<div class="spinner"></div> Analysing pool…';
  await new Promise(r => setTimeout(r, 30));
  const o = { ...S.opts, sets: pool().sets.length ? pool().sets : guessSets(entries) };
  if (o.mode === 'limited' && o.sets.length) o.archetypes = setArchetypes(db, o.sets);
  let combos = combosInPool(entries.map(e => e.card), ls.get('customCombos', []).map(c => ({ ...c, source: 'yours' })));
  let comboNote = '';
  if (o.onlineCombos && navigator.onLine && entries.length <= 1500) {
    prog.innerHTML = '<div class="spinner"></div> Checking Commander Spellbook…';
    try {
      const r = await Promise.race([spellbookCombos(entries.map(e => e.card.name)), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 9000))]);
      combos = combos.concat(r.combos);
      comboNote = `Commander Spellbook: ${r.combos.length} combo(s) in pool${r.cached ? ' (cached)' : ''}.`;
    } catch (e) { comboNote = 'Commander Spellbook unavailable (' + e.message + ') — used built-in combo list.'; }
  }
  prog.innerHTML = '<div class="spinner"></div> Building decks…';
  await new Promise(r => setTimeout(r, 30));
  const t0 = performance.now();
  let out;
  try { out = buildDecks(entries, o, combos); } catch (e) { prog.innerHTML = `<p class="warn">Build failed: ${esc(e.message)}</p>`; console.error(e); return; }
  out.ms = Math.round(performance.now() - t0);
  out.comboNote = comboNote; out.combosInPool = combos; out.opts = o;
  if (out.error || !out.results.length) { prog.innerHTML = `<p class="warn">${esc(out.error || 'No deck could be built with these restrictions — try allowing more colours or removing must-include cards.')}</p>`; return; }
  S.result = out; S.resultIdx = 0; S.editing = false;
  const { archetypes, ...plainOpts } = o; S.lastOpts = plainOpts; saveSession();
  location.hash = 'deck';
}
function guessSets(entries) {
  const cnt = {};
  for (const e of entries) for (const s of e.card.limitedRank ? Object.keys(e.card.limitedRank) : []) cnt[s] = (cnt[s] || 0) + e.count;
  return Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
}

// ---------------- DECK ----------------
const BASIC_NAME = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
function viewDeck(v) {
  if (!S.result && !S.restoreTried && ls.get('session', null)) {
    // rebuild the last deck on demand (big collections take a few seconds, so only when you open this tab)
    S.restoreTried = true;
    v.innerHTML = '<section class="card"><div class="spinner"></div> Restoring your last deck…</section>';
    setTimeout(() => { restoreSession(); render(); }, 30);
    return;
  }
  if (!S.result) {
    v.innerHTML = `<section class="card"><h2>No deck yet</h2><p>Add your pool, then tap <b>Build</b>.</p>${S.decks.length ? '<h3>Saved decks</h3>' + savedDecksHtml() : ''}</section>`;
    bindSaved(v); return;
  }
  const out = S.result; const r = out.results[S.resultIdx];
  const st = r.stats; const mb = r.manabase;
  const creatures = r.cards.filter(x => x.card.isCreature);
  const spells = r.cards.filter(x => !x.card.isCreature);
  const maxCurve = Math.max(...st.curve, 1);
  const basics = Object.entries(mb.basics).filter(([, n]) => n > 0);
  v.innerHTML = `${S.editing ? editBar(r) : ''}
  <section class="card">
    <div class="opts">${out.results.slice(0, 8).map((x, i) => `<button data-res="${i}" class="${i === S.resultIdx ? 'on' : ''}"><span class="pips">${[...x.main].map(c => pip(c)).join('')}${x.splash ? '<span class="spl">+' + pip(x.splash) + '</span>' : ''}</span>${x.run.commander ? '<small>' + esc(x.run.commander.card.name.split(',')[0]) + '</small>' : ''}<small>${x.score}</small></button>`).join('')}</div>
    <h2>${[...r.main].map(c => pip(c)).join('')}${r.splash ? ' splash ' + pip(r.splash) : ''} ${esc(r.archetype)} ${r.run.commander ? '— ' + esc(r.run.commander.card.name) : ''}</h2>
    ${(r.setArchetypes || []).map(a => `<div class="arch"><b>${[...a.pair].map(c => pip(c)).join('')} ${esc(a.name)}:</b> ${esc(a.label)} <small class="muted">— ${a.fits} of ${st.spells} spells on-plan (◆)${a.signposts.length ? ` · signposts: ${a.signposts.map(n => esc(n.split(' // ')[0])).join(', ')}` : ''}</small></div>`).join('')}

    <div class="stats">
      <div><b>${st.creatures}</b><small>creatures</small></div><div><b>${st.nonCreatures}</b><small>other spells</small></div>
      <div><b>${st.removal}</b><small>removal</small></div><div><b>${st.avgCmc}</b><small>avg MV</small></div><div><b>${r.L}</b><small>lands</small></div>
    </div>
    <div class="curve">${st.curve.slice(0, 8).map((n, i) => `<div class="bar"><span style="height:${(n / maxCurve) * 100}%"></span><b>${n || ''}</b><small>${i === 7 ? '7+' : i}</small></div>`).join('')}</div>
    ${r.warnings.length ? `<ul class="warnings">${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    <div class="row wrap"><button id="editDeck" class="${S.editing ? 'primary' : 'ghost'}">${S.editing ? '✓ Done editing' : '✎ Edit deck'}</button><button id="playtest" class="primary">▶ Playtest</button><button id="copyArena" class="primary">Copy for MTG Arena</button><button id="shareDeck" class="ghost">Share</button><button id="saveDeck" class="ghost">Save</button><button id="cacheImgs" class="ghost">Save images offline</button></div>
  </section>
  <section class="card decklist">
    ${r.run.commander ? `<h3 class="grp">Commander</h3>${cardRow(r.run.commander.card)}` : ''}
    <h3 class="grp">Creatures <span class="muted">${creatures.reduce((a, x) => a + x.count, 0)}</span></h3>
    ${creatures.map(x => deckRow(x)).join('')}
    <h3 class="grp">Spells <span class="muted">${spells.reduce((a, x) => a + x.count, 0)}</span></h3>
    ${spells.map(x => deckRow(x)).join('')}
    <h3 class="grp">Lands <span class="muted">${r.L}</span></h3>
    ${mb.nonbasics.map((c, k) => cardRow(c, { right: S.editing ? `<button class="mini" data-outland="${k}">−</button><b>1</b>` : '<b>1</b>', sub: 'makes ' + (c.produces || '—') })).join('')}
    ${(S.editing ? ['W', 'U', 'B', 'R', 'G'].map(c => [c, mb.basics[c] || 0]) : basics).map(([c, n]) => `<div class="crow"><span class="cost">${pip(c)}</span><span class="cname">${BASIC_NAME[c]}</span><span class="right">${S.editing ? `<button class="mini" data-basic="${c}" data-d="-1">−</button><b>${n}</b><button class="mini" data-basic="${c}" data-d="1">+</button>` : `<b>${n}</b>`}</span></div>`).join('')}
    <p class="hint">Sources: ${[...r.colors].map(c => `${pip(c)} ${mb.sources[c]}`).join(' · ')}${mb.fixingLands ? ` · ${mb.fixingLands} dual/fixing land${mb.fixingLands > 1 ? 's' : ''}` : ''}${mb.extraFixers?.length ? ` · plus fixing from ${mb.extraFixers.map(f => esc(f.name.split(' // ')[0]) + (f.count > 1 ? ' ×' + f.count : '')).join(', ')} (landcycling / land search)` : ''}</p>
    ${mb.consistency ? `<div class="mana-risk risk-${mb.consistency.risk.toLowerCase()}"><b>Colour risk: ${mb.consistency.risk}</b> — ${Math.round(mb.consistency.onCurve * 100)}% of spells have their colours on curve, ${Math.round(mb.consistency.within2 * 100)}% within 2 turns.
      ${mb.consistency.worst.filter(x => x.pOn < 0.8).length ? `<br><small>Least reliable: ${mb.consistency.worst.filter(x => x.pOn < 0.8).slice(0, 3).map(x => `${esc(x.name.split(' // ')[0])} ${Math.round(x.pOn * 100)}% on turn ${x.turn}`).join(' · ')}</small>` : ''}</div>` : ''}
  </section>
  <section class="card">
    <h2>Why this deck</h2>
    <table class="score">
      <tr><td>Card quality</td><td>${Math.round(r.breakdown.power)}</td></tr>
      <tr><td>Synergy</td><td>+${Math.round(r.breakdown.synergy)}</td></tr>
      <tr><td>Curve & composition</td><td>${Math.round(r.breakdown.composition)}</td></tr>
      ${r.breakdown.splash ? `<tr><td>Splash cost</td><td>${Math.round(r.breakdown.splash)}</td></tr>` : ''}
      ${r.breakdown.mana ? `<tr><td>Colour-screw risk (expected loss)</td><td>${Math.round(r.breakdown.mana)}</td></tr>` : ''}
      ${r.breakdown.combo ? `<tr><td>Combos</td><td>+${Math.round(r.breakdown.combo)}</td></tr>` : ''}
      ${r.breakdown.cast ? `<tr><td>Hybrid/duplicate costs</td><td>${Math.round(r.breakdown.cast)}</td></tr>` : ''}
      <tr class="tot"><td>Total</td><td>${r.score}</td></tr>
    </table>
    ${out.results.length > 1 ? `<p class="hint">Next best: ${out.results.slice(1, 4).map(x => `${x.main}${x.splash ? '+' + x.splash : ''} (${x.score})`).join(', ')}. Tap the colour buttons at the top to view them.</p>` : ''}
    ${r.themes.length ? `<h3>Themes</h3><div class="chips">${r.themes.map(t => `<span class="chip">${esc(t.theme)} · ${t.links}</span>`).join('')}</div>` : ''}
    ${r.topPairs.length ? `<h3>Key synergies</h3><ul class="pairs">${r.topPairs.slice(0, 8).map(p => `<li><b>${esc(p.a)}</b> + <b>${esc(p.b)}</b><br><small>${p.text.map(esc).join('<br>')}</small></li>`).join('')}</ul>` : '<p class="hint">No real card-to-card synergies in this deck — it is built on card quality.</p>'}
    ${r.combosIn?.length ? `<h3>Combos in this deck</h3><ul class="pairs">${r.combosIn.map(c => `<li><b>${c.cards.map(esc).join(' + ')}</b><br><small>${esc(c.result)}${c.requires ? ' — needs: ' + esc(c.requires) : ''} (${esc(c.source)})</small></li>`).join('')}</ul>` : ''}
    ${out.comboNote ? `<p class="hint">${esc(out.comboNote)}</p>` : ''}
  </section>
  <section class="card">
    <h2>${S.editing ? 'Sideboard — tap + to add' : 'Best of the rest'}</h2>
    ${(S.editing ? r.sideboard : r.sideboard.slice(0, 15)).map(x => cardRow(x.card, { right: `<span class="val">${x.value}</span>${S.editing ? `<button class="mini add" data-in="${x.i}">+</button>` : ''}`, sub: esc(x.reason) + (x.left > 1 ? ` · ${x.left} left` : '') })).join('')}
    ${S.editing ? spareLands(r).map(c => cardRow(c, { right: `<button class="mini add" data-inland="${esc(c.name)}">+</button>`, sub: 'land · makes ' + (c.produces || '—') })).join('') : ''}
    <p class="hint">Built in ${out.ms} ms from ${out.poolSize} cards. Card values: ${esc(scoreSourceNote(r))}</p>
  </section>`;
  $$('[data-res]').forEach(b => b.onclick = () => { S.resultIdx = +b.dataset.res; saveSession(); render(); });
  $('#editDeck').onclick = () => { S.editing = !S.editing; saveSession(); render(); };
  const edit = (fn) => {
    r.orig ||= { score: r.score, list: [...r.deck.list], L: r.L };
    fn(); rescore(r); saveSession();
    const y = v.scrollTop; render(); v.scrollTop = y;
  };
  const manual = () => (r.manual ||= { nonbasics: [...r.manabase.nonbasics], basics: { ...r.manabase.basics } });
  $$('[data-out]', v).forEach(b => b.onclick = (e) => { e.stopPropagation(); edit(() => { const k = r.deck.list.indexOf(+b.dataset.out); if (k >= 0) r.deck.list.splice(k, 1); }); });
  $$('[data-in]', v).forEach(b => b.onclick = (e) => { e.stopPropagation(); edit(() => r.deck.list.push(+b.dataset.in)); });
  $$('[data-outland]', v).forEach(b => b.onclick = (e) => { e.stopPropagation(); edit(() => manual().nonbasics.splice(+b.dataset.outland, 1)); });
  $$('[data-inland]', v).forEach(b => b.onclick = (e) => { e.stopPropagation(); edit(() => manual().nonbasics.push(r.ctx.lands.find(l => l.card.name === b.dataset.inland).card)); });
  $$('[data-basic]', v).forEach(b => b.onclick = (e) => { e.stopPropagation(); edit(() => { const m = manual(); m.basics[b.dataset.basic] = Math.max(0, (m.basics[b.dataset.basic] || 0) + +b.dataset.d); }); });
  if ($('#resetEdit')) $('#resetEdit').onclick = () => { if (!r.orig) return; r.deck.list = [...r.orig.list]; r.L = r.orig.L; delete r.manual; rescore(r); delete r.orig; saveSession(); render(); };
  const deckList = () => {
    const list = r.cards.map(x => ({ card: x.card, count: x.count }));
    const nb = new Map(); for (const c of r.manabase.nonbasics) nb.set(c, (nb.get(c) || 0) + 1);
    for (const [card, count] of nb) list.push({ card, count });
    for (const [c, n] of Object.entries(r.manabase.basics)) if (n) { const card = db.get(BASIC_NAME[c]); if (card) list.push({ card, count: n }); }
    if (r.run.commander) list.push({ card: r.run.commander.card, count: 1 });
    return list;
  };
  $('#playtest').onclick = () => openPlaytest(deckList(), `${r.main}${r.splash ? '+' + r.splash : ''}`, S.result.opts.life || 20);
  $('#cacheImgs').onclick = () => {
    if (!navigator.onLine) { toast('Connect to the internet first'); return; }
    const n = precacheImages(deckList().map(x => x.card), (k) => toast(`${k} card images saved for offline use`));
    toast(`Downloading ${n} card images…`);
  };
  bindCardOpen(v);
  const text = () => arenaText(r);
  $('#copyArena').onclick = async () => { try { await navigator.clipboard.writeText(text()); toast('Copied — in Arena: Decks → Import'); } catch { modal(`<h2>Deck list</h2><textarea rows="20">${esc(text())}</textarea>`); } };
  $('#shareDeck').onclick = async () => { if (navigator.share) navigator.share({ title: 'Deck', text: text() }).catch(() => {}); else modal(`<h2>Deck list</h2><textarea rows="20">${esc(text())}</textarea>`); };
  $('#saveDeck').onclick = async () => { const name = await askText('Deck name', `${pool().name} – ${r.main}${r.splash ? '+' + r.splash : ''}`); if (!name) return; S.decks.unshift({ name, at: Date.now(), text: text(), colors: r.colors }); save(); toast('Saved'); };
}
function scoreSourceNote(r) {
  const n = r.cards.filter(x => x.powerSource === 'ranking').length;
  return n ? `${n}/${r.cards.length} from set pick-order rankings, rest estimated from rules text.` : 'estimated from rules text (no rankings for this set yet).';
}
function deckRow(x) {
  const roleIcons = x.roles.filter(r => ['Removal', 'Hard removal', 'Card advantage', 'Board wipe', 'Counterspell', 'Evasion', 'Finisher'].includes(r)).slice(0, 2);
  return cardRow(x.card, { right: `${x.splash ? '<span class="tag spl">splash</span>' : ''}${x.onPlan ? '<span class="onplan" title="fits the set archetype">◆</span>' : ''}<span class="val" title="value">${x.value}</span>${S.editing ? `<button class="mini" data-out="${x.i}">−</button>` : ''}<b>${x.count}</b>`, sub: roleIcons.join(' · ') });
}
function editBar(r) {
  const size = r.deck.list.length + r.L + (r.run.commander ? 1 : 0);
  const target = S.result.opts.deckSize;
  const delta = r.orig ? r.score - r.orig.score : 0;
  return `<div class="editbar"><span><b class="${size === target ? '' : 'warn'}">${size}/${target}</b> cards · ${r.deck.list.length} spells + ${r.L} lands</span>
    <span>Score <b>${r.score}</b>${r.orig ? ` <span class="${delta >= 0 ? 'ok' : 'warn'}">(${delta >= 0 ? '+' : ''}${delta} vs suggested)</span>` : ''}</span>
    ${r.orig ? '<button id="resetEdit" class="ghost small">Reset to suggested</button>' : ''}</div>`;
}
function spareLands(r) {
  const used = new Map(); for (const c of r.manabase.nonbasics) used.set(c.name, (used.get(c.name) || 0) + 1);
  const out = [];
  for (const e of r.ctx.lands) if (!e.card.isBasic && (used.get(e.card.name) || 0) < e.count) out.push(e.card);
  return out;
}
function arenaText(r) {
  const lines = [];
  if (r.run.commander) lines.push('Commander', `1 ${r.run.commander.card.name.split(' // ')[0]}`, '');
  lines.push('Deck');
  const nm = (c) => c.layout === 'split' ? c.name : c.name.split(' // ')[0];
  for (const x of r.cards) lines.push(`${x.count} ${nm(x.card)}`);
  for (const c of r.manabase.nonbasics) lines.push(`1 ${nm(c)}`);
  for (const [c, n] of Object.entries(r.manabase.basics)) if (n) lines.push(`${n} ${BASIC_NAME[c]}`);
  // merge duplicate nonbasic lines
  const merged = []; const idx = new Map();
  for (const l of lines) { const m = l.match(/^(\d+) (.+)$/); if (!m) { merged.push(l); continue; } if (idx.has(m[2])) { const k = idx.get(m[2]); merged[k] = `${+merged[k].split(' ')[0] + +m[1]} ${m[2]}`; } else { idx.set(m[2], merged.length); merged.push(l); } }
  const side = r.sideboard.filter(x => x.onColour).slice(0, 7);
  if (side.length) { merged.push('', 'Sideboard'); for (const x of side) merged.push(`1 ${nm(x.card)}`); }
  return merged.join('\n');
}
function savedDecksHtml() { return `<div class="saved">${S.decks.map((d, i) => `<div class="crow"><span class="cname">${esc(d.name)}<small>${new Date(d.at).toLocaleString()}</small></span><span class="right"><button data-copy="${i}" class="ghost small">Copy</button><button data-del="${i}" class="ghost small danger">×</button></span></div>`).join('')}</div>`; }
function bindSaved(v) {
  $$('[data-copy]', v).forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(S.decks[+b.dataset.copy].text); toast('Copied'); } catch { modal(`<textarea rows="20">${esc(S.decks[+b.dataset.copy].text)}</textarea>`); } });
  $$('[data-del]', v).forEach(b => b.onclick = () => { S.decks.splice(+b.dataset.del, 1); save(); render(); });
}

// ---------------- RULES ----------------
function viewRules(v) {
  v.innerHTML = `
  <section class="card">
    <h2>Comprehensive Rules <span class="muted">${esc(rules.effective)}</span></h2>
    <input id="rq" type="search" placeholder="Search rules or a number (e.g. deathtouch, 702.19, legend rule)" autocomplete="off">
    <div id="rres"></div>
  </section>
  <section class="card">
    <h2>How do these cards interact?</h2>
    <div class="chips" id="ixChips">${S.interact.map(n => `<span class="chip">${esc(n)} <button data-rmix="${esc(n)}">×</button></span>`).join('') || '<span class="muted">Add two or more cards.</span>'}</div>
    <div class="ac"><input id="ixIn" type="search" placeholder="Add a card…" autocomplete="off"><div id="ixList" class="aclist"></div></div>
    <div id="ixOut"></div>
  </section>
  <section class="card">
    <h2>Keyword abilities & actions</h2>
    <div class="kwgrid">${rules.keywords.slice().sort((a, b) => a.title.localeCompare(b.title)).map(k => `<button data-rule="${k.id}">${esc(k.title)}</button>`).join('')}</div>
  </section>`;
  const show = debounce(() => {
    const q = $('#rq').value;
    const gl = rules.glossarySearch(q, 4);
    const res = rules.search(q, 30);
    $('#rres').innerHTML = (gl.length ? `<div class="gloss">${gl.map(g => `<p><b>${esc(g.term)}</b> — ${linkRules(g.text)}</p>`).join('')}</div>` : '') +
      res.map(x => `<div class="rule"><a data-rule="${x.id}" class="rid">${x.id}</a> ${linkRules(rules.text(x.id))}</div>`).join('');
  }, 150);
  $('#rq').oninput = () => { S.rq = $('#rq').value; ls.set('rq', S.rq); show(); };
  S.rq ||= ls.get('rq', ''); if (S.rq) { $('#rq').value = S.rq; show(); }
  v.onclick = (e) => { const a = e.target.closest('[data-rule]'); if (a) { e.preventDefault(); openRule(a.dataset.rule); } };
  const inp = $('#ixIn'), lst = $('#ixList'); let items = [];
  inp.oninput = debounce(() => { items = db.search(inp.value, { limit: 8 }); lst.innerHTML = items.map((c, i) => `<button class="acitem" data-i="${i}"><span class="cost">${manaHtml(c.manaCost)}</span><span class="cname">${esc(c.name)}</span></button>`).join(''); }, 60);
  lst.onclick = (e) => { const b = e.target.closest('.acitem'); if (!b) return; S.interact.push(items[+b.dataset.i].name); ls.set('interact', S.interact); render(); };
  $$('[data-rmix]').forEach(b => b.onclick = () => { S.interact = S.interact.filter(n => n !== b.dataset.rmix); ls.set('interact', S.interact); render(); });
  if (S.interact.length) renderInteraction($('#ixOut'));
}
function linkRules(text) {
  return esc(text).replace(/\b(\d{3}\.\d+[a-z]?|\d{3})(?=[\s,.)”"–-]|$)/g, (m) => rules.rules[m] ? `<a data-rule="${m}" class="rref">${m}</a>` : m);
}
function openRule(id) {
  const kids = rules.children(id).slice(0, 60);
  const ex = rules.examples(id);
  modal(`<h2>${esc(id)} <small class="muted">${esc(rules.sectionTitle(id))}</small></h2><p>${linkRules(rules.text(id))}</p>
    ${ex.length ? ex.map(x => `<p class="example">${linkRules(x)}</p>`).join('') : ''}
    ${kids.map(k => `<div class="rule"><a data-rule="${k}" class="rid">${k}</a> ${linkRules(rules.text(k))}${rules.examples(k).map(x => `<p class="example">${linkRules(x)}</p>`).join('')}</div>`).join('')}`, (m) => {
    m.addEventListener('click', (e) => { const a = e.target.closest('[data-rule]'); if (a && a.dataset.rule !== id) { e.preventDefault(); openRule(a.dataset.rule); } });
  });
}
function renderInteraction(box) {
  const cards = S.interact.map(n => db.get(n)).filter(Boolean);
  cards.forEach(c => { c.tags ||= analyse(c); });
  const ex = rules.explain(cards);
  const combos = combosInPool(cards);
  box.innerHTML = `
    ${combos.length ? `<h3>Known combo</h3>${combos.map(c => `<p><b>${c.cards.map(esc).join(' + ')}</b>: ${esc(c.result)}</p>`).join('')}` : ''}
    ${ex.pairs.length ? `<h3>Synergy</h3><ul class="pairs">${ex.pairs.map(p => `<li><b>${esc(p.a)}</b> + <b>${esc(p.b)}</b><br><small>${p.text.map(esc).join('<br>')}</small></li>`).join('')}</ul>` : (cards.length > 1 ? '<p class="muted">No direct deck-building synergy detected.</p>' : '')}
    ${ex.notes.length ? `<h3>Rules that matter here</h3>${ex.notes.map(n => `<div class="note"><b>${esc(n.title)}</b><p>${esc(n.text)}</p><p>${n.rules.map(r => `<a data-rule="${r}" class="rref">${r}</a>`).join(' ')}</p></div>`).join('')}` : ''}
    <h3>Each card's keywords</h3>
    ${ex.perCard.map(p => `<p><b>${esc(p.name)}</b>: ${p.keywords.length ? p.keywords.map(k => `<a data-rule="${k.id}" class="rref">${esc(k.title)} (${k.id})</a>`).join(', ') : '<span class="muted">no keyword abilities</span>'}</p>`).join('')}
    <p class="hint">The rules notes are matched from card text; for unusual corner cases, open the card's rulings (Card → Rulings, online) or search the rules above.</p>`;
}

// ---------------- CARDS ----------------
function viewCards(v) {
  v.innerHTML = `<section class="card">
    <input id="cq" type="search" placeholder='Search: name, t:dragon, o:"draw a card", c:ub, mv<=3, s:sos, r:rare, kw:flying' autocomplete="off">
    <p class="hint">${db.cards.length.toLocaleString()} cards offline. Combine filters with spaces; prefix with - to exclude.</p>
    <div id="cres"></div></section>`;
  const run = debounce(() => {
    const q = $('#cq').value.trim(); if (!q) { $('#cres').innerHTML = ''; return; }
    const res = db.query(q, 150);
    $('#cres').innerHTML = res.map(c => cardRow(c, { sub: esc(c.typeLine), right: countInPool(c) ? `<b>${countInPool(c)}</b>` : '' })).join('') || '<p class="muted">No matches.</p>';
  }, 200);
  $('#cq').oninput = () => { ls.set('cq', $('#cq').value); run(); };
  const lastQ = ls.get('cq', ''); if (lastQ) { $('#cq').value = lastQ; run(); }
  bindCardOpen($('#cres'));
}

function openCard(c) {
  c.tags ||= analyse(c);
  const p = pool();
  const lim = powerOf(c, 'limited', p.sets.length ? p.sets : c.sets);
  const con = powerOf(c, 'constructed', []);
  const kws = rules.keywordsOn(c);
  const faces = c.faces.length > 1 ? c.faces : [{ name: c.name, manaCost: c.manaCost, typeLine: c.typeLine, oracle: c.fullText, power: c.power, toughness: c.toughness, loyalty: c.loyalty }];
  modal(`
    <div class="cardview">
      <img class="cimg" alt="" loading="lazy" src="${navigator.onLine ? SF.imageUrl(c.name) : ''}" onerror="this.remove()">
      ${faces.map(f => `<div class="face"><h2>${esc(f.name)} <span class="cost">${manaHtml(f.manaCost)}</span></h2><p class="tl">${esc(f.typeLine)}</p><p class="oracle">${textHtml(f.oracle)}</p>${f.power != null ? `<p class="cv-pt">${esc(f.power)}/${esc(f.toughness)}</p>` : ''}${f.loyalty ? `<p class="cv-pt">Loyalty ${esc(f.loyalty)}</p>` : ''}</div>`).join('')}
      <div class="row wrap"><span class="stepper big"><button id="cDec">−</button><b id="cCount">${countInPool(c)}</b><button id="cInc">+</button></span><span class="muted">in "${esc(p.name)}"</span></div>
      <h3>Assessment</h3>
      <p>Limited value <b>${lim.value}</b> <small class="muted">(${lim.source === 'ranking' ? 'set pick-order ranking' : 'estimated'})</small> · Constructed value <b>${con.value}</b> <small class="muted">(${con.source})</small></p>
      ${c.tags.roles.size ? `<p>Roles: ${[...c.tags.roles].map(r => `<span class="chip">${esc(ROLE_LABEL[r] || r)}</span>`).join(' ')}</p>` : ''}
      ${(() => { const PASSIVE = new Set(['legends', 'multicolor', 'spells', 'artifacts', 'enchantments', 'flyers', 'vehicles', 'lessons', 'voltron']); const en = [...c.tags.gives].filter(x => !x.includes(':') && !PASSIVE.has(x)); const po = [...c.tags.wants].filter(x => !x.includes(':')); const ty = [...c.tags.typal]; const pl = [...(c.tags.goals || [])]; return en.length || po.length || ty.length || pl.length ? `<p>${po.length || ty.length ? `Pays off: ${[...po.map(t => themeLabel(t)), ...ty.map(t => themeLabel('typal:' + t))].map(x => `<span class="chip want">${esc(x)}</span>`).join(' ')}<br>` : ''}${en.length ? `Enables: ${en.map(t => `<span class="chip give">${esc(themeLabel(t))}</span>`).join(' ')}<br>` : ''}${pl.length ? `Game plan: ${pl.map(g => `<span class="chip">${esc(GOALS[g])}</span>`).join(' ')}` : ''}</p>` : '<p class="hint">No synergy hooks — this card stands on its own.</p>'; })()}
      ${kws.length ? `<h3>Rules for this card's keywords</h3>${kws.map(k => `<details><summary>${esc(k.title)} <small class="muted">${k.id}</small></summary>${rules.children(k.id).slice(0, 8).map(id => `<p><span class="rid">${id}</span> ${esc(rules.text(id))}</p>`).join('')}</details>`).join('')}` : ''}
      <h3>Rulings</h3><div id="rulings"><button id="getRulings" class="ghost small">Load official rulings (online, then saved offline)</button></div>
      <p class="hint">Sets: ${c.sets.map(esc).join(', ')} · Legal: ${c.legal.map(esc).join(', ') || '—'}</p>
    </div>`, (m) => {
    const upd = () => { $('#cCount', m).textContent = countInPool(c); if (S.tab === 'pool') renderPoolList(); };
    $('#cInc', m).onclick = () => { addToPool(c, 1); upd(); };
    $('#cDec', m).onclick = () => { addToPool(c, -1); upd(); };
    $('#getRulings', m).onclick = async () => {
      $('#rulings', m).innerHTML = '<div class="spinner"></div>';
      try { const rl = await SF.rulings(c.name); $('#rulings', m).innerHTML = rl.length ? rl.map(x => `<p class="ruling"><small>${esc(x.date)}</small> ${textHtml(x.text)}</p>`).join('') : '<p class="muted">No rulings.</p>'; }
      catch (e) { $('#rulings', m).innerHTML = `<p class="warn">Couldn't load rulings (${esc(e.message)}).</p>`; }
    };
    idbGet('rulings:' + c.name).then(rl => { if (rl) $('#getRulings', m)?.click(); }).catch(() => {});
  });
}

// ---------------- DATA ----------------
function viewData(v) {
  const m = db.meta;
  v.innerHTML = `
  <section class="card">
    <h2>Offline data</h2>
    <p><b>${db.cards.length.toLocaleString()}</b> cards · bundled ${esc((m.generated || '').slice(0, 10))}${m.overlay ? ` · Scryfall update ${esc(m.overlay.at.slice(0, 10))} (+${m.overlay.added} new)` : ''}</p>
    <p>Rules effective <b>${esc(rules.effective)}</b> · ${Object.keys(rules.rules).length.toLocaleString()} rules, ${Object.keys(rules.glossary).length} glossary terms</p>
    <p class="muted">App version ${APP_VERSION} · you are <span id="netstate2">${navigator.onLine ? 'online' : 'offline'}</span></p>
  </section>
  <section class="card">
    <h2>Update from the internet</h2>
    <button id="upNew" class="primary">Get new cards released since ${esc((m.generated || '2026-01-01').slice(0, 10))}</button>
    <div class="row"><input id="setCode" placeholder="Set code e.g. SOS" class="short" autocapitalize="characters"><button id="upSet" class="ghost">Get a set from Scryfall</button></div>
    <button id="upRules" class="ghost">Check for newer Comprehensive Rules</button>
    <div id="upMsg"></div>
    <p class="hint">Do this before a prerelease while you have signal; everything is then kept on the phone.</p>
  </section>
  <section class="card">
    <h2>Your own combos</h2>
    <p class="hint">One per line: <code>Card A + Card B = what it does</code>. Used alongside the built-in list and Commander Spellbook.</p>
    <textarea id="myCombos" rows="4">${esc(ls.get('customCombos', []).map(c => c.cards.join(' + ') + (c.result ? ' = ' + c.result : '')).join('\n'))}</textarea>
    <button id="saveCombos" class="ghost">Save combos</button>
  </section>
  <section class="card">
    <h2>Backup</h2>
    <div class="row"><button id="exp" class="ghost">Export pools & decks</button><label class="ghost filebtn">Import<input type="file" id="imp" accept="application/json" hidden></label></div>
  </section>
  <section class="card about">
    <h2>About & credits</h2>
    <p>Card data and limited pick-order rankings compiled from the open-source <a href="https://github.com/Card-Forge/forge" target="_blank" rel="noopener">Forge</a> project; online updates and rulings from <a href="https://scryfall.com" target="_blank" rel="noopener">Scryfall</a>; combos from <a href="https://commanderspellbook.com" target="_blank" rel="noopener">Commander Spellbook</a>; Comprehensive Rules JSON from <a href="https://github.com/natewizz/mtg-rules" target="_blank" rel="noopener">mtg-rules</a>; mana symbols from Mana (Andrew Gioia).</p>
    <p class="muted">Unofficial Fan Content, not approved or endorsed by Wizards of the Coast. Portions of the materials used are property of Wizards of the Coast. © Wizards of the Coast LLC. The rules data may be used only for free, non-commercial purposes.</p>
  </section>`;
  const msg = (h) => { $('#upMsg').innerHTML = h; };
  const after = (ov) => { const r = db.applyOverlay(ov); msg(`<p>Done: ${r.added} new, ${r.updated} updated cards. Saved for offline use.</p>`); };
  $('#upNew').onclick = async () => {
    msg('<div class="spinner"></div> Downloading…');
    try { after(await SF.updateSince((m.generated || '2026-01-01').slice(0, 10), (n, t) => msg(`<div class="spinner"></div> ${n}/${t ?? '?'} cards…`))); } catch (e) { msg(`<p class="warn">Update failed: ${esc(e.message)}</p>`); }
  };
  $('#upSet').onclick = async () => {
    const code = $('#setCode').value.trim(); if (!code) return;
    msg('<div class="spinner"></div> Downloading set…');
    try { after(await SF.updateSet(code, (n, t) => msg(`<div class="spinner"></div> ${n}/${t ?? '?'} cards…`))); } catch (e) { msg(`<p class="warn">Set download failed: ${esc(e.message)}</p>`); }
  };
  $('#upRules').onclick = async () => {
    msg('<div class="spinner"></div> Checking…');
    try { const r = await SF.checkRulesUpdate(rules.effective); if (r.updated) { rules = new Rules(r.data); msg(`<p>Rules updated to ${esc(rules.effective)}.</p>`); } else msg(`<p>Rules are current (${esc(rules.effective)}).</p>`); }
    catch (e) { msg(`<p class="warn">Couldn't check rules (${esc(e.message)}). The bundled rules still work.</p>`); }
  };
  $('#saveCombos').onclick = () => {
    const list = $('#myCombos').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [cards, result] = l.split('='); return { cards: cards.split('+').map(s => s.trim()).filter(Boolean), result: (result || 'Custom combo').trim() }; }).filter(c => c.cards.length >= 2);
    ls.set('customCombos', list); toast(`Saved ${list.length} combos`);
  };
  $('#exp').onclick = () => {
    const blob = new Blob([JSON.stringify({ pools: S.pools, decks: S.decks, opts: S.opts, customCombos: ls.get('customCombos', []) }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mtg-auto-backup.json'; a.click();
  };
  $('#imp').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const d = JSON.parse(await f.text()); if (d.pools) S.pools = d.pools; if (d.decks) S.decks = d.decks; if (d.opts) S.opts = { ...DEFAULT_OPTS, ...d.opts }; if (d.customCombos) ls.set('customCombos', d.customCombos); S.poolId = S.pools[0].id; save(); toast('Imported'); render(); } catch (err) { toast('Import failed: ' + err.message); }
  };
}

// ---------------- in-app dialogs (no browser prompt/confirm: they're blocked in some viewers and clunky on phones) ----------------
function dialog(html, onOk) {
  return new Promise((resolve) => {
    const d = document.createElement('div');
    d.className = 'modal dlg';
    d.innerHTML = `<div class="sheet small">${html}<div class="row end"><button class="ghost" data-x="0">Cancel</button><button class="primary" data-x="1">OK</button></div></div>`;
    const done = (ok) => { const v = ok ? onOk(d) : null; d.remove(); resolve(v); };
    d.addEventListener('click', (e) => { const b = e.target.closest('[data-x]'); if (b) done(b.dataset.x === '1'); else if (e.target === d) done(false); });
    d.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    document.body.appendChild(d);
    (d.querySelector('input') || d.querySelector('[data-x="1"]')).focus();
  });
}
const askText = (title, value = '') => dialog(`<h2>${esc(title)}</h2><input type="text" value="${esc(value)}">`, (d) => d.querySelector('input').value.trim() || null);
const askConfirm = (msg) => dialog(`<h2>${esc(msg)}</h2>`, () => true);

// ---------------- modal ----------------
function modal(html, bind) {
  const existing = $('.modal');
  if (existing) existing.remove();
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="sheet" role="dialog"><button class="close" aria-label="Close">×</button>${html}</div>`;
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('.close')) closeModal(); });
  document.body.appendChild(m);
  if (!existing) { try { history.pushState({ modal: 1 }, ''); } catch { /* sandboxed viewer */ } }
  bind?.(m);
  return m;
}
function closeModal() { const m = $('.modal'); if (m) { m.remove(); try { if (history.state?.modal) history.back(); } catch { /* ignore */ } } }
window.addEventListener('popstate', () => { const m = $('.modal'); if (m) m.remove(); });

boot();
