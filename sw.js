// Offline-Cache: zuerst Netz, sonst Cache (so kommen Updates sofort an)
const CACHE = 'digital-web-v8';
const FILES = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png',
  'js/app.js', 'js/components.js', 'js/circuit.js', 'js/sim.js', 'js/editor.js', 'js/dig.js', 'js/analysis.js', 'js/examples.js', 'js/lib.js', 'js/kv.js', 'js/synth.js', 'js/graph.js', 'js/testcase.js', 'js/zip.js', 'js/seq.js', 'js/fsmeditor.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
