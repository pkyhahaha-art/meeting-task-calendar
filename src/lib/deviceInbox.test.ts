import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { indexedDB } from 'fake-indexeddb'
import { deleteDeviceAlerts, listDeviceAlerts, markDeviceAlertRead, readDevicePairing, saveDeviceAlert, saveDevicePairing } from './deviceInbox'
import { deviceNotification } from '../../supabase/functions/process-notification-queue/deviceNotification'

globalThis.indexedDB = indexedDB
const workerSource = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')

function worker(factory: IDBFactory = indexedDB) {
  const listeners = new Map<string, (event: unknown) => void>()
  const displayed: Array<{ title: string; options: NotificationOptions }> = []
  const opened: string[] = []
  const self = {
    addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
    registration: { scope: 'https://example.github.io/calendar/', showNotification: async (title: string, options: NotificationOptions) => { displayed.push({ title, options }) } },
    clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url) } },
  }
  vm.runInNewContext(workerSource, { self, indexedDB: factory, URL, crypto, Date, Promise })
  return {
    displayed, opened,
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
  let rows = await listDeviceAlerts()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].details?.location, 'Room A')
  assert.equal(rows[0].details?.start_datetime, '2026-10-06T02:00:00Z')
  assert.equal(rows[0].read, false)
  await markDeviceAlertRead('delivery-1')
  const restarted = worker()
  await restarted.push(notification)
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
