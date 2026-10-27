/* Arcade service worker: offline cache for the launcher and every game. Network first (so a new deploy shows up on the
 * next load), falling back to the cache when offline. The version comes from sw-files.js (content hash), so every
 * deploy gets a fresh cache and old ones are deleted. Registered only over http(s). */
importScripts('sw-files.js');
const CACHE = 'arcade-' + self.ARCADE_VERSION;
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(self.ARCADE_FILES.concat(['./']).map(f => c.add(new Request(f, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(fetch(r).then(res => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); } return res; })
    .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || (r.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
