/* ============================================================
   Service worker: menyimpan tampilan aplikasi (shell) agar
   bisa dibuka cepat dan tetap tampil saat sinyal lemah.
   Data transaksi TIDAK disimpan di cache (selalu dari server).
   ============================================================ */
const CACHE = 'catat-keuangan-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Jangan pernah menyimpan permintaan ke Google (data keuangan)
  if (url.hostname.indexOf('google') !== -1) return;

  // Aplikasi sendiri & CDN (Chart.js): jaringan dulu agar pembaruan langsung terasa,
  // cadangan dari cache jika sedang offline
  event.respondWith(
    fetch(req).then(function (res) {
      const copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () { return caches.match(req); })
  );
});
