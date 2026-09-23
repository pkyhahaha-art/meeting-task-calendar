import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { html, subject, text } from './emailTemplate.ts'
import { internalMeetingUrl } from './meetingLink.ts'
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

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabase = createClient(
  supabaseUrl,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const brevoUrl = 'https://api.brevo.com/v3/smtp/email'
const senderEmail = Deno.env.get('NOTIFICATION_SENDER_EMAIL')
const senderName = Deno.env.get('NOTIFICATION_SENDER_NAME') ?? 'Meeting & Task Calendar'
const apiKey = Deno.env.get('BREVO_API_KEY')
const cronSecret = Deno.env.get('NOTIFICATION_CRON_SECRET')
const lineAccessToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')
const publicAppUrl = Deno.env.get('PUBLIC_APP_URL')

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  try { return JSON.stringify(error) || 'Unknown error' } catch { return String(error) }
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
  return { ...delivery.payload, guest_url: url.toString(), guest_token: token }
}

async function payloadWithMeetingDetails(delivery: Delivery, payload: Record<string, unknown>) {
  if (delivery.channel !== 'email' || !delivery.event_id) return payload
  const { data: event, error: eventError } = await supabase.from('events')
    .select('id, owner_user_id, title, description, affiliation, start_datetime, end_datetime, all_day, location, timezone, recurrence_rule, status')
    .eq('id', delivery.event_id).maybeSingle()
  if (eventError || !event) {
    console.error('Unable to load Meeting details for email', errorMessage(eventError))
    return payload
  }
  const [owner, attachments] = await Promise.all([
    supabase.from('profiles').select('full_name, email').eq('id', event.owner_user_id).maybeSingle(),
    supabase.from('attachments').select('id, file_name, file_size, storage_path').eq('event_id', event.id).order('uploaded_at'),
  ])
  if (owner.error || attachments.error) {
    console.error('Unable to load Meeting organizer or documents for email', errorMessage(owner.error ?? attachments.error))
  }
  const meetingUrl = delivery.recipient_type !== 'guest' && publicAppUrl
    ? internalMeetingUrl(publicAppUrl, event.id)
    : ''
  const organizer = owner.data
    ? `${text(owner.data.full_name)} (${text(owner.data.email)})`
    : ''
  const guestToken = delivery.recipient_type === 'guest' ? text(payload.guest_token) : ''
  const meetingDocuments = await Promise.all((attachments.data ?? []).map(async (file) => {
    if (guestToken) {
      const url = new URL('/functions/v1/guest-event', supabaseUrl)
      url.searchParams.set('token', guestToken)
      url.searchParams.set('attachment_id', file.id)
      return { name: file.file_name, size: file.file_size, url: url.toString() }
    }
    const { data, error } = await supabase.storage.from('meeting-documents').createSignedUrl(file.storage_path, 7 * 24 * 60 * 60)
    if (error || !data) {
      console.error('Unable to create Meeting attachment download URL', errorMessage(error))
      return { name: file.file_name, size: file.file_size, url: '' }
    }
    return { name: file.file_name, size: file.file_size, url: data.signedUrl }
  }))
  return {
    ...payload,
    entity: 'meeting',
    id: event.id,
    title: event.title,
    description: event.description,
    affiliation: event.affiliation,
    start_datetime: event.start_datetime,
    end_datetime: event.end_datetime,
    all_day: event.all_day,
    location: event.location,
    timezone: event.timezone,
    recurrence_rule: event.recurrence_rule,
    status: event.status,
    organizer,
    ...(meetingUrl ? { meeting_url: meetingUrl } : {}),
    meeting_documents: meetingDocuments,
  }
}

async function issueExternalTaskUrl(delivery: Delivery, taskId: string) {
  if (!publicAppUrl) return ''
  const token = randomToken()
  const { error } = await supabase.from('external_task_tokens').insert({
    task_id: taskId,
    external_email: delivery.recipient_reference,
    token_hash: await hashToken(token),
  })
  if (error) throw error
  const url = new URL(publicAppUrl)
  url.searchParams.set('token', token)
  url.hash = '/external-task'
  return url.toString()
}

async function payloadWithTaskDocuments(delivery: Delivery, payload: Record<string, unknown>) {
  if (delivery.channel !== 'email' || payload.entity !== 'task' || !['task_assignee', 'task_creator', 'external_assignee'].includes(delivery.recipient_type)) return payload
  const taskId = text(payload.id)
  if (!taskId) return payload
  const externalUrl = delivery.recipient_type === 'external_assignee'
    ? text(payload.external_url) || await issueExternalTaskUrl(delivery, taskId)
    : ''
  const documentUrl = delivery.recipient_type !== 'external_assignee' && publicAppUrl
    ? internalTaskUrl(publicAppUrl, taskId)
    : externalUrl
  if (!documentUrl.startsWith('http')) return payload
  const [attachments, documentLinks] = await Promise.all([
    supabase.from('task_attachments').select('file_name').eq('task_id', taskId).order('uploaded_at'),
    supabase.from('document_links').select('display_name').eq('task_id', taskId).order('created_at'),
  ])
  if (attachments.error || documentLinks.error) {
    console.error('Unable to load Task documents for email', errorMessage(attachments.error ?? documentLinks.error))
    return delivery.recipient_type !== 'external_assignee' ? { ...payload, internal_task_url: documentUrl } : payload
  }
  return {
    ...payload,
    ...(externalUrl ? { external_url: externalUrl } : {}),
    ...(delivery.recipient_type !== 'external_assignee' ? { internal_task_url: documentUrl } : {}),
    task_documents: [...(attachments.data ?? []).map((file) => file.file_name), ...(documentLinks.data ?? []).map((link) => link.display_name)],
  }
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
      const meetingPayload = await payloadWithMeetingDetails(delivery, guestPayload)
      const payload = await payloadWithTaskDocuments(delivery, meetingPayload)
      response = await send(delivery, payload)
      body = await response.text()
    } catch (error) {
      await supabase.from('notification_deliveries').update({
        status: retryDelay === null ? 'failed' : 'retry',
        next_attempt_at: retryDelay === null ? null : new Date(Date.now() + retryDelay * 60_000).toISOString(),
        error_code: 'network_error', error_message: errorMessage(error).slice(0, 1000),
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
