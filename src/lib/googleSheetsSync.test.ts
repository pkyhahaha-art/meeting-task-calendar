import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

type Payload = Record<string, unknown>
class Sheet {
  values: unknown[][] = []
  maxRows = 1000
  getLastRow() { return this.values.length }
  getMaxRows() { return this.maxRows }
  insertRowsAfter(_row: number, count: number) { this.maxRows += count }
  getRange(row: number, column: number, height: number, width: number) {
    if (row + height - 1 > this.maxRows) throw new Error('Range exceeds sheet row capacity')
    return {
      getValues: () => Array.from({ length: height }, (_, index) => Array.from({ length: width }, (_, cell) => this.values[row + index - 1]?.[column + cell - 1] ?? '')),
      setValues: (values: unknown[][]) => values.forEach((cells, index) => {
        const target = this.values[row + index - 1] ||= []
        cells.forEach((value, cell) => { target[column + cell - 1] = value })
      }),
    }
  }
}
function script(responses: Payload[]) {
  const sheets = new Map<string, Sheet>()
  const properties = new Map([['REPORTING_SYNC_SECRET', 'fixture'], ['meetingTaskCalendarCursor', '2026-10-01T00:00:00.000Z']])
  const urls: string[] = []
  let releases = 0
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => properties.get(key), setProperty: (key: string, value: string) => properties.set(key, value) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { releases++ } }) },
    SpreadsheetApp: { getActive: () => ({ getSheetByName: (name: string) => sheets.get(name), insertSheet: (name: string) => { const sheet = new Sheet(); sheets.set(name, sheet); return sheet } }) },
    UrlFetchApp: { fetch: (url: string) => {
      urls.push(url)
      const payload = responses.shift()
      if (!payload) throw new Error('fixture page failed')
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(payload) }
    } },
  })
  vm.runInContext(readFileSync(new URL('../../integrations/google-sheets/Code.gs', import.meta.url), 'utf8'), context)
  return { context, sheets, properties, urls, responses, releases: () => releases }
}
function page(overrides: Payload = {}): Payload {
  return { profiles: [], auditLogs: [], notificationDeliveries: [], systemLogs: [], cursor: '2026-10-04T12:00:00.000Z', hasMore: false, nextPage: null, ...overrides }
}

test('Sheets sync updates delivery rows by id without duplicating records on overlap or retry', () => {
  const state = script([
    page({ notificationDeliveries: [{ id: 'delivery', status: 'queued' }] }),
    page({ notificationDeliveries: [{ id: 'delivery', status: 'sent' }] }),
    page({ notificationDeliveries: [{ id: 'delivery', status: 'sent' }] }),
  ])
  state.context.syncMeetingTaskCalendar()
  state.context.syncMeetingTaskCalendar()
  state.context.syncMeetingTaskCalendar()
  const values = state.sheets.get('Notification_Log')!.values
  assert.equal(values.length, 2)
  assert.equal(values[1][values[0].indexOf('status')], 'sent')
  assert.ok(values[0].includes('updated_at'))
})

test('Sheets sync drains all pages and expands row capacity beyond 1000', () => {
  const state = script([
    page({ auditLogs: Array.from({ length: 1000 }, (_, index) => ({ id: index + 1 })), hasMore: true, nextPage: 'fixture-page', cursor: 'page:fixture-page' }),
    page({ auditLogs: [{ id: 1001 }] }),
  ])
  state.context.syncMeetingTaskCalendar()
  assert.equal(state.urls.length, 2)
  assert.ok(state.urls[1].includes('&page=fixture-page'))
  assert.equal(state.sheets.get('Audit_Log')!.values.length, 1002)
  assert.equal(state.sheets.get('Audit_Log')!.maxRows, 1002)
  assert.equal(state.properties.get('meetingTaskCalendarCursor'), '2026-10-04T12:00:00.000Z')
  assert.equal(state.releases(), 1)
})

test('Sheets page failure preserves the old cursor and safely retries already-written rows', () => {
  const first = page({ profiles: [{ id: 'member', full_name: 'Fixture' }], hasMore: true, nextPage: 'next', cursor: 'page:next' })
  const state = script([first])
  assert.throws(() => state.context.syncMeetingTaskCalendar(), /fixture page failed/)
  assert.equal(state.properties.get('meetingTaskCalendarCursor'), '2026-10-01T00:00:00.000Z')
  state.responses.push(first, page({ profiles: [{ id: 'member', full_name: 'Updated fixture' }] }))
  state.context.syncMeetingTaskCalendar()
  assert.equal(state.sheets.get('Users')!.values.length, 2)
  assert.equal(state.sheets.get('Users')!.values[1][2], 'Updated fixture')
  assert.equal(state.releases(), 2)
})

test('Sheets sync accepts a continuation cursor stored by an older client', () => {
  const state = script([page({ auditLogs: [{ id: 1001 }] })])
  state.properties.set('meetingTaskCalendarCursor', 'page:old-continuation')
  state.context.syncMeetingTaskCalendar()
  assert.ok(state.urls[0].includes('cursor=page%3Aold-continuation'))
  assert.equal(state.properties.get('meetingTaskCalendarCursor'), '2026-10-04T12:00:00.000Z')
})

test('Sheets sync rejects a truncated page without advancing its cursor', () => {
  const state = script([page({ hasMore: true, nextPage: null })])
  assert.throws(() => state.context.syncMeetingTaskCalendar(), /next page/)
  assert.equal(state.properties.get('meetingTaskCalendarCursor'), '2026-10-01T00:00:00.000Z')
  assert.equal(state.releases(), 1)
})
