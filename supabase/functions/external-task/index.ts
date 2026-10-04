import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { externalTaskUrl } from './link.ts'
import { initialExternalRecipients } from './recipients.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const publicAppUrl = Deno.env.get('PUBLIC_APP_URL')
const admin = createClient(supabaseUrl, serviceRoleKey)
const corsHeaders = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info', 'access-control-allow-methods': 'GET, POST, OPTIONS' }

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
  const { data: recipient, error: recipientError } = await admin.from('task_external_recipients').select('email, acknowledged_at')
    .eq('task_id', task.id).eq('email', tokenRow.external_email).maybeSingle()
  if (recipientError) throw recipientError
  if (!recipient) return null
  if (task.status === 'completed' && task.completed_at && new Date(task.completed_at).getTime() + 30 * 24 * 60 * 60 * 1000 <= Date.now()) return null
  await admin.from('external_task_tokens').update({ last_accessed_at: new Date().toISOString() }).eq('id', tokenRow.id)
  return { ...task, recipient_email: recipient.email, acknowledged_at: recipient.acknowledged_at }
}

async function issueToken(request: Request) {
  const authorization = request.headers.get('authorization')
  if (!authorization) return response({ error: 'ต้องเข้าสู่ระบบก่อน' }, 401)
  const requester = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: userError } = await requester.auth.getUser()
  if (userError || !user) return response({ error: 'เซสชันไม่ถูกต้อง' }, 401)
  const { data: profile, error: profileError } = await admin.from('profiles').select('status').eq('id', user.id).maybeSingle()
  if (profileError) throw profileError
  if (profile?.status !== 'active') return response({ error: 'บัญชีนี้ไม่สามารถใช้งานได้' }, 403)
  const body = await request.json()
  const taskId = typeof body.taskId === 'string' ? body.taskId : ''
  const notificationType = body.notificationType === 'task_updated' ? 'task_updated' : 'task_assigned'
  if (!publicAppUrl) return response({ error: 'ยังไม่ได้ตั้งค่า PUBLIC_APP_URL สำหรับลิงก์ Task' }, 503)
  try {
    externalTaskUrl(publicAppUrl, 'validation')
  } catch { return response({ error: 'PUBLIC_APP_URL สำหรับลิงก์ Task ไม่ถูกต้อง' }, 503) }
  const { data: task, error: taskError } = await admin.from('tasks').select('*').eq('id', taskId).maybeSingle()
  if (taskError) throw taskError
  if (!task || task.creator_user_id !== user.id || task.deleted_at || task.status !== 'pending') return response({ error: 'ไม่สามารถออกลิงก์สำหรับ Task นี้ได้' }, 403)
  const now = new Date().toISOString()
  const { data: recipients, error: recipientsError } = await admin.from('task_external_recipients').select('email').eq('task_id', task.id).order('email')
  if (recipientsError) throw recipientsError
  if (!recipients?.length) return response({ error: 'ไม่พบอีเมลผู้รับภายนอกสำหรับ Task นี้' }, 422)
  let recipientEmails = recipients.map((recipient) => recipient.email)
  if (notificationType === 'task_assigned') {
    const [{ data: creator, error: creatorError }, { data: members, error: membersError }] = await Promise.all([
      admin.from('profiles').select('email').eq('id', task.creator_user_id).single(),
      admin.from('task_internal_recipients').select('profiles!user_id(email,status)').eq('task_id', task.id),
    ])
    if (creatorError || membersError) throw creatorError ?? membersError
    const internalEmails = (members ?? []).flatMap((member) => {
      const profile = member.profiles as unknown as { email: string; status: string } | null
      return profile?.status === 'active' ? [profile.email] : []
    })
    recipientEmails = initialExternalRecipients(recipientEmails, creator.email, internalEmails)
  }
  const deliveries = []
  for (const email of recipientEmails) {
    const token = randomToken()
    const tokenHash = await hashToken(token)
    const recipientTaskUrl = externalTaskUrl(publicAppUrl, token)
    const { error: tokenError } = await admin.from('external_task_tokens').insert({ task_id: task.id, external_email: email, token_hash: tokenHash, expires_at: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString() })
    if (tokenError) throw tokenError
    deliveries.push({ task_id: task.id, recipient_type: 'external_assignee', recipient_reference: email, channel: 'email', idempotency_key: `external-task:${notificationType}:${task.id}:${notificationType === 'task_assigned' ? email : tokenHash}`, scheduled_at: now, template_key: notificationType, payload: { entity: 'task', id: task.id, title: task.title, description: task.description, due_date: task.due_date, due_time: task.due_time, external_url: recipientTaskUrl } })
  }
  if (!deliveries.length) return response({ issued: 0 })
  const { error: queueError } = await admin.from('notification_deliveries').upsert(deliveries, { onConflict: 'idempotency_key', ignoreDuplicates: true })
  if (queueError) throw queueError
  return response({ issued: deliveries.length })
}

Deno.serve(async (request) => {
  try {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    if (request.method === 'POST') {
      if (request.headers.get('content-type')?.includes('multipart/form-data')) return response({ error: 'ผู้รับมอบหมายไม่สามารถอัปโหลดเอกสารได้' }, 403)
      const body = await request.clone().json()
      if (body.action === 'issue') return await issueToken(request)
      if (body.action === 'complete') return response({ error: 'เฉพาะผู้สร้าง Task เท่านั้นที่ยืนยันงานเสร็จได้' }, 403)
      if (body.action !== 'acknowledge') return response({ error: 'คำสั่งไม่ถูกต้อง' }, 400)
    } else if (request.method !== 'GET') return response({ error: 'ไม่รองรับคำสั่งนี้' }, 405)
    const token = request.method === 'GET' ? new URL(request.url).searchParams.get('token')?.trim() : (await request.json()).token?.trim()
    if (!token) return response({ error: 'ลิงก์งานไม่ถูกต้อง' }, 400)
    const task = await taskForToken(token)
    if (!task) return response({ error: 'ลิงก์หมดอายุหรือถูกยกเลิกแล้ว' }, 404)
    if (request.method === 'POST') {
      if (task.status !== 'pending') return response({ error: 'Task นี้ปิดงานแล้ว' }, 409)
      const { data, error } = await admin.from('task_external_recipients')
        .update({ acknowledged_at: task.acknowledged_at ?? new Date().toISOString() })
        .eq('task_id', task.id).eq('email', task.recipient_email).select('acknowledged_at').single()
      if (error) throw error
      return response({ acknowledged_at: data.acknowledged_at })
    }
    const [{ data: attachments, error: attachmentError }, { data: documentLinks, error: linkError }] = await Promise.all([
      admin.from('task_attachments').select('id, file_name, storage_path').eq('task_id', task.id),
      admin.from('document_links').select('id, display_name, url').eq('task_id', task.id),
    ])
    if (attachmentError || linkError) throw attachmentError ?? linkError
    const attachmentViews = await Promise.all((attachments ?? []).map(async (attachment) => {
      const { data, error } = await admin.storage.from('task-documents').createSignedUrl(attachment.storage_path, 300, { download: attachment.file_name })
      if (error || !data) throw error ?? new Error('ไม่สามารถสร้างลิงก์ไฟล์ได้')
      return { id: attachment.id, file_name: attachment.file_name, url: data.signedUrl }
    }))
    return response({ task: { title: task.title, description: task.description, due_date: task.due_date, due_time: task.due_time, status: task.status, acknowledged_at: task.acknowledged_at, attachments: attachmentViews, documentLinks: documentLinks ?? [] } })
  } catch (error) {
    console.error(error)
    return response({ error: 'ระบบไม่สามารถดำเนินการได้ในขณะนี้' }, 500)
  }
})
