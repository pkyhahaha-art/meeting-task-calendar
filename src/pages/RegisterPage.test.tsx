import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { registrationSchema, type RegistrationValues } from '../lib/validation'

const values: RegistrationValues = {
  namePrefix: 'นาย', firstName: 'Test', lastName: 'Member', employeeId: '123456',
  organizationUnit: 'ประจำฝ่าย (ฝลส.)', department: '', email: 'Fixture@gmail.com',
  password: 'Fixturepass12', confirmPassword: 'Fixturepass12',
}
type SignupResult = { data: { user: { identities?: unknown[] } | null }; error: { message: string } | null }
const successfulSignup: SignupResult = { data: { user: { identities: [{}] } }, error: null }
type Alert = { icon: string; title: string; text: string; confirmButtonText: string }

async function harness(result: SignupResult | Promise<SignupResult> = successfulSignup, language = 'th') {
  assert.equal(registrationSchema.safeParse(values).success, true)
  const alerts: Alert[] = []
  const signupCalls: { email: string; options: { emailRedirectTo: string } }[] = []
  let resetCount = 0
  const require = createRequire(import.meta.url)
  const exports: { RegisterPage?: React.ComponentType } = {}
  const mocks: Record<string, unknown> = {
    react: React,
    'react-hook-form': { useForm: () => ({
      register: () => ({}), watch: (field: keyof RegistrationValues) => values[field], setValue: () => {},
      reset: () => { resetCount++ }, formState: { errors: {}, isSubmitting: false },
      handleSubmit: (submit: (submitted: RegistrationValues) => Promise<void>) => () => submit(values),
    }) },
    'sweetalert2': { fire: async (options: Alert) => { alerts.push(options) } },
    'react-router-dom': { Link: ({ children }: React.PropsWithChildren) => <a>{children}</a> },
    '../components/AuthLayout': { AuthLayout: ({ children }: React.PropsWithChildren) => <main>{children}</main> },
    '../components/Captcha': { Captcha: () => null },
    '../components/FormMessage': { FormMessage: ({ children, type }: React.PropsWithChildren<{ type: string }>) => <p data-status={type}>{children}</p> },
    '../components/OrganizationFields': { OrganizationFields: () => null },
    '../i18n/LanguageProvider': { useLanguage: () => ({ language, t: (key: string) => key }) },
    '../lib/appUrl': { appUrl: (path: string) => `https://fixture.invalid/#${path}` },
    '../lib/supabase': { supabase: { auth: { signUp: async (request: typeof signupCalls[number]) => {
      signupCalls.push(request)
      return result
    } } } },
  }
  vm.runInContext(ts.transpileModule(readFileSync(new URL('./RegisterPage.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
  vm.createContext({ exports, require: (name: string) => mocks[name] || require(name), console }))
  let renderer!: ReactTestRenderer
  const Page = exports.RegisterPage!
  await act(async () => { renderer = create(<Page />) })
  return { alerts, signupCalls, renderer, get resetCount() { return resetCount },
    submit: () => renderer.root.findByType('form').props.onSubmit() as Promise<void>,
    unmount: () => act(() => renderer.unmount()),
  }
}

test('successful registration shows the PEA confirmation alert and keeps Gmail, Spam and Trash instructions inline', async () => {
  const h = await harness()
  try {
    await act(async () => { await h.submit() })
    assert.equal(h.alerts.length, 1)
    assert.equal(h.alerts[0].icon, 'success')
    assert.equal(h.alerts[0].title, 'สมัครสำเร็จ')
    assert.equal(h.alerts[0].confirmButtonText, 'รับทราบ')
    assert.match(h.alerts[0].text, /Gmail.*ยืนยันบัญชีก่อนเข้าสู่ระบบ.*จดหมายขยะ \(Spam\).*ถังขยะ/)
    assert.equal(h.renderer.root.findByProps({ 'data-status': 'success' }).children.join(''), `${h.alerts[0].title} ${h.alerts[0].text}`)
    assert.equal(h.resetCount, 1)
    assert.equal(h.signupCalls[0].email, 'fixture@gmail.com')
    assert.equal(h.signupCalls[0].options.emailRedirectTo, 'https://fixture.invalid/#/auth/callback')
  } finally { h.unmount() }
})

test('registration waits for the signup response before claiming success', async () => {
  let resolve!: (result: SignupResult) => void
  const h = await harness(new Promise<SignupResult>((done) => { resolve = done }))
  try {
    let pending!: Promise<void>
    await act(async () => { pending = h.submit() })
    assert.equal(h.signupCalls.length, 1)
    assert.equal(h.alerts.length, 0)
    assert.equal(h.resetCount, 0)
    assert.equal(h.renderer.root.findAllByProps({ 'data-status': 'success' }).length, 0)
    await act(async () => { resolve(successfulSignup); await pending })
    assert.equal(h.alerts.length, 1)
    assert.equal(h.resetCount, 1)
  } finally { h.unmount() }
})

test('existing accounts retain their existing dialog without a success alert or form reset', async () => {
  for (const result of [
    { data: { user: { identities: [] } }, error: null },
    { data: { user: null }, error: { message: 'User already registered' } },
  ]) {
    const h = await harness(result)
    try {
      await act(async () => { await h.submit() })
      assert.equal(h.alerts.length, 0)
      assert.equal(h.resetCount, 0)
      assert.equal(h.renderer.root.findAllByProps({ role: 'dialog' }).length, 1)
      assert.equal(h.renderer.root.findAllByProps({ 'data-status': 'success' }).length, 0)
    } finally { h.unmount() }
  }
})

test('a signup error never displays the success alert and preserves the form for retry', async () => {
  const h = await harness({ data: { user: null }, error: { message: 'Email rate limit exceeded' } })
  try {
    await act(async () => { await h.submit() })
    assert.equal(h.alerts.length, 0)
    assert.equal(h.resetCount, 0)
    assert.equal(h.renderer.root.findAllByProps({ 'data-status': 'error' }).length, 1)
    assert.equal(h.renderer.root.findAllByProps({ 'data-status': 'success' }).length, 0)
  } finally { h.unmount() }
})

test('the registration confirmation uses English when selected and still explains email verification', async () => {
  const h = await harness(successfulSignup, 'en')
  try {
    await act(async () => { await h.submit() })
    assert.equal(h.alerts[0].title, 'Registration successful')
    assert.equal(h.alerts[0].confirmButtonText, 'Got it')
    assert.match(h.alerts[0].text, /Open Gmail.*confirmation link before signing in.*Spam or Trash/)
    assert.equal(h.renderer.root.findByProps({ 'data-status': 'success' }).children.join(''), `${h.alerts[0].title} ${h.alerts[0].text}`)
  } finally { h.unmount() }
})
