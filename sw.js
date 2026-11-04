const CACHE = 'radar-alert-shell-v0152';
const SHELL = [
  '/', '/index.html', '/styles.css', '/app.js', '/core.js', '/manifest.webmanifest', '/icon.svg',
  '/geo/geo-math.js', '/geo/radar-consolidator.js', '/geo/spatial-index.js',
  '/geo/adaptive-gps.js', '/geo/offline-store.js', '/geo/alert-manager.js',
  '/geo/preferences.js', '/geo/dataset-loader.js', '/geo/native-sync.js', '/geo/road-network.js', '/geo/map-matcher.js', '/geo/motion-heading.js', '/geo/road-stability.js', '/geo/match-diagnostics.js', '/geo/osm-loader.js', '/geo/road-prefetch.js',
  '/refined.css', '/ui/navigation.js', '/ui/nearby-list.js', '/ui/match-panel.js', '/ui/system-health.js', '/ui/map-view.js', '/ui/simulator-panel.js', '/ui/drive-mode.js', '/sim/route-simulator.js'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('radar-alert-shell-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(() => caches.match(request).then(cached => cached || (request.mode === 'navigate' ? caches.match('/index.html') : Response.error()))));
});
