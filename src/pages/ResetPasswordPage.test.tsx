import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

const session = (id: string) => ({ user: { id } })
type Session = ReturnType<typeof session> | null

async function harness({ hash = '#/reset-password', search = '', current = session('account-A'), failure = false, sdkConsumesCode = false, replayEffects = false, recoveryFailure = false }: {
  hash?: string; search?: string; current?: Session; failure?: boolean; sdkConsumesCode?: boolean; replayEffects?: boolean; recoveryFailure?: boolean;
} = {}) {
  const calls: string[] = []
  const location = { hash, search, pathname: '/meeting-task-calendar/', href: `https://fixture.invalid/meeting-task-calendar/${search}${hash}` }
  let active = current
  let updateFails = false
  const auth = {
    getSession: async () => {
      calls.push('getSession')
      if (failure) throw new Error('Offline')
      if (sdkConsumesCode && location.search.includes('code=')) {
        location.search = ''; location.href = `https://fixture.invalid/meeting-task-calendar/${location.hash}`
        active = session('account-B')
      }
      return { data: { session: active }, error: null }
    },
    setSession: async ({ access_token }: { access_token: string }) => {
      calls.push(`setSession:${access_token}`)
      if (recoveryFailure) throw new Error('Offline')
      if (access_token === 'invalid') return { data: { session: null }, error: new Error('Invalid token') }
      active = session('account-B')
      return { data: { session: active }, error: null }
    },
    exchangeCodeForSession: async (code: string) => {
      calls.push(`exchange:${code}`)
      if (code === 'invalid') return { data: { session: null }, error: new Error('Invalid code') }
      active = session('account-B')
      return { data: { session: active }, error: null }
    },
    verifyOtp: async ({ token_hash }: { token_hash: string }) => {
      calls.push(`verify:${token_hash}`)
      if (token_hash === 'invalid') return { data: { session: null }, error: new Error('Invalid token') }
      active = session('account-B')
      return { data: { session: active }, error: null }
    },
    updateUser: async () => {
      calls.push(`updateUser:${active?.user.id}`)
      if (updateFails) throw new Error('Offline')
      return { error: null }
    },
  }
  const exports: { ResetPasswordPage?: React.ComponentType } = {}
  const require = createRequire(import.meta.url)
  const mocks: Record<string, unknown> = {
    react: replayEffects ? { ...React, useEffect: (effect: React.EffectCallback, deps: React.DependencyList) => React.useEffect(() => {
      effect()?.()
      return effect()
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Replay the actual component effect with its original dependency list.
    }, deps) } : React,
    'react-router-dom': { Link: ({ children }: React.PropsWithChildren) => <a>{children}</a> },
    '../components/AuthLayout': { AuthLayout: ({ children }: React.PropsWithChildren) => <main>{children}</main> },
    '../components/FormMessage': { FormMessage: ({ children, type }: React.PropsWithChildren<{ type: string }>) => <p data-status={type}>{children}</p> },
    '../lib/supabase': { supabase: { auth } },
  }
  vm.runInContext(ts.transpileModule(readFileSync(new URL('./ResetPasswordPage.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
  vm.createContext({ exports, require: (name: string) => mocks[name] || require(name), window: {
    location, history: { replaceState: (_state: unknown, _title: string, value: string) => { calls.push(`clean:${value}`) } },
  }, URL, URLSearchParams, console }))
  let renderer!: ReactTestRenderer
  const Page = exports.ResetPasswordPage!
  await act(async () => { renderer = create(<Page />) })
  return { calls, renderer, setAccount: (id: string) => { active = session(id) }, failUpdate: (value: boolean) => { updateFails = value },
    async submit() {
      const inputs = renderer.root.findAllByType('input')
      await act(async () => { inputs[0].props.onChange({ target: { value: 'Fixturepass12' } }) })
      await act(async () => { inputs[1].props.onChange({ target: { value: 'Fixturepass12' } }) })
      await act(async () => { await renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    },
    unmount() { act(() => renderer.unmount()) },
  }
}

test('nested recovery credentials select their account before an existing session', async () => {
  const h = await harness({ hash: '#/reset-password#access_token=token-B&refresh_token=refresh-B&type=recovery' })
  try {
    await h.submit()
    assert.ok(h.calls.includes('setSession:token-B'))
    assert.ok(h.calls.includes('updateUser:account-B'))
    assert.equal(h.calls.includes('updateUser:account-A'), false)
    assert.ok(h.calls.includes('clean:/meeting-task-calendar/#/reset-password'))
  } finally { h.unmount() }
})

test('invalid, incomplete and rejected recovery links never fall back to an existing account', async () => {
  for (const hash of ['#/reset-password#access_token=invalid&refresh_token=bad&type=recovery',
    '#/reset-password#access_token=token-B', '#/reset-password#access_token=&refresh_token=',
    '#/reset-password#error_description=expired', '#/reset-password#access_token=token-B&refresh_token=refresh-B&type=signup']) {
    const h = await harness({ hash })
    try {
      assert.equal(h.renderer.root.findAllByType('input').length, 0, hash)
      assert.equal(h.renderer.root.findAllByProps({ 'data-status': 'error' }).length, 1, hash)
      assert.equal(h.calls.includes('getSession'), false, hash)
      assert.equal(h.calls.some((call) => call.startsWith('updateUser')), false, hash)
    } finally { h.unmount() }
  }
})

test('PKCE recovery exchanges an unprocessed code and accepts a code already consumed by the SDK once', async () => {
  for (const sdkConsumesCode of [false, true]) {
    const h = await harness({ search: '?code=recovery-B', sdkConsumesCode })
    try {
      await h.submit()
      assert.equal(h.calls.filter((call) => call.startsWith('exchange')).length, sdkConsumesCode ? 0 : 1)
      assert.ok(h.calls.includes('updateUser:account-B'))
      assert.ok(h.calls.includes('clean:/meeting-task-calendar/#/reset-password'))
    } finally { h.unmount() }
  }
})

test('session initialization failure finishes checking and does not expose password fields', async () => {
  const h = await harness({ failure: true })
  try {
    assert.equal(h.renderer.root.findAllByType('input').length, 0)
    assert.equal(h.renderer.root.findAllByProps({ 'data-status': 'error' }).length, 1)
    assert.equal(JSON.stringify(h.renderer.toJSON()).includes('กำลังตรวจสอบลิงก์…'), false)
  } finally { h.unmount() }
})

test('effect replay only consumes recovery credentials once and catches a rejected token API', async () => {
  const hash = '#/reset-password#access_token=token-B&refresh_token=refresh-B&type=recovery'
  const h = await harness({ hash, replayEffects: true })
  try {
    assert.equal(h.calls.filter((call) => call.startsWith('setSession:')).length, 1)
    await h.submit()
    assert.ok(h.calls.includes('updateUser:account-B'))
  } finally { h.unmount() }
  const failed = await harness({ hash, recoveryFailure: true })
  try {
    assert.equal(failed.renderer.root.findAllByType('input').length, 0)
    assert.equal(failed.renderer.root.findAllByProps({ 'data-status': 'error' }).length, 1)
  } finally { failed.unmount() }
})

test('recovery OTP and PKCE failures cannot change the existing account', async () => {
  for (const search of ['?token_hash=recovery-B&type=recovery', '?token_hash=invalid&type=recovery', '?code=invalid', '?code=']) {
    const h = await harness({ search })
    try {
      if (search.includes('recovery-B')) {
        await h.submit()
        assert.ok(h.calls.includes('verify:recovery-B'))
        assert.ok(h.calls.includes('updateUser:account-B'))
      } else {
        assert.equal(h.renderer.root.findAllByType('input').length, 0)
        assert.equal(h.calls.some((call) => call.startsWith('updateUser:')), false)
      }
    } finally { h.unmount() }
  }
})

test('already initialized sessions remain usable, save errors allow retry, and an account switch cannot change a different account', async () => {
  const h = await harness()
  try {
    h.failUpdate(true)
    await h.submit()
    assert.equal(h.renderer.root.findByType('button').props.disabled, false)
    assert.equal(h.renderer.root.findAllByProps({ 'data-status': 'error' }).length, 1)
    h.failUpdate(false)
    await h.submit()
    assert.equal(h.renderer.root.findAllByProps({ 'data-status': 'success' }).length, 1)
  } finally { h.unmount() }
  const switched = await harness({ hash: '#/reset-password#access_token=token-B&refresh_token=refresh-B&type=recovery' })
  try {
    switched.setAccount('account-C')
    await switched.submit()
    assert.equal(switched.calls.some((call) => call.startsWith('updateUser')), false)
    assert.equal(switched.renderer.root.findAllByType('input').length, 0)
  } finally { switched.unmount() }
})
