import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const admin = createClient(supabaseUrl, serviceRoleKey)
const corsHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' }

function response(body: Record<string, unknown>, status = 200) { return Response.json(body, { status, headers: corsHeaders }) }
function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, '0')).join('') }
async function hashToken(token: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

async function taskForToken(token: string) {
  const { data: tokenRow, error: tokenError } = await admin.from('external_task_tokens').select('*').eq('token_hash', await hashToken(token)).is('revoked_at', null).maybeSingle()
  if (tokenError) throw tokenError
  if (!tokenRow || (tokenRow.expires_at && new Date(tokenRow.expires_at) <= new Date())) return null
  const { data: task, error: taskError } = await admin.from('tasks').select('*').eq('id', tokenRow.task_id).maybeSingle()
  if (taskError) throw taskError
  if (!task || task.deleted_at || task.status === 'cancelled') return null
  if (task.status === 'completed' && task.completed_at && new Date(task.completed_at).getTime() + 30 * 24 * 60 * 60 * 1000 <= Date.now()) return null
  await admin.from('external_task_tokens').update({ last_accessed_at: new Date().toISOString() }).eq('id', tokenRow.id)
  return task
}

async function issueToken(request: Request) {
  const authorization = request.headers.get('authorization')
  if (!authorization) return response({ error: 'ต้องเข้าสู่ระบบก่อน' }, 401)
  const requester = createClient(supabaseUrl, anonKey, { global: { headers: { authorization } } })
  const { data: { user }, error: userError } = await requester.auth.getUser()
  if (userError || !user) return response({ error: 'เซสชันไม่ถูกต้อง' }, 401)
  const body = await request.json()
  const taskId = typeof body.taskId === 'string' ? body.taskId : ''
  let taskUrl: URL
  try {
    taskUrl = new URL(typeof body.publicUrl === 'string' ? body.publicUrl : '')
    if (!['https:', 'http:'].includes(taskUrl.protocol)) throw new Error('unsupported protocol')
  } catch { return response({ error: 'ลิงก์ Task ไม่ถูกต้อง' }, 400) }
  if (!request.headers.get('origin') || taskUrl.origin !== request.headers.get('origin')) return response({ error: 'โดเมนลิงก์ Task ไม่ถูกต้อง' }, 400)
  const { data: task, error: taskError } = await admin.from('tasks').select('*').eq('id', taskId).maybeSingle()
  if (taskError) throw taskError
  if (!task || task.creator_user_id !== user.id || task.assignee_type !== 'external' || task.deleted_at || task.status !== 'pending') return response({ error: 'ไม่สามารถออกลิงก์สำหรับ Task นี้ได้' }, 403)
  const token = randomToken()
  const tokenHash = await hashToken(token)
  const now = new Date().toISOString()
  const { error: revokeError } = await admin.from('external_task_tokens').update({ revoked_at: now }).eq('task_id', task.id).is('revoked_at', null)
  if (revokeError) throw revokeError
  const { error: tokenError } = await admin.from('external_task_tokens').insert({ task_id: task.id, external_email: task.external_assignee_email, token_hash: tokenHash })
  if (tokenError) throw tokenError
  taskUrl.searchParams.set('token', token)
  const { error: queueError } = await admin.from('notification_deliveries').insert({ task_id: task.id, recipient_type: 'external_assignee', recipient_reference: task.external_assignee_email, channel: 'email', idempotency_key: `external-task-assigned:${task.id}:${tokenHash}`, scheduled_at: now, template_key: 'task_assigned', payload: { entity: 'task', id: task.id, title: task.title, description: task.description, due_date: task.due_date, due_time: task.due_time, external_url: taskUrl.toString() } })
  if (queueError) throw queueError
  return response({ url: taskUrl.toString() })
}

Deno.serve(async (request) => {
  try {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (request.method === 'POST') {
      const body = await request.clone().json()
      if (body.action === 'issue') return await issueToken(request)
      if (body.action !== 'complete') return response({ error: 'คำสั่งไม่ถูกต้อง' }, 400)
    } else if (request.method !== 'GET') return response({ error: 'ไม่รองรับคำสั่งนี้' }, 405)
    const token = request.method === 'GET' ? new URL(request.url).searchParams.get('token')?.trim() : (await request.json()).token?.trim()
    if (!token) return response({ error: 'ลิงก์งานไม่ถูกต้อง' }, 400)
    const task = await taskForToken(token)
    if (!task) return response({ error: 'ลิงก์หมดอายุหรือถูกยกเลิกแล้ว' }, 404)
    if (request.method === 'POST') {
      if (task.status === 'pending') {
        const { error } = await admin.from('tasks').update({ status: 'completed' }).eq('id', task.id).eq('status', 'pending')
        if (error) throw error
      }
      return response({ status: 'completed' })
    }
    const [{ data: attachments, error: attachmentError }, { data: documentLinks, error: linkError }] = await Promise.all([
      admin.from('task_attachments').select('id, file_name, storage_path').eq('task_id', task.id),
      admin.from('document_links').select('id, display_name, url').eq('task_id', task.id),
    ])
    if (attachmentError || linkError) throw attachmentError ?? linkError
    const attachmentViews = await Promise.all((attachments ?? []).map(async (attachment) => {
      const { data, error } = await admin.storage.from('task-documents').createSignedUrl(attachment.storage_path, 300)
      if (error || !data) throw error ?? new Error('ไม่สามารถสร้างลิงก์ไฟล์ได้')
      return { id: attachment.id, file_name: attachment.file_name, url: data.signedUrl }
    }))
    return response({ task: { title: task.title, description: task.description, due_date: task.due_date, due_time: task.due_time, status: task.status, attachments: attachmentViews, documentLinks: documentLinks ?? [] } })
  } catch (error) {
    console.error(error)
    return response({ error: 'ระบบไม่สามารถดำเนินการได้ในขณะนี้' }, 500)
  }
})
