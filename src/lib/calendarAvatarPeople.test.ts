import test from 'node:test'
import assert from 'node:assert/strict'
import { avatarGuestEmails } from './calendarAvatarPeople'
import type { Database } from './database.types'
const guest: Database['public']['Tables']['event_guests']['Row'] = { id:'g', event_id:'e', occurrence_id:null, email:'Member@example.com', revoked_at:null, acknowledged_at:null, created_at:'2026-10-01', self_join_from:null, self_join_until:null, attendance_history:[] }
const at = '2026-10-20T09:00:00+07:00'
test('series membership includes the selected boundary, never earlier appointments', () => {
  const member = {...guest, self_join_from:at}
  assert.equal(avatarGuestEmails([member], [], 'o', at).size, 1)
  assert.equal(avatarGuestEmails([member], [], 'o', '2026-10-19T09:00:00+07:00').size, 0)
})
test('single occurrence membership does not leak into other appointments', () => {
  assert.equal(avatarGuestEmails([{...guest, occurrence_id:'o'}], [], 'o', at).size, 1)
  assert.equal(avatarGuestEmails([{...guest, occurrence_id:'o'}], [], 'other', at).size, 0)
})
test('exclusions and revocation hide series attendees', () => {
  assert.equal(avatarGuestEmails([guest], [{occurrence_id:'o', email:'member@example.com', created_at:at}], 'o', at).size, 0)
  assert.equal(avatarGuestEmails([{...guest, revoked_at:at}], [], 'o', at).size, 0)
})
test('historical membership remains visible only within its recorded dates', () => {
  const member = {...guest, self_join_from:'2026-11-01T00:00:00+07:00', attendance_history:[{from:'2026-10-01T00:00:00+07:00', until:at}]}
  assert.equal(avatarGuestEmails([member], [], 'o', at).size, 1)
  assert.equal(avatarGuestEmails([member], [], 'o', '2026-10-21T00:00:00+07:00').size, 0)
})
test('emails are deduplicated and invalid dates do not infer attendance', () => {
  assert.deepEqual([...avatarGuestEmails([guest, {...guest, email:'member@example.com'}], [], 'o', at)], ['member@example.com'])
  assert.equal(avatarGuestEmails([guest], [], 'o', undefined).size, 0)
})
