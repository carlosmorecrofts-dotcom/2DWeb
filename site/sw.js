// 2DWeb by Djinja-C: keeps the app shell for installing and opening offline.
// Every /api/ request and every request to another origin goes to the network as it is,
// so a price is never shown from an old copy.
// Change VERSION whenever a shell file changes: old caches are cleared on activate.
const VERSION = 'dw-shell-3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './assets/djinja-visuals.css', './assets/icon_128.png', './assets/icon.png', './assets/icon_512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.indexOf('/api/') >= 0) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(VERSION).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
