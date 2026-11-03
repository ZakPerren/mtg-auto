// Tiny key-value store on IndexedDB (large data) + localStorage helpers (small data).
const DB_NAME = 'mtg-auto'; const STORE = 'kv';
let dbp = null;
function open() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no indexedDB'));
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
export async function idbGet(key) {
  const db = await open();
  return new Promise((res, rej) => { const t = db.transaction(STORE).objectStore(STORE).get(key); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
}
export async function idbSet(key, val) {
  const db = await open();
  return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(val, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
export async function idbDel(key) {
  const db = await open();
  return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
export const ls = {
  get(k, d) { try { const v = localStorage.getItem('pc:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pc:' + k, JSON.stringify(v)); } catch { /* quota */ } },
};
