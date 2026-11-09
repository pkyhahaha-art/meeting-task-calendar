import test from 'node:test'
import assert from 'node:assert/strict'
import {
  meetingOccurrenceKey,
  isMeetingCompleted,
  isMeetingPendingConfirmation,
  isMeetingAppointmentPassed,
  getMeetingStatus,
  getMeetingColors,
  sanitizeMeetingSummaryHtml,
  getMeetingSummaryVisibleText,
  hasMeetingSummary,
} from './meetingCompletion.js'

test('meetingOccurrenceKey normalizes event ID and occurrence timestamp', () => {
  const key = meetingOccurrenceKey('event-123', '2026-11-01T09:00:00+07:00')
  assert.equal(key, 'event-123:2026-11-01T09:00:00')
})

test('isMeetingCompleted correctly detects completed occurrences', () => {
  const completed = new Set(['event-1:2026-11-01T09:00:00'])
  assert.equal(isMeetingCompleted(completed, 'event-1', '2026-11-01T09:00:00+07:00'), true)
  assert.equal(isMeetingCompleted(completed, 'event-1', '2026-11-02T09:00:00+07:00'), false)
  assert.equal(isMeetingCompleted(completed, 'event-2', '2026-11-01T09:00:00+07:00'), false)
})

test('isMeetingPendingConfirmation flags past uncompleted meetings but not completed or future ones', () => {
  const now = new Date('2026-11-05T12:00:00+07:00')
  
  // Past date, not completed -> pending confirmation
  assert.equal(isMeetingPendingConfirmation(false, '2026-11-01T09:00:00+07:00', now), true)
  
  // Past date, but completed -> NOT pending
  assert.equal(isMeetingPendingConfirmation(true, '2026-11-01T09:00:00+07:00', now), false)
  
  // Future date, not completed -> NOT pending
  assert.equal(isMeetingPendingConfirmation(false, '2026-11-10T09:00:00+07:00', now), false)
})

test('getMeetingStatus returns 3 clear states: completed, pending_confirmation, upcoming', () => {
  const now = new Date('2026-11-05T12:00:00+07:00')
  
  assert.equal(getMeetingStatus(true, '2026-11-01T09:00:00+07:00', now), 'completed')
  assert.equal(getMeetingStatus(false, '2026-11-01T09:00:00+07:00', now), 'pending_confirmation')
  assert.equal(getMeetingStatus(false, '2026-11-10T09:00:00+07:00', now), 'upcoming')
})

test('getMeetingColors gives distinct green, amber, and purple hues', () => {
  const completedColors = getMeetingColors('completed')
  assert.equal(completedColors.backgroundColor, '#dcf8e9')
  assert.equal(completedColors.textColor, '#166534')

  const pendingColors = getMeetingColors('pending_confirmation')
  assert.equal(pendingColors.backgroundColor, '#ffedd5')
  assert.equal(pendingColors.textColor, '#9a3412')

  const ownerUpcomingColors = getMeetingColors('upcoming', true)
  assert.equal(ownerUpcomingColors.backgroundColor, '#edddf6')
  assert.equal(ownerUpcomingColors.textColor, '#6b2170')

  const guestUpcomingColors = getMeetingColors('upcoming', false)
  assert.equal(guestUpcomingColors.backgroundColor, '#f1e7fa')
  assert.equal(guestUpcomingColors.textColor, '#6b2170')
})

test('isMeetingAppointmentPassed correctly checks whether appointment has arrived or passed', () => {
  const now = new Date('2026-11-05T12:00:00+07:00')

  // Null/missing events
  assert.equal(isMeetingAppointmentPassed(null, null, now), false)
  assert.equal(isMeetingAppointmentPassed(undefined, undefined, now), false)

  // Timed event in the past
  assert.equal(isMeetingAppointmentPassed({ start_datetime: '2026-11-05T09:00:00+07:00', all_day: false }, null, now), true)
  assert.equal(isMeetingAppointmentPassed({ start_datetime: '2026-11-01T09:00:00+07:00', all_day: false }, null, now), true)

  // Timed event at exact current time
  assert.equal(isMeetingAppointmentPassed({ start_datetime: '2026-11-05T12:00:00+07:00', all_day: false }, null, now), true)

  // Timed event in the future
  assert.equal(isMeetingAppointmentPassed({ start_datetime: '2026-11-05T14:00:00+07:00', all_day: false }, null, now), false)
  assert.equal(isMeetingAppointmentPassed({ start_datetime: '2026-11-10T09:00:00+07:00', all_day: false }, null, now), false)

  // All-day event today or past
  assert.equal(isMeetingAppointmentPassed({ start_datetime: '2026-11-05T00:00:00+07:00', all_day: true }, null, now), true)
  assert.equal(isMeetingAppointmentPassed({ start_datetime: '2026-11-01T00:00:00+07:00', all_day: true }, null, now), true)

  // All-day event in the future
  assert.equal(isMeetingAppointmentPassed({ start_datetime: '2026-11-06T00:00:00+07:00', all_day: true }, null, now), false)

  // Recurring occurrence overrides series root start
  const seriesEvent = { start_datetime: '2026-10-01T09:00:00+07:00', all_day: false }
  // Future occurrence of a series that started in the past
  assert.equal(isMeetingAppointmentPassed(seriesEvent, '2026-11-12T09:00:00+07:00', now), false)
  // Past occurrence of the series
  assert.equal(isMeetingAppointmentPassed(seriesEvent, '2026-10-15T09:00:00+07:00', now), true)
})

test('sanitizeMeetingSummaryHtml preserves allowed formatting and removes disallowed attributes and tags', () => {
  const dirty = '<p class="bold">ข้อความสรุป</p><script>alert(1)</script><div style="color:red">บรรทัดที่สอง</div><strong>สำคัญ</strong> <em>เน้น</em> <u>ขีดเส้นใต้</u><ul><li>ข้อ 1</li><li>ข้อ 2</li></ul>'
  const sanitized = sanitizeMeetingSummaryHtml(dirty)
  assert.ok(!sanitized.includes('script'))
  assert.ok(!sanitized.includes('style'))
  assert.ok(!sanitized.includes('class'))
  assert.ok(sanitized.includes('ข้อความสรุป'))
  assert.ok(sanitized.includes('<strong>สำคัญ</strong>'))
  assert.ok(sanitized.includes('<em>เน้น</em>'))
  assert.ok(sanitized.includes('<u>ขีดเส้นใต้</u>'))
  assert.ok(sanitized.includes('<ul><li>ข้อ 1</li><li>ข้อ 2</li></ul>'))
})

test('hasMeetingSummary and getMeetingSummaryVisibleText correctly detect presence of actual text', () => {
  assert.equal(hasMeetingSummary(''), false)
  assert.equal(hasMeetingSummary('<p></p>'), false)
  assert.equal(hasMeetingSummary('<p>&nbsp;   <br></p>'), false)
  assert.equal(hasMeetingSummary('<p>สรุปการประชุมมติเห็นชอบ</p>'), true)
  assert.equal(getMeetingSummaryVisibleText('<p><strong>สรุปผล:</strong> ผ่าน</p>'), 'สรุปผล: ผ่าน')
})


