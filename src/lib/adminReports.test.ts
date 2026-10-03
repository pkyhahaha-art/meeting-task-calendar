import assert from 'node:assert/strict'
import test from 'node:test'
import { collectReportRows, csvReport, deliveryAdvice, deliveryRecipient, filterAdminProfiles, reportDateBounds, safeDiagnosticText, type AdminDelivery, type AdminProfile } from './adminReports'

const filters = { search: '', status: '', unit: '', department: '', missing: false }
const profile = (id: string, extra: Partial<AdminProfile>): AdminProfile => ({ id, full_name: `สมาชิก ${id}`, employee_id: id,
  email: `${id}@gmail.com`, organization_unit: null, department: null, status: 'active', role: 'user', ui_language: 'th',
  email_verified_at: null, created_at: '', updated_at: '', ...extra })

test('member search, status, organization and department work together and CSV receives all filtered rows', () => {
  const rows = Array.from({ length: 55 }, (_, index) => profile(String(index), { organization_unit: 'กคน.', department: 'ผคอ.' }))
  rows.push(profile('other', { organization_unit: 'กบง.', department: 'ผสอ.' }), profile('disabled', { organization_unit: 'กคน.', department: 'ผคอ.', status: 'disabled' }))
  const selected = filterAdminProfiles(rows, { ...filters, search: '@GMAIL.COM', status: 'active', unit: 'กคน.', department: 'ผคอ.' })
  assert.equal(selected.length, 55)
  assert.equal(selected.slice(0, 25).length, 25)
  const csv = csvReport(['ชื่อ'], selected.map((row) => [row.full_name]))
  assert.equal(csv.split('\r\n').length, 56)
  assert.deepEqual(filterAdminProfiles(rows, { ...filters, search: 'other' }).map((row) => row.id), ['other'])
})

test('missing organization filter does not flag departments that are intentionally absent', () => {
  const rows = [profile('missing', {}), profile('needs-department', { organization_unit: 'กคน.' }),
    profile('office', { organization_unit: 'ประจำฝ่าย (ฝลส.)' }), profile('no-department', { organization_unit: 'กกร.' }),
    profile('complete', { organization_unit: 'กคน.', department: 'ผคอ.' })]
  assert.deepEqual(filterAdminProfiles(rows, { ...filters, missing: true }).map((row) => row.id), ['missing', 'needs-department'])
})

test('Thai date range includes the entire final day and rejects invalid or reversed dates', () => {
  assert.deepEqual(reportDateBounds({ from: '2026-10-01', to: '2026-10-31' }), { start: '2026-09-30T17:00:00.000Z', end: '2026-10-31T17:00:00.000Z' })
  assert.deepEqual(reportDateBounds({ from: '', to: '' }), { start: undefined, end: undefined })
  assert.throws(() => reportDateBounds({ from: '2026-10-03', to: '2026-10-02' }))
  assert.throws(() => reportDateBounds({ from: '2026-02-30', to: '' }))
})

test('report export reads beyond the API row limit instead of truncating to the visible page', async () => {
  const fixture = Array.from({ length: 1205 }, (_, id) => ({ id }))
  const rows = await collectReportRows(async (offset, limit) => ({ rows: fixture.slice(offset, offset + Math.min(limit, 100)), count: fixture.length }))
  assert.equal(rows.length, 1205)
  assert.equal(rows.at(-1)?.id, 1204)
})

test('report export refuses incomplete, duplicate or changing batches', async () => {
  await assert.rejects(collectReportRows(async () => ({ rows: [], count: 10 })))
  await assert.rejects(collectReportRows(async () => ({ rows: [{ id: 1 }], count: 2 })))
  await assert.rejects(collectReportRows(async (offset) => ({ rows: [{ id: offset }], count: offset ? 3 : 2 })))
})

test('CSV preserves Thai, quotes and newlines while neutralizing spreadsheet formulas', () => {
  const csv = csvReport(['ชื่อ'], [['ประชุม "ฝ่าย"\nวาระ'], ['=1+1'], [' @SUM(1)'], [null]])
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes('"ประชุม ""ฝ่าย""\nวาระ"'))
  assert.ok(csv.includes('"\'=1+1"'))
  assert.ok(csv.includes('"\' @SUM(1)"'))
  assert.ok(csv.endsWith('""'))
})

test('diagnostics hide signed URLs and credentials while retaining an actionable error', () => {
  const text = safeDiagnosticText('410 subscription expired https://push.example/private-token?token=secret token=hidden password=hidden')
  assert.match(text, /410 subscription expired/)
  assert.doesNotMatch(text, /private-token|secret|hidden/)
})

test('notification recipient resolves the employee and retry advice respects existing sending logic', () => {
  const row = { channel: 'push', recipient_reference: 'device', push_user_id: 'person', status: 'retry', error_code: null, error_message: null } as AdminDelivery
  assert.equal(deliveryRecipient(row, [profile('person', { full_name: 'ผู้รับ' })]), 'ผู้รับ · person@gmail.com')
  assert.match(deliveryAdvice(row), /อัตโนมัติ/)
  assert.match(deliveryAdvice({ ...row, status: 'failed', error_code: '410' }), /เชื่อมมือถือใหม่/)
})
