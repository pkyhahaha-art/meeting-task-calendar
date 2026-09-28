import assert from 'node:assert/strict'
import test from 'node:test'
import { internalTaskUrl } from '../../supabase/functions/process-notification-queue/taskLink'
import { html } from '../../supabase/functions/process-notification-queue/emailTemplate'
import { taskDocumentItems } from '../../supabase/functions/process-notification-queue/taskDocuments'

test('creates a hash-router link to the assigned task', () => {
  assert.equal(
    internalTaskUrl('https://example.github.io/meeting-task-calendar', 'task id'),
    'https://example.github.io/meeting-task-calendar#/calendar?task=task%20id',
  )
})

test('Task email opens Drive directly and keeps acknowledgement separate from the Task page', () => {
  const taskDocuments = taskDocumentItems(
    [{ file_name: 'report.pdf' }],
    [{ display_name: 'Drive folder', url: 'https://drive.google.com/drive/folders/example' }],
  )
  const card = html('task_assigned', {
    entity: 'task',
    title: 'Prepare report',
    ack_url: 'https://project.supabase.co/functions/v1/email-acknowledgement?token=scoped',
    task_documents: taskDocuments,
  })

  assert.match(card, /href="https:\/\/drive\.google\.com\/drive\/folders\/example"/)
  assert.match(card, /Google Drive: <a href="https:\/\/drive\.google\.com\/drive\/folders\/example"/)
  assert.doesNotMatch(card, /เปิด Task \/ ดาวน์โหลดเอกสาร/)
  assert.match(card, /href="https:\/\/project\.supabase\.co\/functions\/v1\/email-acknowledgement\?token=scoped"[^>]*>รับทราบ<\/a>/)
  assert.match(card, /หากปุ่มรับทราบใช้งานไม่ได้/)
  assert.doesNotMatch(card, /อัปโหลดเอกสาร/)
})
