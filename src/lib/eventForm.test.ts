import assert from 'node:assert/strict'
import test from 'node:test'
import { invalidGuestEmails, parseGuestEmails, recurrenceFromRule, recurrenceRule, reminderDate } from './eventForm.js'

test('parses and deduplicates guest emails', () => {
  assert.deepEqual(parseGuestEmails('A@gmail.com, b@gmail.com\na@gmail.com'), ['a@gmail.com', 'b@gmail.com'])
  assert.deepEqual(parseGuestEmails(['A@gmail.com', '', 'a@gmail.com', 'b@gmail.com']), ['a@gmail.com', 'b@gmail.com'])
  assert.deepEqual(invalidGuestEmails('good@gmail.com bad-email'), ['bad-email'])
})

test('maps recurrence values both ways', () => {
  assert.equal(recurrenceRule('weekdays'), 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
  assert.equal(recurrenceFromRule('FREQ=MONTHLY'), 'monthly')
})

test('calculates reminder schedule from event start', () => {
  const start = new Date('2027-03-19T09:00:00+07:00')
  assert.equal(reminderDate(start, '3:day').toISOString(), '2027-03-16T02:00:00.000Z')
})
