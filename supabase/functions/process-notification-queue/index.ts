import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { deviceNotification } from './deviceNotification.ts'
import { deliverWebPush, type PushSubscriptionRecord } from '../_shared/webPushDelivery.ts'
import { html, subject, text } from './emailTemplate.ts'
import { internalMeetingUrl } from './meetingLink.ts'
import { retryDelayMinutes } from './retry.ts'
import { internalTaskUrl } from './taskLink.ts'
import { taskDocumentItems } from './taskDocuments.ts'

type Delivery = {
  id: string
  event_id: string | null
  task_id: string | null
  reminder_id: string | null
  task_reminder_id: string | null
  recipient_type: string
  recipient_reference: string
  channel: 'email' | 'line' | 'push'
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
const senderName = Deno.env.get('NOTIFICATION_SENDER_NAME') ?? 'PEA Meeting & Task Calendar'
const apiKey = Deno.env.get('BREVO_API_KEY')
const cronSecret = Deno.env.get('NOTIFICATION_CRON_SECRET')
const lineAccessToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')
const publicAppUrl = Deno.env.get('PUBLIC_APP_URL')

function isOccurrenceNotice(delivery: Delivery) {
  return delivery.template_key === 'meeting_occurrence_cancelled' || delivery.template_key === 'meeting_occurrence_moved'
}

// An overdue retry belongs to its daily round. Stop it after a close/delete/
// reschedule, or after that day ends, before issuing document links or sending.
async function currentOverdueTaskDelivery(delivery: Delivery): Promise<boolean> {
  if (delivery.template_key !== 'task_reminder' || delivery.payload.reminder_key !== 'overdue') return true
  if (!delivery.task_id || !delivery.task_reminder_id) return false
  const task = await supabase.from('tasks').select('status,deleted_at,due_date,due_time').eq('id', delivery.task_id).maybeSingle()
  if (task.error) throw task.error
  if (!task.data || task.data.status !== 'pending' || task.data.deleted_at
    || task.data.due_date !== delivery.payload.due_date
    || text(task.data.due_time).slice(0, 5) !== text(delivery.payload.due_time).slice(0, 5)) return false
  const reminder = await supabase.from('task_reminders').select('status,reminder_key').eq('id', delivery.task_reminder_id).maybeSingle()
  if (reminder.error) throw reminder.error
  if (!reminder.data || reminder.data.status === 'cancelled' || reminder.data.reminder_key !== 'overdue') return false
  const round = new Date(text(delivery.payload.reminder_scheduled_at))
  const now = new Date()
  const bangkokDay = (date: Date) => new Date(date.getTime() + 7 * 60 * 60_000).toISOString().slice(0, 10)
  return !Number.isNaN(round.getTime()) && round <= now && bangkokDay(round) === bangkokDay(now)
}

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

async function issueAcknowledgementUrl(delivery: Delivery) {
  if (delivery.channel !== 'email' || !['task_assignee', 'external_assignee', 'guest'].includes(delivery.recipient_type)) return ''
  if (!delivery.event_id && !delivery.task_id) return ''
  const token = randomToken()
  const { error } = await supabase.from('email_acknowledgement_tokens').insert({
    event_id: delivery.event_id,
    task_id: delivery.task_id,
    recipient_type: delivery.recipient_type,
    recipient_reference: delivery.recipient_reference.toLowerCase(),
    token_hash: await hashToken(token),
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
  })
  if (error) throw error
  const url = new URL('/functions/v1/email-acknowledgement', supabaseUrl)
  url.searchParams.set('token', token)
  return url.toString()
}

async function occurrenceIdForDelivery(delivery: Delivery, payload: Record<string, unknown>) {
  const payloadOccurrenceId = text(payload.occurrence_id) || (delivery.template_key === 'meeting_occurrence_cancelled' ? text(payload.original_occurrence_id) : '')
  if (payloadOccurrenceId) return payloadOccurrenceId
  if (!delivery.event_id || !delivery.reminder_id) return ''
  const { data, error } = await supabase.from('reminders').select('occurrence_id').eq('id', delivery.reminder_id).maybeSingle()
  if (error) throw new Error(`Unable to load Meeting occurrence: ${errorMessage(error)}`)
  return data?.occurrence_id ?? ''
}

// Queue-time eligibility can change while a delivery waits for its next attempt.
// Recheck before enriching or sending Push; retained inbox details have their own guard.
async function currentPushRecipient(delivery: Delivery): Promise<boolean> {
  const recipientId = text(delivery.payload.push_user_id)
  const device = await supabase.from('mobile_push_subscriptions').select('user_id')
    .eq('id', delivery.recipient_reference).maybeSingle()
  if (device.error) throw device.error
  if (!recipientId || device.data?.user_id !== recipientId) return false
  const profile = await supabase.from('profiles').select('status').eq('id', recipientId).maybeSingle()
  if (profile.error) throw profile.error
  if (profile.data?.status !== 'active') return false

  if (delivery.task_id) {
    const result = await supabase.from('tasks').select('creator_user_id,assignee_type,assignee_user_id,status,deleted_at')
      .eq('id', delivery.task_id).maybeSingle()
    if (result.error) throw result.error
    const task = result.data
    const cancellation = delivery.template_key === 'task_cancelled'
    if (!task || (task.deleted_at && !cancellation)
      || (task.status !== 'pending' && !(delivery.template_key === 'task_created' && task.creator_user_id === recipientId)
        && !(cancellation && task.status === 'cancelled')
        && !(delivery.template_key === 'task_completed' && task.status === 'completed'))) return false
    if (task.creator_user_id === recipientId || (task.assignee_type === 'internal' && task.assignee_user_id === recipientId)) return true
    const member = await supabase.from('task_internal_recipients').select('user_id')
      .eq('task_id', delivery.task_id).eq('user_id', recipientId).maybeSingle()
    if (member.error) throw member.error
    return Boolean(member.data)
  }

  if (delivery.event_id) {
    const result = await supabase.from('events').select('owner_user_id,start_datetime,status,deleted_at')
      .eq('id', delivery.event_id).maybeSingle()
    if (result.error) throw result.error
    const meeting = result.data
    const cancellation = delivery.template_key === 'meeting_cancelled'
    const occurrenceCancellation = delivery.template_key === 'meeting_occurrence_cancelled'
    if (!meeting || (meeting.deleted_at && !cancellation)
      || (meeting.status !== 'scheduled' && !(delivery.template_key === 'meeting_created' && meeting.owner_user_id === recipientId)
        && !(cancellation && meeting.status === 'cancelled'))) return false
    let occurrenceId = await occurrenceIdForDelivery(delivery, delivery.payload)
    // Older first-appointment reminders use a null occurrence_id. Their guests
    // still follow that appointment's exclusions, rather than the whole series.
    if (!occurrenceId && delivery.reminder_id) {
      const first = await supabase.from('event_occurrences').select('id')
        .eq('event_id', delivery.event_id).eq('occurrence_key', meeting.start_datetime).maybeSingle()
      if (first.error) throw first.error
      if (!first.data) return false
      occurrenceId = first.data.id
    }
    if (occurrenceId) {
      const occurrence = await supabase.from('event_occurrences').select('status')
        .eq('id', occurrenceId).eq('event_id', delivery.event_id).maybeSingle()
      if (occurrence.error) throw occurrence.error
      if (!occurrence.data || (occurrence.data.status !== 'scheduled' && !cancellation && !occurrenceCancellation)) return false
      if (occurrenceCancellation && occurrence.data.status !== 'cancelled') return false
    }
    if (occurrenceCancellation && !occurrenceId) return false
    if (meeting.owner_user_id === recipientId) return true
    const guests = await supabase.rpc('meeting_mobile_guest_users', {
      target_event_id: delivery.event_id, target_occurrence_id: occurrenceId || null,
    })
    if (guests.error) throw guests.error
    return (guests.data ?? []).some((guest: { user_id: string }) => guest.user_id === recipientId)
  }
  return false
}

async function payloadWithGuestLink(delivery: Delivery) {
  if (delivery.channel !== 'email' || delivery.recipient_type !== 'guest' || !delivery.event_id || !publicAppUrl) return delivery.payload
  const occurrenceId = await occurrenceIdForDelivery(delivery, delivery.payload)
  let guest: { id: string } | null = null
  if (isOccurrenceNotice(delivery)) {
    const current = await supabase.from('event_guests').select('id,email,occurrence_id')
      .eq('event_id', delivery.event_id).is('revoked_at', null)
    if (current.error) throw current.error
    const matching = (current.data ?? []).filter((row: { email: string }) => text(row.email).toLowerCase() === delivery.recipient_reference.trim().toLowerCase())
    guest = (occurrenceId ? matching.find((row: { occurrence_id: string | null }) => row.occurrence_id === occurrenceId) : null)
      ?? matching.find((row: { occurrence_id: string | null }) => !row.occurrence_id) ?? null
    if (!guest) throw new Error('The Meeting guest is no longer available for this notification')
  } else {
    const scopedGuest = occurrenceId
      ? await supabase.from('event_guests').select('id').eq('event_id', delivery.event_id)
        .eq('occurrence_id', occurrenceId).eq('email', delivery.recipient_reference).is('revoked_at', null).maybeSingle()
      : { data: null, error: null }
    if (scopedGuest.error) throw scopedGuest.error
    const baseGuest = scopedGuest.data ? { data: null, error: null } : await supabase.from('event_guests').select('id').eq('event_id', delivery.event_id)
      .is('occurrence_id', null).eq('email', delivery.recipient_reference).is('revoked_at', null).maybeSingle()
    if (baseGuest.error) throw baseGuest.error
    guest = scopedGuest.data ?? baseGuest.data
  }
  if (!guest) return occurrenceId ? { ...delivery.payload, occurrence_id: occurrenceId } : delivery.payload
  const token = randomToken()
  const revokeToken = supabase.from('guest_tokens').update({ revoked_at: new Date().toISOString() })
    .eq('guest_id', guest.id).is('revoked_at', null)
  const { error: revokeError } = occurrenceId
    ? await revokeToken.eq('occurrence_id', occurrenceId)
    : await revokeToken.is('occurrence_id', null)
  if (revokeError) throw revokeError
  const { error } = await supabase.from('guest_tokens').insert({
    guest_id: guest.id, token_hash: await hashToken(token),
    occurrence_id: occurrenceId || null,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
  })
  if (error) throw error
  const url = new URL(publicAppUrl)
  url.hash = `/guest-event?token=${encodeURIComponent(token)}`
  return { ...delivery.payload, ...(occurrenceId ? { occurrence_id: occurrenceId } : {}),
    ...(delivery.template_key === 'meeting_occurrence_cancelled' ? {} : { guest_url: url.toString() }), guest_token: token }
}

async function payloadWithMeetingDetails(delivery: Delivery, payload: Record<string, unknown>) {
  if (isOccurrenceNotice(delivery) && delivery.channel === 'email' && delivery.recipient_type === 'guest' && !text(payload.guest_token)) {
    throw new Error('A scoped guest token is required for Meeting action documents')
  }
  if (!delivery.event_id) return payload
  const { data: event, error: eventError } = await supabase.from('events')
    .select('id, owner_user_id, title, description, affiliation, start_datetime, end_datetime, all_day, location, timezone, recurrence_rule, status')
    .eq('id', delivery.event_id).maybeSingle()
  if (eventError) throw new Error(`Unable to load Meeting details for email: ${errorMessage(eventError)}`)
  if (!event) throw new Error(`Unable to load Meeting details for email: event ${delivery.event_id} was not found`)
  const occurrenceId = await occurrenceIdForDelivery(delivery, payload)
  const occurrenceResult = occurrenceId
    ? await supabase.from('event_occurrences').select('id, start_datetime, end_datetime, override_payload').eq('id', occurrenceId).eq('event_id', event.id).maybeSingle()
    : { data: null, error: null }
  if (occurrenceResult.error) throw new Error(`Unable to load Meeting occurrence details: ${errorMessage(occurrenceResult.error)}`)
  const override = occurrenceResult.data?.override_payload
  const occurrenceOverride = override && typeof override === 'object' && !Array.isArray(override) ? override as Record<string, unknown> : {}
  const description = typeof occurrenceOverride.description === 'string' ? occurrenceOverride.description : event.description
  const location = typeof occurrenceOverride.location === 'string' ? occurrenceOverride.location : event.location
  const occurrenceStart = text(payload.start_datetime) || occurrenceResult.data?.start_datetime || event.start_datetime
  const occurrenceEnd = text(payload.end_datetime) || occurrenceResult.data?.end_datetime || event.end_datetime
  const meetingPayload = {
    ...payload,
    entity: 'meeting',
    id: event.id,
    title: isOccurrenceNotice(delivery) ? text(payload.title) || event.title : event.title,
    description,
    affiliation: event.affiliation,
    start_datetime: occurrenceStart,
    end_datetime: occurrenceEnd,
    all_day: event.all_day,
    location,
    timezone: event.timezone,
    recurrence_rule: event.recurrence_rule,
    status: delivery.template_key === 'meeting_occurrence_cancelled' ? 'cancelled' : event.status,
    ...(occurrenceId ? { occurrence_id: occurrenceId } : {}),
  }
  if (delivery.channel !== 'email') return meetingPayload
  const [owner, attachments, documentLinks] = await Promise.all([
    supabase.from('profiles').select('full_name, email').eq('id', event.owner_user_id).maybeSingle(),
    supabase.from('attachments').select('id, file_name, file_size, storage_path, occurrence_id').eq('event_id', event.id).order('uploaded_at'),
    supabase.from('document_links').select('display_name, url').eq('event_id', event.id).order('created_at'),
  ])
  if (owner.error || attachments.error || documentLinks.error) throw new Error(`Unable to load Meeting organizer or documents for email: ${errorMessage(owner.error ?? attachments.error ?? documentLinks.error)}`)
  const meetingUrl = delivery.recipient_type !== 'guest' && publicAppUrl
    ? internalMeetingUrl(publicAppUrl, event.id)
    : ''
  const organizer = owner.data
    ? `${text(owner.data.full_name)} (${text(owner.data.email)})`
    : ''
  const guestToken = delivery.recipient_type === 'guest' ? text(payload.guest_token) : ''
  const meetingDocuments = await Promise.all((attachments.data ?? []).filter((file) => !file.occurrence_id || file.occurrence_id === occurrenceId).map(async (file) => {
    if (guestToken) {
      const url = new URL('/functions/v1/guest-event', supabaseUrl)
      url.searchParams.set('token', guestToken)
      url.searchParams.set('attachment_id', file.id)
      if (delivery.template_key === 'meeting_occurrence_cancelled') url.searchParams.set('notification_id', delivery.id)
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
    ...meetingPayload,
    organizer,
    ...(meetingUrl ? { meeting_url: meetingUrl } : {}),
    meeting_documents: [...meetingDocuments, ...(documentLinks.data ?? []).map((link) => ({ name: link.display_name, url: link.url, kind: 'drive' }))],
  }
}

async function currentOccurrenceEmailRecipient(delivery: Delivery) {
  if (!delivery.event_id) return false
  const meeting = await supabase.from('events').select('owner_user_id,status,deleted_at').eq('id', delivery.event_id).maybeSingle()
  if (meeting.error) throw meeting.error
  if (!meeting.data || meeting.data.status !== 'scheduled' || meeting.data.deleted_at) return false
  const occurrenceId = await occurrenceIdForDelivery(delivery, delivery.payload)
  if (delivery.template_key === 'meeting_occurrence_cancelled') {
    if (!occurrenceId) return false
    const appointment = await supabase.from('event_occurrences').select('status').eq('event_id', delivery.event_id).eq('id', occurrenceId).maybeSingle()
    if (appointment.error) throw appointment.error
    if (appointment.data?.status !== 'cancelled') return false
  }
  if (delivery.recipient_type === 'owner') {
    const owner = await supabase.from('profiles').select('email,status').eq('id', meeting.data.owner_user_id).maybeSingle()
    if (owner.error) throw owner.error
    return owner.data?.status === 'active' && text(owner.data.email).toLowerCase() === delivery.recipient_reference.trim().toLowerCase()
  }
  if (delivery.recipient_type !== 'guest') return false
  const guests = await supabase.rpc('occurrence_guest_emails', { target_event_id: delivery.event_id, target_occurrence_id: occurrenceId || null })
  if (guests.error) throw guests.error
  return (guests.data ?? []).some((guest: { email: string }) => text(guest.email).toLowerCase() === delivery.recipient_reference.trim().toLowerCase())
}

async function issueExternalTaskUrl(delivery: Delivery, taskId: string) {
  if (!publicAppUrl) return ''
  const token = randomToken()
  const { error } = await supabase.from('external_task_tokens').insert({
    task_id: taskId,
    external_email: delivery.recipient_reference,
    token_hash: await hashToken(token),
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
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
    supabase.from('task_attachments').select('file_name,file_size,storage_path').eq('task_id', taskId).order('uploaded_at'),
    supabase.from('document_links').select('display_name, url').eq('task_id', taskId).order('created_at'),
  ])
  if (attachments.error || documentLinks.error) {
    console.error('Unable to load Task documents for email', errorMessage(attachments.error ?? documentLinks.error))
    return {
      ...payload,
      ...(delivery.recipient_type !== 'external_assignee' ? { internal_task_url: documentUrl } : {}),
    }
  }
  const files = await Promise.all((attachments.data ?? []).map(async (file) => {
    const { data, error } = await supabase.storage.from('task-documents').createSignedUrl(file.storage_path, 7 * 24 * 60 * 60)
    if (error || !data) throw new Error(`Unable to create Task document link: ${errorMessage(error)}`)
    return { ...file, url: data.signedUrl }
  }))
  return {
    ...payload,
    ...(externalUrl ? { external_url: externalUrl } : {}),
    ...(delivery.recipient_type !== 'external_assignee' ? { internal_task_url: documentUrl } : {}),
    task_documents: taskDocumentItems(files, documentLinks.data ?? []),
  }
}

async function send(delivery: Delivery, payload: Record<string, unknown>) {
  if (delivery.channel === 'push') {
    const config = { publicKey: Deno.env.get('VAPID_PUBLIC_KEY') || '', privateKey: Deno.env.get('VAPID_PRIVATE_KEY') || '', subject: Deno.env.get('VAPID_SUBJECT') || publicAppUrl || '' }
    if (!config.publicKey || !config.privateKey || !config.subject || !publicAppUrl) return new Response('Web Push sender is not configured', { status: 503 })
    const { data: device, error } = await supabase.from('mobile_push_subscriptions').select('id,user_id,endpoint,p256dh,auth').eq('id', delivery.recipient_reference).maybeSingle()
    if (error) throw new Error('Unable to load the push subscription')
    if (!device) return new Response('Push device is no longer connected', { status: 410 })
    // A device re-paired to another account must never receive an older owner's delivery.
    if (device.user_id !== text(payload.push_user_id)) return new Response('Push recipient changed', { status: 410 })
    const result = await deliverWebPush(device as PushSubscriptionRecord, deviceNotification(delivery.id, subject(delivery.template_key, payload), payload, publicAppUrl, delivery.template_key), config, webpush.generateRequestDetails)
    if (result.expired) await supabase.from('mobile_push_subscriptions').delete().eq('id', device.id).eq('user_id', device.user_id)
    return new Response(result.sent ? 'Push provider accepted the notification' : `Push provider status ${result.status}`, { status: result.sent ? 200 : result.status })
  }
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
    body: JSON.stringify({ sender: { email: senderEmail, name: senderName }, to: [{ email: delivery.recipient_reference }], subject: subject(delivery.template_key, payload), htmlContent: html(delivery.template_key, payload, publicAppUrl) }),
  })
}

Deno.serve(async (request) => {
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  const [{ error: recoveryError }, { error: staleReminderError }] = await Promise.all([
    supabase.rpc('requeue_stale_email_deliveries'),
    supabase.rpc('cancel_stale_meeting_reminders'),
  ])
  // Queue mobile/LINE first: email completes shared reminder rows.
  const { error: lineReminderError } = await supabase.rpc('queue_due_line_reminders')
  const { error: reminderError } = await supabase.rpc('queue_due_email_reminders')
  if (recoveryError || staleReminderError || lineReminderError || reminderError) return new Response(recoveryError?.message ?? staleReminderError?.message ?? lineReminderError?.message ?? reminderError!.message, { status: 500 })

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('notification_deliveries')
    .select('id, event_id, task_id, reminder_id, task_reminder_id, recipient_type, recipient_reference, channel, template_key, payload, attempt')
    .in('channel', ['email', 'line', 'push']).in('status', ['queued', 'retry'])
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
      if (!await currentOverdueTaskDelivery(delivery)) {
        const skipped = await supabase.from('notification_deliveries').update({
          status: 'skipped', next_attempt_at: null, error_code: 'task_overdue_unavailable',
          error_message: 'This overdue round expired or the Task was closed, deleted or rescheduled.',
        }).eq('id', delivery.id)
        if (skipped.error) throw skipped.error
        continue
      }
      if (delivery.channel === 'push' && !await currentPushRecipient(delivery)) {
        const skipped = await supabase.from('notification_deliveries').update({
          status: 'skipped', next_attempt_at: null, error_code: 'push_recipient_unavailable',
          error_message: 'The recipient or item is no longer eligible for this Push notification.',
        }).eq('id', delivery.id)
        if (skipped.error) throw skipped.error
        continue
      }
      if (delivery.channel === 'email' && isOccurrenceNotice(delivery) && !await currentOccurrenceEmailRecipient(delivery)) {
        const skipped = await supabase.from('notification_deliveries').update({
          status: 'skipped', next_attempt_at: null, error_code: 'meeting_recipient_unavailable',
          error_message: 'The recipient or appointment is no longer eligible for this email notification.',
        }).eq('id', delivery.id)
        if (skipped.error) throw skipped.error
        continue
      }
      const guestPayload = await payloadWithGuestLink(delivery)
      const meetingPayload = await payloadWithMeetingDetails(delivery, guestPayload)
      const documentPayload = await payloadWithTaskDocuments(delivery, meetingPayload)
      const acknowledgement = !isOccurrenceNotice(delivery) && !['meeting_cancelled', 'task_cancelled', 'task_completed'].includes(delivery.template_key)
        ? await issueAcknowledgementUrl(delivery)
        : ''
      const payload = acknowledgement ? { ...documentPayload, ack_url: acknowledgement } : documentPayload
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
