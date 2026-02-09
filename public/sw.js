const CACHE_NAME = 'antigravity-phone-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/js/app_multi.js',
    '/css/style.css'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
