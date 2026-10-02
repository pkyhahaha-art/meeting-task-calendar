import assert from 'node:assert/strict'
import test from 'node:test'
import { appUrl } from './appUrl.js'

test('QR links retain the GitHub Pages project path and token', () => {
  for (const pageUrl of [
    'https://pkyhahaha-art.github.io/meeting-task-calendar/#/mobile-push',
    'https://pkyhahaha-art.github.io/meeting-task-calendar/index.html#/mobile-push',
    'https://pkyhahaha-art.github.io/meeting-task-calendar',
  ]) {
    const result = appUrl('/pair-device?token=test-token', pageUrl)
    assert.equal(result, 'https://pkyhahaha-art.github.io/meeting-task-calendar/#/pair-device?token=test-token')
    const url = new URL(result)
    assert.equal(url.pathname, '/meeting-task-calendar/')
    assert.equal(new URLSearchParams(url.hash.split('?')[1]).get('token'), 'test-token')
  }
})

test('links work at the domain root and on local development ports', () => {
  assert.equal(appUrl('pair-device?token=test', 'https://calendar.example/#/mobile-push'), 'https://calendar.example/#/pair-device?token=test')
  assert.equal(appUrl('/calendar', 'http://localhost:5173/index.html#/login'), 'http://localhost:5173/#/calendar')
})

test('deployment directories containing a dot and page queries are preserved correctly', () => {
  assert.equal(appUrl('/calendar', 'https://example.com/calendar.v2/?source=qr#/login'), 'https://example.com/calendar.v2/#/calendar')
})
