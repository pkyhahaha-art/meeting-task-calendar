/* global self */
// Notifications only: do not cache calendar data or authenticated responses.
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let message = {}
  if (event.data) {
    try {
      const payload = event.data.json()
      message = payload && typeof payload === 'object' ? payload : { body: event.data.text() }
    } catch { message = { body: event.data.text() } }
  }
  event.waitUntil(self.registration.showNotification(message.title || 'PEA Meeting & Task', {
    body: message.body || 'คุณมีการแจ้งเตือนใหม่ กรุณาเปิดปฏิทิน',
    icon: new URL('icon-192.png', self.registration.scope).href,
    data: { url: message.url || './#/calendar' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const base = new URL(self.registration.scope)
  let target = new URL('./#/calendar', base)
  try {
    const requested = new URL(event.notification.data?.url || './#/calendar', base)
    if (requested.origin === base.origin && requested.pathname.startsWith(base.pathname)) target = requested
  } catch { /* Keep the calendar destination for malformed links. */ }
  event.waitUntil(self.clients.openWindow(target.href))
})
