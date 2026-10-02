import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateContinuousStartDate,
  daysBetweenBangkokDates,
  generateContinuousReminderDates,
  invalidExternalEmails,
  isGoogleDocumentUrl,
  isTaskOverdue,
  normalizeExternalEmails,
  pastTaskSingleReminderKeys,
  taskDueDateTime,
  taskReminderDate,
  taskSingleReminderOptionLabel,
} from './taskForm'

test('only pending Tasks past the due date are overdue', () => {
  const now = new Date('2026-09-28T05:00:00.000Z')
  assert.equal(isTaskOverdue('pending', '2026-09-27', now), true)
  assert.equal(isTaskOverdue('pending', '2026-09-28', now), false)
  assert.equal(isTaskOverdue('completed', '2026-09-27', now), false)
  assert.equal(isTaskOverdue('cancelled', '2026-09-27', now), false)
})

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

test('calculateContinuousStartDate computes the starting date string', () => {
  assert.equal(calculateContinuousStartDate('2026-10-30', 30), '2026-09-30')
  assert.equal(calculateContinuousStartDate('2026-10-30', 5), '2026-10-25')
  assert.equal(calculateContinuousStartDate('2026-03-01', 1), '2026-02-28')
})

test('daysBetweenBangkokDates calculates difference in days between two dates', () => {
  assert.equal(daysBetweenBangkokDates('2026-10-20', '2026-10-30'), 10)
  assert.equal(daysBetweenBangkokDates('2026-10-30', '2026-10-20'), -10)
  assert.equal(daysBetweenBangkokDates('2026-10-20', '2026-10-20'), 0)
})

test('generateContinuousReminderDates generates daily reminders leading up to due date', () => {
  // 2026-10-09 is Friday
  const dates = generateContinuousReminderDates('2026-10-09', '09:00', { startDaysBefore: 3, frequency: 'daily' })
  assert.equal(dates.length, 4) // 3 days before + due date = 4
  assert.equal(dates[0].toISOString(), '2026-10-06T02:00:00.000Z') // Tuesday
  assert.equal(dates[1].toISOString(), '2026-10-07T02:00:00.000Z') // Wednesday
  assert.equal(dates[2].toISOString(), '2026-10-08T02:00:00.000Z') // Thursday
  assert.equal(dates[3].toISOString(), '2026-10-09T02:00:00.000Z') // Friday
})

test('generateContinuousReminderDates skips weekends when frequency is weekdays', () => {
  // 2026-10-12 is Monday. 4 days before is Thursday Oct 08.
  // Oct 08 (Thu), Oct 09 (Fri), Oct 10 (Sat - skipped), Oct 11 (Sun - skipped), Oct 12 (Mon)
  const dates = generateContinuousReminderDates('2026-10-12', '10:00', { startDaysBefore: 4, frequency: 'weekdays' })
  assert.equal(dates.length, 3)
  assert.equal(dates[0].toISOString(), '2026-10-08T03:00:00.000Z') // Thu
  assert.equal(dates[1].toISOString(), '2026-10-09T03:00:00.000Z') // Fri
  assert.equal(dates[2].toISOString(), '2026-10-12T03:00:00.000Z') // Mon
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

test('identifies past single task reminder keys based on due date and time', () => {
  // Current time: 2026-10-02 11:27:00 Bangkok (04:27:00 UTC)
  const now = new Date('2026-10-02T04:27:00.000Z')

  // Case 1: Due date is Today (2026-10-02) with no due time (default 09:00 Bangkok / 02:00 UTC)
  // '3_days' was 2026-09-29 -> past
  // '1_day' was 2026-10-01 -> past
  // '1_hour' was 2026-10-02 08:00 -> past
  // 'due' was 2026-10-02 09:00 -> past
  // 'overdue' is 2026-10-03 09:00 -> future
  assert.deepEqual(
    pastTaskSingleReminderKeys('2026-10-02', '', ['3_days', '1_day', '1_hour', 'due', 'overdue'], now),
    ['3_days', '1_day', '1_hour', 'due'],
  )

  // Case 2: Due date is Today (2026-10-02) with due time 15:00 Bangkok (08:00 UTC)
  // '3_days' -> past
  // '1_day' -> past
  // '1_hour' (14:00) -> future
  // 'due' (15:00) -> future
  // 'overdue' -> future
  assert.deepEqual(
    pastTaskSingleReminderKeys('2026-10-02', '15:00', ['3_days', '1_day', '1_hour', 'due', 'overdue'], now),
    ['3_days', '1_day'],
  )

  // Case 3: Due date is 5 days from now (2026-10-07)
  // All reminders are in the future
  assert.deepEqual(
    pastTaskSingleReminderKeys('2026-10-07', '10:00', ['3_days', '1_day', '1_hour', 'due', 'overdue'], now),
    [],
  )

  assert.equal(taskSingleReminderOptionLabel('3_days', 'th'), 'ก่อน 3 วัน')
  assert.equal(taskSingleReminderOptionLabel('1_day', 'th'), 'ก่อน 1 วัน')
})

