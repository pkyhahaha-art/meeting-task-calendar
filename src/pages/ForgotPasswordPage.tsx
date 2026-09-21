import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { Captcha } from '../components/Captcha'
import { FormMessage } from '../components/FormMessage'
import { appUrl } from '../lib/appUrl'
import { supabase } from '../lib/supabase'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: appUrl('/reset-password'), captchaToken: captchaToken ?? undefined })
    setBusy(false)
    if (error) {
      const rateLimited = error.status === 429 || error.message.toLowerCase().includes('rate limit')
      setMessage({
        type: 'error',
        text: rateLimited
          ? 'ส่งอีเมลไม่ได้ในขณะนี้ เนื่องจาก Supabase ฟรีจำกัดรวม 2 ฉบับต่อชั่วโมง กรุณารอประมาณ 1 ชั่วโมงแล้วลองใหม่'
          : 'ส่งลิงก์ไม่สำเร็จ กรุณารอสักครู่แล้วลองใหม่',
      })
      return
    }
    setMessage({ type: 'success', text: 'หาก Gmail นี้มีบัญชีอยู่ ระบบได้ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว กรุณาใช้ลิงก์ล่าสุดที่ได้รับ' })
  }
  return <AuthLayout title="ลืมรหัสผ่าน" subtitle="ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ไปยัง Gmail">
    <form onSubmit={submit} className="space-y-4">
      {message && <FormMessage type={message.type}>{message.text}</FormMessage>}
      <div><label className="field-label" htmlFor="email">Gmail</label><input required id="email" type="email" className="field-input" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
      <Captcha onToken={setCaptchaToken} />
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'กำลังส่ง…' : 'ส่งลิงก์ตั้งรหัสผ่านใหม่'}</button>
      <p className="text-center text-sm"><Link to="/login" className="font-semibold text-brand-600 hover:underline">กลับไปหน้าเข้าสู่ระบบ</Link></p>
    </form>
  </AuthLayout>
}
