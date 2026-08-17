self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Truco Tchê';
  const options = {
    body: data.body || 'Há uma novidade na tua cancha.',
    icon: '/manus-storage/truco-tche-pwa-icon_ae86865a.png',
    badge: '/manus-storage/truco-tche-pwa-icon_ae86865a.png',
    tag: data.tag || 'truco-tche-notification',
    data: { url: data.url || '/' },
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || '/'));
});
