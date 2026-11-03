// Online updates from Scryfall (used only when connected). Results are stored in IndexedDB for offline use.
import { scryfallToRecord } from '../engine/card.js';
import { idbGet, idbSet } from './store.js';

const API = 'https://api.scryfall.com';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Scryfall ${res.status}`);
  return res.json();
}

// Page through a Scryfall search. Scryfall asks for ~10 requests/second max.
export async function searchAll(q, onProgress) {
  let url = `${API}/cards/search?unique=cards&order=released&q=${encodeURIComponent(q)}`;
  const out = [];
  while (url) {
    const page = await getJson(url);
    if (!page) break;
    out.push(...page.data);
    onProgress?.(out.length, page.total_cards);
    url = page.has_more ? page.next_page : null;
    if (url) await sleep(120);
  }
  return out;
}

async function saveOverlay(records) {
  const cur = (await idbGet('scryfall-overlay').catch(() => null)) || { cards: [] };
  const map = new Map(cur.cards.map(r => [r.n, r]));
  for (const r of records) {
    const old = map.get(r.n);
    map.set(r.n, old ? { ...old, ...r, s: [...new Set([...(r.s || []), ...(old.s || [])])] } : r);
  }
  const overlay = { at: new Date().toISOString(), cards: [...map.values()] };
  await idbSet('scryfall-overlay', overlay);
  return overlay;
}

function toRecords(list) {
  return list.filter(c => !['token', 'double_faced_token', 'emblem', 'art_series', 'vanguard', 'scheme', 'planar'].includes(c.layout))
    .map(c => ({ ...scryfallToRecord(c), setName: c.set_name }));
}

// New cards released (or previewed) since a date — keeps the offline DB current with new sets.
export async function updateSince(dateISO, onProgress) {
  const list = await searchAll(`date>=${dateISO}`, onProgress);
  return saveOverlay(toRecords(list));
}

// Every card in one set (use for a prerelease set that's newer than the bundled data).
export async function updateSet(code, onProgress) {
  const list = await searchAll(`e:${code.toLowerCase()}`, onProgress);
  return saveOverlay(toRecords(list));
}

export async function fetchSetList() {
  const data = await getJson(`${API}/sets`);
  return (data?.data || []).filter(s => ['expansion', 'core', 'draft_innovation', 'masters', 'alchemy', 'funny', 'commander'].includes(s.set_type))
    .map(s => ({ code: s.code.toUpperCase(), name: s.name, date: s.released_at, type: s.set_type, count: s.card_count }));
}

export function imageUrl(name, version = 'normal') {
  return `${API}/cards/named?exact=${encodeURIComponent(name.split(' // ')[0])}&format=image&version=${version}`;
}

export async function rulings(name) {
  const key = 'rulings:' + name;
  const cached = await idbGet(key).catch(() => null);
  if (cached) return cached;
  const card = await getJson(`${API}/cards/named?exact=${encodeURIComponent(name.split(' // ')[0])}`);
  if (!card?.rulings_uri) return [];
  const r = await getJson(card.rulings_uri);
  const list = (r?.data || []).map(x => ({ date: x.published_at, text: x.comment, source: x.source }));
  await idbSet(key, list).catch(() => {});
  return list;
}

// Newer Comprehensive Rules (structured JSON published on GitHub by the mtg-rules project).
export async function checkRulesUpdate(currentEffective) {
  const latest = await (await fetch('https://raw.githubusercontent.com/natewizz/mtg-rules/main/latest.json')).json();
  if (!latest?.rulesUrl || latest.effectiveDate === currentEffective) return { latest, updated: false };
  const raw = await (await fetch(latest.rulesUrl)).json();
  const data = {
    effective: raw.metadata?.effectiveDate, metadata: raw.metadata, sections: raw.sections,
    rules: Object.fromEntries(Object.entries(raw.rules).map(([id, v]) => [id, v.examples?.length ? [v.text, v.examples] : [v.text]])),
    glossary: Object.fromEntries(Object.entries(raw.glossary).map(([k, v]) => [k, v.text])),
  };
  await idbSet('rules-override', data);
  return { latest, updated: true, data };
}
