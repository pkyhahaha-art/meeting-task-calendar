import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { reportDateBounds, reportPageSize } from './adminReports'

function harness(result: { data: unknown; error: unknown } = { data: { rows: [], total_count: 0 }, error: null }) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const context = vm.createContext({ reportDateBounds, reportPageSize, supabase: {
    rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return result },
  } })
  const source = readFileSync(new URL('./adminCalendarItems.ts', import.meta.url), 'utf8').replace(/^import .*\n/gm, '').replace(/export /g, '')
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context)
  return { calls, load: vm.runInContext('loadAdminCalendarItems', context), trash: vm.runInContext('trashAdminCalendarItems', context),
    cancel: vm.runInContext('cancelAdminMeetingOccurrence', context), occurrences: vm.runInContext('loadAdminMeetingOccurrences', context) }
}
const filters = { entity: 'meeting', creator: 'creator-A', search: '  นัด 100%  ', from: '2026-10-01', to: '2026-10-31' }

test('Admin items combine all filters with Bangkok exclusive end and exact empty-page count', async () => {
  const h = harness({ data: { rows: [], total_count: 51 }, error: null })
  assert.equal((await h.load(filters, 2)).count, 51)
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), { name: 'admin_calendar_items', args: {
    target_entity: 'meeting', target_creator_user_id: 'creator-A', target_search: 'นัด 100%',
    target_created_from: '2026-09-30T17:00:00.000Z', target_created_to: '2026-10-31T17:00:00.000Z', target_offset: 50, target_limit: 25,
  } })
  await assert.rejects(h.load({ ...filters, from: '2026-11-01' }, 0), /วันเริ่มต้น/)
  assert.equal(h.calls.length, 1)
})

test('Admin trash deduplicates by entity and id, strips client metadata, and validates before calling privileged RPC', async () => {
  const h = harness({ data: 2, error: null })
  const item = { entity: 'task', id: 'same-id', title: 'client-title', creator_user_id: 'client-owner' }
  assert.equal(await h.trash([item, item, { entity: 'meeting', id: 'same-id' }], '  ผู้สร้างลบไม่ได้  '), 2)
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), { name: 'admin_trash_calendar_items', args: {
    target_items: [{ entity: 'task', id: 'same-id' }, { entity: 'meeting', id: 'same-id' }], target_reason: 'ผู้สร้างลบไม่ได้',
  } })
  for (const [items, reason] of [[[], 'reason'], [[item], ' '], [[item], 'x'.repeat(501)],
    [Array.from({ length: 101 }, (_, i) => ({ entity: 'task', id: String(i) })), 'reason']] as const) {
    await assert.rejects(h.trash(items, reason))
  }
  assert.equal(h.calls.length, 1)
})

test('single occurrence uses its exact key; permission and malformed responses are surfaced for retry', async () => {
  const h = harness({ data: 'occurrence-id', error: null })
  await h.cancel('meeting-A', '2026-10-07T09:00:00+07:00', '  นัดซ้ำ  ')
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), { name: 'admin_cancel_meeting_occurrence', args: {
    target_event_id: 'meeting-A', target_occurrence_start: '2026-10-07T09:00:00+07:00', target_reason: 'นัดซ้ำ',
  } })
  const denied = harness({ data: null, error: new Error('admin_required') })
  await assert.rejects(denied.load(filters, 0), /admin_required/)
  await assert.rejects(denied.trash([{ entity: 'task', id: 'A' }], 'reason'), /admin_required/)
  await assert.rejects(denied.occurrences('A'), /admin_required/)
  await assert.rejects(harness({ data: null, error: null }).load(filters, 0), /ไม่ครบถ้วน/)
  await assert.rejects(harness({ data: {}, error: null }).occurrences('A'), /โหลดวันนัดไม่ได้/)
  await assert.rejects(harness({ data: null, error: null }).trash([{ entity: 'task', id: 'A' }], 'reason'), /ไม่พบผล/)
})
