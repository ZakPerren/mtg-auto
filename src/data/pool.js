// Parsing card lists: MTG Arena exports, "4x Name", "4 Name (SET) 123", plain names, CSV-ish lines.
export function parseList(text) {
  const out = []; const sections = [];
  let section = 'main';
  for (let raw of (text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;
    const head = line.toLowerCase().replace(/:$/, '');
    if (['deck', 'main', 'maindeck', 'mainboard', 'sideboard', 'commander', 'companion', 'about', 'pool', 'sealed pool'].includes(head)) { section = head; sections.push(head); continue; }
    if (/^name /i.test(line)) continue;
    let m = line.match(/^(\d+)\s*x?\s+(.+)$/i) || line.match(/^(.+?)\s+x\s*(\d+)$/i);
    let count = 1, rest = line;
    if (m) { if (/^\d+$/.test(m[1])) { count = +m[1]; rest = m[2]; } else { rest = m[1]; count = +m[2]; } }
    // strip "(SET) 123", "[SET]", "*F*", trailing collector numbers
    let set = null;
    const sm = rest.match(/\s+[([]([A-Za-z0-9]{2,6})[)\]](\s+[\w-]+)?\s*(\*\w+\*)?$/);
    if (sm) { set = sm[1].toUpperCase(); rest = rest.slice(0, sm.index); }
    rest = rest.replace(/\s+\*\w+\*$/, '').replace(/\s+\/\s+/g, ' // ').trim();
    if (rest) out.push({ name: rest, count, set, section });
  }
  return out;
}

// Merge duplicates (same card name) and resolve against the DB.
export function resolveList(db, items) {
  const found = new Map(); const missing = [];
  for (const it of items) {
    const c = db.get(it.name) || db.get(it.name.replace(/^A-/, '')) || db.get(it.name.replace(/\s*\/\/\s*/g, '//')) || db.get(it.name.replace(/\s*\/\/\s*/g, ' // ')) || (it.name.includes('//') ? db.get(it.name.split(/\s*\/\/\s*/)[0]) : null);
    if (!c) { missing.push(it.name); continue; }
    const cur = found.get(c.name) || { card: c, count: 0, set: it.set };
    cur.count += it.count; found.set(c.name, cur);
  }
  return { entries: [...found.values()], missing };
}

export function exportArena(cards, lands, setCode) {
  const lines = ['Deck'];
  for (const x of cards) lines.push(`${x.count} ${x.card.name.split(' // ')[0]}`);
  for (const x of lands) lines.push(`${x.count} ${x.name}`);
  return lines.join('\n');
}

// ---------- CSV import (MTG Arena collection exports, Moxfield, ManaBox, Deckbox, Archidekt, TCGplayer, …) ----------
function splitCsvLine(line, delim) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}
export function looksLikeCsv(text) {
  const first = (text || '').split(/\r?\n/).find(l => l.trim()) || '';
  return /(^|[,;\t])"?(name|card name|card)"?([,;\t]|$)/i.test(first) && /[,;\t]/.test(first);
}
// Returns { items: [{name, count, set}], format, rows, skippedZero }
export function parseCsv(text) {
  const lines = (text || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { items: [], format: 'empty', rows: 0, skippedZero: 0 };
  const delim = [',', ';', '\t'].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const head = splitCsvLine(lines[0], delim).map(h => h.toLowerCase().replace(/^"|"$/g, ''));
  const col = (...names) => head.findIndex(h => names.includes(h));
  const iName = col('name', 'card name', 'card', 'cardname');
  const iCount = col('count', 'quantity', 'qty', 'amount', 'have', 'total quantity');
  const iPrint = col('printcount');
  const iSet = col('set', 'set code', 'edition', 'setcode', 'edition code');
  if (iName < 0) return { items: [], format: 'unknown', rows: 0, skippedZero: 0, error: 'No "Name" column found' };
  // MTG Arena collection export: Count = copies owned of that card name (repeated on every printing), PrintCount = this printing.
  const arena = iPrint >= 0 && iCount >= 0;
  const byName = new Map(); let skippedZero = 0;
  for (let k = 1; k < lines.length; k++) {
    const f = splitCsvLine(lines[k], delim);
    let name = (f[iName] || '').replace(/\s*\/{3}\s*/g, ' // ').trim();
    if (!name) continue;
    const n = iCount >= 0 ? parseInt(f[iCount], 10) : 1;
    if (!n || n < 0) { skippedZero++; continue; }
    const set = iSet >= 0 ? (f[iSet] || '').toUpperCase() : null;
    const cur = byName.get(name);
    if (!cur) byName.set(name, { name, count: n, set });
    else cur.count = arena ? Math.max(cur.count, n) : cur.count + n;
  }
  return { items: [...byName.values()], format: arena ? 'MTG Arena collection' : 'CSV', rows: lines.length - 1, skippedZero };
}
