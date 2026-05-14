const CACHE_NAME = 'citanext-v3';

// Archivos que estarán disponibles offline
const urlsToCache = [
  './',
  './index.html',
  './auth.html',
  './dashboard.html',
  './calendar.html',
  './reserva.html',
  './css/styles.css',
  './css/dashboard.css',
  './css/calendar.css',
  './css/reserva.css',
  './js/firebase-config.js',
  './js/auth.js',
  './js/dashboard.js',
  './js/calendar.js',
  './js/reserva.js',
  './img/icon-192.png',
  './img/icon-512.png',
  'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.8/index.global.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

// Instalación: cachear recursos esenciales
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cacheando recursos');
        return cache.addAll(urlsToCache);
      })
      .catch((err) => console.log('Error al cachear:', err))
  );
});

// Activar: eliminar caches antiguos si se actualiza
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
});

// Estrategia Cache First (intenta cache, si no, red)
self.addEventListener('fetch', (event) => {
  // No cachear peticiones a Firestore/Auth
  if (event.request.url.includes('firestore') ||
      event.request.url.includes('auth') ||
      event.request.url.includes('googleapis')) {
    return;
  }
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        return cachedResponse || fetch(event.request);
      })
  );
});
