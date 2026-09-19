import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { FormMessage } from '../components/FormMessage'
import { appUrl } from '../lib/appUrl'
import { supabase } from '../lib/supabase'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true)
    await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: appUrl('/reset-password') })
    setBusy(false); setSent(true)
  }
  return <AuthLayout title="ลืมรหัสผ่าน" subtitle="ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ไปยัง Gmail">
    <form onSubmit={submit} className="space-y-4">
      {sent && <FormMessage type="success">หาก Gmail นี้มีบัญชีอยู่ ระบบได้ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว</FormMessage>}
      <div><label className="field-label" htmlFor="email">Gmail</label><input required id="email" type="email" className="field-input" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'กำลังส่ง…' : 'ส่งลิงก์ตั้งรหัสผ่านใหม่'}</button>
      <p className="text-center text-sm"><Link to="/login" className="font-semibold text-brand-600 hover:underline">กลับไปหน้าเข้าสู่ระบบ</Link></p>
    </form>
  </AuthLayout>
}
