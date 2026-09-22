import assert from 'node:assert/strict'
import test from 'node:test'
import { forgotPasswordErrorMessage } from './authError.js'

test('distinguishes email and request rate limits without stale quota text', () => {
  const emailLimit = forgotPasswordErrorMessage({ code: 'over_email_send_rate_limit', status: 429 })
  const requestLimit = forgotPasswordErrorMessage({ code: 'over_request_rate_limit', status: 429 })

  assert.match(emailLimit, /ถึงขีดจำกัด/)
  assert.match(requestLimit, /ส่งคำขอถี่เกินไป/)
  assert.doesNotMatch(`${emailLimit} ${requestLimit}`, /2 ฉบับต่อชั่วโมง/)
})
