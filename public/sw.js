/*
 * Service worker de Notas: solo notificaciones push (sin caché offline ni manejo de fetch).
 * Se registra desde Configuración → Notificaciones cuando el usuario las activa (scope "/").
 * El servidor manda JSON { title, body, url, tag } (src/core/notifications.ts).
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const FALLBACK_PATH = '/app/today';

/** Solo URLs del propio sitio: un payload con otra URL abre Hoy. */
function sameOriginUrl(raw) {
  try {
    const url = new URL(typeof raw === 'string' ? raw : FALLBACK_PATH, self.location.origin);
    return url.origin === self.location.origin ? url.href : new URL(FALLBACK_PATH, self.location.origin).href;
  } catch {
    return new URL(FALLBACK_PATH, self.location.origin).href;
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Notas';
  const tag = typeof data.tag === 'string' && data.tag ? data.tag : undefined;
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      lang: 'es',
      tag,
      // Con el mismo tag (misma tarea) reemplaza al aviso anterior y vuelve a sonar.
      renotify: Boolean(tag),
      data: { url: sameOriginUrl(data.url) },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = sameOriginUrl(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      try {
        await client.focus();
        await client.navigate(url);
        return;
      } catch {
        // La ventana no está controlada por este service worker (navigate lanza): se abre una nueva.
      }
    }
    await self.clients.openWindow(url);
  })());
});
