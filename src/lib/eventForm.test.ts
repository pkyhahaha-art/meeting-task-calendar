import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bangkokDate,
  endOfYearBangkokDate,
  formatDisplayDate,
  invalidGuestEmails,
  isMeetingReminderKeyPast,
  isPastBangkokDate,
  meetingRecurrenceFromRule,
  meetingRecurrenceRule,
  meetingRecurrenceSummary,
  meetingReminderKeysFromTemplates,
  meetingReminderOptionLabel,
  meetingReminderStatus,
  pastMeetingReminderKeys,
  parseDisplayDate,
  parseGuestEmails,
  recurrenceFromRule,
  recurrenceRule,
  reminderDate,
} from './eventForm.js'

test('parses and deduplicates guest emails', () => {
  assert.deepEqual(parseGuestEmails('A@gmail.com, b@gmail.com\na@gmail.com'), ['a@gmail.com', 'b@gmail.com'])
  assert.deepEqual(parseGuestEmails(['A@gmail.com', '', 'a@gmail.com', 'b@gmail.com']), ['a@gmail.com', 'b@gmail.com'])
  assert.deepEqual(invalidGuestEmails('good@gmail.com bad-email'), ['bad-email'])
})

test('generates clear meeting recurrence summaries in Thai and English', () => {
  assert.equal(
    meetingRecurrenceSummary({ frequency: 'none', interval: 1, weekdays: [], until: '', count: null }, '2026-10-05'),
    'ไม่ทำซ้ำ (นัดหมายครั้งเดียว)',
  )
  assert.equal(
    meetingRecurrenceSummary(
      { frequency: 'week', interval: 1, weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'], until: '2026-12-31', count: null },
      '2026-10-05',
      '09:00',
      '10:00',
      'th',
    ),
    'ทำซ้ำทุกวันทำงาน (จันทร์ – ศุกร์) เวลา 09:00 - 10:00 น. จนถึงวันที่ 31/12/2026',
  )
  assert.equal(
    meetingRecurrenceSummary(
      { frequency: 'week', interval: 1, weekdays: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'], until: '2026-12-31', count: null },
      '2026-10-05',
      '09:00',
      '10:00',
      'th',
    ),
    'ทำซ้ำทุกวัน (จันทร์ – อาทิตย์) เวลา 09:00 - 10:00 น. จนถึงวันที่ 31/12/2026',
  )
  assert.equal(
    meetingRecurrenceSummary(
      { frequency: 'week', interval: 1, weekdays: ['WE'], until: '', count: 8 },
      '2026-10-05',
      '13:30',
      '15:00',
      'th',
    ),
    'ทำซ้ำทุกสัปดาห์ (วันพ) เวลา 13:30 - 15:00 น. รวมทั้งหมด 8 ครั้ง',
  )
  assert.equal(endOfYearBangkokDate('2026-10-05'), '2026-12-31')
})

test('maps recurrence values both ways', () => {
  assert.equal(recurrenceRule('weekdays'), 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
  assert.equal(recurrenceFromRule('FREQ=MONTHLY'), 'monthly')
})

test('maps custom Meeting recurrences to and from an RRULE', () => {
  const recurrence = { frequency: 'week' as const, interval: 2, weekdays: ['MO', 'WE'] as const, until: '2026-12-31', count: 12 }
  assert.equal(meetingRecurrenceRule(recurrence), 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE')
  assert.deepEqual(
    meetingRecurrenceFromRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', '2026-09-28', '2026-12-31T16:59:59.999Z', 12),
    recurrence,
  )
})

test('calculates reminder schedule from event start', () => {
  const start = new Date('2027-03-19T09:00:00+07:00')
  assert.equal(reminderDate(start, '0:minute').toISOString(), '2027-03-19T02:00:00.000Z')
  assert.equal(reminderDate(start, '3:day').toISOString(), '2027-03-16T02:00:00.000Z')
})

test('cancels a Meeting reminder that was already due when it is saved', () => {
  const now = new Date('2026-09-29T05:33:00.000Z')
  assert.equal(meetingReminderStatus(new Date('2026-09-28T05:50:00.000Z'), now), 'cancelled')
  assert.equal(meetingReminderStatus(new Date('2026-09-29T05:50:00.000Z'), now), 'scheduled')
})

test('identifies every selected reminder that would be skipped', () => {
  const start = new Date('2026-09-29T05:50:00.000Z')
  const now = new Date('2026-09-29T05:33:00.000Z')
  assert.deepEqual(pastMeetingReminderKeys(start, ['1:day', '0:minute'], now), ['1:day'])
})

test('keeps only unique base reminders when editing a recurring Meeting', () => {
  assert.deepEqual(meetingReminderKeysFromTemplates([
    { occurrenceId: null, offsetValue: 3, offsetUnit: 'day' },
    { occurrenceId: 'first-occurrence', offsetValue: 3, offsetUnit: 'day' },
    { occurrenceId: 'second-occurrence', offsetValue: 3, offsetUnit: 'day' },
    { occurrenceId: null, offsetValue: 3, offsetUnit: 'day' },
  ]), ['3:day'])
})

test('flags dates before today in Bangkok', () => {
  const now = new Date('2027-03-19T02:00:00.000Z')
  assert.equal(bangkokDate(now), '2027-03-19')
  assert.equal(isPastBangkokDate('2027-03-18T09:00', now), true)
  assert.equal(isPastBangkokDate('2027-03-19T00:00', now), false)
  assert.equal(isPastBangkokDate('2027-03-20', now), false)
})

test('converts valid dates between ISO and dd/mm/yyyy', () => {
  assert.equal(formatDisplayDate('2026-09-28'), '28/09/2026')
  assert.equal(parseDisplayDate('28/09/2026'), '2026-09-28')
  assert.equal(parseDisplayDate('1/2/2028'), '2028-02-01')
  assert.equal(parseDisplayDate('29/02/2028'), '2028-02-29')
  assert.equal(parseDisplayDate('29/02/2027'), null)
  assert.equal(parseDisplayDate('31/04/2026'), null)
  assert.equal(parseDisplayDate('2026-09-28'), null)
})

test('identifies past meeting reminder keys correctly', () => {
  // Current time: 2026-10-02 11:37:00 Bangkok (04:37:00 UTC)
  const now = new Date('2026-10-02T04:37:00.000Z')

  // Meeting today at 14:00 (07:00 UTC)
  const meetingTodayAfternoon = new Date('2026-10-02T07:00:00.000Z')
  assert.equal(isMeetingReminderKeyPast(meetingTodayAfternoon, '1:month', now), true)
  assert.equal(isMeetingReminderKeyPast(meetingTodayAfternoon, '1:week', now), true)
  assert.equal(isMeetingReminderKeyPast(meetingTodayAfternoon, '3:day', now), true)
  assert.equal(isMeetingReminderKeyPast(meetingTodayAfternoon, '1:day', now), true)
  assert.equal(isMeetingReminderKeyPast(meetingTodayAfternoon, '0:minute', now), false)

  assert.equal(meetingReminderOptionLabel('1:day', 'th'), '1 วันก่อน')
  assert.equal(meetingReminderOptionLabel('0:minute', 'th'), 'เมื่อถึงเวลานัด')
})
