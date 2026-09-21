import assert from 'node:assert/strict'
import test from 'node:test'
import { internalTaskUrl } from '../../supabase/functions/process-notification-queue/taskLink'

test('creates a hash-router link to the assigned task', () => {
  assert.equal(
    internalTaskUrl('https://example.github.io/meeting-task-calendar', 'task id'),
    'https://example.github.io/meeting-task-calendar#/calendar?task=task%20id',
  )
})
