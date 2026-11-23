// Service Worker: App offline verfügbar machen. Bei jeder Änderung VERSION erhöhen.
const VERSION = 'bewirtung-v7';
const CORE = [
  './', 'index.html', 'css/app.css', 'js/app.js', 'js/receipt.js', 'js/plz.js', 'js/db.js', 'js/pdf-export.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
];
const LAZY = [
  'vendor/tesseract.min.js', 'vendor/tess-worker.js', 'vendor/tess-core-simd.js', 'vendor/tess-core.js',
  'vendor/tess-deu.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/jspdf.umd.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(CORE);
    c.addAll(LAZY).catch(() => {}); // große Dateien im Hintergrund
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // PLZ-Abfragen gehen direkt ins Netz
  const isVendor = url.pathname.includes('/vendor/');
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    if (isVendor) {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }
    // App-Dateien: erst Netz (immer aktuell), offline aus dem Cache
    try {
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    } catch {
      return (await c.match(e.request, { ignoreSearch: true })) || (await c.match('index.html'));
    }
  })());
});
