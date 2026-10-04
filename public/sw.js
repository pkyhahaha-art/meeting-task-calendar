/* global self */
// Notifications only: store received messages, never authenticated calendar responses.
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()))
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim().then(syncInboxBadge)))

function readInboxMessages() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pea-device-inbox', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('alerts', { keyPath: 'id' })
      request.result.createObjectStore('settings')
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('alerts', 'readonly')
      const rows = transaction.objectStore('alerts').getAll()
      transaction.oncomplete = () => { db.close(); resolve(rows.result) }
      transaction.onerror = () => { db.close(); reject(transaction.error) }
      transaction.onabort = () => { db.close(); reject(transaction.error) }
    }
  })
}

// Serialize updates and read the persisted inbox each time. A foreground request
// never supplies a stale count that can overwrite a newly arrived Push.
let badgeUpdates = Promise.resolve()
function syncInboxBadge(removedIds = []) {
  badgeUpdates = badgeUpdates.then(async () => {
    const rows = await readInboxMessages()
    const unread = rows.filter((row) => !row.read).length
    try {
      if (typeof self.navigator?.setAppBadge === 'function') {
        if (unread === 0 && typeof self.navigator.clearAppBadge === 'function') await self.navigator.clearAppBadge()
        else await self.navigator.setAppBadge(unread)
      }
    } catch { /* Badging permission must not interrupt message delivery or reading. */ }
    // Android derives its icon dot from active notifications. Close only this
    // inbox's read/deleted notifications, including those from the previous worker.
    if (typeof self.registration.getNotifications === 'function') {
      const notices = await self.registration.getNotifications()
      const dismissedIds = new Set([...removedIds, ...rows.filter((row) => row.read).map((row) => row.id)])
      for (const notice of notices) {
        let id = notice.data?.notificationId
        if (!id && notice.data?.url) {
          try {
            const url = new URL(notice.data.url)
            const base = new URL(self.registration.scope)
            if (url.origin === base.origin && url.pathname.startsWith(base.pathname) && url.hash.startsWith('#/device-inbox?')) {
              id = new URLSearchParams(url.hash.split('?')[1]).get('notification')
            }
          } catch { /* Leave unrelated notifications intact. */ }
        }
        if (id && dismissedIds.has(id)) notice.close()
      }
    }
  }).catch(() => undefined)
  return badgeUpdates
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'PEA_SYNC_INBOX_BADGE') {
    const removedIds = Array.isArray(event.data.removedIds) ? event.data.removedIds.filter((id) => typeof id === 'string').slice(0, 100) : []
    event.waitUntil(syncInboxBadge(removedIds))
  }
})

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
      let show = true
      const all = store.getAll()
      all.onsuccess = () => {
        const rows = all.result
        const previous = rows.find((row) => row.id === message.id)
        const group = message.replaceKey ? rows.filter((row) => row.replaceKey === message.replaceKey) : []
        // A late retry from yesterday must not replace today's message or banner.
        if (group.some((row) => row.reminderAt > message.reminderAt)) { show = false; return }
        if (message.replaceKey && previous) show = false
        for (const row of group) if (row.id !== message.id) store.delete(row.id)
        const saved = { ...message, receivedAt: previous?.receivedAt || message.receivedAt,
          read: previous?.read === true }
        store.put(saved)
        const retained = rows.filter((row) => row.id !== message.id && !group.includes(row))
        retained.push(saved)
        retained.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
        for (const row of retained.slice(100)) store.delete(row.id)
      }
      transaction.oncomplete = () => { db.close(); resolve(show) }
      transaction.onerror = () => { db.close(); reject(transaction.error) }
      transaction.onabort = () => { db.close(); reject(transaction.error) }
    }
  })
}

let receivedPushes = Promise.resolve()
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
    receivedAt: new Date().toISOString(), read: false, details: message.details || {},
    ...(typeof message.replaceKey === 'string' && typeof message.reminderAt === 'string'
      ? { replaceKey: message.replaceKey, reminderAt: message.reminderAt } : {}) }
  // A storage failure must never suppress the visible Push notification.
  // Serialize persistence and display so concurrently delivered rounds cannot
  // finish showing yesterday's banner after today's.
  receivedPushes = receivedPushes.catch(() => undefined)
    .then(() => saveReceivedMessage(saved).catch(() => true)).then(async (show) => {
    if (show) await self.registration.showNotification(saved.title, {
      body: message.body || 'คุณมีการแจ้งเตือนใหม่ กรุณาเปิดปฏิทิน',
      tag: typeof message.tag === 'string' ? message.tag : undefined,
      ...(saved.replaceKey ? { renotify: true } : {}),
      icon: new URL('icon-192.png', self.registration.scope).href,
      data: { url: inboxUrl, notificationId: id },
    })
    await syncInboxBadge()
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) client.postMessage({ type: 'PEA_INBOX_UPDATED' })
  })
  event.waitUntil(receivedPushes)
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
