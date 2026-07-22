// Zebra Circus Blaster — service worker (offline + installability)
const CACHE = 'zcb-v1';
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './vendor/three.min.js',
  './vendor/GLTFLoader.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first, then network; runtime-cache same-origin GETs (models/textures) for offline replay.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(resp => {
      try {
        if (new URL(e.request.url).origin === location.origin) {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
      } catch (_) {}
      return resp;
    }).catch(() => caches.match('./index.html')))
  );
});
