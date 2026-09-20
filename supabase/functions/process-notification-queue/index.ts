import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type Delivery = {
  id: string
  recipient_reference: string
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

function text(value: unknown) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim()
}

function escapeHtml(value: unknown) {
  return text(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
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
  const rows = [
    ['รายละเอียด', description],
    ['สถานที่', location],
    ['เริ่ม', startsAt],
    ['สิ้นสุด', endsAt],
    ['กำหนดส่ง', [dueDate, dueTime].filter(Boolean).join(' ')],
  ].filter(([, value]) => value)
    .map(([label, value]) => `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('')

  return `<h2>${escapeHtml(subject(template, payload))}</h2>${rows ? `<table>${rows}</table>` : ''}`
}

Deno.serve(async (request) => {
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  if (!apiKey || !senderEmail) return new Response('Notification provider is not configured', { status: 503 })

  const [{ error: recoveryError }, { error: reminderError }] = await Promise.all([
    supabase.rpc('requeue_stale_email_deliveries'),
    supabase.rpc('queue_due_email_reminders'),
  ])
  if (recoveryError || reminderError) return new Response(recoveryError?.message ?? reminderError!.message, { status: 500 })

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('notification_deliveries')
    .select('id, recipient_reference, template_key, payload, attempt')
    .eq('channel', 'email').in('status', ['queued', 'retry'])
    .lte('scheduled_at', now)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
    .order('scheduled_at').limit(50)
  if (error) return new Response(error.message, { status: 500 })

  let sent = 0
  for (const delivery of (data ?? []) as Delivery[]) {
    const attempt = delivery.attempt + 1
    const claimed = await supabase.from('notification_deliveries').update({ status: 'processing', attempt }).eq('id', delivery.id).in('status', ['queued', 'retry']).lte('scheduled_at', now).or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`).select('id').maybeSingle()
    if (claimed.error || !claimed.data) continue

    let response: Response
    let body: string
    try {
      response = await fetch(brevoUrl, {
        method: 'POST', headers: { 'api-key': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ sender: { email: senderEmail, name: senderName }, to: [{ email: delivery.recipient_reference }], subject: subject(delivery.template_key, delivery.payload), htmlContent: html(delivery.template_key, delivery.payload) }),
      })
      body = await response.text()
    } catch (error) {
      await supabase.from('notification_deliveries').update({
        status: attempt < 3 ? 'retry' : 'failed',
        next_attempt_at: attempt < 3 ? new Date(Date.now() + attempt * 5 * 60_000).toISOString() : null,
        error_code: 'network_error', error_message: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown network error',
      }).eq('id', delivery.id)
      continue
    }
    if (response.ok) {
      await supabase.from('notification_deliveries').update({ status: 'sent', sent_at: new Date().toISOString(), provider_reference: body.slice(0, 500), error_code: null, error_message: null }).eq('id', delivery.id)
      sent++
    } else {
      const retryable = response.status === 429 || response.status >= 500
      await supabase.from('notification_deliveries').update({ status: retryable && attempt < 3 ? 'retry' : response.status === 429 ? 'deferred_quota' : 'failed', next_attempt_at: retryable && attempt < 3 ? new Date(Date.now() + attempt * 5 * 60_000).toISOString() : null, error_code: String(response.status), error_message: body.slice(0, 1000) }).eq('id', delivery.id)
    }
  }
  return Response.json({ processed: data?.length ?? 0, sent })
})
