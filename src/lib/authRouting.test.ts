import assert from 'node:assert/strict'
import test from 'node:test'
import { homePathForRole } from './authRouting.js'

test('opens the calendar by default for every role', () => {
  assert.equal(homePathForRole(), '/calendar')
})
