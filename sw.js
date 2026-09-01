// Bump this string every time you ship a new version of the app.
// Bumping it forces the old cache to be thrown away and the new files fetched.
const CACHE_VERSION = 'te-app-v14';
const CORE_ASSETS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './header-bg.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Network-first for the HTML shell itself, so a fresh version loads
  // whenever you have a connection, instead of being stuck on an old
  // cached copy. Falls back to cache only if you're offline.
  if (event.request.mode === 'navigate' || url.endsWith('index.html') || url.endsWith('/')) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first for everything else (icons, manifest, the Tesseract library
  // fetched from its CDN) — these rarely change and this keeps the app fast
  // and usable offline once it's been opened at least once.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
