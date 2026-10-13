// Cache only the offline page. Auth callbacks, API responses and employee data
// always use the network and are never stored in Cache Storage.
const CACHE = 'empmanager-offline-v1';
const OFFLINE_URL = new URL('./offline.html', self.location.href).href;
self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)));
});
self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys().then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('empmanager-offline-') && key !== CACHE)
            .map((key) => caches.delete(key))
    )));
});
self.addEventListener('fetch', (event) => {
    if (event.request.mode !== 'navigate' || event.request.method !== 'GET') return;
    event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
