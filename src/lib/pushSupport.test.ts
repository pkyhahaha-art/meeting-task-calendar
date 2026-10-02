import assert from 'node:assert/strict'
import test from 'node:test'
import { pushSupport, tokenFromPairingLink, type PushEnvironment } from './pushSupport.js'

const supported: PushEnvironment = {
  userAgent: 'Android Chrome', maxTouchPoints: 5, standalone: false,
  secure: true, notifications: true, serviceWorker: true, pushManager: true,
}

test('iPhone Safari needs a Home Screen app before requesting notifications', () => {
  const iphone = { ...supported, userAgent: 'iPhone Safari', notifications: false, pushManager: false }
  assert.equal(pushSupport(iphone), 'ios-install')
  assert.equal(pushSupport({ ...iphone, standalone: true }), 'unsupported')
  assert.equal(pushSupport({ ...supported, userAgent: 'iPhone Safari', standalone: true }), 'ready')
})

test('iPads using the desktop user agent still need Home Screen installation', () => {
  assert.equal(pushSupport({ ...supported, userAgent: 'Macintosh Safari' }), 'ios-install')
  assert.equal(pushSupport({ ...supported, userAgent: 'Macintosh Safari', maxTouchPoints: 0 }), 'ready')
})

test('insecure origins and embedded browsers cannot claim Push support', () => {
  assert.equal(pushSupport({ ...supported, secure: false }), 'insecure')
  for (const capability of ['notifications', 'serviceWorker', 'pushManager'] as const) {
    assert.equal(pushSupport({ ...supported, [capability]: false }), 'unsupported')
  }
  assert.equal(pushSupport(supported), 'ready')
})

test('a copied QR link retains its token when pasted into the Home Screen app', () => {
  const token = '0123456789abcdef0123456789abcdef-test'
  assert.equal(tokenFromPairingLink(`https://example.com/calendar/#/pair-device?token=${token}`), token)
  assert.equal(tokenFromPairingLink('https://example.com/#/calendar?token=0123456789abcdef'), null)
  assert.equal(tokenFromPairingLink('https://example.com/#/pair-device?token='), null)
  assert.equal(tokenFromPairingLink('not a link'), null)
})
