import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { collectReportRows, reportDateBounds } from './adminReports'

test('the actual report queries apply dates, channel, status, entity and search to the same exact-count query', async () => {
  const calls: unknown[][] = []
  const query: Record<string, unknown> = { then: (resolve: (value: unknown) => void) => resolve({ data: [{ id: 'result' }], count: 47, error: null }) }
  for (const method of ['select', 'gte', 'lt', 'lte', 'eq', 'not', 'or', 'ilike', 'order', 'range']) {
    query[method] = (...args: unknown[]) => { calls.push([method, ...args]); return query }
  }
  const context = vm.createContext({ supabase: { from: (table: string) => { calls.push(['from', table]); return query } }, reportDateBounds, collectReportRows })
  const source = readFileSync(new URL('./adminReportQueries.ts', import.meta.url), 'utf8').replace(/^import .*\n/gm, '').replace(/export /g, '')
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context)
  const load = vm.runInContext('loadDeliveryReport', context)
  const filters = { from: '2026-10-01', to: '2026-10-31', channel: 'push', status: 'failed', entity: 'task', search: 'งาน 100%' }
  const page = await load(filters, 25, 25)
  assert.equal(page.count, 47)
  assert.ok(calls.some((call) => call[0] === 'select' && (call[2] as { count: string }).count === 'exact'))
  for (const call of [['gte', 'created_at', '2026-09-30T17:00:00.000Z'], ['lt', 'created_at', '2026-10-31T17:00:00.000Z'],
    ['eq', 'channel', 'push'], ['eq', 'status', 'failed'], ['not', 'task_id', 'is', null], ['range', 25, 49]]) assert.ok(calls.some((value) => JSON.stringify(value) === JSON.stringify(call)), JSON.stringify(call))
  assert.ok(calls.some((call) => call[0] === 'ilike' && call[2] === '%งาน 100\\%%'))
  assert.ok(calls.filter((call) => call[0] === 'select').every((call) => !String(call[1]).includes('provider_reference') && !String(call[1]).includes('idempotency_key')))
  calls.length = 0
  await load(filters, 0, 200, '2026-10-03T00:00:00Z')
  assert.ok(calls.some((call) => call[0] === 'lte' && call[2] === '2026-10-03T00:00:00Z'))
  assert.ok(calls.some((call) => call[0] === 'range' && call[2] === 199))
})
