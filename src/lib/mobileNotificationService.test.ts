import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const deviceId = '10000000-0000-4000-8000-000000000001'
const notificationId = '20000000-0000-4000-8000-000000000002'
const proof = { endpoint: 'https://web.push.apple.com/inbox-unit', auth: 'unit-device-secret-123456789' }

// Run the actual Edge handler with local database/storage adapters; no outbound calls.
function service(active = true) {
  let handler!: (request: Request) => Promise<Response>
  let signings = 0
  const db = {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      return {
        select() { return this },
        eq(key: string, value: unknown) { filters[key] = value; return this },
        async maybeSingle() {
          const data = table === 'profiles' ? { status: active ? 'active' : 'disabled' }
            : filters.endpoint === proof.endpoint && filters.auth === proof.auth
              ? { id: deviceId, user_id: 'user', ...proof, p256dh: 'unit-key' } : null
          return { data, error: null }
        },
      }
    },
    async rpc(name: string, args: Record<string, string>) {
      assert.equal(name, 'mobile_notification_details')
      assert.equal(args.target_device_id, deviceId)
      return { data: args.target_delivery_id === notificationId ? {
        details: { entity: 'task', title: 'Task', affiliation: 'Department', due_date: '2026-10-06' },
        documents: [{ id: 'file', name: 'Report.pdf', bucket: 'task-documents', storage_path: 'creator/task/report.pdf' }],
      } : null, error: null }
    },
    storage: { from(bucket: string) { return { async createSignedUrl(path: string, expires: number, options: { download: false | string }) {
      assert.equal(bucket, 'task-documents'); assert.equal(path, 'creator/task/report.pdf'); assert.equal(expires, 900)
      signings++
      return { data: { signedUrl: `https://storage.example/signed?download=${encodeURIComponent(String(options.download))}` }, error: null }
    } } } },
  }
  const helperFiles = ['webPushDelivery.ts', 'mobileTestTarget.ts', 'mobileNotificationDocuments.ts']
  const helpers = helperFiles.map((file) => readFileSync(new URL(`../../supabase/functions/_shared/${file}`, import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '').replace(/export /g, '')).join('\n')
  const entry = readFileSync(new URL('../../supabase/functions/mobile-push/index.ts', import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
  const compiled = ts.transpileModule(`${helpers}\n${entry}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  vm.runInNewContext(compiled, { URL, Request, Response, Date, JSON, crypto, createClient: () => db, webpush: {},
    Deno: { env: { get: (key: string) => key === 'SUPABASE_URL' ? 'https://database.example' : 'unit-config' },
      serve: (callback: typeof handler) => { handler = callback } },
  })
  return { call: (body: unknown) => handler(new Request('https://functions.example/mobile-push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })), signed: () => signings }
}

test('the paired-device API returns full details and both temporary links without exposing private paths', async () => {
  const server = service()
  const response = await server.call({ ...proof, action: 'inbox-details', notificationId })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const content = await response.json()
  assert.equal(content.details.affiliation, 'Department')
  assert.equal(content.documents.length, 1)
  assert.ok(content.documents[0].previewUrl && content.documents[0].downloadUrl)
  assert.equal(server.signed(), 2)
  assert.doesNotMatch(JSON.stringify(content), /storage_path|unit-device-secret|creator\/task/)
})

test('the API denies wrong proof, another delivery and inactive users before signing any document', async () => {
  for (const [active, body, status] of [
    [true, { ...proof, auth: 'wrong-secret-123456789012345', action: 'inbox-details', notificationId }, 403],
    [true, { ...proof, action: 'inbox-details', notificationId: '30000000-0000-4000-8000-000000000003' }, 403],
    [false, { ...proof, action: 'inbox-details', notificationId }, 403],
    [true, { ...proof, action: 'inbox-details', notificationId: 'not-a-delivery' }, 400],
  ] as const) {
    const server = service(active)
    assert.equal((await server.call(body)).status, status)
    assert.equal(server.signed(), 0)
  }
})
