// Offline-first service worker. App shell + card/rules data are precached; everything is served cache-first.
const VERSION = 'dc0beac583';
const CACHE = 'mtg-auto-' + VERSION;
const PRECACHE = ["./","index.html","app.js","app.css","data/cards.json","data/rules.json","vendor/mana.min.css","fonts/mana.woff2","fonts/mana.woff","fonts/mana.ttf","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('mtg-auto-') && k !== CACHE && k !== 'mtg-auto-images').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Card images from Scryfall: cache as you view them, so they work offline later
  if (url.hostname === 'api.scryfall.com' && url.searchParams.get('format') === 'image') {
    e.respondWith(caches.open('mtg-auto-images').then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      try { const res = await fetch(e.request); c.put(e.request, res.clone()); return res; } catch { return Response.error(); }
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match('index.html'))));
});
