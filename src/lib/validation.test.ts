import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { zodResolver } from '@hookform/resolvers/zod'
import { registrationSchema } from './validation'

const validRegistration = {
  fullName: 'สมชาย ใจดี',
  employeeId: 'EMP-001',
  email: 'employee@gmail.com',
  password: 'secure123',
  confirmPassword: 'secure123',
}

describe('registrationSchema', () => {
  it('accepts the required registration fields', () => {
    assert.equal(registrationSchema.safeParse(validRegistration).success, true)
  })

  it('requires a Gmail address', () => {
    assert.equal(registrationSchema.safeParse({ ...validRegistration, email: 'employee@example.com' }).success, false)
  })

  it('requires matching passwords', () => {
    assert.equal(registrationSchema.safeParse({ ...validRegistration, confirmPassword: 'different123' }).success, false)
  })

  it('returns a form error instead of throwing when passwords do not match', async () => {
    const resolver = zodResolver(registrationSchema)
    const result = await resolver(
      { ...validRegistration, confirmPassword: 'different123' },
      undefined,
      { criteriaMode: 'firstError', fields: {}, shouldUseNativeValidation: false },
    )
    assert.ok('confirmPassword' in result.errors)
    assert.equal(result.errors.confirmPassword?.message, 'รหัสผ่านทั้งสองช่องไม่ตรงกัน')
  })

  it('rejects an unsafe Employee ID', () => {
    assert.equal(registrationSchema.safeParse({ ...validRegistration, employeeId: 'EMP 001<script>' }).success, false)
  })
})
