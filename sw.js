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
  // ✅ FIX #14: Promise.allSettled en lugar de addAll (atómico)
  // Una URL fallida (CDN caído, sin red) ya NO bloquea toda la instalación
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Cacheando recursos...');
      return Promise.allSettled(
        urlsToCache.map(url =>
          cache.add(url).catch(err =>
            console.warn(`[SW] No se pudo cachear: ${url}`, err)
          )
        )
      );
    })
  );
  // Activa el nuevo SW inmediatamente sin esperar que se cierren las pestañas
  self.skipWaiting();
});

// Activar: eliminar caches antiguos y tomar control inmediato
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      // ✅ FIX #14: reclamar clientes activos para que el nuevo SW tome efecto de inmediato
      return self.clients.claim();
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
