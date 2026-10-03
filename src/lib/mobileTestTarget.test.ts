import assert from 'node:assert/strict'
import test from 'node:test'
import { mobileTestTarget } from '../../supabase/functions/_shared/mobileTestTarget'

const device = { id: '11111111-1111-1111-1111-111111111111', user_id: 'owner',
  endpoint: 'https://web.push.apple.com/device', auth: 'existing-device-secret', p256dh: 'key' }

test('a signed-in owner can test their device; another account or anonymous ID cannot', async () => {
  assert.equal(await mobileTestTarget({ subscriptionId: device.id }, 'owner', async () => device), device)
  assert.equal(await mobileTestTarget({ subscriptionId: device.id }, 'other', async () => device), null)
  assert.equal(await mobileTestTarget({ subscriptionId: device.id }, null, async () => device), null)
})

test('a paired phone can test itself with its existing secret without a calendar login', async () => {
  assert.equal(await mobileTestTarget({ endpoint: device.endpoint, auth: device.auth }, null, async (target) => {
    assert.deepEqual(target, { endpoint: device.endpoint, auth: device.auth })
    return device
  }), device)
})

test('wrong secrets, other endpoints, and arbitrary outbound URLs cannot request a test', async () => {
  assert.equal(await mobileTestTarget({ endpoint: device.endpoint, auth: 'wrong-secret-of-device' }, null, async () => device), null)
  assert.equal(await mobileTestTarget({ endpoint: 'https://web.push.apple.com/other', auth: device.auth }, null, async () => device), null)
  assert.equal(await mobileTestTarget({ endpoint: 'https://attacker.example/', auth: device.auth }, null, async () => { throw new Error('must not look up arbitrary endpoints') }), null)
  assert.equal(await mobileTestTarget({}, null, async () => device), null)
})
