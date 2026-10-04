import assert from 'node:assert/strict'
import test from 'node:test'
import { html, subject } from '../../supabase/functions/process-notification-queue/emailTemplate'
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

test('appointment action notices name the exact Bangkok date and remain concise in branded email', () => {
  const payload = { entity: 'meeting', title: '<แผนงาน>', original_occurrence_start: '2026-10-02T17:30:00Z',
    new_occurrence_start: '2026-10-01T17:30:00Z', description: 'PRIVATE AGENDA',
    affiliation: 'ฝ่ายแผนงาน', start_datetime: '2026-10-03T02:00:00Z', end_datetime: '2026-10-03T03:00:00Z', location: 'ห้อง 7',
    recurrence_rule: 'FREQ=WEEKLY;COUNT=4', ack_url: 'https://example.test/ack',
    meeting_documents: [{ name: 'PRIVATE DOCUMENT', url: 'https://example.test/private' }] }
  assert.equal(subject('meeting_occurrence_cancelled', payload), 'ยกเลิกประชุม «<แผนงาน>» วันที่ 3 ต.ค. เวลา 00:30 น.')
  assert.equal(subject('meeting_occurrence_moved', payload), 'ย้ายประชุม «<แผนงาน>» จากวันที่ 3 ต.ค. เป็นวันที่ 2 ต.ค. เวลา 00:30 น.')
  for (const template of ['meeting_occurrence_cancelled', 'meeting_occurrence_moved']) {
    const card = html(template, payload, 'https://example.github.io/calendar/')
    assert.ok(card.includes(subject(template, { ...payload, title: '&lt;แผนงาน&gt;' })))
    assert.match(card, /pea-mail-mascot-v1\.png|PEA MEETING &amp; TASK CALENDAR/)
    for (const text of ['PRIVATE AGENDA', 'PRIVATE DOCUMENT', 'ฝ่ายแผนงาน', 'ห้อง 7', 'วันและเวลาเริ่ม', 'วันและเวลาสิ้นสุด', 'วาระการประชุม']) assert.ok(card.includes(text), text)
    assert.match(card, /href="https:\/\/example\.test\/private"/)
    assert.doesNotMatch(card, /FREQ|ทุกสัปดาห์|>รับทราบ|example\.test\/ack|แบบไม่ทำซ้ำ|ยังคงเดิม/)
  }
  assert.equal(subject('meeting_occurrence_cancelled', { ...payload, all_day: true }), 'ยกเลิกประชุม «<แผนงาน>» วันที่ 3 ต.ค.')
  assert.match(subject('meeting_occurrence_moved', { ...payload, original_occurrence_start: '2026-12-31T02:00:00Z', new_occurrence_start: '2027-01-01T02:00:00Z' }), /31 ธ\.ค\. 2569 เป็นวันที่ 1 ม\.ค\. 2570/)
})
