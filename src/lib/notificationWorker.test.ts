import assert from 'node:assert/strict'
import test from 'node:test'
import { activeNotificationWorker, showLocalTestNotification, withNotificationTimeout } from './notificationWorker.js'

test('uses the activated registration under the GitHub Pages project path', async () => {
  const registration = { active: { state: 'activated' } } as ServiceWorkerRegistration
  let requestedUrl = ''
  let requestedScope = ''
  const result = await activeNotificationWorker({ register: async (url, options) => {
    requestedUrl = String(url)
    requestedScope = options?.scope || ''
    return registration
  } }, 'https://example.com/meeting-task-calendar/#/mobile-push')
  assert.equal(requestedUrl, 'https://example.com/meeting-task-calendar/sw.js')
  assert.equal(requestedScope, '/meeting-task-calendar/')
  assert.equal(result, registration)
})

test('waits for the registered worker to activate before showing a notification', async () => {
  let state = 'installing'
  const listeners = new Set<() => void>()
  const worker = {
    get state() { return state },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }
  const registration = { installing: worker, active: null } as unknown as ServiceWorkerRegistration
  const pending = activeNotificationWorker({ register: async () => registration }, 'https://example.com/')
  setTimeout(() => {
    state = 'activated'
    for (const listener of listeners) listener()
  }, 0)
  assert.equal(await pending, registration)
  assert.equal(listeners.size, 0)
})

test('failed installation and unbounded waits report errors', async () => {
  const worker = { state: 'redundant', addEventListener: () => {}, removeEventListener: () => {} }
  await assert.rejects(activeNotificationWorker({ register: async () => ({ installing: worker } as unknown as ServiceWorkerRegistration) }, 'https://example.com/'), /ติดตั้งระบบแจ้งเตือนไม่สำเร็จ/)
  await assert.rejects(withNotificationTimeout(new Promise(() => {}), 'Timed out', 5), /Timed out/)
})

test('confirms only the newly created notification, not old notifications', async () => {
  let notificationTag = ''
  let icon = ''
  const registration = {
    scope: 'https://example.com/meeting-task-calendar/',
    showNotification: async (_: string, options: NotificationOptions) => {
      notificationTag = options.tag || ''
      icon = options.icon || ''
    },
    getNotifications: async (options: GetNotificationOptions) => {
      assert.equal(options.tag, notificationTag)
      return [{}]
    },
  } as unknown as ServiceWorkerRegistration
  assert.equal(await showLocalTestNotification(registration, 'Test', 'Hello'), true)
  assert.equal(icon, 'https://example.com/meeting-task-calendar/icon-192.png')
  const firstTag = notificationTag
  await showLocalTestNotification(registration, 'Test', 'Hello again')
  assert.notEqual(notificationTag, firstTag)
})

test('does not claim success when the device does not list the notification', async () => {
  const registration = {
    scope: 'https://example.com/', showNotification: async () => {}, getNotifications: async () => [],
  } as unknown as ServiceWorkerRegistration
  assert.equal(await showLocalTestNotification(registration, 'Test', 'Hello'), false)
})
