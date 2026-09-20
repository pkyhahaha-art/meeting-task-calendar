import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { zodResolver } from '@hookform/resolvers/zod'
import { registrationSchema } from './validation'

const validRegistration = {
  namePrefix: 'นาย' as const,
  firstName: 'สมชาย',
  lastName: 'ใจดี',
  employeeId: '123456',
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

  it('accepts Thai and English letters in first and last names', () => {
    assert.equal(registrationSchema.safeParse({ ...validRegistration, firstName: 'Somsak', lastName: 'ใจดี' }).success, true)
  })

  it('rejects numbers and symbols in first and last names', () => {
    assert.equal(registrationSchema.safeParse({ ...validRegistration, firstName: 'สมชาย1' }).success, false)
    assert.equal(registrationSchema.safeParse({ ...validRegistration, lastName: 'Smith-Jones' }).success, false)
  })

  it('requires a supported name prefix', () => {
    assert.equal(registrationSchema.safeParse({ ...validRegistration, namePrefix: '' }).success, false)
    assert.equal(registrationSchema.safeParse({ ...validRegistration, namePrefix: 'ดร.' }).success, false)
  })

  it('requires exactly six numeric Employee ID digits', () => {
    assert.equal(registrationSchema.safeParse({ ...validRegistration, employeeId: '12345' }).success, false)
    assert.equal(registrationSchema.safeParse({ ...validRegistration, employeeId: '1234567' }).success, false)
    assert.equal(registrationSchema.safeParse({ ...validRegistration, employeeId: '12A456' }).success, false)
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

})
