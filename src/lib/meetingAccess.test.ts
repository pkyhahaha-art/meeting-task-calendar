import assert from 'node:assert/strict'
import test from 'node:test'
import { canManageMeeting, meetingCreateArgs } from './meetingAccess.js'

test('meeting creation delegates ownership to the database', () => {
  const args = meetingCreateArgs({
    title: 'Planning',
    description: 'Quarterly plan',
    location: 'Room 1',
    affiliation: 'กคน.ฝลส.',
    all_day: false,
    start_datetime: '2026-09-23T02:00:00.000Z',
    end_datetime: '2026-09-23T03:00:00.000Z',
    recurrence_rule: null,
  })

  assert.equal('owner_user_id' in args, false)
  assert.deepEqual(args, {
    target_title: 'Planning',
    target_description: 'Quarterly plan',
    target_location: 'Room 1',
    target_affiliation: 'กคน.ฝลส.',
    target_all_day: false,
    target_start_datetime: '2026-09-23T02:00:00.000Z',
    target_end_datetime: '2026-09-23T03:00:00.000Z',
    target_recurrence_rule: null,
  })
})

test('meeting management is limited to the owner or an admin', () => {
  assert.equal(canManageMeeting(undefined, 'employee-1', 'user'), true)
  assert.equal(canManageMeeting('employee-1', 'employee-1', 'user'), true)
  assert.equal(canManageMeeting('employee-1', 'employee-2', 'user'), false)
  assert.equal(canManageMeeting('employee-1', 'admin-1', 'admin'), true)
  assert.equal(canManageMeeting('employee-1', undefined, undefined), false)
})
