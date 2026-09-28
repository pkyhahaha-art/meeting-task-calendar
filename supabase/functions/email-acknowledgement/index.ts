import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const publicAppUrl = Deno.env.get('PUBLIC_APP_URL')

async function hashToken(token: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

function result(title: string, message: string, status: number, success = false) {
  const accent = success ? '#15803d' : '#b91c1c'
  const icon = success ? '✓' : '!'
  const body = `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;background:#f6f0f8;font-family:Arial,'Noto Sans Thai',sans-serif;color:#34253d"><main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box"><section style="width:100%;max-width:480px;padding:32px;box-sizing:border-box;text-align:center;background:#fff;border:1px solid #ead9ef;border-top:6px solid ${accent};border-radius:24px;box-shadow:0 18px 50px rgba(76,15,93,.16)"><div style="width:64px;height:64px;margin:0 auto 18px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:${accent};color:#fff;font-size:36px;font-weight:700">${icon}</div><h1 style="margin:0;color:#4e0d53;font-size:26px">${title}</h1><p style="margin:14px 0 0;color:#625469;font-size:16px;line-height:1.7">${message}</p></section></main></body></html>`
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}

function acknowledgementSuccess() {
  if (!publicAppUrl) return result('รับทราบเรียบร้อยแล้ว', 'ระบบบันทึกการรับทราบของคุณแล้ว สามารถปิดหน้านี้ได้', 200, true)
  const url = new URL(publicAppUrl)
  url.hash = '/acknowledged'
  return Response.redirect(url, 303)
}

Deno.serve(async (request) => {
  if (request.method !== 'GET') return result('ไม่รองรับคำขอนี้', 'กรุณาเปิดลิงก์รับทราบจากอีเมลอีกครั้ง', 405)
  try {
    const token = new URL(request.url).searchParams.get('token')?.trim()
    if (!token) return result('ลิงก์รับทราบไม่ถูกต้อง', 'ไม่พบ token สำหรับยืนยันการรับทราบ', 400)
    const { data: outcome, error } = await admin.rpc('consume_email_acknowledgement', { target_token_hash: await hashToken(token) })
    if (error) throw error
    if (outcome === 'invalid') return result('ลิงก์รับทราบหมดอายุ', 'กรุณาติดต่อผู้ส่งเพื่อขออีเมลแจ้งเตือนฉบับใหม่', 404)
    if (outcome === 'recipient_not_found') return result('ไม่พบผู้รับรายการนี้', 'รายการอาจถูกแก้ไขหรือยกเลิกไปแล้ว', 404)
    return acknowledgementSuccess()
  } catch (error) {
    console.error(error)
    return result('บันทึกการรับทราบไม่สำเร็จ', 'ระบบขัดข้องชั่วคราว กรุณาลองเปิดลิงก์จากอีเมลอีกครั้ง', 500)
  }
})
