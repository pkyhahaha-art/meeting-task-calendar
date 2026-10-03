import assert from 'node:assert/strict'
import test from 'node:test'
import { html, subject } from '../../supabase/functions/process-notification-queue/emailTemplate'
import { initialExternalRecipients } from '../../supabase/functions/external-task/recipients'

test('creator confirmations explicitly confirm creation of Task and Meeting', () => {
  for (const entity of ['task', 'meeting']) {
    const label = entity === 'task' ? 'Task' : 'Meeting'
    const template = `${entity}_created`
    assert.equal(subject(template, { title: 'Review' }), `คุณได้สร้าง ${label} แล้ว: Review`)
    const card = html(template, { entity, title: 'Review', description: 'Details' })
    assert.match(card, new RegExp(`คุณได้สร้าง ${label} แล้ว`))
    assert.match(card, /Review/)
    assert.match(card, /Details/)
    assert.doesNotMatch(card, /คุณได้รับมอบหมาย|คุณได้รับเชิญ|>รับทราบ<\/a>/)
  }
  assert.equal(subject('task_assigned', { title: 'Review' }), 'คุณได้รับมอบหมาย Task: Review')
  assert.equal(subject('meeting_guest_added', { title: 'Review' }), 'คุณได้รับเชิญเข้าร่วม Meeting: Review')
})

test('initial external invitations exclude creator and existing internal recipients by normalized email', () => {
  assert.deepEqual(initialExternalRecipients(
    [' OWNER@gmail.com ', 'internal@gmail.com', 'guest@gmail.com', 'GUEST@gmail.com'],
    'owner@GMAIL.com', [' Internal@gmail.com '],
  ), ['guest@gmail.com'])
  assert.deepEqual(initialExternalRecipients(['owner@gmail.com'], 'owner@gmail.com', []), [])
})
