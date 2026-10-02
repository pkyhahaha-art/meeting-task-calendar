import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { deliverWebPush, isPushEndpoint, type VapidConfig, type PushRequest } from '../../supabase/functions/_shared/webPushDelivery'

const require = createRequire(import.meta.url)
const webpush = require('web-push') as { generateVAPIDKeys(): { publicKey: string; privateKey: string }; generateRequestDetails: Parameters<typeof deliverWebPush>[3] }
const ece = require('http_ece') as { decrypt(buffer: Buffer, parameters: Record<string, unknown>): Buffer }

test('restricts outgoing URLs to known push services and refuses credentials and redirects', () => {
  assert.equal(isPushEndpoint('https://web.push.apple.com/Qtest'), true)
  assert.equal(isPushEndpoint('https://fcm.googleapis.com/fcm/send/test'), true)
  for (const url of ['http://web.push.apple.com/test', 'https://127.0.0.1/', 'https://web.push.apple.com.evil.example/', 'https://user:password@web.push.apple.com/', 'https://web.push.apple.com:8443/']) assert.equal(isPushEndpoint(url), false)
})

test('produces encrypted payload that the registered device key can decrypt', async () => {
  const device = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = device.privateKey.export({ format: 'jwk' })
  const p256dh = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, 'base64url'), Buffer.from(jwk.y!, 'base64url')]).toString('base64url')
  const auth = randomBytes(16).toString('base64url')
  const config: VapidConfig = { ...webpush.generateVAPIDKeys(), subject: 'https://example.com/' }
  const message = { title: 'ทดสอบ PEA', body: 'ถึงเวลาประชุม', url: 'https://example.com/#/calendar' }
  let details: PushRequest | undefined
  const result = await deliverWebPush({ id: 'device', user_id: 'owner', endpoint: 'https://web.push.apple.com/test', p256dh, auth }, message, config, (sub, payload, options) => {
    details = webpush.generateRequestDetails(sub, payload, options)
    return details
  }, (async (_url, init) => {
    assert.equal(init?.redirect, 'error')
    assert.ok(init?.signal)
    return new Response(null, { status: 201 })
  }) as typeof fetch)
  assert.equal(result.sent, true)
  assert.equal(details!.headers['Content-Encoding'], 'aes128gcm')
  // http_ece expects a Node ECDH object rather than a KeyObject.
  const { createECDH } = await import('node:crypto')
  const receiver = createECDH('prime256v1')
  receiver.setPrivateKey(Buffer.from(jwk.d!, 'base64url'))
  const plain = ece.decrypt(Buffer.from(details!.body!), { version: 'aes128gcm', privateKey: receiver, authSecret: auth })
  assert.deepEqual(JSON.parse(plain.toString()), message)
})

test('recognizes expired subscriptions and keeps retryable failures distinct', async () => {
  const subscription = { id: 'device', user_id: 'owner', endpoint: 'https://web.push.apple.com/test', p256dh: '', auth: '' }
  const config = { publicKey: 'public', privateKey: 'private', subject: 'https://example.com/' }
  const generate = () => ({ endpoint: subscription.endpoint, method: 'POST', headers: {}, body: null })
  for (const status of [404, 410, 429, 503]) {
    const result = await deliverWebPush(subscription, { title: 'Test', body: 'Test', url: '/' }, config, generate, (async () => new Response(null, { status })) as typeof fetch)
    assert.equal(result.expired, status === 404 || status === 410)
    assert.equal(result.sent, false)
  }
  await assert.rejects(deliverWebPush(subscription, { title: 'Test', body: 'Test', url: '/' }, { ...config, privateKey: '' }, generate))
})
