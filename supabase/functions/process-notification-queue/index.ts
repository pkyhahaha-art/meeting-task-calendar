import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { retryDelayMinutes } from './retry.ts'
import { internalTaskUrl } from './taskLink.ts'

type Delivery = {
  id: string
  event_id: string | null
  recipient_type: string
  recipient_reference: string
  channel: 'email' | 'line'
  template_key: string
  payload: Record<string, unknown>
  attempt: number
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const brevoUrl = 'https://api.brevo.com/v3/smtp/email'
const senderEmail = Deno.env.get('NOTIFICATION_SENDER_EMAIL')
const senderName = Deno.env.get('NOTIFICATION_SENDER_NAME') ?? 'Meeting & Task Calendar'
const apiKey = Deno.env.get('BREVO_API_KEY')
const cronSecret = Deno.env.get('NOTIFICATION_CRON_SECRET')
const lineAccessToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')
const publicAppUrl = Deno.env.get('PUBLIC_APP_URL')

function text(value: unknown) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim()
}

function escapeHtml(value: unknown) {
  return text(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) => value.toString(16).padStart(2, '0')).join('')
}

async function hashToken(token: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

async function payloadWithGuestLink(delivery: Delivery) {
  if (delivery.channel !== 'email' || delivery.recipient_type !== 'guest' || !delivery.event_id || !publicAppUrl) return delivery.payload
  const { data: guest } = await supabase.from('event_guests').select('id').eq('event_id', delivery.event_id)
    .eq('email', delivery.recipient_reference).is('revoked_at', null).maybeSingle()
  if (!guest) return delivery.payload
  const token = randomToken()
  await supabase.from('guest_tokens').update({ revoked_at: new Date().toISOString() })
    .eq('guest_id', guest.id).is('revoked_at', null)
  const { error } = await supabase.from('guest_tokens').insert({
    guest_id: guest.id, token_hash: await hashToken(token),
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
  })
  if (error) throw error
  const url = new URL(publicAppUrl)
  url.hash = `/guest-event?token=${encodeURIComponent(token)}`
  return { ...delivery.payload, guest_url: url.toString() }
}

async function payloadWithInternalTaskDetails(delivery: Delivery, payload: Record<string, unknown>) {
  if (delivery.channel !== 'email' || delivery.recipient_type !== 'task_assignee' || payload.entity !== 'task' || !publicAppUrl) return payload
  const taskId = text(payload.id)
  if (!taskId) return payload
  const [attachments, documentLinks] = await Promise.all([
    supabase.from('task_attachments').select('file_name').eq('task_id', taskId).order('uploaded_at'),
    supabase.from('document_links').select('display_name').eq('task_id', taskId).order('created_at'),
  ])
  if (attachments.error || documentLinks.error) throw attachments.error ?? documentLinks.error
  return {
    ...payload,
    internal_task_url: internalTaskUrl(publicAppUrl, taskId),
    task_documents: [...(attachments.data ?? []).map((file) => file.file_name), ...(documentLinks.data ?? []).map((link) => link.display_name)],
  }
}

function formatDateTime(value: unknown) {
  const date = new Date(String(value ?? ''))
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
  }).format(date)
}

function subject(template: string, payload: Record<string, unknown>) {
  const title = text(payload.title)
  const labels: Record<string, string> = {
    meeting_created: 'Meeting ใหม่', meeting_updated: 'Meeting ถูกแก้ไข', meeting_cancelled: 'Meeting ถูกยกเลิก',
    meeting_guest_added: 'คุณได้รับเชิญเข้าร่วม Meeting', meeting_reminder: 'แจ้งเตือน Meeting', task_assigned: 'คุณได้รับมอบหมาย Task',
    task_reminder: 'แจ้งเตือน Task',
    task_updated: 'Task ถูกแก้ไข', task_cancelled: 'Task ถูกยกเลิก', task_completed: 'Task เสร็จแล้ว',
  }
  return `${labels[template] ?? 'การแจ้งเตือน'}${title ? `: ${title}` : ''}`
}

function html(template: string, payload: Record<string, unknown>) {
  const description = text(payload.description)
  const location = text(payload.location)
  const startsAt = formatDateTime(payload.start_datetime)
  const endsAt = formatDateTime(payload.end_datetime)
  const dueDate = text(payload.due_date)
  const dueTime = text(payload.due_time)
  const externalUrl = text(payload.external_url)
  const guestUrl = text(payload.guest_url)
  const internalTaskUrl = text(payload.internal_task_url)
  const rows = [
    ['รายละเอียด', description],
    ['สถานที่', location],
    ['เริ่ม', startsAt],
    ['สิ้นสุด', endsAt],
    ['กำหนดส่ง', [dueDate, dueTime].filter(Boolean).join(' ')],
  ].filter(([, value]) => value)
    .map(([label, value]) => `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('')

  const actionUrl = externalUrl || guestUrl || internalTaskUrl
  const action = actionUrl.startsWith('https://') || actionUrl.startsWith('http://')
    ? `<p><a href="${escapeHtml(actionUrl)}">${externalUrl ? 'เปิด Task ของคุณ' : guestUrl ? 'เปิดรายละเอียด Meeting' : 'เปิด Task ในระบบ'}</a></p>` : ''
  const documents = Array.isArray(payload.task_documents) && internalTaskUrl.startsWith('http')
    ? payload.task_documents.map(text).filter(Boolean).slice(0, 20)
      .map((name) => `<li><a href="${escapeHtml(internalTaskUrl)}">${escapeHtml(name)}</a></li>`).join('')
    : ''
  const documentList = documents ? `<h3>เอกสารประกอบ</h3><ul>${documents}</ul><p>โปรดเข้าสู่ระบบเพื่อเปิดเอกสารตามสิทธิ์ของคุณ</p>` : ''
  return `<h2>${escapeHtml(subject(template, payload))}</h2>${rows ? `<table>${rows}</table>` : ''}${action}${documentList}`
}

async function send(delivery: Delivery, payload: Record<string, unknown>) {
  if (delivery.channel === 'line') {
    if (!lineAccessToken) return new Response('LINE provider is not configured', { status: 503 })
    return fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { authorization: `Bearer ${lineAccessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ to: delivery.recipient_reference, messages: [{ type: 'text', text: `${subject(delivery.template_key, payload)}\n${text(payload.description)}`.trim().slice(0, 5000) }] }),
    })
  }
  if (!apiKey || !senderEmail) return new Response('Email provider is not configured', { status: 503 })
  return fetch(brevoUrl, {
    method: 'POST', headers: { 'api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({ sender: { email: senderEmail, name: senderName }, to: [{ email: delivery.recipient_reference }], subject: subject(delivery.template_key, payload), htmlContent: html(delivery.template_key, payload) }),
  })
}

Deno.serve(async (request) => {
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  const [{ error: recoveryError }, { error: lineReminderError }, { error: reminderError }] = await Promise.all([
    supabase.rpc('requeue_stale_email_deliveries'),
    supabase.rpc('queue_due_line_reminders'),
    supabase.rpc('queue_due_email_reminders'),
  ])
  if (recoveryError || lineReminderError || reminderError) return new Response(recoveryError?.message ?? lineReminderError?.message ?? reminderError!.message, { status: 500 })

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('notification_deliveries')
    .select('id, event_id, recipient_type, recipient_reference, channel, template_key, payload, attempt')
    .in('channel', ['email', 'line']).in('status', ['queued', 'retry'])
    .lte('scheduled_at', now)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
    .order('scheduled_at').limit(50)
  if (error) return new Response(error.message, { status: 500 })

  let sent = 0
  for (const delivery of (data ?? []) as Delivery[]) {
    const attempt = delivery.attempt + 1
    const retryDelay = retryDelayMinutes(attempt)
    const claimed = await supabase.from('notification_deliveries').update({ status: 'processing', attempt }).eq('id', delivery.id).in('status', ['queued', 'retry']).lte('scheduled_at', now).or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`).select('id').maybeSingle()
    if (claimed.error || !claimed.data) continue

    let response: Response
    let body: string
    try {
      const guestPayload = await payloadWithGuestLink(delivery)
      const payload = await payloadWithInternalTaskDetails(delivery, guestPayload)
      response = await send(delivery, payload)
      body = await response.text()
    } catch (error) {
      await supabase.from('notification_deliveries').update({
        status: retryDelay === null ? 'failed' : 'retry',
        next_attempt_at: retryDelay === null ? null : new Date(Date.now() + retryDelay * 60_000).toISOString(),
        error_code: 'network_error', error_message: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown network error',
      }).eq('id', delivery.id)
      continue
    }
    if (response.ok) {
      await supabase.from('notification_deliveries').update({ status: 'sent', sent_at: new Date().toISOString(), provider_reference: body.slice(0, 500), error_code: null, error_message: null }).eq('id', delivery.id)
      sent++
    } else {
      const retryable = response.status === 429 || response.status >= 500
      await supabase.from('notification_deliveries').update({ status: retryable && retryDelay !== null ? 'retry' : response.status === 429 ? 'deferred_quota' : 'failed', next_attempt_at: retryable && retryDelay !== null ? new Date(Date.now() + retryDelay * 60_000).toISOString() : null, error_code: String(response.status), error_message: body.slice(0, 1000) }).eq('id', delivery.id)
    }
  }
  return Response.json({ processed: data?.length ?? 0, sent })
})
