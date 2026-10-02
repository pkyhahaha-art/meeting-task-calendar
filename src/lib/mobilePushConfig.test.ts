import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadMobilePushConfig, parseMobilePushConfig } from './mobilePushConfig'

test('requires a configured server and valid public key before enabling pairing', () => {
  assert.deepEqual(parseMobilePushConfig({ ready: false, publicKey: 'A'.repeat(87) }), { ready: false, publicKey: null })
  assert.throws(() => parseMobilePushConfig({ ready: true, publicKey: 'missing' }))
  assert.deepEqual(parseMobilePushConfig({ ready: true, publicKey: 'B'.repeat(87) }), { ready: true, publicKey: 'B'.repeat(87) })
})

test('reads current configuration without caching or login and surfaces server failure', async () => {
  let receivedUrl = ''
  const request = (async (url, init) => {
    receivedUrl = String(url)
    assert.equal(init?.cache, 'no-store')
    assert.ok(init?.signal)
    return Response.json({ ready: true, publicKey: 'B'.repeat(87) })
  }) as typeof fetch
  assert.equal((await loadMobilePushConfig('https://project.supabase.co/', request)).ready, true)
  assert.equal(receivedUrl, 'https://project.supabase.co/functions/v1/mobile-push')
  await assert.rejects(loadMobilePushConfig('https://project.supabase.co', (async () => new Response(null, { status: 503 })) as typeof fetch))
  await assert.rejects(loadMobilePushConfig(undefined, request))
})
