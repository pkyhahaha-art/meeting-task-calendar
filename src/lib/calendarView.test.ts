import assert from 'node:assert/strict'
import test from 'node:test'
import { calendarClickedDate, calendarDayKey, calendarEntriesByDay, calendarMeetingOccurrences, calendarViewType, readCalendarPages } from './calendarView'

test('all four choices keep their meaning when the screen changes size', () => {
  assert.equal(calendarViewType('day', false), 'timeGridDay')
  assert.equal(calendarViewType('week', false), 'timeGridWeek')
  assert.equal(calendarViewType('week', true), 'listWeek')
  assert.equal(calendarViewType('month', true), 'dayGridMonth')
  assert.equal(calendarViewType('year', true), 'multiMonthYear')
})

test('time-grid clicks supply a date to the existing form and UTC midnight uses Bangkok dates', () => {
  assert.equal(calendarClickedDate('2026-10-09T14:30:00+07:00'), '2026-10-09')
  assert.equal(calendarClickedDate('2026-10-09'), '2026-10-09')
  assert.equal(calendarDayKey('2026-10-08T17:30:00Z'), '2026-10-09')
  assert.equal(calendarDayKey('2026-10-08T16:30:00Z'), '2026-10-08')
})

test('day index preserves Bangkok boundaries, date-only entries, order and original details', () => {
  const entries = [
    { start: '2026-10-08T16:59:59Z', title: 'Previous day', occurrenceStart: 'original' },
    { start: '2026-10-08T17:00:00Z', title: 'Midnight meeting', occurrenceStart: 'original' },
    { start: '2026-10-09', title: 'All-day task', occurrenceStart: 'original' },
    { start: new Date('2026-10-09T14:30:00+07:00'), title: 'Timed task', occurrenceStart: 'original' },
  ]
  const index = calendarEntriesByDay(entries)
  assert.deepEqual(index.get('2026-10-08'), [entries[0]])
  assert.deepEqual(index.get('2026-10-09'), entries.slice(1))
  assert.equal(index.get('2026-10-09')?.[0], entries[1])
  assert.equal(index.has('2026-10-10'), false)
  assert.equal(calendarEntriesByDay([]).size, 0)
})

test('year navigation expands meetings outside the old today-centered window without changing count', () => {
  const event = { id: 'annual', start_datetime: '2026-09-21T02:00:00Z', end_datetime: '2026-09-21T03:00:00Z', recurrence_rule: 'FREQ=YEARLY', recurrence_count: 6 }
  const range = [new Date('2030-01-01T00:00:00+07:00'), new Date('2031-01-01T00:00:00+07:00')] as const
  assert.deepEqual(calendarMeetingOccurrences(event, ...range).map((row) => row.start), ['2030-09-21T02:00:00.000Z'])
  assert.equal(calendarMeetingOccurrences(event, new Date('2032-01-01'), new Date('2033-01-01')).length, 0)
})

test('Day includes the preceding recurring appointment while it continues into the view', () => {
  const event = { id: 'overnight', start_datetime: '2026-10-07T16:00:00Z', end_datetime: '2026-10-07T19:00:00Z', recurrence_rule: 'FREQ=DAILY', recurrence_count: 3 }
  const rows = calendarMeetingOccurrences(event, new Date('2026-10-09T00:00:00+07:00'), new Date('2026-10-10T00:00:00+07:00'))
  assert.deepEqual(rows.map((row) => row.start), ['2026-10-08T16:00:00.000Z', '2026-10-09T16:00:00.000Z'])
  assert.equal(rows[0].end, '2026-10-08T19:00:00.000Z')
})

test('a view end is exclusive and appointments finishing at its start do not appear', () => {
  const event = { id: 'midnight', start_datetime: '2026-10-07T17:00:00Z', end_datetime: '2026-10-07T18:00:00Z', recurrence_rule: 'FREQ=DAILY' }
  const rows = calendarMeetingOccurrences(event, new Date('2026-10-09T00:00:00+07:00'), new Date('2026-10-10T00:00:00+07:00'))
  assert.deepEqual(rows.map((row) => row.start), ['2026-10-08T17:00:00.000Z'])
  assert.equal(calendarMeetingOccurrences({ ...event, recurrence_rule: null, end_datetime: '2026-10-08T17:00:00Z' }, new Date('2026-10-09T00:00:00+07:00'), new Date('2026-10-10T00:00:00+07:00')).length, 0)
})

test('calendar reads all rows even when the API supplies shorter pages than requested', async () => {
  const source = Array.from({ length: 1205 }, (_, id) => ({ id }))
  const offsets: number[] = []
  const rows = await readCalendarPages(async (offset) => {
    offsets.push(offset)
    return { data: source.slice(offset, offset + 125), error: null, count: source.length }
  })
  assert.deepEqual(rows, source)
  assert.equal(offsets.at(-1), 1125)
})

test('empty results finish and page errors are reported instead of displaying incomplete data', async () => {
  assert.deepEqual(await readCalendarPages(async () => ({ data: [], error: null, count: 0 })), [])
  const failure = new Error('Network unavailable')
  await assert.rejects(readCalendarPages(async (offset) => offset
    ? { data: null, error: failure, count: null }
    : { data: [{ id: 1 }], error: null, count: 2 }), failure)
})
