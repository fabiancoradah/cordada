// Service worker: la app funciona sin señal en la montaña.
const VERSION = 'cordada-v10';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/app.js', 'js/store.js', 'js/gear.js', 'js/weather.js', 'js/map.js', 'js/drive.js', 'js/sync.js', 'js/config.js', 'js/places.js', 'js/auto.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png', 'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
];
const TILE_HOSTS = /tile\.opentopomap\.org|tile\.openstreetmap\.org|server\.arcgisonline\.com/;
const MAX_TILES = 3000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'tiles').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Teselas del mapa: primero caché (las zonas ya vistas quedan offline).
  if (TILE_HOSTS.test(url.hostname)) {
    e.respondWith(caches.open('tiles').then(async (c) => {
      const hit = await c.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok || res.type === 'opaque') {
        c.put(request, res.clone());
        c.keys().then((k) => { if (k.length > MAX_TILES) k.slice(0, k.length - MAX_TILES).forEach((r) => c.delete(r)); });
      }
      return res;
    }));
    return;
  }

  // Archivos de la app: red primero, caché si no hay señal.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
    );
  }
});
