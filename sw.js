// AstroSnap service worker — sw.js
//
// This is what actually lets a notification appear after the browser tab is
// gone: the browser keeps this script registered and wakes it briefly when a
// push message arrives from your backend, even if no AstroSnap tab is open.
//
// Must be served from the SAME origin as the app, at a path that covers
// whatever you want it to control (typically the site root). Must be served
// over HTTPS (or localhost for local testing) — browsers refuse to register
// service workers otherwise.

const SW_VERSION = 'astrosnap-sw-v1';

self.addEventListener('install', (event) => {
  // Activate this new service worker as soon as it's installed, without
  // waiting for old tabs to close first.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// The actual background notification. This fires even with zero tabs open,
// as long as the browser/OS has the service worker registered and push
// permission was granted.
self.addEventListener('push', (event) => {
  let payload = { title: 'AstroSnap', body: 'Sky conditions update.' };
  try {
    if (event.data) {
      payload = event.data.json();
    }
  } catch (e) {
    // Non-JSON push payload (shouldn't happen from our backend, but don't
    // crash the service worker over a malformed message).
    if (event.data) payload.body = event.data.text();
  }

  const title = payload.title || 'AstroSnap';
  const options = {
    body: payload.body || '',
    icon: payload.icon || undefined,
    badge: payload.badge || undefined,
    tag: payload.tag || 'astrosnap-notification',
    // renotify: if a new push arrives with the same tag, still alert the
    // user rather than silently replacing the old one unseen.
    renotify: true,
    data: { url: payload.url || '/' }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Clicking the notification focuses an existing AstroSnap tab if one is
// open, or opens a new one — standard PWA notification-click pattern.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// If the browser rotates the push subscription (this happens periodically
// for security reasons), we need to re-subscribe with the new keys and tell
// the backend, or notifications silently stop working. This event lets us
// do that even with no tab open.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const newSub = await self.registration.pushManager.subscribe(event.oldSubscription.options);
        // Re-register with the backend using whatever subscriberId + API
        // base URL were last saved by the page (see push-client.js).
        const stored = await getStoredConfig();
        if (stored && stored.apiBaseUrl && stored.subscriberId) {
          await fetch(stored.apiBaseUrl + '/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subscriberId: stored.subscriberId,
              subscription: newSub.toJSON(),
              lat: stored.lat,
              lon: stored.lon,
              prefs: stored.prefs || { notificationsEnabled: true }
            })
          });
        }
      } catch (e) {
        // Nothing more we can do from here without a tab open — this will
        // simply mean notifications stop until the user reopens the app,
        // at which point push-client.js re-checks and re-subscribes anyway.
      }
    })()
  );
});

// Service workers can't use localStorage, so push-client.js mirrors the
// small bits of config this worker needs into IndexedDB via a tiny helper.
function getStoredConfig() {
  return new Promise((resolve) => {
    const req = indexedDB.open('astrosnap-push', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('config');
    };
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction('config', 'readonly');
        const getReq = tx.objectStore('config').get('pushConfig');
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    };
    req.onerror = () => resolve(null);
  });
}
