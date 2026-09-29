import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'apikey, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: cors })
}

async function hashToken(token: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const url = new URL(request.url)
    const body = request.method === 'POST' ? await request.json() : null
    if (request.method === 'POST' && body?.action !== 'acknowledge') return json({ error: 'คำสั่งไม่ถูกต้อง' }, 400)
    const token = request.method === 'POST'
      ? typeof body?.token === 'string' ? body.token.trim() : ''
      : url.searchParams.get('token')?.trim()
    const attachmentId = url.searchParams.get('attachment_id')?.trim()
    if (!token) return json({ error: 'ลิงก์ไม่ถูกต้อง' }, 400)
    const { data: tokenRow, error: tokenError } = await admin.from('guest_tokens').select('*')
      .eq('token_hash', await hashToken(token)).is('revoked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle()
    if (tokenError) throw tokenError
    if (!tokenRow) return json({ error: 'ลิงก์หมดอายุหรือถูกยกเลิกแล้ว' }, 404)

    const { data: guest, error: guestError } = await admin.from('event_guests').select('*')
      .eq('id', tokenRow.guest_id).is('revoked_at', null).maybeSingle()
    if (guestError) throw guestError
    if (!guest) return json({ error: 'สิทธิ์เข้าถึงถูกยกเลิกแล้ว' }, 404)

    const occurrenceRequest = tokenRow.occurrence_id
      ? admin.from('event_occurrences').select('id,start_datetime,end_datetime,override_payload,status').eq('id', tokenRow.occurrence_id).eq('event_id', guest.event_id).maybeSingle()
      : Promise.resolve({ data: null, error: null })
    const [{ data: event, error: eventError }, { data: occurrence, error: occurrenceError }, { data: attachments, error: attachmentError }] = await Promise.all([
      admin.from('events').select('id,title,description,affiliation,start_datetime,end_datetime,all_day,location,timezone,status,deleted_at').eq('id', guest.event_id).maybeSingle(),
      occurrenceRequest,
      admin.from('attachments').select('id,file_name,storage_path,occurrence_id').eq('event_id', guest.event_id),
    ])
    if (eventError || occurrenceError || attachmentError) throw eventError ?? occurrenceError ?? attachmentError
    if (!event || event.deleted_at || event.status !== 'scheduled') return json({ error: 'Meeting นี้ถูกยกเลิกแล้ว' }, 404)
    if (tokenRow.occurrence_id && (!occurrence || occurrence.status !== 'scheduled')) return json({ error: 'นัดหมายรอบนี้ถูกยกเลิกแล้ว' }, 404)
    const override = occurrence?.override_payload
    const occurrenceOverride = override && typeof override === 'object' && !Array.isArray(override) ? override as Record<string, unknown> : {}
    const occurrenceAttachments = (attachments ?? []).filter((attachment) => !attachment.occurrence_id || attachment.occurrence_id === tokenRow.occurrence_id)
    const eventForGuest = {
      ...event,
      description: typeof occurrenceOverride.description === 'string' ? occurrenceOverride.description : event.description,
      location: typeof occurrenceOverride.location === 'string' ? occurrenceOverride.location : event.location,
      start_datetime: occurrence?.start_datetime ?? event.start_datetime,
      end_datetime: occurrence?.end_datetime ?? event.end_datetime,
    }

    if (request.method === 'POST') {
      const { data, error } = await admin.from('event_guests')
        .update({ acknowledged_at: guest.acknowledged_at ?? new Date().toISOString() })
        .eq('id', guest.id).select('acknowledged_at').single()
      if (error) throw error
      return json({ acknowledged_at: data.acknowledged_at })
    }

    if (attachmentId) {
      const attachment = occurrenceAttachments.find((item) => item.id === attachmentId)
      if (!attachment) return json({ error: 'ไม่พบเอกสารแนบนี้' }, 404)
      const { data, error } = await admin.storage.from('meeting-documents').createSignedUrl(attachment.storage_path, 300)
      if (error || !data) throw error ?? new Error('Unable to sign attachment')
      await admin.from('guest_tokens').update({ last_accessed_at: new Date().toISOString() }).eq('id', tokenRow.id)
      return Response.redirect(data.signedUrl, 302)
    }

    const files = await Promise.all(occurrenceAttachments.map(async (attachment) => {
      const { data, error } = await admin.storage.from('meeting-documents').createSignedUrl(attachment.storage_path, 300)
      if (error || !data) throw error ?? new Error('Unable to sign attachment')
      return { id: attachment.id, file_name: attachment.file_name, url: data.signedUrl }
    }))
    await admin.from('guest_tokens').update({ last_accessed_at: new Date().toISOString() }).eq('id', tokenRow.id)
    return json({ event: { ...eventForGuest, acknowledged_at: guest.acknowledged_at, attachments: files } })
  } catch (error) {
    console.error(error)
    return json({ error: 'ไม่สามารถเปิดข้อมูล Meeting ได้ในขณะนี้' }, 500)
  }
})
