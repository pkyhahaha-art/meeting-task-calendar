import test from 'node:test'
import assert from 'node:assert/strict'
import {
  formatThaiFullDate,
  formatThaiShortDate,
  formatTimeRange,
  getMonthWeeks,
  getCurrentCalendarWeekRange,
  filterAndSortMeetingsForSummary,
  summaryPdfLayout,
  type EventRow,
} from './meetingSummary'
import { formatMeetingParticipantPositions, meetingExecutiveOptions, parseMeetingParticipants, serializeMeetingParticipants } from './meetingParticipants'

test('executive participant selections preserve names while summaries show only their positions', () => {
  const selected = serializeMeetingParticipants([meetingExecutiveOptions[0], meetingExecutiveOptions[1], meetingExecutiveOptions[5]])
  assert.deepEqual(parseMeetingParticipants(selected), [meetingExecutiveOptions[0], meetingExecutiveOptions[1], meetingExecutiveOptions[5]])
  assert.equal(formatMeetingParticipantPositions(selected), 'อฝ.ลส., รฝ.ลส.(ว), อก.กร.')
  assert.equal(formatMeetingParticipantPositions('ค่าเดิม'), 'ค่าเดิม')
})

test('PDF layout preserves infographic aspect ratio and uses the image height for page count', () => {
  const onePage = summaryPdfLayout(900, 960, 210, 297)
  assert.equal(onePage.width, 210)
  assert.equal(onePage.height, 224)
  assert.deepEqual(onePage.offsets, [0])
  const tall = summaryPdfLayout(900, 4000, 210, 297)
  assert.ok(Math.abs(tall.height / tall.width - 4000 / 900) < 1e-10)
  assert.deepEqual(tall.offsets, [0, -297, -594, -891])
  assert.throws(() => summaryPdfLayout(0, 960, 210, 297))
})

test('formatThaiFullDate correctly converts YYYY-MM-DD to Thai BE full date', () => {
  assert.equal(formatThaiFullDate('2026-11-05'), '5 พฤศจิกายน 2569')
  assert.equal(formatThaiFullDate('2026-01-01'), '1 มกราคม 2569')
})

test('formatThaiShortDate correctly converts YYYY-MM-DD to Thai BE short date', () => {
  assert.equal(formatThaiShortDate('2026-11-05'), '5 พ.ย. 69')
})

test('formatTimeRange handles all day and regular times', () => {
  assert.deepEqual(formatTimeRange('2026-11-05T09:00:00+07:00', '2026-11-05T12:00:00+07:00', false), {
    startTime: '09:00',
    endTime: '12:00',
    text: '09:00 – 12:00 น.',
  })
  assert.deepEqual(formatTimeRange('2026-11-05T00:00:00+07:00', null, true), {
    startTime: '00:00',
    endTime: '23:59',
    text: 'ตลอดวัน',
  })
  assert.deepEqual(formatTimeRange('2026-11-04T17:00:00Z', '2026-11-04T18:30:00Z'), {
    startTime: '00:00', endTime: '01:30', text: '00:00 – 01:30 น.',
  })
  assert.equal(formatTimeRange('2026-11-04T23:00:00Z').text, '06:00 น.')
})

test('getMonthWeeks returns 4 or 5 week intervals for a month', () => {
  // November has 30 days -> 5 weeks (1-7, 8-14, 15-21, 22-28, 29-30)
  const weeksNov = getMonthWeeks(2026, 10) // Nov is index 10
  assert.equal(weeksNov.length, 5)
  assert.equal(weeksNov[0].startDate, '2026-11-01')
  assert.equal(weeksNov[0].endDate, '2026-11-07')
  assert.equal(weeksNov[4].startDate, '2026-11-29')
  assert.equal(weeksNov[4].endDate, '2026-11-30')

  // February non-leap (28 days) -> 4 weeks
  const weeksFeb = getMonthWeeks(2026, 1)
  assert.equal(weeksFeb.length, 4)
})

test('filterAndSortMeetingsForSummary sorts by date asc then start time asc', () => {
  const mockEvents: EventRow[] = [
    {
      id: 'e1',
      title: 'ประชุมบ่าย วันที่ 5',
      owner_user_id: 'u1',
      creator_name: 'สมชาย',
      description: 'คุยงาน',
      affiliation: 'กกร.',
      start_datetime: '2026-11-05T13:30:00+07:00',
      end_datetime: '2026-11-05T16:30:00+07:00',
      all_day: false,
      location: 'ห้องประชุม 1',
      timezone: 'Asia/Bangkok',
      recurrence_rule: null,
      recurrence_until: null,
      recurrence_count: null,
      status: 'scheduled',
      deleted_at: null,
      notification_requested_at: null,
      initial_notification_requested_at: null,
      suppress_guest_notifications: false,
      mobile_notifications_enabled: false,
      email_notifications_enabled: false,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    },
    {
      id: 'e2',
      title: 'ประชุมเช้า วันที่ 5',
      owner_user_id: 'u1',
      creator_name: 'สมชาย',
      description: 'สัมภาษณ์',
      affiliation: 'กกร.',
      start_datetime: '2026-11-05T09:00:00+07:00',
      end_datetime: '2026-11-05T12:00:00+07:00',
      all_day: false,
      location: 'ห้องประชุม 2',
      timezone: 'Asia/Bangkok',
      recurrence_rule: null,
      recurrence_until: null,
      recurrence_count: null,
      status: 'scheduled',
      deleted_at: null,
      notification_requested_at: null,
      initial_notification_requested_at: null,
      suppress_guest_notifications: false,
      mobile_notifications_enabled: false,
      email_notifications_enabled: false,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    },
    {
      id: 'e3',
      title: 'ประชุมวันที่ 2',
      owner_user_id: 'u1',
      creator_name: 'สมชาย',
      description: 'ติดตามงาน',
      affiliation: 'กกร.',
      start_datetime: '2026-11-02T10:00:00+07:00',
      end_datetime: '2026-11-02T11:30:00+07:00',
      all_day: false,
      location: 'ห้องประชุมใหญ่',
      timezone: 'Asia/Bangkok',
      recurrence_rule: null,
      recurrence_until: null,
      recurrence_count: null,
      status: 'scheduled',
      deleted_at: null,
      notification_requested_at: null,
      initial_notification_requested_at: null,
      suppress_guest_notifications: false,
      mobile_notifications_enabled: false,
      email_notifications_enabled: false,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    },
    {
      id: 'e4-cancelled',
      title: 'ยกเลิกแล้ว',
      owner_user_id: 'u1',
      creator_name: 'สมชาย',
      description: '',
      affiliation: 'กกร.',
      start_datetime: '2026-11-03T10:00:00+07:00',
      end_datetime: null,
      all_day: false,
      location: '',
      timezone: 'Asia/Bangkok',
      recurrence_rule: null,
      recurrence_until: null,
      recurrence_count: null,
      status: 'cancelled',
      deleted_at: null,
      notification_requested_at: null,
      initial_notification_requested_at: null,
      suppress_guest_notifications: false,
      mobile_notifications_enabled: false,
      email_notifications_enabled: false,
      created_at: '2026-11-01T00:00:00Z',
      updated_at: '2026-11-01T00:00:00Z',
    },
  ]

  const rangeStart = new Date('2026-11-01T00:00:00+07:00')
  const rangeEnd = new Date('2026-11-10T23:59:59+07:00')

  const results = filterAndSortMeetingsForSummary(mockEvents, rangeStart, rangeEnd)

  assert.equal(results.length, 3)
  // First should be e3 (Nov 2)
  assert.equal(results[0].eventId, 'e3')
  assert.equal(results[0].dateKey, '2026-11-02')

  // Second should be e2 (Nov 5, 09:00)
  assert.equal(results[1].eventId, 'e2')
  assert.equal(results[1].dateKey, '2026-11-05')
  assert.equal(results[1].startTime, '09:00')

  // Third should be e1 (Nov 5, 13:30)
  assert.equal(results[2].eventId, 'e1')
  assert.equal(results[2].dateKey, '2026-11-05')
  assert.equal(results[2].startTime, '13:30')

  // These UTC dates fall on Nov 4, but both meetings are on Nov 5 in Bangkok.
  const early = [
    { ...mockEvents[0], id: 'early-six', start_datetime: '2026-11-04T23:00:00Z', end_datetime: '2026-11-05T00:00:00Z' },
    { ...mockEvents[0], id: 'midnight', start_datetime: '2026-11-04T17:00:00Z', end_datetime: '2026-11-04T18:00:00Z' },
  ]
  const midnightRangeStart = new Date('2026-11-05T00:00:00+07:00')
  const midnightRangeEnd = new Date('2026-11-06T00:00:00+07:00')
  const summaries = filterAndSortMeetingsForSummary(early, midnightRangeStart, midnightRangeEnd)
  assert.deepEqual(summaries.map((item) => [item.eventId, item.dateKey, item.startTime, item.thaiDate]), [
    ['midnight', '2026-11-05', '00:00', '5 พฤศจิกายน 2569'],
    ['early-six', '2026-11-05', '06:00', '5 พฤศจิกายน 2569'],
  ])
  const cancelled = new Set([`midnight:${Date.parse('2026-11-04T17:00:00Z')}`])
  assert.deepEqual(filterAndSortMeetingsForSummary(early, midnightRangeStart, midnightRangeEnd, cancelled).map((item) => item.eventId), ['early-six'])
})

