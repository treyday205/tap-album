const STATIC_CACHE = 'tap-static-v1';
const RUNTIME_CACHE = 'tap-runtime-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/icon-180.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName !== STATIC_CACHE && cacheName !== RUNTIME_CACHE)
        .map((cacheName) => caches.delete(cacheName))
    );
    await self.clients.claim();
  })());
});

const isCacheableRequest = (request) => {
  if (!request || request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname.startsWith('/uploads/')) return false;
  return true;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!isCacheableRequest(request)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(request);
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(request, networkResponse.clone());
        return networkResponse;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        const shell = await caches.match('/index.html');
        return shell || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) {
      event.waitUntil((async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(request, fresh.clone());
        } catch {
          // keep cached response on network errors
        }
      })());
      return cached;
    }

    try {
      const response = await fetch(request);
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
      return response;
    } catch {
      return Response.error();
    }
  })());
});
