import test from 'node:test'
import assert from 'node:assert/strict'
import { continuousReminderPreview } from './taskForm'
const now = new Date('2026-10-30T08:00:00+07:00')
const days = (dates: Date[]) => dates.map(date => date.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }))
test('daily includes Friday and Saturday due date, never after due date', () => {
  assert.deepEqual(days(continuousReminderPreview('2026-10-31', '09:00', {startDaysBefore:1, frequency:'daily'}, now).dates), ['2026-10-30', '2026-10-31'])
})
test('weekdays excludes Saturday due date', () => {
  assert.deepEqual(days(continuousReminderPreview('2026-10-31', '09:00', {startDaysBefore:1, frequency:'weekdays'}, now).dates), ['2026-10-30'])
})
test('elapsed times are excluded and reported, without retroactive delivery', () => {
  const result = continuousReminderPreview('2026-10-31', '07:00', {startDaysBefore:1, frequency:'weekdays'}, now)
  assert.equal(result.dates.length,0); assert.equal(result.skippedCount,1)
})
test('no due date gives an empty preview', () => {
  assert.equal(continuousReminderPreview('', '09:00', {startDaysBefore:1, frequency:'daily'}, now).dates.length,0)
})
test('next reminder excludes the first scheduled round', () => {
  const daily = continuousReminderPreview('2026-10-31', '09:00', {startDaysBefore:1, frequency:'daily'}, now)
  assert.deepEqual(days([daily.nextDate!]), ['2026-10-31'])
  const weekdays = continuousReminderPreview('2026-10-31', '09:00', {startDaysBefore:1, frequency:'weekdays'}, now)
  assert.equal(weekdays.nextDate, undefined)
})
test('next reminder remains correct after first round passes and stops after due time', () => {
  const config = {startDaysBefore:1, frequency:'daily' as const}
  assert.deepEqual(days([continuousReminderPreview('2026-10-31', '09:00', config, new Date('2026-10-30T10:00:00+07:00')).nextDate!]), ['2026-10-31'])
  assert.equal(continuousReminderPreview('2026-10-31', '09:00', config, new Date('2026-10-31T10:00:00+07:00')).nextDate, undefined)
})
