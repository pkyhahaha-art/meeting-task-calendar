import assert from 'node:assert/strict'
import test from 'node:test'
import { meetingSaveId, saveMeetingWithFollowUp, type MeetingSaveAttempt } from './meetingSave'

test('an ambiguous create response is retried with the same meeting ID', async () => {
  const attempt = { current: null as MeetingSaveAttempt }
  const saved = new Map<string, string>()
  let loseResponse = true
  let followUps = 0
  const save = async (id: string) => {
    saved.set(id, 'Meeting')
    if (loseResponse) { loseResponse = false; throw new Error('Connection lost after commit') }
    return id
  }
  const firstId = meetingSaveId(undefined, 'creator', attempt, () => 'meeting-1')
  await assert.rejects(saveMeetingWithFollowUp(firstId, save, async () => { followUps++ }))
  const retryId = meetingSaveId(undefined, 'creator', attempt, () => 'meeting-2')
  const result = await saveMeetingWithFollowUp(retryId, save, async () => { followUps++ })
  assert.equal(saved.size, 1)
  assert.equal(result.eventId, firstId)
  assert.equal(followUps, 1)
  assert.equal(result.warning, '')
})

test('a core save failure does not upload files or queue confirmations', async () => {
  let followUpCalled = false
  await assert.rejects(saveMeetingWithFollowUp('meeting-1', async () => {
    throw new Error('Reminder validation failed')
  }, async () => { followUpCalled = true }), /Reminder validation failed/)
  assert.equal(followUpCalled, false)
})

test('an attachment failure after saving returns a saved warning instead of a create retry', async () => {
  const result = await saveMeetingWithFollowUp('meeting-1', async (id) => id, async () => {
    throw new Error('Attachment upload failed')
  })
  assert.equal(result.eventId, 'meeting-1')
  assert.match(result.warning, /บันทึกการประชุมแล้ว/)
  assert.match(result.warning, /Attachment upload failed/)
})

test('a notification failure after saving is reported without rejecting the meeting save', async () => {
  const result = await saveMeetingWithFollowUp('meeting-1', async (id) => id, async () => {
    throw new Error('Notification queue temporarily unavailable')
  })
  assert.match(result.warning, /บันทึกการประชุมแล้ว/)
  assert.match(result.warning, /Notification queue temporarily unavailable/)
})

test('existing meetings keep their ID and new attempts do not cross accounts', () => {
  const attempt = { current: null as MeetingSaveAttempt }
  assert.equal(meetingSaveId('existing', 'creator', attempt, () => 'unused'), 'existing')
  assert.equal(attempt.current, null)
  assert.equal(meetingSaveId(undefined, 'creator', attempt, () => 'first'), 'first')
  assert.equal(meetingSaveId(undefined, 'other-creator', attempt, () => 'second'), 'second')
  attempt.current = null
  assert.equal(meetingSaveId(undefined, 'other-creator', attempt, () => 'third'), 'third')
})
