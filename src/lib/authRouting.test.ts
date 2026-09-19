import assert from 'node:assert/strict'
import test from 'node:test'
import { homePathForRole } from './authRouting.js'

test('routes admins to system settings', () => {
  assert.equal(homePathForRole('admin'), '/admin')
})

test('routes employees and unknown profiles to calendar', () => {
  assert.equal(homePathForRole('user'), '/calendar')
  assert.equal(homePathForRole(), '/calendar')
})
