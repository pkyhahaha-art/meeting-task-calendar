import assert from 'node:assert/strict'
import test from 'node:test'
import { countScheduledMeetings, eventCreationPeriods, eventAgendaPeriods } from './eventStats'

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

test('agenda periods return full calendar bounds for week and month', () => {
  const periods = eventAgendaPeriods(new Date('2026-11-01T08:00:00+07:00')) // Sunday 2026-11-01
  assert.equal(periods.today.startDay, '2026-11-01')
  assert.equal(periods.today.endDay, '2026-11-02')
  // Sunday 2026-11-01 belongs to week starting Monday 2026-10-26 to next Monday 2026-11-02
  assert.equal(periods.week.startDay, '2026-10-26')
  assert.equal(periods.week.endDay, '2026-11-02')
  // Month of November 2026 starts 2026-11-01 and ends 2026-12-01
  assert.equal(periods.month.startDay, '2026-11-01')
  assert.equal(periods.month.endDay, '2026-12-01')
})

test('agenda excludes a cancelled occurrence when PostgREST uses a different timestamp format', () => {
  const periods = eventAgendaPeriods(new Date('2026-11-30T08:00:00+07:00'))
  const event = {
    id: 'weekly-meeting',
    start_datetime: '2026-11-16T02:30:00+00:00',
    end_datetime: null,
    recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO',
    recurrence_count: 3,
  }
  assert.deepEqual(countScheduledMeetings([event], [], periods), { today: 1, week: 1, month: 3 })
  assert.deepEqual(
    countScheduledMeetings([event], [{ event_id: event.id, occurrence_key: '2026-11-30T02:30:00+00:00' }], periods),
    { today: 0, week: 0, month: 2 },
  )
})

test('agenda does not count a recurring occurrence at the first instant of the next month', () => {
  const periods = eventAgendaPeriods(new Date('2026-11-30T08:00:00+07:00'))
  const event = {
    id: 'daily-meeting',
    start_datetime: '2026-11-30T00:00:00+07:00',
    end_datetime: null,
    recurrence_rule: 'FREQ=DAILY',
    recurrence_count: 2,
  }
  assert.deepEqual(countScheduledMeetings([event], [], periods), { today: 1, week: 2, month: 1 })
})
