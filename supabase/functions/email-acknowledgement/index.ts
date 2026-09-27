import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const publicAppUrl = Deno.env.get('PUBLIC_APP_URL')

async function hashToken(token: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

function result(message: string, status: number) {
  return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
}

function acknowledgementSuccessRedirect() {
  if (!publicAppUrl) return null
  const url = new URL(publicAppUrl)
  url.hash = '/acknowledged'
  return url.toString()
}

Deno.serve(async (request) => {
  if (request.method !== 'GET') return result('ไม่รองรับคำขอนี้', 405)
  try {
    const token = new URL(request.url).searchParams.get('token')?.trim()
    if (!token) return result('ลิงก์รับทราบไม่ถูกต้อง', 400)
    const { data: action, error: actionError } = await admin.from('email_acknowledgement_tokens').select('*')
      .eq('token_hash', await hashToken(token)).gt('expires_at', new Date().toISOString()).maybeSingle()
    if (actionError) throw actionError
    if (!action) return result('ลิงก์รับทราบหมดอายุแล้ว', 404)

    if (action.recipient_type === 'guest') {
      const { error } = await admin.from('event_guests').update({ acknowledged_at: new Date().toISOString() })
        .eq('event_id', action.event_id!).eq('email', action.recipient_reference).is('revoked_at', null).is('acknowledged_at', null)
      if (error) throw error
    } else if (action.recipient_type === 'external_assignee') {
      const { error } = await admin.from('task_external_recipients').update({ acknowledged_at: new Date().toISOString() })
        .eq('task_id', action.task_id!).eq('email', action.recipient_reference).is('acknowledged_at', null)
      if (error) throw error
    } else {
      const { data: profile, error: profileError } = await admin.from('profiles').select('id').eq('email', action.recipient_reference).maybeSingle()
      if (profileError) throw profileError
      if (!profile) return result('ไม่พบผู้รับมอบหมาย', 404)
      const { error } = await admin.from('task_internal_recipients').update({ acknowledged_at: new Date().toISOString() })
        .eq('task_id', action.task_id!).eq('user_id', profile.id).is('acknowledged_at', null)
      if (error) throw error
    }
    await admin.from('email_acknowledgement_tokens').update({ consumed_at: new Date().toISOString() }).eq('id', action.id)
    const redirect = acknowledgementSuccessRedirect()
    return redirect
      ? Response.redirect(redirect, 302)
      : new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    console.error(error)
    return result('ไม่สามารถบันทึกการรับทราบได้ในขณะนี้', 500)
  }
})
