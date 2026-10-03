import assert from 'node:assert/strict'
import test from 'node:test'
import { html } from '../../supabase/functions/process-notification-queue/emailTemplate'
import { internalMeetingUrl } from '../../supabase/functions/process-notification-queue/meetingLink'

test('creates a hash-router link to a Meeting', () => {
  assert.equal(
    internalMeetingUrl('https://example.github.io/meeting-task-calendar', 'event id'),
    'https://example.github.io/meeting-task-calendar#/calendar?event=event%20id',
  )
})

test('renders a complete Meeting HTML card with secure document links', () => {
  const card = html('meeting_guest_added', {
    entity: 'meeting',
    title: '<Quarterly Planning>',
    description: 'Review roadmap & risks',
    affiliation: 'กคน.ฝลส.',
    organizer: 'สมชาย <owner@gmail.com>',
    start_datetime: '2026-09-23T02:00:00.000Z',
    end_datetime: '2026-09-23T03:00:00.000Z',
    location: 'Room 1',
    recurrence_rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
    status: 'scheduled',
    ack_url: 'https://project.supabase.co/functions/v1/email-acknowledgement?token=scoped',
    meeting_documents: [
      { name: '<agenda>.pdf', size: 1048576, url: 'https://files.example.com/download/agenda' },
      { name: 'Google Drive วาระประชุม', url: 'https://drive.google.com/drive/folders/example', kind: 'drive' },
    ],
  }, 'https://example.github.io/meeting-task-calendar/?private=discard#/calendar')

  assert.match(card, /MEETING &amp; TASK CALENDAR/)
  assert.match(card, /src="https:\/\/example.github.io\/meeting-task-calendar\/email-assets\/pea-mail-mascot-v1.png"/)
  assert.match(card, /alt="มาสคอต PEA ถือซองจดหมาย"/)
  assert.match(card, /src="https:\/\/example.github.io\/meeting-task-calendar\/email-assets\/pea-logo.png"/)
  assert.doesNotMatch(card, /private=discard|data:image|display:flex/)
  assert.match(card, /&lt;Quarterly Planning&gt;/)
  assert.match(card, /Review roadmap &amp; risks/)
  assert.match(card, /สมชาย &lt;owner@gmail.com&gt;/)
  assert.match(card, /หน่วยงาน \/ สังกัด/)
  assert.match(card, /กคน\.ฝลส\./)
  assert.match(card, /ทุก 2 สัปดาห์ \(จันทร์, พุธ\)/)
  assert.match(card, /เอกสารและลิงก์ Google Drive \(2\)/)
  assert.match(card, /&lt;agenda&gt;\.pdf/)
  assert.match(card, /1\.0 MB/)
  assert.match(card, /href="https:\/\/project\.supabase\.co\/functions\/v1\/email-acknowledgement\?token=scoped"[^>]*>รับทราบ<\/a>/)
  assert.match(card, /หากปุ่มรับทราบใช้งานไม่ได้/)
  assert.match(card, /target="_blank"/)
  assert.match(card, /https:\/\/files\.example\.com\/download\/agenda/)
  assert.match(card, /href="https:\/\/drive\.google\.com\/drive\/folders\/example"/)
  assert.doesNotMatch(card, /เปิดรายละเอียด Meeting/)
  assert.doesNotMatch(card, /<Quarterly Planning>/)
})

test('email branding falls back to readable PEA text without a secure app URL', () => {
  for (const base of ['', 'javascript:alert(1)', 'http://localhost:5173/']) {
    const card = html('task_created', { entity: 'task', title: 'งานใหม่' }, base)
    assert.match(card, />PEA<\/span>/)
    assert.match(card, /งานใหม่/)
    assert.doesNotMatch(card, /<img|javascript:|localhost/)
  }
})
