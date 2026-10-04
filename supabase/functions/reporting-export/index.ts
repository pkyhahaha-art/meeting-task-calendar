import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const secret = Deno.env.get('REPORTING_SYNC_SECRET')
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const pageSize = 1000
const streams = [
  { table: 'profiles', key: 'profiles', time: 'updated_at', fields: 'id,employee_id,full_name,email,role,status,updated_at' },
  { table: 'audit_logs', key: 'auditLogs', time: 'created_at', fields: 'id,actor_user_id,action,entity_type,entity_id,created_at' },
  { table: 'notification_deliveries', key: 'notificationDeliveries', time: 'updated_at', fields: 'id,event_id,task_id,recipient_type,channel,template_key,status,attempt,error_code,created_at,sent_at,updated_at' },
  { table: 'system_logs', key: 'systemLogs', time: 'created_at', fields: 'id,job_name,status,processed_count,created_at' },
] as const
type Position = { at: string; id: string; done: boolean }
type Page = { cursor: string; until: string; positions: Record<string, Position> }

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'content-type': 'application/json' } })
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
}

function readPage(url: URL): Page {
  const cursorValue = url.searchParams.get('cursor') || '1970-01-01T00:00:00.000Z'
  // Older Sheets clients only persist "cursor". Let it carry continuation too,
  // so they advance through the full window even before Code.gs is upgraded.
  const encoded = url.searchParams.get('page') || (cursorValue.startsWith('page:') ? cursorValue.slice(5) : null)
  if (!encoded) {
    const cursor = cursorValue
    if (!validDate(cursor) || Date.parse(cursor) > Date.now()) throw new Error('Invalid cursor')
    return { cursor, until: new Date().toISOString(), positions: {} }
  }
  if (encoded.length > 8000) throw new Error('Invalid page')
  const page: Page = JSON.parse(atob(encoded))
  if (!page || !validDate(page.cursor) || !validDate(page.until) || Date.parse(page.cursor) > Date.parse(page.until)
    || Date.parse(page.until) > Date.now() || !page.positions || typeof page.positions !== 'object') throw new Error('Invalid page')
  for (const stream of streams) {
    const position = page.positions[stream.table]
    if (!position || typeof position.done !== 'boolean' || !validDate(position.at)
      || Date.parse(position.at) < Date.parse(page.cursor) || Date.parse(position.at) > Date.parse(page.until)
      || !/^(?:\d+|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i.test(position.id)) throw new Error('Invalid page')
  }
  return page
}

Deno.serve(async (request) => {
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return response({ error: 'Unauthorized' }, 401)
  let page: Page
  try { page = readPage(new URL(request.url)) } catch { return response({ error: 'Invalid reporting cursor or page' }, 400) }
  try {
    const results = await Promise.all(streams.map(async (stream) => {
      const position = page.positions[stream.table]
      if (position?.done) return { stream, rows: [], position }
      // Inclusive lower boundary also picks up changes committed at the last
      // cursor timestamp. Sheets upserts by id, so the overlap is harmless.
      let query = admin.from(stream.table).select(stream.fields, { count: 'exact' }).gte(stream.time, page.cursor).lte(stream.time, page.until)
      if (position) query = query.or(`${stream.time}.gt.${position.at},and(${stream.time}.eq.${position.at},id.gt.${position.id})`)
      const { data, count, error } = await query.order(stream.time).order('id').limit(pageSize)
      if (error) throw error
      if (count === null || count === undefined) throw new Error('Reporting row count unavailable')
      const rows = data ?? []
      if (count > 0 && rows.length === 0) throw new Error('Reporting page was truncated')
      const last = rows.at(-1)
      return { stream, rows, position: { at: last?.[stream.time] ?? page.cursor, id: String(last?.id ?? '0'), done: rows.length >= count } }
    }))
    const payload: Record<string, unknown> = {}
    for (const result of results) { payload[result.stream.key] = result.rows; page.positions[result.stream.table] = result.position }
    const hasMore = results.some((result) => !result.position.done)
    const nextPage = hasMore ? btoa(JSON.stringify(page)) : null
    return response({ ...payload, hasMore, nextPage, cursor: nextPage ? `page:${nextPage}` : page.until })
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : 'Reporting export failed' }, 500)
  }
})
