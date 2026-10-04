import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { webcrypto, createHash } from 'node:crypto'
import ts from 'typescript'

type Row = Record<string, unknown>
type Store = Record<string, Row[]>
const timestamp = '2026-10-04T12:00:00.000Z'
const token = 'fixture-token'
const hash = createHash('sha256').update(token).digest('hex')

function endpoint(files: string[], rows: Store, options: { profileError?: boolean; membershipError?: boolean; clock?: string; serverRowLimit?: number } = {}) {
  let handler!: (request: Request) => Promise<Response>
  const writes: string[] = []
  let signed = 0
  class Query {
    table: string
    predicates: ((row: Row) => boolean)[] = []
    orders: string[] = []
    limitCount = Infinity
    mutation?: { kind: string; value: Row | Row[] }
    constructor(table: string) { this.table = table }
    select() { return this }
    eq(key: string, value: unknown) { this.predicates.push((row) => row[key] === value); return this }
    is(key: string, value: unknown) { return this.eq(key, value) }
    gt(key: string, value: string) { this.predicates.push((row) => String(row[key]) > value); return this }
    gte(key: string, value: string) { this.predicates.push((row) => String(row[key]) >= value); return this }
    lte(key: string, value: string) { this.predicates.push((row) => String(row[key]) <= value); return this }
    order(key: string) { this.orders.push(key); return this }
    limit(count: number) { this.limitCount = count; return this }
    compare(key: string, a: Row, b: Row) {
      if (key === 'id' && ['audit_logs', 'system_logs'].includes(this.table)) return Number(BigInt(String(a.id)) - BigInt(String(b.id)))
      return String(a[key]).localeCompare(String(b[key]))
    }
    or(value: string) {
      const match = /^(\w+)\.gt\.([^,]+),and\(\1\.eq\.([^,]+),id\.gt\.([^)]+)\)$/.exec(value)
      assert.ok(match, value)
      const [, key, after, equal, id] = match
      this.predicates.push((row) => String(row[key]) > after || (row[key] === equal && this.compare('id', row, { id }) > 0))
      return this
    }
    insert(value: Row | Row[]) { this.mutation = { kind: 'insert', value }; return this }
    upsert(value: Row | Row[]) { this.mutation = { kind: 'insert', value }; return this }
    update(value: Row) { this.mutation = { kind: 'update', value }; return this }
    result(single = false) {
      if (options.profileError && this.table === 'profiles') return { data: null, error: { message: 'fixture database unavailable' } }
      let data = (rows[this.table] || []).filter((row) => this.predicates.every((predicate) => predicate(row)))
      if (this.mutation) {
        writes.push(this.table)
        if (this.mutation.kind === 'insert') (rows[this.table] ||= []).push(...[this.mutation.value].flat())
        else data.forEach((row) => Object.assign(row, this.mutation!.value))
      }
      const count = data.length
      data = [...data].sort((a, b) => this.orders.reduce((result, key) => result || this.compare(key, a, b), 0)).slice(0, Math.min(this.limitCount, options.serverRowLimit ?? Infinity))
      return { data: single ? data[0] || null : data.map((row) => ({ ...row })), count, error: null }
    }
    maybeSingle() { return Promise.resolve(this.result(true)) }
    single() { return this.maybeSingle() }
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve(this.result()).then(resolve, reject) }
  }
  const admin = {
    from: (table: string) => new Query(table),
    rpc: async () => ({ data: rows.current_guests || [], error: options.membershipError ? { message: 'fixture access lookup failed' } : null }),
    storage: { from: () => ({ createSignedUrl: async () => { signed++; return { data: { signedUrl: 'https://fixture.invalid/private' }, error: null } } }) },
  }
  class FixedDate extends Date {
    constructor(value?: string) { super(value ?? options.clock ?? timestamp) }
    static now() { return Date.parse(options.clock ?? timestamp) }
  }
  const context = vm.createContext({
    createClient: (_url: string, _key: string, config?: unknown) => config
      ? { auth: { getUser: async () => ({ data: { user: { id: 'creator' } }, error: null }) } } : admin,
    Deno: { env: { get: (key: string) => key === 'PUBLIC_APP_URL' ? 'https://fixture.invalid/calendar/' : 'fixture' }, serve: (serve: typeof handler) => { handler = serve } },
    Response, Request, URL, TextEncoder, crypto: webcrypto, Date: FixedDate, Promise, atob, btoa,
    console: { error: () => undefined },
  })
  for (const file of files) {
    const source = readFileSync(new URL('../../' + file, import.meta.url), 'utf8').replace(/^import .*\n/gm, '').replace(/export /g, '')
    vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context)
  }
  return { handler, writes, signed: () => signed }
}

function guestStore(): Store {
  return {
    guest_tokens: [{ id: 'token-id', guest_id: 'guest-id', token_hash: hash, occurrence_id: 'occurrence-id', expires_at: '2099-01-01T00:00:00Z', revoked_at: null }],
    event_guests: [{ id: 'guest-id', event_id: 'meeting-id', email: 'guest@gmail.com', occurrence_id: null, revoked_at: null }],
    events: [{ id: 'meeting-id', title: 'Fixture', status: 'scheduled', deleted_at: null }],
    event_occurrences: [{ id: 'occurrence-id', event_id: 'meeting-id', status: 'scheduled', override_payload: { description: 'Private appointment' } }],
    attachments: [{ id: 'file-id', event_id: 'meeting-id', occurrence_id: 'occurrence-id', storage_path: 'private/fixture.pdf', file_name: 'Fixture.pdf' }],
    current_guests: [],
  }
}

for (const action of ['read', 'document', 'acknowledge']) test('guest endpoint blocks an excluded series guest: ' + action, async () => {
  const service = endpoint(['supabase/functions/guest-event/index.ts'], guestStore())
  const request = action === 'acknowledge'
    ? new Request('https://fixture.invalid/', { method: 'POST', body: JSON.stringify({ token, action: 'acknowledge' }) })
    : new Request('https://fixture.invalid/?token=' + token + (action === 'document' ? '&attachment_id=file-id' : ''))
  const response = await service.handler(request)
  assert.equal(response.status, 404)
  assert.equal(service.signed(), 0)
  assert.deepEqual(service.writes, [])
})

test('guest endpoint still reads and signs documents for a current appointment guest', async () => {
  const rows = guestStore(); rows.current_guests = [{ email: 'guest@gmail.com' }]
  const service = endpoint(['supabase/functions/guest-event/index.ts'], rows)
  const response = await service.handler(new Request('https://fixture.invalid/?token=' + token))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).event.attachments.length, 1)
  assert.equal(service.signed(), 1)
})

test('guest endpoint fails closed when current membership cannot be checked', async () => {
  const service = endpoint(['supabase/functions/guest-event/index.ts'], guestStore(), { membershipError: true })
  const response = await service.handler(new Request('https://fixture.invalid/?token=' + token))
  assert.equal(response.status, 500)
  assert.equal(service.signed(), 0)
})

test('guest endpoint refuses a scoped guest token for another appointment', async () => {
  const rows = guestStore(); rows.event_guests[0].occurrence_id = 'other-appointment'
  const service = endpoint(['supabase/functions/guest-event/index.ts'], rows)
  assert.equal((await service.handler(new Request('https://fixture.invalid/?token=' + token))).status, 404)
  assert.equal(service.signed(), 0)
})

const externalFiles = ['supabase/functions/external-task/link.ts', 'supabase/functions/external-task/recipients.ts', 'supabase/functions/external-task/index.ts']
function externalStore(status: string): Store {
  return {
    profiles: [{ id: 'creator', email: 'creator@gmail.com', status }],
    tasks: [{ id: 'task-id', creator_user_id: 'creator', title: 'Fixture', status: 'pending', deleted_at: null }],
    task_external_recipients: [{ task_id: 'task-id', email: 'guest@gmail.com' }],
    task_internal_recipients: [],
  }
}
function issueRequest() {
  return new Request('https://fixture.invalid/', { method: 'POST', headers: { authorization: 'Bearer fixture-session', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'issue', taskId: 'task-id' }) })
}
for (const status of ['disabled', 'pending_verification']) test('external issue endpoint rejects an authenticated ' + status + ' creator', async () => {
  const service = endpoint(externalFiles, externalStore(status))
  assert.equal((await service.handler(issueRequest())).status, 403)
  assert.deepEqual(service.writes, [])
})
test('external issue endpoint fails closed on a profile lookup failure', async () => {
  const service = endpoint(externalFiles, externalStore('active'), { profileError: true })
  assert.equal((await service.handler(issueRequest())).status, 500)
  assert.deepEqual(service.writes, [])
})
test('external issue endpoint preserves issuance for the active Task creator', async () => {
  const service = endpoint(externalFiles, externalStore('active'))
  assert.equal((await service.handler(issueRequest())).status, 200)
  assert.deepEqual(service.writes, ['external_task_tokens', 'notification_deliveries'])
})

function exportRequest(cursor = '1970-01-01T00:00:00.000Z', page?: string) {
  return new Request('https://fixture.invalid/?cursor=' + encodeURIComponent(cursor) + (page ? '&page=' + encodeURIComponent(page) : ''), { headers: { authorization: 'Bearer fixture' } })
}
test('reporting export pages more than 1000 equal-timestamp rows without advancing the high water early', async () => {
  const rows: Store = { audit_logs: Array.from({ length: 2101 }, (_, index) => ({ id: index + 1, created_at: '2026-10-01T00:00:00.000Z' })) }
  const service = endpoint(['supabase/functions/reporting-export/index.ts'], rows)
  const ids: number[] = []
  let page: string | undefined
  let cursor = '1970-01-01T00:00:00.000Z'
  do {
    const response = await service.handler(exportRequest(cursor, page))
    assert.equal(response.status, 200)
    const payload = await response.json()
    ids.push(...payload.auditLogs.map((row: { id: number }) => row.id))
    if (payload.hasMore) assert.ok(payload.cursor.startsWith('page:'))
    page = payload.nextPage || undefined
    if (!page) cursor = payload.cursor
  } while (page)
  assert.equal(ids.length, 2101)
  assert.equal(new Set(ids).size, 2101)
  assert.equal(cursor, timestamp)
})

test('legacy reporting clients finish paging by persisting only the cursor field', async () => {
  const rows: Store = { audit_logs: Array.from({ length: 1001 }, (_, index) => ({ id: index + 1, created_at: '2026-10-01T00:00:00.000Z' })) }
  const service = endpoint(['supabase/functions/reporting-export/index.ts'], rows)
  const first = await (await service.handler(exportRequest())).json()
  const second = await (await service.handler(exportRequest(first.cursor))).json()
  assert.equal(first.auditLogs.length + second.auditLogs.length, 1001)
  assert.equal(second.cursor, timestamp)
})

test('reporting export returns later delivery status changes and includes the cursor boundary', async () => {
  const rows: Store = { notification_deliveries: [{ id: '00000000-0000-0000-0000-000000000001', created_at: '2026-10-01T00:00:00.000Z', updated_at: timestamp, status: 'sent' }] }
  const service = endpoint(['supabase/functions/reporting-export/index.ts'], rows)
  const payload = await (await service.handler(exportRequest(timestamp))).json()
  assert.equal(payload.notificationDeliveries[0].status, 'sent')
  assert.equal(payload.notificationDeliveries[0].updated_at, timestamp)
})

test('reporting export keeps the first page high water while later records wait for the next window', async () => {
  const rows: Store = { audit_logs: Array.from({ length: 1001 }, (_, index) => ({ id: index + 1, created_at: '2026-10-01T00:00:00.000Z' })) }
  const service = endpoint(['supabase/functions/reporting-export/index.ts'], rows)
  const first = await (await service.handler(exportRequest())).json()
  rows.audit_logs.push({ id: 1002, created_at: '2026-10-04T12:00:01.000Z' })
  const second = await (await service.handler(exportRequest(undefined, first.nextPage))).json()
  assert.equal(second.auditLogs.length, 1)
  assert.equal(second.auditLogs[0].id, 1001)
  assert.equal(second.cursor, timestamp)
})
test('reporting export follows server row caps smaller than its requested page size', async () => {
  const rows: Store = { audit_logs: Array.from({ length: 31 }, (_, index) => ({ id: index + 1, created_at: '2026-10-01T00:00:00.000Z' })) }
  const service = endpoint(['supabase/functions/reporting-export/index.ts'], rows, { serverRowLimit: 10 })
  let cursor = '1970-01-01T00:00:00.000Z'
  let total = 0
  let hasMore = true
  while (hasMore) {
    const payload = await (await service.handler(exportRequest(cursor))).json()
    total += payload.auditLogs.length; cursor = payload.cursor; hasMore = payload.hasMore
  }
  assert.equal(total, 31)
  assert.equal(cursor, timestamp)
})
test('reporting export rejects malformed cursors and page filter injection', async () => {
  const service = endpoint(['supabase/functions/reporting-export/index.ts'], {})
  assert.equal((await service.handler(exportRequest('bad-cursor'))).status, 400)
  const invalid = btoa(JSON.stringify({ cursor: timestamp, until: timestamp, positions: { profiles: { at: timestamp, id: '0),id.gt.0', done: false } } }))
  assert.equal((await service.handler(exportRequest(timestamp, invalid))).status, 400)
})
