/* global self */
// Notifications only: store received messages, never authenticated calendar responses.
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

function saveReceivedMessage(message) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pea-device-inbox', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('alerts', { keyPath: 'id' })
      request.result.createObjectStore('settings')
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('alerts', 'readwrite')
      const store = transaction.objectStore('alerts')
      const previous = store.get(message.id)
      previous.onsuccess = () => {
        store.put({ ...message, receivedAt: previous.result?.receivedAt || message.receivedAt,
          read: previous.result?.read === true })
        const all = store.getAll()
        all.onsuccess = () => {
          const rows = all.result.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
          for (const row of rows.slice(100)) store.delete(row.id)
        }
      }
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onerror = () => { db.close(); reject(transaction.error) }
      transaction.onabort = () => { db.close(); reject(transaction.error) }
    }
  })
}

self.addEventListener('push', (event) => {
  let message = {}
  if (event.data) {
    try {
      const payload = event.data.json()
      message = payload && typeof payload === 'object' ? payload : { body: event.data.text() }
    } catch { message = { body: event.data.text() } }
  }
  const id = typeof message.id === 'string' ? message.id : typeof message.tag === 'string' ? message.tag : crypto.randomUUID()
  const inboxUrl = new URL(`./#/device-inbox?notification=${encodeURIComponent(id)}`, self.registration.scope).href
  const saved = { id, title: message.title || 'PEA Meeting & Task', body: message.body || 'คุณมีการแจ้งเตือนใหม่',
    receivedAt: new Date().toISOString(), read: false, details: message.details || {} }
  // A storage failure must never suppress the visible Push notification.
  const storing = saveReceivedMessage(saved).catch(() => undefined)
  const showing = self.registration.showNotification(saved.title, {
    body: message.body || 'คุณมีการแจ้งเตือนใหม่ กรุณาเปิดปฏิทิน',
    tag: typeof message.tag === 'string' ? message.tag : undefined,
    icon: new URL('icon-192.png', self.registration.scope).href,
    data: { url: inboxUrl },
  })
  event.waitUntil(Promise.all([storing, showing]).then(async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) client.postMessage({ type: 'PEA_INBOX_UPDATED' })
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const base = new URL(self.registration.scope)
  let target = new URL('./#/device-inbox', base)
  try {
    const requested = new URL(event.notification.data?.url || './#/calendar', base)
    if (requested.origin === base.origin && requested.pathname.startsWith(base.pathname)) target = requested
  } catch { /* Keep the calendar destination for malformed links. */ }
  event.waitUntil(self.clients.openWindow(target.href))
})
