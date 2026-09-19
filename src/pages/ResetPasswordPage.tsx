import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { FormMessage } from '../components/FormMessage'
import { supabase } from '../lib/supabase'

export function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) { setMessage({ type: 'error', text: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัว และมีทั้งตัวอักษรกับตัวเลข' }); return }
    if (password !== confirmPassword) { setMessage({ type: 'error', text: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' }); return }
    setBusy(true); const { error } = await supabase.auth.updateUser({ password }); setBusy(false)
    setMessage(error ? { type: 'error', text: 'ลิงก์หมดอายุหรือไม่สามารถตั้งรหัสผ่านได้' } : { type: 'success', text: 'ตั้งรหัสผ่านใหม่สำเร็จแล้ว' })
  }
  return <AuthLayout title="ตั้งรหัสผ่านใหม่" subtitle="กำหนดรหัสผ่านใหม่สำหรับบัญชีของคุณ">
    <form onSubmit={submit} className="space-y-4">
      {message && <FormMessage type={message.type}>{message.text}</FormMessage>}
      <div><label className="field-label" htmlFor="password">รหัสผ่านใหม่</label><input id="password" type="password" className="field-input" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
      <div><label className="field-label" htmlFor="confirmPassword">ยืนยันรหัสผ่านใหม่</label><input id="confirmPassword" type="password" className="field-input" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกรหัสผ่านใหม่'}</button>
      {message?.type === 'success' && <Link to="/login" className="btn-secondary w-full">เข้าสู่ระบบ</Link>}
    </form>
  </AuthLayout>
}
