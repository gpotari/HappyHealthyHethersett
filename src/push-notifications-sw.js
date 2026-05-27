self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const logoIconUrl = new URL('/assets/images/hhh-oval-logo.png', self.location.origin).href;

async function notifyOpenClients(message) {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientList) {
    client.postMessage(message);
  }
}

self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || 'Litter pick reminder';
  const options = {
    body: payload.body || 'A community litter pick is coming up soon.',
    icon: payload.icon || logoIconUrl,
    badge: payload.badge || logoIconUrl,
    requireInteraction: true,
    renotify: true,
    silent: false,
    tag: payload.tag || 'litter-pick-reminder',
    timestamp: Date.now(),
    data: {
      testId: payload.testId || null,
      url: payload.url || '/#litter-picks'
    }
  };

  event.waitUntil((async () => {
    await notifyOpenClients({
      type: 'hhh-push-received',
      testId: payload.testId || null,
      tag: options.tag
    });

    try {
      await self.registration.showNotification(title, options);
      await notifyOpenClients({
        type: 'hhh-push-shown',
        testId: payload.testId || null,
        tag: options.tag
      });
    } catch {
      await notifyOpenClients({
        type: 'hhh-push-display-failed',
        testId: payload.testId || null,
        tag: options.tag
      });
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/#litter-picks', self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }

        return self.clients.openWindow(targetUrl);
      })
  );
});
