import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
const channelSecret = Deno.env.get('LINE_CHANNEL_SECRET')
const accessToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')
const admin = createClient(supabaseUrl, serviceRoleKey)
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-line-signature',
  'access-control-allow-methods': 'POST, OPTIONS',
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: cors })
}

async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function validSignature(body: string, signature: string | null) {
  if (!channelSecret || !signature) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(channelSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
  const expected = btoa(String.fromCharCode(...signed))
  return expected === signature
}

async function reply(replyToken: string, message: string) {
  if (!accessToken) return
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: message }] }),
  })
}

async function createCode(request: Request) {
  const authorization = request.headers.get('authorization')
  if (!authorization) return json({ error: 'Authentication required' }, 401)
  const client = createClient(supabaseUrl, anonKey, { global: { headers: { authorization } } })
  const { data: { user } } = await client.auth.getUser()
  if (!user) return json({ error: 'Invalid session' }, 401)
  const code = Array.from(crypto.getRandomValues(new Uint8Array(4)), (value) => (value % 10).toString()).join('')
  await admin.from('line_link_codes').delete().eq('user_id', user.id).is('used_at', null)
  const { error } = await admin.from('line_link_codes').insert({
    user_id: user.id,
    code_hash: await sha256(code),
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  })
  if (error) return json({ error: error.message }, 500)
  return json({ code, expiresInMinutes: 15 })
}

async function webhook(request: Request, rawBody: string) {
  if (!await validSignature(rawBody, request.headers.get('x-line-signature'))) return json({ error: 'Invalid signature' }, 401)
  const payload = JSON.parse(rawBody) as { events?: Array<{ replyToken?: string; source?: { userId?: string }; message?: { type?: string; text?: string } }> }
  for (const event of payload.events ?? []) {
    if (event.message?.type !== 'text' || !event.source?.userId || !event.replyToken) continue
    const code = event.message.text?.toUpperCase().replace(/^LINK\s+/, '').trim() ?? ''
    const { data: linkCode } = await admin.from('line_link_codes').select('*')
      .eq('code_hash', await sha256(code)).is('used_at', null).gt('expires_at', new Date().toISOString()).maybeSingle()
    if (!linkCode) {
      await reply(event.replyToken, 'รหัสเชื่อมต่อไม่ถูกต้องหรือหมดอายุ กรุณาสร้างรหัสใหม่จากหน้าโปรไฟล์')
      continue
    }
    const now = new Date().toISOString()
    const { error } = await admin.from('line_connections').upsert({
      user_id: linkCode.user_id, line_user_id: event.source.userId, connected_at: now, disconnected_at: null,
    }, { onConflict: 'user_id' })
    if (error) {
      await reply(event.replyToken, 'ไม่สามารถเชื่อมต่อได้ กรุณาติดต่อผู้ดูแลระบบ')
      continue
    }
    await admin.from('line_link_codes').update({ used_at: now }).eq('id', linkCode.id)
    await reply(event.replyToken, 'เชื่อมต่อ LINE กับ Meeting & Task Calendar สำเร็จแล้ว')
  }
  return json({ ok: true })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const rawBody = await request.text()
  if (request.headers.get('authorization')) {
    return createCode(new Request(request.url, { method: 'POST', headers: request.headers, body: rawBody }))
  }
  return webhook(request, rawBody)
})
