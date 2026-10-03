import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

async function callbackState(search: string, session: unknown, failure = false) {
  const require = createRequire(import.meta.url)
  const exports: { AuthCallbackPage?: React.ComponentType } = {}
  const auth = { getSession: async () => { if (failure) throw new Error('Offline'); return { data: { session }, error: null } },
    verifyOtp: async () => ({ data: { user: { email_confirmed_at: '2026-10-04T00:00:00Z' } }, error: null }) }
  const mocks: Record<string, unknown> = { react: React, 'react-router-dom': { Link: ({ children }: React.PropsWithChildren) => <a>{children}</a> },
    '../components/AuthLayout': { AuthLayout: ({ children }: React.PropsWithChildren) => <main>{children}</main> },
    '../components/FormMessage': { FormMessage: ({ children, type }: React.PropsWithChildren<{ type: string }>) => <p data-status={type}>{children}</p> },
    '../lib/supabase': { supabase: { auth } } }
  vm.runInContext(ts.transpileModule(readFileSync(new URL('./AuthCallbackPage.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
  vm.createContext({ exports, require: (name: string) => mocks[name] || require(name), window: { location: { search } }, URLSearchParams, console }))
  let renderer!: ReactTestRenderer
  const Page = exports.AuthCallbackPage!
  await act(async () => { renderer = create(<Page />) })
  const status = renderer.root.findByType('p').props['data-status']
  act(() => renderer.unmount())
  return status
}

test('confirmation page rejects absent sessions and network failures instead of claiming success', async () => {
  assert.equal(await callbackState('', null), 'error')
  assert.equal(await callbackState('', null, true), 'error')
  assert.equal(await callbackState('', { user: { email_confirmed_at: null } }), 'error')
})

test('confirmation page accepts verified sessions and valid signup tokens but rejects unknown OTP types', async () => {
  assert.equal(await callbackState('', { user: { email_confirmed_at: '2026-10-04T00:00:00Z' } }), 'success')
  assert.equal(await callbackState('?token_hash=fixture&type=signup', null), 'success')
  assert.equal(await callbackState('?token_hash=fixture&type=unknown', null), 'error')
})
