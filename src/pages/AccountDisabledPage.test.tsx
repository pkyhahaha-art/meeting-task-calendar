import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

async function harness() {
  const navigations: string[] = []
  let calls = 0
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const exports: { AccountDisabledPage?: React.ComponentType } = {}
  const require = createRequire(import.meta.url)
  const mocks: Record<string, unknown> = {
    react: React,
    'react-router-dom': { useNavigate: () => (path: string) => navigations.push(path) },
    '../auth/AuthProvider': { useAuth: () => ({ signOut: () => {
      calls++
      return new Promise<void>((yes, no) => { resolve = yes; reject = no })
    } }) },
    '../i18n/LanguageProvider': { useLanguage: () => ({ text: (thai: string) => thai }) },
  }
  vm.runInContext(ts.transpileModule(readFileSync(new URL('./AccountDisabledPage.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
  vm.createContext({ exports, require: (name: string) => mocks[name] || require(name), console }))
  let renderer!: ReactTestRenderer
  const Page = exports.AccountDisabledPage!
  await act(async () => { renderer = create(<Page />) })
  return { renderer, navigations, get calls() { return calls },
    click() { act(() => { renderer.root.findByType('button').props.onClick() }) },
    async succeed() { await act(async () => { resolve() }) },
    async fail() { await act(async () => { reject(new Error('Offline')) }) },
    unmount() { act(() => renderer.unmount()) },
  }
}

test('disabled accounts can sign out, wait for completion and return to login', async () => {
  const h = await harness()
  try {
    h.click()
    assert.equal(h.calls, 1)
    assert.equal(h.renderer.root.findByType('button').props.disabled, true)
    assert.deepEqual(h.navigations, [])
    await h.succeed()
    assert.deepEqual(h.navigations, ['/login'])
  } finally { h.unmount() }
})

test('failed sign-out retains the disabled screen and offers a working retry', async () => {
  const h = await harness()
  try {
    h.click(); await h.fail()
    assert.deepEqual(h.navigations, [])
    assert.equal(h.renderer.root.findAllByProps({ role: 'alert' }).length, 1)
    assert.equal(h.renderer.root.findByType('button').props.disabled, false)
    h.click()
    assert.equal(h.calls, 2)
    assert.equal(h.renderer.root.findAllByProps({ role: 'alert' }).length, 0)
    await h.succeed()
    assert.deepEqual(h.navigations, ['/login'])
  } finally { h.unmount() }
})
