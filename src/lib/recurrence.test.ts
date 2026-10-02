import assert from 'node:assert/strict'
import test from 'node:test'
import { expandEvent, expandTask } from './recurrence'

const base = { id: 'event-1', start_datetime: '2026-09-21T02:00:00.000Z', end_datetime: '2026-09-21T03:00:00.000Z' }

test('expands weekly events and preserves duration', () => {
  const rows = expandEvent({ ...base, recurrence_rule: 'FREQ=WEEKLY' }, new Date('2026-09-20'), new Date('2026-10-06'))
  assert.deepEqual(rows.map((row) => row.start), ['2026-09-21T02:00:00.000Z', '2026-09-28T02:00:00.000Z', '2026-10-05T02:00:00.000Z'])
  assert.equal(rows[1].end, '2026-09-28T03:00:00.000Z')
})

test('weekdays exclude Saturday and Sunday', () => {
  const rows = expandEvent({ ...base, recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }, new Date('2026-09-21'), new Date('2026-09-28'))
  assert.deepEqual(rows.map((row) => new Date(row.start).getUTCDay()), [1, 2, 3, 4, 5])
})

test('monthly recurrence skips a month without the requested date', () => {
  const rows = expandEvent({ id: 'monthly', start_datetime: '2026-01-31T02:00:00.000Z', end_datetime: null, recurrence_rule: 'FREQ=MONTHLY' }, new Date('2026-01-01'), new Date('2026-04-30'))
  assert.deepEqual(rows.map((row) => row.start.slice(0, 10)), ['2026-01-31', '2026-03-31'])
})

test('expands a custom biweekly Meeting on its selected weekdays and honors its end', () => {
  const rows = expandEvent({
    ...base,
    recurrence_rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
    recurrence_until: '2026-10-14T16:59:59.999Z',
  }, new Date('2026-09-20'), new Date('2026-10-31'))
  assert.deepEqual(rows.map((row) => row.start.slice(0, 10)), ['2026-09-21', '2026-09-23', '2026-10-05', '2026-10-07'])
})

test('stops after the configured number of custom occurrences', () => {
  const rows = expandEvent({ ...base, recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,WE', recurrence_count: 3 }, new Date('2026-09-20'), new Date('2026-10-31'))
  assert.deepEqual(rows.map((row) => row.start.slice(0, 10)), ['2026-09-21', '2026-09-23', '2026-09-28'])
})

const taskBase = { id: 'task-1', due_date: '2026-09-21', due_time: '09:00:00' as string | null, recurrence_end_at: null as string | null }

test('expandTask generates daily task occurrences', () => {
  const rows = expandTask({ ...taskBase, recurrence_rule: 'FREQ=DAILY' }, new Date('2026-09-20'), new Date('2026-09-24'))
  assert.deepEqual(rows.map((row) => row.dueDate), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'])
})

test('expandTask returns a single entry for non-recurring tasks', () => {
  const rows = expandTask({ ...taskBase, recurrence_rule: null }, new Date('2026-09-20'), new Date('2026-09-25'))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].dueDate, '2026-09-21')
})

test('expandTask respects recurrence_end_at', () => {
  const rows = expandTask({ ...taskBase, recurrence_rule: 'FREQ=DAILY', recurrence_end_at: '2026-09-23T16:59:59.999Z' }, new Date('2026-09-20'), new Date('2026-09-30'))
  assert.deepEqual(rows.map((row) => row.dueDate), ['2026-09-21', '2026-09-22', '2026-09-23'])
})
