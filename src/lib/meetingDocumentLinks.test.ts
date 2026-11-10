import test from 'node:test'
import assert from 'node:assert/strict'
import { planMeetingDocumentLinkChanges, requireUpdatedMeetingLink } from './meetingDocumentLinks'
import { saveMeetingWithFollowUp } from './meetingSave'

test('meeting link changes preserve existing IDs and target only explicit removals', () => {
  const plan = planMeetingDocumentLinkChanges([
    { id: 'imported', displayName: 'Calendar', url: 'https://example.com', originalDisplayName: 'Calendar', originalUrl: 'https://example.com' },
    { id: 'edited', displayName: 'Updated', url: 'https://example.org', originalDisplayName: 'Old', originalUrl: 'https://example.org' },
    { id: 'cleared', displayName: '', url: ' ', originalDisplayName: 'Old', originalUrl: 'https://example.net' },
    { displayName: '', url: ' https://example.edu ' },
  ], ['removed'])
  assert.deepEqual(plan.deletedIds, ['removed', 'cleared'])
  assert.deepEqual(plan.updates, [{ id: 'edited', display_name: 'Updated', url: 'https://example.org' }])
  assert.deepEqual(plan.inserts, [{ display_name: 'ลิงก์เอกสาร / เว็บไซต์', url: 'https://example.edu' }])
})

test('empty selection does not delete links added concurrently by a Calendar sync', () => {
  assert.deepEqual(planMeetingDocumentLinkChanges([]), { deletedIds: [], updates: [], inserts: [] })
})

test('a link removed by a concurrent sync produces a conflict instead of silently succeeding', () => {
  assert.throws(() => requireUpdatedMeetingLink([], null), /ลิงก์ถูกเปลี่ยนหรือลบระหว่างแก้ไข/)
  assert.throws(() => requireUpdatedMeetingLink(null, new Error('database failure')), /แก้ไขลิงก์เอกสารไม่สำเร็จ/)
  assert.doesNotThrow(() => requireUpdatedMeetingLink([{ id: 'existing' }], null))
})

test('the meeting save warns when a concurrent sync removed the edited link', async () => {
  const result = await saveMeetingWithFollowUp('meeting', async (id) => id, async () => {
    requireUpdatedMeetingLink([], null)
  })
  assert.match(result.warning, /ลิงก์ถูกเปลี่ยนหรือลบระหว่างแก้ไข/)
})
