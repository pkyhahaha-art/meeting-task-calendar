import assert from 'node:assert/strict'
import test from 'node:test'
import { retryDelayMinutes } from '../../supabase/functions/process-notification-queue/retry'

test('uses the PRD retry schedule and stops after three retries', () => {
  assert.equal(retryDelayMinutes(1), 5)
  assert.equal(retryDelayMinutes(2), 15)
  assert.equal(retryDelayMinutes(3), 30)
  assert.equal(retryDelayMinutes(4), null)
})
