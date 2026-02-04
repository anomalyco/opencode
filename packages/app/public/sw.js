// Minimal service worker for PWA installability
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// Basic fetch handler - just pass through requests
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
