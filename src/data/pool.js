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
    const c = db.get(it.name) || db.get(it.name.replace(/^A-/, ''));
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
