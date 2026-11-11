// Service worker simples: network-first para arquivos do próprio app,
// com fallback para o cache quando offline. Não intercepta Supabase/CDNs.
// Também mostra os avisos de curtida (Web Push) com o app fechado.
const CACHE = 'smart-closet-v23';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './js/app.js',
  './js/config.js',
  './icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html'))),
  );
});

// Aviso de curtida recebido com o app fechado
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(
    self.registration.showNotification(data.title || 'Smart Closet AI', {
      body: data.body || 'Você tem uma novidade',
      icon: './icons/icon.svg',
      badge: './icons/icon.svg',
      tag: data.tag || 'smart-closet',
      renotify: false,
      data: { url: data.url || '#/home' },
    }),
  );
});

// Toque no aviso: abre (ou foca) o app na tela do look
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(`./${e.notification.data?.url || '#/home'}`, self.registration.scope).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if ('focus' in c) {
        await c.focus();
        if ('navigate' in c) { try { await c.navigate(target); } catch { /* ignora */ } }
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
