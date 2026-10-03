import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { indexedDB } from 'fake-indexeddb'
import { deleteDeviceAlerts, listDeviceAlerts, markDeviceAlertRead, readDevicePairing, saveDeviceAlert, saveDevicePairing, updateDeviceAlertDetails } from './deviceInbox'
import { deviceNotification } from '../../supabase/functions/process-notification-queue/deviceNotification'

globalThis.indexedDB = indexedDB
const workerSource = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')

function worker(factory: IDBFactory = indexedDB, badgeAvailable = true, badgeFails = false) {
  const listeners = new Map<string, (event: unknown) => void>()
  const displayed: Array<{ title: string; options: NotificationOptions }> = []
  const opened: string[] = []
  const badges: number[] = []
  const notices: Array<{ data: NotificationOptions['data']; closed: boolean; close(): void }> = []
  const self = {
    addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
    navigator: badgeAvailable ? {
      setAppBadge: async (count: number) => { if (badgeFails) throw new Error('Badging denied'); badges.push(count) },
      clearAppBadge: async () => { if (badgeFails) throw new Error('Badging denied'); badges.push(0) },
    } : {},
    registration: {
      scope: 'https://example.github.io/calendar/',
      showNotification: async (title: string, options: NotificationOptions) => {
        displayed.push({ title, options })
        notices.push({ data: options.data, closed: false, close() { this.closed = true } })
      },
      getNotifications: async () => notices.filter((notice) => !notice.closed),
    },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async (url: string) => { opened.push(url) } },
  }
  vm.runInNewContext(workerSource, { self, indexedDB: factory, URL, URLSearchParams, crypto, Date, Promise })
  return {
    displayed, opened, badges, notices,
    async activate() {
      let pending: Promise<unknown> | undefined
      listeners.get('activate')!({ waitUntil: (promise: Promise<unknown>) => { pending = promise } })
      await pending
    },
    async sync(removedIds: string[] = []) {
      let pending: Promise<unknown> | undefined
      listeners.get('message')!({ data: { type: 'PEA_SYNC_INBOX_BADGE', removedIds }, waitUntil: (promise: Promise<unknown>) => { pending = promise } })
      await pending
    },
    async push(message: Record<string, unknown>) {
      let pending: Promise<unknown> | undefined
      listeners.get('push')!({ data: { json: () => message }, waitUntil: (promise: Promise<unknown>) => { pending = promise } })
      await pending
    },
    async click(url: string) {
      let pending: Promise<unknown> | undefined
      listeners.get('notificationclick')!({ notification: { close() {}, data: { url } }, waitUntil: (promise: Promise<unknown>) => { pending = promise } })
      await pending
    },
  }
}

test('a Push received while the app is closed survives a worker restart and opens its local details', async () => {
  await saveDevicePairing({ subscriptionId: 'device-1', endpoint: 'https://web.push.apple.com/test', userName: 'User', pairedAt: '2026-10-03T02:00:00Z' }, true)
  const notification = deviceNotification('delivery-1', 'แจ้งเตือน Meeting: Planning', {
    entity: 'meeting', title: 'Planning', description: 'Agenda', start_datetime: '2026-10-06T02:00:00Z', location: 'Room A',
  }, 'https://example.github.io/calendar/')
  const first = worker()
  await first.push(notification)
  assert.deepEqual(first.badges, [1])
  let rows = await listDeviceAlerts()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].details?.location, 'Room A')
  assert.equal(rows[0].details?.start_datetime, '2026-10-06T02:00:00Z')
  assert.equal(rows[0].read, false)
  await markDeviceAlertRead('delivery-1')
  const restarted = worker()
  await restarted.push(notification)
  assert.deepEqual(restarted.badges, [0])
  rows = await listDeviceAlerts()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].read, true)
  assert.equal((await readDevicePairing())?.subscriptionId, 'device-1')
  await restarted.click(first.displayed[0].options.data.url)
  assert.equal(restarted.opened[0], 'https://example.github.io/calendar/#/device-inbox?notification=delivery-1')
  await restarted.click('https://untrusted.example/steal')
  assert.equal(restarted.opened[1], 'https://example.github.io/calendar/#/device-inbox')
  await saveDevicePairing({ subscriptionId: 'device-2', endpoint: 'https://web.push.apple.com/new', userName: 'Other User', pairedAt: '2026-10-03T03:00:00Z' }, true)
  assert.equal((await listDeviceAlerts()).length, 0)
})

test('an IndexedDB failure still displays the visible Push notification', async () => {
  const failing = worker({ open() { throw new Error('Storage unavailable') } } as unknown as IDBFactory)
  await failing.push({ title: 'Message', body: 'Details', id: 'test' })
  assert.equal(failing.displayed.length, 1)
  assert.equal(failing.displayed[0].title, 'Message')
})

test('the app icon counts unread messages, deduplicates Push, and clears after reading or deleting', async () => {
  await saveDevicePairing({ subscriptionId: 'badge-device', endpoint: 'https://web.push.apple.com/badge', userName: 'User', pairedAt: '2026-10-03T04:00:00Z' }, true)
  const state = worker()
  await state.push({ id: 'badge-first', title: 'First' })
  await state.push({ id: 'badge-second', title: 'Second' })
  await state.push({ id: 'badge-second', title: 'Second retry' })
  assert.deepEqual(state.badges, [1, 2, 2])
  // Foreground changes request a worker refresh instead of supplying a stale count.
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  let pending: Promise<void> | undefined
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { controller: {
    postMessage: (message: { type: string; removedIds: string[] }) => {
      assert.equal(message.type, 'PEA_SYNC_INBOX_BADGE')
      pending = state.sync(message.removedIds)
    },
  } } } })
  try {
    await markDeviceAlertRead('badge-first')
    await pending
    assert.equal(state.badges.at(-1), 1)
    assert.equal(state.notices[0].closed, true)
    assert.equal(state.notices[1].closed, false)
    await deleteDeviceAlerts(['badge-second'])
    await pending
    assert.equal(state.badges.at(-1), 0)
    assert.equal(state.notices[1].closed, true)
    assert.equal((await readDevicePairing())?.subscriptionId, 'badge-device')
    await state.push({ id: 'badge-after-clear', title: 'New' })
    assert.equal(state.badges.at(-1), 1)
    await saveDevicePairing({ subscriptionId: 'next-device', endpoint: 'https://web.push.apple.com/new', userName: 'Next', pairedAt: '2026-10-03T05:00:00Z' }, true)
    await pending
    assert.equal(state.badges.at(-1), 0)
    assert.equal(state.notices.at(-1)?.closed, true)
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
})

test('a worker update restores the persisted badge without a new Push', async () => {
  await saveDevicePairing({ subscriptionId: 'updated-worker', endpoint: 'https://web.push.apple.com/update', userName: 'User', pairedAt: '2026-10-03T04:00:00Z' }, true)
  await saveDeviceAlert({ id: 'already-received', title: 'Unread', body: '', read: false, receivedAt: '2026-10-03T04:00:00Z' })
  const updated = worker()
  await updated.activate()
  assert.deepEqual(updated.badges, [1])
  await markDeviceAlertRead('already-received')
  const restarted = worker()
  await restarted.activate()
  assert.deepEqual(restarted.badges, [0])
})

test('a stopped foreground worker does not fail an inbox change', async () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker: { controller: {
    postMessage: () => { throw new Error('Worker stopped') },
  } } } })
  try {
    await saveDeviceAlert({ id: 'stopped-worker', title: 'Message', body: '', read: false, receivedAt: '2026-10-03T04:00:00Z' })
    await markDeviceAlertRead('stopped-worker')
    assert.equal((await listDeviceAlerts()).find((row) => row.id === 'stopped-worker')?.read, true)
    await deleteDeviceAlerts(['stopped-worker'])
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }
})

test('unsupported or rejected badges preserve visible Push and close only the inbox notifications read by the user', async () => {
  for (const state of [worker(indexedDB, false), worker(indexedDB, true, true)]) {
    await saveDevicePairing({ subscriptionId: 'fallback', endpoint: 'https://web.push.apple.com/fallback', userName: 'User', pairedAt: '2026-10-03T04:00:00Z' }, true)
    await state.push({ id: 'fallback-message', title: 'Visible' })
    assert.equal(state.displayed.length, 1)
    assert.equal((await listDeviceAlerts())[0].id, 'fallback-message')
    state.notices.push({ data: { url: 'https://other.example/#/device-inbox?notification=fallback-message' }, closed: false, close() { this.closed = true } })
    await markDeviceAlertRead('fallback-message')
    await state.sync()
    assert.equal(state.notices[0].closed, true)
    assert.equal(state.notices[1].closed, false)
  }
})

test('badge refresh uses the latest inbox after concurrent Push and respects the 100-message limit', async () => {
  await saveDevicePairing({ subscriptionId: 'concurrent', endpoint: 'https://web.push.apple.com/concurrent', userName: 'User', pairedAt: '2026-10-03T04:00:00Z' }, true)
  const state = worker()
  await Promise.all([state.push({ id: 'concurrent-first' }), state.sync(), state.push({ id: 'concurrent-second' })])
  assert.equal(state.badges.at(-1), 2)
  for (let i = 0; i < 100; i++) await saveDeviceAlert({ id: `limit-${i}`, title: 'Message', body: '', read: false, receivedAt: new Date().toISOString() })
  await state.push({ id: 'last-limit-message' })
  assert.equal((await listDeviceAlerts()).length, 100)
  assert.equal(state.badges.at(-1), 100)
})

test('deleting a message preserves other messages and device pairing across reopening', async () => {
  const pairing = { subscriptionId: 'cleanup-device', endpoint: 'https://web.push.apple.com/cleanup', userName: 'User', pairedAt: '2026-10-03T04:00:00Z' }
  await saveDevicePairing(pairing, true)
  for (const id of ['remove-one', 'keep-one']) await saveDeviceAlert({ id, title: id, body: 'Message', read: false, receivedAt: '2026-10-03T04:00:00Z' })
  await deleteDeviceAlerts(['remove-one'])
  assert.deepEqual((await listDeviceAlerts()).map((alert) => alert.id), ['keep-one'])
  assert.deepEqual(await readDevicePairing(), pairing)
})

test('clearing the displayed messages preserves a Push arriving during confirmation', async () => {
  await saveDevicePairing({ subscriptionId: 'cleanup-device', endpoint: 'https://web.push.apple.com/cleanup', userName: 'User', pairedAt: '2026-10-03T04:00:00Z' }, true)
  await saveDeviceAlert({ id: 'shown-message', title: 'Shown', body: 'Message', read: false, receivedAt: '2026-10-03T04:00:00Z' })
  const shown = (await listDeviceAlerts()).map((alert) => alert.id)
  await worker().push({ id: 'arrived-later', title: 'New alert', body: 'Arrived while confirming' })
  await deleteDeviceAlerts(shown)
  assert.deepEqual((await listDeviceAlerts()).map((alert) => alert.id), ['arrived-later'])
  await deleteDeviceAlerts(['arrived-later'])
  assert.equal((await listDeviceAlerts()).length, 0)
  assert.equal((await readDevicePairing())?.subscriptionId, 'cleanup-device')
  await worker().push({ id: 'after-clear', title: 'Still connected', body: 'New messages still arrive' })
  assert.equal((await listDeviceAlerts())[0].id, 'after-clear')
})

test('Thai notification snapshots fit Web Push payload limits and exclude credentials', () => {
  const result = deviceNotification('id', 'แจ้งเตือน Task', {
    entity: 'task', title: 'ทดสอบ'.repeat(100), description: 'รายละเอียด'.repeat(1000),
    location: 'ห้องประชุม'.repeat(100), due_date: '2026-10-06', due_time: '09:00',
    guest_token: 'SECRET', ack_url: 'https://example.com/private', push_user_id: 'PRIVATE',
  }, 'https://example.github.io/calendar/')
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).length < 3500)
  assert.equal(result.details.due_date, '2026-10-06')
  assert.doesNotMatch(JSON.stringify(result), /SECRET|PRIVATE|ack_url|guest_token/)
})

test('caching full message details preserves read state and never restores a deleted alert', async () => {
  await saveDevicePairing({ subscriptionId: 'metadata-device', endpoint: 'https://web.push.apple.com/metadata', userName: 'User', pairedAt: '2026-10-03T07:00:00Z' }, true)
  await saveDeviceAlert({ id: 'metadata-message', title: 'Created', body: 'Summary', receivedAt: '2026-10-03T07:00:00Z', read: false })
  await markDeviceAlertRead('metadata-message')
  const details = { entity: 'task', title: 'Task', affiliation: 'Department', description: 'Full details', due_date: '2026-10-06' }
  await updateDeviceAlertDetails('metadata-message', details)
  assert.equal((await listDeviceAlerts())[0].read, true)
  assert.deepEqual((await listDeviceAlerts())[0].details, details)
  await deleteDeviceAlerts(['metadata-message'])
  await updateDeviceAlertDetails('metadata-message', details)
  assert.equal((await listDeviceAlerts()).length, 0)
})
