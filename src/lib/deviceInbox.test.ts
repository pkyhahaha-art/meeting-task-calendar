import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { indexedDB } from 'fake-indexeddb'
import { deleteDeviceAlerts, listDeviceAlerts, markDeviceAlertRead, readDevicePairing, saveDeviceAlert, saveDevicePairing, updateDeviceAlertDetails } from './deviceInbox'
import { deviceNotification } from '../../supabase/functions/process-notification-queue/deviceNotification'
import { subject } from '../../supabase/functions/process-notification-queue/emailTemplate'

globalThis.indexedDB = indexedDB
const workerSource = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')

const overdueTaskId = '40000000-0000-4000-8000-000000000004'
function overdueMessage(id: string, day: number) {
  const payload = { entity: 'task', id: overdueTaskId, title: 'Report', description: 'Details',
    due_date: '2026-10-06', reminder_key: 'overdue', reminder_scheduled_at: `2026-10-${String(day).padStart(2, '0')}T09:00:00+07:00` }
  return deviceNotification(id, subject('task_reminder', payload), payload, 'https://example.github.io/calendar/', 'task_reminder')
}

function worker(factory: IDBFactory = indexedDB, badgeAvailable = true, badgeFails = false) {
  const listeners = new Map<string, (event: unknown) => void>()
  const displayed: Array<{ title: string; options: NotificationOptions & { renotify?: boolean } }> = []
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

test('daily overdue Push replaces the same task message, resets unread only for a new round, and opens latest delivery details', async () => {
  const pairing = { subscriptionId: 'daily-device', endpoint: 'https://web.push.apple.com/daily', userName: 'User', pairedAt: '2026-10-07T02:00:00Z' }
  await saveDevicePairing(pairing, true)
  await saveDeviceAlert({ id: 'created-separate', title: 'Created', body: '', read: true, receivedAt: '2026-10-06T02:00:00Z' })
  await markDeviceAlertRead('created-separate')
  const first = overdueMessage('50000000-0000-4000-8000-000000000005', 7)
  const second = overdueMessage('60000000-0000-4000-8000-000000000006', 8)
  const state = worker()
  await state.push(first)
  await markDeviceAlertRead(first.id)
  await state.push(second)
  let rows = await listDeviceAlerts()
  assert.equal(rows.length, 2)
  assert.ok(!rows.some((row) => row.id === first.id))
  assert.equal(rows.find((row) => row.id === second.id)?.read, false)
  assert.equal(state.badges.at(-1), 1)
  assert.equal(state.displayed[0].options.tag, state.displayed[1].options.tag)
  assert.equal(state.displayed[1].options.renotify, true)
  await state.click(state.displayed[1].options.data.url)
  assert.equal(state.opened[0], `https://example.github.io/calendar/#/device-inbox?notification=${second.id}`)
  // Retried older deliveries cannot replace today's alert or reopen a read round.
  await markDeviceAlertRead(second.id)
  await state.push(first)
  await state.push(second)
  rows = await listDeviceAlerts()
  assert.equal(rows.find((row) => row.id === second.id)?.read, true)
  assert.equal(state.displayed.length, 2)
  assert.equal(state.badges.at(-1), 0)
  await deleteDeviceAlerts([second.id])
  const third = overdueMessage('70000000-0000-4000-8000-000000000007', 9)
  await worker().push(third)
  assert.deepEqual((await listDeviceAlerts()).map((row) => row.id).sort(), ['created-separate', third.id].sort())
  assert.deepEqual(await readDevicePairing(), pairing)
})

test('only marked overdue task reminders share a notification group; other task messages remain separate', () => {
  const overdue = overdueMessage('daily-delivery', 7)
  assert.equal(overdue.replaceKey, `task-overdue:${overdueTaskId}`)
  assert.equal(overdue.reminderAt, '2026-10-07T02:00:00.000Z')
  assert.match(overdue.title, /^งานเลยกำหนด/)
  for (const template of ['task_created', 'task_updated', 'task_completed', 'meeting_reminder']) {
    const message = deviceNotification('ordinary', 'Title', { entity: 'task', id: overdueTaskId,
      reminder_key: 'overdue', reminder_scheduled_at: '2026-10-07T02:00:00Z' }, 'https://example.github.io/calendar/', template)
    assert.equal(message.replaceKey, undefined)
    assert.equal(message.tag, 'delivery-ordinary')
  }
  assert.equal(deviceNotification('ordinary', 'Title', { entity: 'task', id: overdueTaskId },
    'https://example.github.io/calendar/', 'task_reminder').replaceKey, undefined)
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

test('appointment action survives worker restart and online refresh without rewriting the original action', async () => {
  await saveDevicePairing({ subscriptionId: 'action-device', endpoint: 'https://web.push.apple.com/actions', userName: 'User', pairedAt: '2026-10-04T02:00:00Z' }, true)
  for (const template of ['meeting_occurrence_cancelled', 'meeting_occurrence_moved']) {
    const payload = { entity: 'meeting', title: 'ประชุม😀'.repeat(100), original_occurrence_start: '2026-10-02T17:30:00Z',
      new_occurrence_start: '2026-10-01T17:30:00Z', description: 'วาระ😀'.repeat(1000), guest_token: 'SECRET',
      affiliation: 'ฝ่ายแผนงาน😀'.repeat(100), location: 'ห้องประชุม😀'.repeat(100),
      start_datetime: '2026-10-03T02:00:00Z', end_datetime: '2026-10-03T03:00:00Z',
      meeting_documents: [{ name: 'PRIVATE DOCUMENT', url: 'https://storage.test/private' }] }
    const message = deviceNotification(template, subject(template, payload), payload, 'https://example.github.io/calendar/', template)
    assert.ok(new TextEncoder().encode(JSON.stringify(message)).length < 3500)
    assert.match(message.title, /3 ต\.ค\./)
    assert.doesNotMatch(message.body, /ประชุม|«|»/)
    if (template.endsWith('moved')) assert.match(message.body, /2 ต\.ค\. เวลา 00:30 น\./)
    assert.doesNotMatch(JSON.stringify(message), /PRIVATE DOCUMENT|SECRET|storage\.test/)
    assert.match(message.details.description, /วาระ/)
    await worker().push(message)
    await updateDeviceAlertDetails(template, { entity: 'meeting', title: 'New title', description: 'Current agenda', start_datetime: '2026-11-01T00:00:00Z' })
    const alert = (await listDeviceAlerts()).find((item) => item.id === template)!
    assert.equal(alert.title, message.title)
    assert.equal(alert.details?.notice_template, template)
    assert.equal(alert.details?.description, 'Current agenda')
    assert.equal(alert.details?.original_occurrence_start, payload.original_occurrence_start)
    assert.equal(alert.details?.new_occurrence_start, payload.new_occurrence_start)
  }
})

test('action Push bounds serialized JSON when all restored fields contain controls, quotes or backslashes', () => {
  const id = 'a0000000-0000-4000-8000-000000000001'
  for (const template of ['meeting_occurrence_cancelled', 'meeting_occurrence_moved']) {
    for (const value of ['\u0001', '\u0000\u0002\b\f\u001f', '"\\', 'ประชุม😀']) {
      const longText = value.repeat(10000)
      const payload = { entity: 'meeting', title: longText, description: longText, affiliation: longText, location: longText,
        status: longText, due_date: longText, due_time: longText,
        original_occurrence_start: '2026-10-03T02:00:00Z', new_occurrence_start: '2026-10-02T02:00:00Z',
        start_datetime: '2026-10-02T02:00:00Z', end_datetime: '2026-10-02T03:00:00Z' }
      const message = deviceNotification(id, subject(template, payload), payload, 'https://pkyhahaha-art.github.io/meeting-task-calendar/', template)
      const bytes = new TextEncoder().encode(JSON.stringify(message)).length
      assert.ok(bytes <= 3500, `${template} ${JSON.stringify(value)} produced ${bytes} serialized bytes`)
      assert.match(message.title, /3 ต\.ค\./)
      if (template.endsWith('moved')) assert.match(message.title, /2 ต\.ค\. เวลา 09:00 น\./)
      assert.equal(message.details.original_occurrence_start, payload.original_occurrence_start)
      assert.equal(message.details.new_occurrence_start, payload.new_occurrence_start)
    }
  }
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
