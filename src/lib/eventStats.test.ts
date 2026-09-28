import assert from 'node:assert/strict'
import test from 'node:test'
import { eventCreationPeriods } from './eventStats'

test('creation periods use Bangkok days and a Monday-start week', () => {
  const periods = eventCreationPeriods(new Date('2026-09-27T18:00:00Z')) // Monday 01:00 in Bangkok
  assert.deepEqual(periods, {
    today: { start: '2026-09-27T17:00:00.000Z', end: '2026-09-28T17:00:00.000Z' },
    week: { start: '2026-09-27T17:00:00.000Z', end: '2026-09-28T17:00:00.000Z' },
    month: { start: '2026-08-31T17:00:00.000Z', end: '2026-09-28T17:00:00.000Z' },
  })
})

test('creation periods cross a month and week boundary in Bangkok', () => {
  const periods = eventCreationPeriods(new Date('2026-10-04T17:30:00Z')) // Monday 00:30 in Bangkok
  assert.equal(periods.today.start, '2026-10-04T17:00:00.000Z')
  assert.equal(periods.week.start, periods.today.start)
  assert.equal(periods.month.start, '2026-09-30T17:00:00.000Z')
})
