// DOM + formatting helpers
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function manaHtml(cost) {
  if (!cost) return '';
  return cost.split(' // ').map(part => [...part.matchAll(/\{([^}]+)\}/g)].map(m => {
    const s = m[1].toLowerCase().replace(/\//g, '');
    const cls = s === 't' ? 'tap' : s === 'q' ? 'untap' : s;
    return `<i class="ms ms-${esc(cls)} ms-cost" title="{${esc(m[1])}}"></i>`;
  }).join('')).join('<span class="split">//</span>');
}
// Replace {X} symbols inside rules text with icons
export function textHtml(text) {
  return esc(text).replace(/\{([^}]+)\}/g, (_, s) => {
    const k = s.toLowerCase().replace(/\//g, '');
    const cls = k === 't' ? 'tap' : k === 'q' ? 'untap' : k;
    return `<i class="ms ms-${cls} ms-cost ms-small"></i>`;
  }).replace(/\n/g, '<br>');
}
export const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'M', 'C', 'L'];
export function colorGroup(c) {
  if (c.isLand) return 'L';
  if (!c.colors) return 'C';
  if (c.colors.length > 1) return 'M';
  return c.colors;
}
export const GROUP_LABEL = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Multicolour', C: 'Colourless', L: 'Lands' };
export function pip(c, on = true) { return `<span class="pip pip-${c} ${on ? '' : 'off'}">${c}</span>`; }

export function toast(msg, ms = 2600) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}
export function debounce(fn, ms) { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; }
export const rarityLetter = (r) => ({ common: 'C', uncommon: 'U', rare: 'R', mythic: 'M' }[r] || '');
