import assert from 'node:assert/strict'
import test from 'node:test'
import { invalidExternalEmails, isGoogleDocumentUrl, normalizeExternalEmails, taskDueDateTime, taskReminderDate } from './taskForm'

test('uses 09:00 Bangkok time when a Task has no due time', () => {
  assert.equal(taskDueDateTime('2026-09-20', '').toISOString(), '2026-09-20T02:00:00.000Z')
})

test('calculates Task reminder offsets', () => {
  const due = taskDueDateTime('2026-09-20', '10:00')
  assert.equal(taskReminderDate(due, '1_hour').toISOString(), '2026-09-20T02:00:00.000Z')
  assert.equal(taskReminderDate(due, '1_day').toISOString(), '2026-09-19T03:00:00.000Z')
  assert.equal(taskReminderDate(due, '3_days').toISOString(), '2026-09-17T03:00:00.000Z')
  assert.equal(taskReminderDate(due, 'overdue').toISOString(), '2026-09-21T02:00:00.000Z')
})

test('accepts only secure Google document links', () => {
  assert.equal(isGoogleDocumentUrl('https://drive.google.com/file/d/abc/view'), true)
  assert.equal(isGoogleDocumentUrl('https://docs.google.com/document/d/abc/edit'), true)
  assert.equal(isGoogleDocumentUrl('http://drive.google.com/file/d/abc/view'), false)
  assert.equal(isGoogleDocumentUrl('https://example.com/document'), false)
})

test('normalizes unique external Gmail recipients and rejects invalid addresses', () => {
  const emails = ['  PERSON@gmail.com ', 'person@gmail.com', '', 'not-an-email', 'other@example.com']

  assert.deepEqual(normalizeExternalEmails(emails), ['person@gmail.com', 'not-an-email', 'other@example.com'])
  assert.deepEqual(invalidExternalEmails(emails), ['not-an-email', 'other@example.com'])
})
