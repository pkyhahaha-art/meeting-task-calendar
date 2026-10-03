import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

type Session = { user: { id: string } } | null
type ProfileResult = { data: { id: string; role: string } | null; error: { message: string } | null }
type AuthValue = { user: { id: string } | null; profile: { id: string; role: string } | null;
  loading: boolean; profileLoading: boolean; authError: string | null; profileError: string | null;
  refreshProfile: () => Promise<void>; signOut: () => Promise<void> }

function harness() {
  const initial = deferred<{ data: { session: Session }; error: null }>()
  const profiles = new Map<string, ReturnType<typeof deferred<ProfileResult>>>()
  let authChanged!: (event: string, session: Session) => void
  let clears = 0
  let value!: AuthValue
  let renderer!: ReactTestRenderer
  const supabase = {
    auth: { getSession: () => initial.promise,
      onAuthStateChange: (callback: typeof authChanged) => { authChanged = callback; return { data: { listener: null, subscription: { unsubscribe: () => {} } } } },
      signOut: async () => ({ error: null }) },
    from: () => { let id = ''; const query = { select: () => query, eq: (_key: string, nextId: string) => { id = nextId; return query }, returns: () => query,
      maybeSingle: () => { const request = deferred<ProfileResult>(); profiles.set(id, request); return request.promise } }; return query },
  }
  const exports: { AuthProvider?: React.ComponentType<React.PropsWithChildren>; useAuth?: () => AuthValue } = {}
  const require = createRequire(import.meta.url)
  const mocks: Record<string, unknown> = { react: React,
    '@tanstack/react-query': { useQueryClient: () => client },
    '../lib/supabase': { isSupabaseConfigured: true, supabase } }
  const client = { clear: () => { clears++ } }
  const source = readFileSync(new URL('./AuthProvider.tsx', import.meta.url), 'utf8')
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
  vm.createContext({ exports, require: (name: string) => mocks[name] || require(name), console }))
  const Provider = exports.AuthProvider!
  function Consumer() { value = exports.useAuth!(); return null }
  return { initial, profiles, get value() { return value }, get clears() { return clears },
    async mount() { await act(async () => { renderer = create(<Provider><Consumer /></Provider>) }) },
    async change(session: Session) { await act(async () => { authChanged('SIGNED_IN', session) }) },
    unmount() { act(() => renderer.unmount()) } }
}

test('late initial session and old profile cannot overwrite a newer login or sign-out', async () => {
  const h = harness(); await h.mount()
  try {
    await h.change({ user: { id: 'admin-A' } })
    await h.change({ user: { id: 'user-B' } })
    await act(async () => { h.profiles.get('user-B')!.resolve({ data: { id: 'user-B', role: 'user' }, error: null }) })
    await act(async () => {
      h.initial.resolve({ data: { session: { user: { id: 'admin-A' } } }, error: null })
      h.profiles.get('admin-A')!.resolve({ data: { id: 'admin-A', role: 'admin' }, error: null })
    })
    assert.equal(h.value.user?.id, 'user-B')
    assert.equal(h.value.profile?.role, 'user')
    await h.change(null)
    assert.equal(h.value.profile, null)
    assert.equal(h.clears, 3)
  } finally { h.unmount() }
})

test('profile API errors and thrown network failures finish loading and allow retry', async () => {
  const h = harness(); await h.mount()
  try {
    await act(async () => { h.initial.resolve({ data: { session: { user: { id: 'user' } } }, error: null }) })
    await act(async () => { h.profiles.get('user')!.resolve({ data: null, error: { message: 'Network failure' } }) })
    assert.equal(h.value.profileLoading, false)
    assert.ok(h.value.profileError)
    let retry!: Promise<void>
    act(() => { retry = h.value.refreshProfile() })
    await act(async () => { h.profiles.get('user')!.reject(new Error('Offline')); await retry })
    assert.equal(h.value.profileLoading, false)
    assert.ok(h.value.profileError)
    act(() => { retry = h.value.refreshProfile() })
    await act(async () => { h.profiles.get('user')!.resolve({ data: { id: 'user', role: 'user' }, error: null }); await retry })
    assert.equal(h.value.profileError, null)
    assert.equal(h.value.profile?.id, 'user')
  } finally { h.unmount() }
})

test('failed session initialization does not leave the app loading indefinitely', async () => {
  const h = harness(); await h.mount()
  try {
    await act(async () => { h.initial.reject(new Error('Offline')) })
    assert.equal(h.value.loading, false)
    assert.ok(h.value.authError)
    await h.change({ user: { id: 'user' } })
    assert.equal(h.value.authError, null)
  } finally { h.unmount() }
})
