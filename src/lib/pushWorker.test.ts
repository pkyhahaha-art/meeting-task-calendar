import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { indexedDB } from 'fake-indexeddb'

function worker() {
  const handlers: Record<string, (event: unknown) => void> = {}
  const notifications: { title: string; options: { body: string; icon: string } }[] = []
  const opened: string[] = []
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), {
    URL,
    crypto,
    indexedDB,
    self: {
      addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler },
      registration: {
        scope: 'https://example.com/meeting-task-calendar/',
        showNotification: async (title: string, options: { body: string; icon: string }) => { notifications.push({ title, options }) },
      },
      clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url) } },
    },
  })
  return { handlers, notifications, opened }
}

test('background notifications use the GitHub Pages icon path', async () => {
  const state = worker()
  let pending: Promise<unknown> | undefined
  state.handlers.push({
    data: { json: () => ({ title: 'Meeting', body: 'Starts soon' }) },
    waitUntil: (promise: Promise<unknown>) => { pending = promise },
  })
  await pending
  assert.equal(state.notifications[0].options.icon, 'https://example.com/meeting-task-calendar/icon-192.png')
  assert.equal(state.notifications[0].options.body, 'Starts soon')
})

test('notification clicks cannot open an external site or another Pages project', async () => {
  for (const url of ['https://untrusted.example/', '/other-project/', 'http://[invalid']) {
    const state = worker()
    let pending: Promise<unknown> | undefined
    state.handlers.notificationclick({
      notification: { close: () => {}, data: { url } },
      waitUntil: (promise: Promise<unknown>) => { pending = promise },
    })
    await pending
    assert.deepEqual(state.opened, ['https://example.com/meeting-task-calendar/#/device-inbox'])
  }
})

test('notifications with a null payload still display a visible message', async () => {
  const state = worker()
  let pending: Promise<unknown> | undefined
  state.handlers.push({
    data: { json: () => null, text: () => 'Reminder' },
    waitUntil: (promise: Promise<unknown>) => { pending = promise },
  })
  await pending
  assert.equal(state.notifications[0].options.body, 'Reminder')
})
