import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { LanguageProvider } from '../i18n/LanguageProvider'
import type { AdminProfile } from '../lib/adminReports'

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'th', setItem: () => {} } })

const memberFixture: AdminProfile = {
  id: 'member-1',
  full_name: 'สมชาย ใจดี',
  employee_id: '509792',
  email: 'somchai@gmail.com',
  email_verified_at: '2026-10-01T00:00:00Z',
  role: 'user',
  status: 'active',
  ui_language: 'th',
  organization_unit: 'กบง.',
  department: 'ผสอ.',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
}

function harness() {
  const rpcCalls: { fn: string; args: unknown }[] = []
  let rpcError: Error | null = null

  const mocks: Record<string, unknown> = {
    react: React,
    '../i18n/LanguageProvider': { useLanguage: () => ({ language: 'th', text: (th: string) => th }) },
    '../lib/supabase': {
      supabase: {
        rpc: async (fn: string, args: unknown) => {
          rpcCalls.push({ fn, args })
          return { error: rpcError }
        },
      },
    },
  }

  const exports: { AdminEditMemberDialog?: React.ComponentType<{ account: AdminProfile; onClose: () => void; onSaved: () => Promise<void> | void }> } = {}
  const require = createRequire(import.meta.url)
  const mockedRequire = (name: string) => mocks[name] || require(name)

  vm.runInContext(
    ts.transpileModule(readFileSync(new URL('./AdminEditMemberDialog.tsx', import.meta.url), 'utf8'),
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
    vm.createContext({ exports, require: mockedRequire, console, window: { addEventListener() {}, removeEventListener() {} }, document: { body: { style: { overflow: '' } } } })
  )

  return {
    AdminEditMemberDialog: exports.AdminEditMemberDialog!,
    rpcCalls,
    setRpcError: (err: Error | null) => { rpcError = err },
  }
}

test('AdminEditMemberDialog validates name and calls admin_update_member_profile RPC', async () => {
  const h = harness()
  let closed = false
  let saved = false
  let renderer!: ReactTestRenderer

  await act(async () => {
    renderer = create(
      <LanguageProvider>
        <h.AdminEditMemberDialog
          account={memberFixture}
          onClose={() => { closed = true }}
          onSaved={() => { saved = true }}
        />
      </LanguageProvider>
    )
  })

  // Inputs initialized
  const nameInput = renderer.root.findByProps({ id: 'edit-member-name' })
  assert.equal(nameInput.props.value, 'สมชาย ใจดี')
  const empIdInput = renderer.root.findByProps({ id: 'edit-member-empid' })
  assert.equal(empIdInput.props.value, '509792')

  // Validation: short name fails
  await act(async () => {
    nameInput.props.onChange({ target: { value: ' ' } })
  })
  const form = renderer.root.findByType('form')
  await act(async () => {
    form.props.onSubmit({ preventDefault() {} })
  })

  assert.equal(h.rpcCalls.length, 0)
  assert.equal(saved, false)
  assert.equal(closed, false)

  // Valid update
  await act(async () => {
    nameInput.props.onChange({ target: { value: 'สมชาย รักงาน' } })
    empIdInput.props.onChange({ target: { value: '509999' } })
  })
  await act(async () => {
    form.props.onSubmit({ preventDefault() {} })
  })

  assert.equal(h.rpcCalls.length, 1)
  assert.equal(h.rpcCalls[0].fn, 'admin_update_member_profile')
  assert.deepEqual(JSON.parse(JSON.stringify(h.rpcCalls[0].args)), {
    target_user_id: 'member-1',
    next_full_name: 'สมชาย รักงาน',
    next_employee_id: '509999',
    next_organization_unit: 'กบง.',
    next_department: 'ผสอ.',
  })
  assert.equal(saved, true)
  assert.equal(closed, true)
})

test('AdminEditMemberDialog displays error when RPC fails', async () => {
  const h = harness()
  h.setRpcError(new Error('รหัสพนักงานนี้ถูกใช้งานแล้วในระบบ'))
  let closed = false
  let saved = false
  let renderer!: ReactTestRenderer

  await act(async () => {
    renderer = create(
      <LanguageProvider>
        <h.AdminEditMemberDialog
          account={memberFixture}
          onClose={() => { closed = true }}
          onSaved={() => { saved = true }}
        />
      </LanguageProvider>
    )
  })

  const form = renderer.root.findByType('form')
  await act(async () => {
    form.props.onSubmit({ preventDefault() {} })
  })

  assert.equal(h.rpcCalls.length, 1)
  assert.equal(saved, false)
  assert.equal(closed, false)

  const alert = renderer.root.findByProps({ role: 'alert' })
  assert.ok(alert)
  const errorText = alert.findByType('span').children.join('')
  assert.match(errorText, /รหัสพนักงานนี้ถูกใช้งานแล้วในระบบ/)
})

test('Admin saves the actual Other or head-office selection while general affiliation uses only the unit', async () => {
  for (const department of ['อื่นๆ', 'ประจำกอง กบง.']) {
    const h = harness()
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<LanguageProvider><h.AdminEditMemberDialog account={{ ...memberFixture, department }} onClose={() => {}} onSaved={() => {}} /></LanguageProvider>) })
    const departmentSelect = renderer.root.findAllByType('select').find(node => node.props.id.endsWith('-department'))!
    assert.equal(departmentSelect.props.value, department)
    await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    assert.equal((h.rpcCalls[0].args as { next_department: string }).next_department, department)
    act(() => renderer.unmount())
  }
})

test('editing a legacy member name does not replace an absent department with Other', async () => {
  const h = harness()
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<LanguageProvider><h.AdminEditMemberDialog account={{ ...memberFixture, department: null }} onClose={() => {}} onSaved={() => {}} /></LanguageProvider>) })
  const departmentSelect = renderer.root.findAllByType('select').find(node => node.props.id.endsWith('-department'))!
  assert.equal(departmentSelect.props.value, '')
  act(() => renderer.root.findByProps({ id: 'edit-member-name' }).props.onChange({ target: { value: 'สมชาย แก้เฉพาะชื่อ' } }))
  await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
  assert.equal((h.rpcCalls[0].args as { next_department: string | null }).next_department, null)
  act(() => renderer.unmount())
})
