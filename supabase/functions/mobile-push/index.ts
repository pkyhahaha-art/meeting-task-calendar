import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { deliverWebPush, type PushSubscriptionRecord } from '../_shared/webPushDelivery.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const appUrl = Deno.env.get('PUBLIC_APP_URL') || 'https://pkyhahaha-art.github.io/meeting-task-calendar/'
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: cors })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors })
  const config = {
    publicKey: Deno.env.get('VAPID_PUBLIC_KEY')?.trim() || '',
    privateKey: Deno.env.get('VAPID_PRIVATE_KEY')?.trim() || '',
    subject: Deno.env.get('VAPID_SUBJECT')?.trim() || appUrl,
  }
  const ready = Boolean(config.publicKey && config.privateKey)
  if (request.method === 'GET') return reply({ ready, publicKey: ready ? config.publicKey : null })
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405)

  // The JWT is verified here so the public GET can supply the public VAPID key.
  const bearer = request.headers.get('authorization')?.replace(/^Bearer /i, '')
  if (!bearer) return reply({ error: 'Unauthorized' }, 401)
  const { data: auth, error: authError } = await db.auth.getUser(bearer)
  if (authError || !auth.user) return reply({ error: 'Unauthorized' }, 401)
  const { data: profile } = await db.from('profiles').select('status').eq('id', auth.user.id).maybeSingle()
  if (profile?.status !== 'active') return reply({ error: 'Account is not active' }, 403)
  if (!ready) return reply({ error: 'ระบบส่งแจ้งเตือนมือถือยังไม่พร้อม' }, 503)

  try {
    const { subscriptionId } = await request.json()
    if (typeof subscriptionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(subscriptionId)) return reply({ error: 'Invalid device' }, 400)
    const { data, error } = await db.from('mobile_push_subscriptions').select('id,user_id,endpoint,p256dh,auth,last_used_at').eq('id', subscriptionId).eq('user_id', auth.user.id).maybeSingle()
    if (error) throw error
    if (!data) return reply({ error: 'ไม่พบอุปกรณ์ที่เชื่อมต่อกับบัญชีนี้' }, 404)
    // Atomically rate-limit test sends per device without a separate public RPC.
    const claimed = await db.from('mobile_push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).eq('last_used_at', data.last_used_at).lt('last_used_at', new Date(Date.now() - 10_000).toISOString()).select('id').maybeSingle()
    if (claimed.error) throw claimed.error
    if (!claimed.data) return reply({ error: 'กรุณารอ 10 วินาทีแล้วทดสอบอีกครั้ง' }, 429)
    const url = new URL(appUrl)
    url.hash = '/mobile-push'
    const result = await deliverWebPush(data as PushSubscriptionRecord, { title: '⚡ ทดสอบแจ้งเตือน PEA Calendar', body: 'ข้อความทดสอบส่งจากเซิร์ฟเวอร์ไปยังมือถือที่เชื่อมต่อ', tag: `test-${crypto.randomUUID()}`, url: url.href }, config, webpush.generateRequestDetails)
    if (result.expired) await db.from('mobile_push_subscriptions').delete().eq('id', data.id)
    return result.sent ? reply({ accepted: true }) : reply({ error: result.expired ? 'การเชื่อมต่อหมดอายุ กรุณาสแกน QR ใหม่' : `ผู้ให้บริการ Push ปฏิเสธการส่ง (${result.status})` }, 502)
  } catch {
    return reply({ error: 'ส่งแจ้งเตือนไม่สำเร็จ กรุณาลองอีกครั้ง' }, 500)
  }
})
