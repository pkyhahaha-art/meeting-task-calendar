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
import type { AdminCalendarFilters, AdminCalendarItem, AdminMeetingOccurrence } from '../lib/adminCalendarItems'

const item = (id: string, entity: 'task' | 'meeting' = 'task', recurring = false): AdminCalendarItem => ({
  id, entity, recurring, title: `รายการ ${id}`, creator_user_id: 'creator', creator_name: 'ผู้สร้าง', creator_email: 'fixture@example.invalid',
  created_at: '2026-10-01T02:00:00Z', affiliation: 'หน่วยงาน', status: entity === 'task' ? 'pending' : 'scheduled',
  start_datetime: '2026-10-07T02:00:00Z', end_datetime: '2026-10-07T03:00:00Z', due_date: '2026-10-07', due_time: '09:00:00',
})
const key = (row: Pick<AdminCalendarItem, 'entity' | 'id'>) => `${row.entity}:${row.id}`
const delay = () => new Promise<void>(resolve => setTimeout(resolve, 15))

async function harness(rows: AdminCalendarItem[], { count = rows.length, occurrenceRows = [] as AdminMeetingOccurrence[], loadFails = false } = {}) {
  const calls: { name: string; args: unknown[] }[] = []
  const confirmations: { title: string; message: string }[] = []
  let approved = true
  let trashFails = false
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
        calls.push({ name: 'list', args: [filters, page] }); if (loadFails) throw new Error('Offline')
        return { rows: page === 0 ? rows : [item('next-page')], count }
      },
      loadAdminMeetingOccurrences: async (id: string) => { calls.push({ name: 'occurrences', args: [id] }); return occurrenceRows },
      trashAdminCalendarItems: async (...args: unknown[]) => { calls.push({ name: 'trash', args }); if (trashFails) throw new Error('Offline'); return (args[0] as unknown[]).length },
      cancelAdminMeetingOccurrence: async (...args: unknown[]) => { calls.push({ name: 'cancel', args }); return 'cancelled-id' },
    },
  }
  const exports: { AdminCalendarItemsPanel?: React.ComponentType<{ adminUserId: string; members: [] }> } = {}
  const require = createRequire(import.meta.url)
  vm.runInContext(ts.transpileModule(readFileSync(new URL('./AdminCalendarItemsPanel.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
  vm.createContext({ exports, require: (name: string) => mocks[name] || require(name), console }))
  const Panel = exports.AdminCalendarItemsPanel!
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<QueryClientProvider client={client}><Panel adminUserId="admin" members={[]} /></QueryClientProvider>); await delay() })
  await act(delay)
  // Inspect rendered child text without serializing React owner objects.
  const text = (node: { children: unknown[] }): string => node.children.map(child => typeof child === 'string' ? child : child && typeof child === 'object' && 'children' in child ? text(child as { children: unknown[] }) : '').join('')
  const findButton = (label: string) => renderer.root.findAllByType('button').find(node => text(node).includes(label))!
  return { renderer, calls, confirmations, button: findButton,
    async click(label: string) { const node = findButton(label); assert.ok(node, label); assert.equal(Boolean(node.props.disabled), false, label); await act(async () => { node.props.onClick(); await delay() }); await act(delay) },
    async changeReason(value = 'ผู้สร้างลบไม่ได้') { await act(async () => { renderer.root.findByType('textarea').props.onChange({ target: { value } }) }) },
    async selectAll() { await act(async () => { renderer.root.findAllByType('input').find(node => node.props.type === 'checkbox' && !node.props['aria-label'])!.props.onChange({ target: { checked: true } }) }) },
    setApproved(value: boolean) { approved = value }, failTrash(value: boolean) { trashFails = value },
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
