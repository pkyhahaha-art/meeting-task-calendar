import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import * as controls from './AdminReportControls'
import { reportDateBounds, reportPageSize } from '../lib/adminReports'
import type { AdminCalendarFilters, AdminCalendarItem, AdminMeetingOccurrence, AdminCalendarTrashPreview } from '../lib/adminCalendarItems'

const item = (id: string, entity: 'task' | 'meeting' = 'task', recurring = false): AdminCalendarItem => ({
  id, entity, recurring, title: `รายการ ${id}`, creator_user_id: 'creator', creator_name: 'ผู้สร้าง', creator_email: 'fixture@example.invalid',
  created_at: '2026-10-01T02:00:00Z', affiliation: 'หน่วยงาน', status: entity === 'task' ? 'pending' : 'scheduled',
  start_datetime: '2026-10-07T02:00:00Z', end_datetime: '2026-10-07T03:00:00Z', due_date: '2026-10-07', due_time: '09:00:00',
})
const key = (row: Pick<AdminCalendarItem, 'entity' | 'id'>) => `${row.entity}:${row.id}`
const delay = () => new Promise<void>(resolve => setTimeout(resolve, 15))

async function harness(rows: AdminCalendarItem[], { count = rows.length, occurrenceRows = [] as AdminMeetingOccurrence[], loadFails = false,
  allPreview = { taskCount: 126, meetingCount: 81, totalCount: 207, snapshot: 'fixture-snapshot' } as AdminCalendarTrashPreview } = {}) {
  const calls: { name: string; args: unknown[] }[] = []
  const confirmations: { title: string; message: string }[] = []
  let approved = true
  let trashFails = false
  let previewFails = false
  let allFails = false
  let removedAll = false
  let refreshFailsAfterAll = false
  let waitForAll: Promise<void> | null = null
  let releaseAll: (() => void) | null = null
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  const invalidate = client.invalidateQueries.bind(client)
  client.invalidateQueries = async (...args) => { calls.push({ name: 'invalidate', args }); return invalidate(...args) }
  const mocks: Record<string, unknown> = {
    react: React,
    '@tanstack/react-query': { useQuery, useQueryClient },
    './ConfirmDialogProvider': { useConfirm: () => async (options: { title: string; message: string }) => { confirmations.push(options); return approved } },
    './AdminReportControls': controls,
    '../lib/adminReports': { reportDateBounds, reportPageSize },
    '../lib/adminCalendarItems': { adminItemKey: key,
      loadAdminCalendarItems: async (filters: AdminCalendarFilters, page: number) => {
        calls.push({ name: 'list', args: [filters, page] }); if (loadFails || (removedAll && refreshFailsAfterAll)) throw new Error('Offline')
        return removedAll ? { rows: [], count: 0 } : { rows: page === 0 ? rows : [item('next-page')], count }
      },
      loadAdminMeetingOccurrences: async (id: string) => { calls.push({ name: 'occurrences', args: [id] }); return occurrenceRows },
      trashAdminCalendarItems: async (...args: unknown[]) => { calls.push({ name: 'trash', args }); if (trashFails) throw new Error('Offline'); return (args[0] as unknown[]).length },
      cancelAdminMeetingOccurrence: async (...args: unknown[]) => { calls.push({ name: 'cancel', args }); return 'cancelled-id' },
      loadAdminCalendarTrashPreview: async (...args: unknown[]) => { calls.push({ name: 'preview-all', args }); if (previewFails) throw new Error('Offline'); return { ...allPreview } },
      trashAllAdminCalendarItems: async (...args: unknown[]) => {
        calls.push({ name: 'trash-all', args }); if (waitForAll) await waitForAll
        if (allFails) throw new Error('Snapshot changed')
        removedAll = true
        return { taskCount: allPreview.taskCount, meetingCount: allPreview.meetingCount, totalCount: allPreview.totalCount }
      },
    },
  }
  const exports: { AdminCalendarItemsPanel?: React.ComponentType<{ adminUserId: string; members: [] }> } = {}
  const require = createRequire(import.meta.url)
  const mockedRequire = (name: string) => mocks[name] || (name.endsWith('.jpg') ? 'admin-mascot.jpg' : require(name))
  const dialogExports: Record<string, unknown> = {}
  vm.runInContext(ts.transpileModule(readFileSync(new URL('./AdminTrashAllDialog.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
  vm.createContext({ exports: dialogExports, require: mockedRequire, console }))
  mocks['./AdminTrashAllDialog'] = dialogExports
  vm.runInContext(ts.transpileModule(readFileSync(new URL('./AdminCalendarItemsPanel.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
  vm.createContext({ exports, require: mockedRequire, console }))
  const Panel = exports.AdminCalendarItemsPanel!
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<QueryClientProvider client={client}><Panel adminUserId="admin" members={[]} /></QueryClientProvider>); await delay() })
  await act(delay)
  // Inspect rendered child text without serializing React owner objects.
  const text = (node: { children: unknown[] }): string => node.children.map(child => typeof child === 'string' ? child : child && typeof child === 'object' && 'children' in child ? text(child as { children: unknown[] }) : '').join('')
  const findButton = (label: string) => renderer.root.findAllByType('button').find(node => text(node).includes(label))!
  return { renderer, calls, confirmations, button: findButton,
    async click(label: string) { const node = findButton(label); assert.ok(node, label); assert.equal(Boolean(node.props.disabled), false, label); await act(async () => { node.props.onClick({ currentTarget: null }); await delay() }); await act(delay) },
    async changeReason(value = 'ผู้สร้างลบไม่ได้') { await act(async () => { renderer.root.findByType('textarea').props.onChange({ target: { value } }) }) },
    async selectAll() { await act(async () => { renderer.root.findAllByType('input').find(node => node.props.type === 'checkbox' && !node.props['aria-label'])!.props.onChange({ target: { checked: true } }) }) },
    async fillAllReason(value: string) { await act(async () => { renderer.root.findByProps({ id: 'admin-trash-all-reason' }).props.onChange({ target: { value } }) }) },
    async fillAllConfirmation(value: string) { await act(async () => { renderer.root.findByProps({ id: 'admin-trash-all-confirmation' }).props.onChange({ target: { value } }) }) },
    async submitAll() { await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); await delay() }); await act(delay) },
    setApproved(value: boolean) { approved = value }, failTrash(value: boolean) { trashFails = value },
    failPreview(value: boolean) { previewFails = value }, failAll(value: boolean) { allFails = value },
    failRefreshAfterAll(value: boolean) { refreshFailsAfterAll = value },
    async setAdmin(id: string) { await act(async () => { renderer.update(<QueryClientProvider client={client}><Panel adminUserId={id} members={[]} /></QueryClientProvider>); await delay() }); await act(delay) },
    deferAll() { waitForAll = new Promise<void>(resolve => { releaseAll = resolve }) },
    async finishAll() { await act(async () => { releaseAll?.(); await delay() }); await act(delay) },
    unmount() { act(() => renderer.unmount()); client.clear() },
  }
}

test('bulk deletion requires reason and confirmation, selects only the visible page, and clears on filter/page change', async () => {
  const h = await harness([item('A'), item('B', 'meeting', true)], { count: 26 })
  try {
    await h.selectAll()
    assert.equal(h.button('ย้ายที่เลือก').props.disabled, true)
    await h.changeReason()
    h.setApproved(false)
    await h.click('ย้ายที่เลือก')
    assert.equal(h.calls.some(call => call.name === 'trash'), false)
    assert.match(h.confirmations[0].message, /ประชุมทำซ้ำที่เลือกจะลบทั้งชุด/)
    await h.click('ถัดไป')
    assert.equal(h.button('ย้ายที่เลือก').props.disabled, true)
    await h.selectAll()
    await act(async () => { h.renderer.root.findAllByType('input').find(node => node.props.maxLength === 200)!.props.onChange({ target: { value: 'ค้นหาใหม่' } }); await delay() })
    await act(delay)
    assert.equal(h.button('ย้ายที่เลือก').props.disabled, true)
    assert.equal(h.calls.filter(call => call.name === 'list').at(-1)!.args[1], 0)
    await h.selectAll(); h.setApproved(true)
    await h.click('ย้ายที่เลือก')
    const targets = h.calls.find(call => call.name === 'trash')!.args[0] as AdminCalendarItem[]
    assert.deepEqual(targets.map(key), ['task:A', 'meeting:B'])
    assert.ok(h.calls.some(call => call.name === 'invalidate'))
    assert.equal(h.renderer.root.findByType('textarea').props.value, '')
  } finally { h.unmount() }
})

test('failed deletion preserves selection and reason for retry; legacy task cascade is explicit', async () => {
  const h = await harness([item('legacy', 'task', true)])
  try {
    await h.changeReason(); await h.selectAll(); h.failTrash(true)
    await h.click('ย้ายที่เลือก')
    assert.match(h.confirmations[0].message, /งานทำซ้ำเดิม.*งานถัดไปที่ยังไม่เสร็จ/)
    assert.equal(h.renderer.root.findAllByProps({ role: 'alert' }).length, 1)
    assert.equal(h.button('ย้ายที่เลือก').props.disabled, false)
    assert.equal(h.renderer.root.findByType('textarea').props.value, 'ผู้สร้างลบไม่ได้')
    h.failTrash(false); await h.click('ย้ายที่เลือก')
    assert.equal(h.calls.filter(call => call.name === 'trash').length, 2)
  } finally { h.unmount() }
})

test('single meeting occurrence disables past dates and sends the exact future occurrence key without trashing the series', async () => {
  const future = new Date(Date.now() + 86400000).toISOString()
  const occurrenceRows = [{ id: 'past', occurrence_key: '2000-01-01T02:00:00Z', start_datetime: '2000-01-01T02:00:00Z', end_datetime: null },
    { id: 'future', occurrence_key: future, start_datetime: future, end_datetime: null }]
  const h = await harness([item('series', 'meeting', true)], { occurrenceRows })
  try {
    await h.changeReason(); await h.click('เลือกวันเพื่อลบเฉพาะนัด')
    assert.equal(h.renderer.root.findAllByType('option').find(node => node.props.value === 'past')!.props.disabled, true)
    assert.equal(h.button('ลบเฉพาะนัดนี้').props.disabled, true)
    const select = h.renderer.root.findAllByType('select').at(-1)!
    await act(async () => { select.props.onChange({ target: { value: 'future' } }) })
    await h.click('ลบเฉพาะนัดนี้')
    assert.deepEqual(h.calls.find(call => call.name === 'cancel')!.args, ['series', future, 'ผู้สร้างลบไม่ได้'])
    assert.equal(h.calls.some(call => call.name === 'trash'), false)
  } finally { h.unmount() }
})

test('load failure blocks destructive actions and exposes reload', async () => {
  const h = await harness([], { loadFails: true })
  try {
    assert.equal(h.renderer.root.findAllByProps({ role: 'alert' }).length, 1)
    assert.equal(h.button('ย้ายที่เลือก').props.disabled, true)
    await h.click('โหลดรายการใหม่')
    assert.equal(h.calls.filter(call => call.name === 'list').length, 2)
  } finally { h.unmount() }
})

test('Admin edit links open the original calendar form without requiring a deletion reason', async () => {
  const h = await harness([item('task-1'), item('meeting-1', 'meeting'), { ...item('cancelled', 'meeting'), status: 'cancelled' }])
  try {
    const links = h.renderer.root.findAllByType('a')
    assert.deepEqual(links.map(link => link.props.href), ['#/calendar?task=task-1', '#/calendar?event=meeting-1'])
    assert.ok(links.every(link => link.props['aria-disabled'] === false))
    assert.equal(h.button('ย้ายที่เลือก').props.disabled, true)
    assert.equal(h.calls.some(call => call.name === 'trash' || call.name === 'cancel'), false)
  } finally { h.unmount() }
})

test('table filters work together and a row delete targets only that record', async () => {
  const h = await harness([item('A'), item('B', 'meeting')])
  try {
    const filters = h.renderer.root.findAllByType('select')
    const dates = h.renderer.root.findAllByType('input').filter(node => node.props.type === 'date')
    for (const [node, value] of [
      [h.renderer.root.findAllByType('input').find(node => node.props.maxLength === 200)!, 'ประชุม'],
      [filters[0], 'meeting'], [filters[1], 'creator'], [dates[0], '2026-10-01'], [dates[1], '2026-10-31'],
    ] as const) {
      await act(async () => { node.props.onChange({ target: { value } }); await delay() })
    }
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls.filter(call => call.name === 'list').at(-1)!.args)), [
      { entity: 'meeting', creator: 'creator', search: 'ประชุม', from: '2026-10-01', to: '2026-10-31' }, 0,
    ])
    const row = h.renderer.root.findAllByType('tr').find(node => node.findAllByType('h3').some(title => title.children.includes('รายการ B')))!
    await h.changeReason()
    await act(async () => { row.findAllByType('button').find(node => node.children.some(child => child === 'ย้ายรายการนี้เข้าถังขยะ'))!.props.onClick(); await delay() })
    const targets = h.calls.find(call => call.name === 'trash')!.args[0] as AdminCalendarItem[]
    assert.deepEqual(Array.from(targets, key), ['meeting:B'])
    assert.equal(h.calls.some(call => call.name === 'cancel'), false)
  } finally { h.unmount() }
})

test('global trash uses system preview despite table filters and requires its own reason and exact typed confirmation', async () => {
  const h = await harness([item('A'), item('B', 'meeting')])
  try {
    await h.changeReason('เหตุผลสำหรับรายการที่เลือก')
    await act(async () => { h.renderer.root.findAllByType('select')[0].props.onChange({ target: { value: 'task' } }); await delay() })
    await h.click('ลบ Task และ Meeting ทั้งระบบ')
    assert.deepEqual(h.calls.find(call => call.name === 'preview-all')!.args, [])
    assert.equal(h.calls.some(call => call.name === 'trash-all'), false)
    assert.equal(h.renderer.root.findByProps({ id: 'admin-trash-all-reason' }).props.value, '')
    await h.fillAllConfirmation('ลบทั้งหมด')
    assert.equal(h.button('ยืนยันลบทั้งหมด').props.disabled, true)
    await h.fillAllReason('เตรียมระบบใช้งานจริง')
    await h.fillAllConfirmation('ลบทั้งหมด ')
    assert.equal(h.button('ยืนยันลบทั้งหมด').props.disabled, true)
    await h.fillAllConfirmation('ลบทั้งหมด')
    assert.equal(h.button('ยืนยันลบทั้งหมด').props.disabled, false)
    await h.submitAll()
    const call = h.calls.find(call => call.name === 'trash-all')!
    assert.deepEqual(JSON.parse(JSON.stringify(call.args)), [
      { taskCount: 126, meetingCount: 81, totalCount: 207, snapshot: 'fixture-snapshot' }, 'เตรียมระบบใช้งานจริง', 'ลบทั้งหมด',
    ])
    assert.equal(h.renderer.root.findAllByProps({ role: 'dialog' }).length, 0)
    assert.ok(h.renderer.root.findAllByProps({ role: 'status' }).some(node => node.children.some(child => typeof child === 'string' && child.includes('207'))))
    assert.equal(h.calls.some(call => call.name === 'trash' || call.name === 'cancel'), false)
    assert.equal(h.confirmations.length, 0)
    assert.ok(h.calls.some(call => call.name === 'invalidate'))
  } finally { h.unmount() }
})

test('global preview failure and cancel never delete; failed submission requires a fresh preview and prevents duplicate requests', async () => {
  const h = await harness([item('A')])
  try {
    h.failPreview(true)
    await h.click('ลบ Task และ Meeting ทั้งระบบ')
    assert.equal(h.button('ยืนยันลบทั้งหมด').props.disabled, true)
    assert.equal(h.renderer.root.findAllByProps({ role: 'alert' }).length, 1)
    await h.click('ยกเลิก')
    assert.equal(h.calls.some(call => call.name === 'trash-all'), false)
    h.failPreview(false)
    await h.click('ลบ Task และ Meeting ทั้งระบบ')
    await h.fillAllReason('fixture reason'); await h.fillAllConfirmation('ลบทั้งหมด')
    h.failAll(true); h.deferAll()
    await h.submitAll(); await h.submitAll()
    assert.equal(h.calls.filter(call => call.name === 'trash-all').length, 1)
    assert.equal(h.button('ยกเลิก').props.disabled, true)
    await h.finishAll()
    assert.equal(h.button('ยืนยันลบทั้งหมด').props.disabled, true)
    assert.equal(h.renderer.root.findByProps({ id: 'admin-trash-all-confirmation' }).props.value, '')
    await h.click('ตรวจจำนวนรายการใหม่')
    assert.equal(h.calls.filter(call => call.name === 'preview-all').length, 3)
    assert.equal(h.renderer.root.findByProps({ id: 'admin-trash-all-reason' }).props.value, 'fixture reason')
    assert.equal(h.button('ยืนยันลบทั้งหมด').props.disabled, true)
    await h.click('ยกเลิก')
    assert.equal(h.calls.filter(call => call.name === 'trash-all').length, 1)
  } finally { h.unmount() }
})

test('global action remains separate from invalid filters and cannot submit an empty system', async () => {
  const h = await harness([], { allPreview: { taskCount: 0, meetingCount: 0, totalCount: 0, snapshot: 'empty' } })
  try {
    const dates = h.renderer.root.findAllByType('input').filter(node => node.props.type === 'date')
    await act(async () => { dates[0].props.onChange({ target: { value: '2026-11-01' } }) })
    await act(async () => { dates[1].props.onChange({ target: { value: '2026-10-01' } }) })
    await h.click('ลบ Task และ Meeting ทั้งระบบ')
    assert.equal(h.button('ยืนยันลบทั้งหมด').props.disabled, true)
    assert.equal(h.renderer.root.findByProps({ id: 'admin-trash-all-reason' }).props.disabled, true)
    await h.submitAll()
    assert.equal(h.calls.some(call => call.name === 'trash-all'), false)
    await h.click('ยกเลิก')
  } finally { h.unmount() }
})

test('a successful global trash with a failed refresh reports the saved result and does not offer a destructive retry', async () => {
  const h = await harness([item('A')])
  try {
    h.failRefreshAfterAll(true)
    await h.click('ลบ Task และ Meeting ทั้งระบบ')
    await h.fillAllReason('fixture reason'); await h.fillAllConfirmation('ลบทั้งหมด')
    await h.submitAll()
    assert.equal(h.calls.filter(call => call.name === 'trash-all').length, 1)
    assert.equal(h.renderer.root.findAllByProps({ role: 'dialog' }).length, 0)
    assert.ok(h.renderer.root.findAllByProps({ role: 'alert' }).some(node => node.children.some(child => typeof child === 'string' && child.includes('เข้าถังขยะแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ'))))
  } finally { h.unmount() }
})

test('switching Admin accounts closes global confirmation without previewing or deleting for the new account', async () => {
  const h = await harness([item('A')])
  try {
    await h.click('ลบ Task และ Meeting ทั้งระบบ')
    await h.fillAllReason('fixture reason'); await h.fillAllConfirmation('ลบทั้งหมด')
    await h.setAdmin('different-admin')
    assert.equal(h.renderer.root.findAllByProps({ role: 'dialog' }).length, 0)
    assert.equal(h.calls.filter(call => call.name === 'preview-all').length, 1)
    assert.equal(h.calls.some(call => call.name === 'trash-all'), false)
  } finally { h.unmount() }
})
