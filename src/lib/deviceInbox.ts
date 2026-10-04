export type DevicePairing = { subscriptionId: string; endpoint: string; userName: string; userId?: string; pairedAt: string }
export type DeviceAlert = {
  id: string; title: string; body: string; receivedAt: string; read: boolean
  details?: { entity?: string; notice_template?: string; id?: string; title?: string; affiliation?: string; description?: string; start_datetime?: string;
    end_datetime?: string; due_date?: string; due_time?: string; location?: string; all_day?: boolean; status?: string }
}
export type DeviceInboxDocument = { id: string; name: string; size?: number; kind: 'file' | 'drive';
  previewUrl?: string; downloadUrl?: string; error?: string }
export type DeviceNotificationContent = { details: NonNullable<DeviceAlert['details']>; documents: DeviceInboxDocument[]; linksExpireAt: string }

export function isDeviceAppointmentNotice(alert?: DeviceAlert) {
  return alert?.details?.notice_template === 'meeting_occurrence_cancelled' || alert?.details?.notice_template === 'meeting_occurrence_moved'
}

/** The worker reads the latest stored unread count; no login or server call needed. */
export function requestDeviceInboxBadgeSync(removedIds: string[] = []) {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return
  const workers = navigator.serviceWorker
  const message = { type: 'PEA_SYNC_INBOX_BADGE', removedIds }
  try {
    if (workers.controller) workers.controller.postMessage(message)
    else void workers.getRegistration().then((registration) => registration?.active?.postMessage(message)).catch(() => {})
  } catch { /* A stopped worker must not turn a saved inbox change into an error. */ }
}

// The service worker uses the same database, so messages survive closing the app.
export function openDeviceInbox(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open('pea-device-inbox', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('alerts', { keyPath: 'id' })
      request.result.createObjectStore('settings')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readValue<T>(store: string, key?: string): Promise<T> {
  const db = await openDeviceInbox()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(store, 'readonly')
      const request = key ? transaction.objectStore(store).get(key) : transaction.objectStore(store).getAll()
      request.onsuccess = () => resolve(request.result as T)
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}

export async function readDevicePairing(): Promise<DevicePairing | null> {
  return await readValue<DevicePairing | undefined>('settings', 'pairing') ?? null
}

export async function saveDevicePairing(pairing: DevicePairing, clearMessages = false) {
  const db = await openDeviceInbox()
  let removedIds: string[] = []
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(['settings', 'alerts'], 'readwrite')
      if (clearMessages) {
        const store = transaction.objectStore('alerts')
        const previous = store.getAllKeys()
        previous.onsuccess = () => { removedIds = previous.result.map(String); store.clear() }
      }
      transaction.objectStore('settings').put(pairing, 'pairing')
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { db.close() }
  if (clearMessages) requestDeviceInboxBadgeSync(removedIds)
}

export async function listDeviceAlerts(): Promise<DeviceAlert[]> {
  const rows = await readValue<DeviceAlert[]>('alerts')
  return rows.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
}

export async function saveDeviceAlert(alert: DeviceAlert) {
  const db = await openDeviceInbox()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('alerts', 'readwrite')
      const store = transaction.objectStore('alerts')
      const previous = store.get(alert.id)
      previous.onsuccess = () => {
        store.put({ ...alert, receivedAt: previous.result?.receivedAt || alert.receivedAt,
          read: previous.result?.read === true })
        const all = store.getAll()
        all.onsuccess = () => {
          const rows = all.result.sort((a: DeviceAlert, b: DeviceAlert) => b.receivedAt.localeCompare(a.receivedAt))
          for (const row of rows.slice(100)) store.delete(row.id)
        }
      }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { db.close() }
  requestDeviceInboxBadgeSync()
}

export async function markDeviceAlertRead(id: string) {
  const db = await openDeviceInbox()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('alerts', 'readwrite')
      const store = transaction.objectStore('alerts')
      const request = store.get(id)
      request.onsuccess = () => { if (request.result) store.put({ ...request.result, read: true }) }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  } finally { db.close() }
  requestDeviceInboxBadgeSync()
}

/** Cache metadata for offline reading, without document URLs or resurrecting a deleted alert. */
export async function updateDeviceAlertDetails(id: string, details: NonNullable<DeviceAlert['details']>) {
  const db = await openDeviceInbox()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('alerts', 'readwrite')
      const store = transaction.objectStore('alerts')
      const request = store.get(id)
      request.onsuccess = () => { if (request.result && !isDeviceAppointmentNotice(request.result)) store.put({ ...request.result, details }) }
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { db.close() }
}

/** Remove only the messages the user selected; keep pairing and newly arrived alerts. */
export async function deleteDeviceAlerts(ids: string[]) {
  const db = await openDeviceInbox()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('alerts', 'readwrite')
      const store = transaction.objectStore('alerts')
      for (const id of ids) store.delete(id)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { db.close() }
  requestDeviceInboxBadgeSync(ids)
}
