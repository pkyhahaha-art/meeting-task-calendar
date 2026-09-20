import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { FormMessage } from '../components/FormMessage'
import { supabase } from '../lib/supabase'

export function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [linkState, setLinkState] = useState<'checking' | 'valid' | 'invalid'>('checking')

  useEffect(() => {
    const prepareRecoverySession = async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      if (sessionData.session) { setLinkState('valid'); return }

      const nestedFragment = window.location.hash.split('#').at(-1) ?? ''
      const params = new URLSearchParams(nestedFragment)
      const accessToken = params.get('access_token')
      const refreshToken = params.get('refresh_token')
      if (!accessToken || !refreshToken) { setLinkState('invalid'); return }

      const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      if (error) { setLinkState('invalid'); return }
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/reset-password`)
      setLinkState('valid')
    }
    void prepareRecoverySession()
  }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) { setMessage({ type: 'error', text: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัว และมีทั้งตัวอักษรกับตัวเลข' }); return }
    if (password !== confirmPassword) { setMessage({ type: 'error', text: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' }); return }
    setBusy(true); const { error } = await supabase.auth.updateUser({ password }); setBusy(false)
    setMessage(error ? { type: 'error', text: 'ลิงก์หมดอายุหรือไม่สามารถตั้งรหัสผ่านได้' } : { type: 'success', text: 'ตั้งรหัสผ่านใหม่สำเร็จแล้ว' })
  }
  return <AuthLayout title="ตั้งรหัสผ่านใหม่" subtitle="กำหนดรหัสผ่านใหม่สำหรับบัญชีของคุณ">
    <form onSubmit={submit} className="space-y-4">
      {linkState === 'checking' && <p className="text-center text-slate-600">กำลังตรวจสอบลิงก์…</p>}
      {linkState === 'invalid' && <><FormMessage type="error">ลิงก์ไม่ถูกต้อง ถูกใช้แล้ว หรือหมดอายุ กรุณาขอลิงก์ใหม่</FormMessage><Link to="/forgot-password" className="btn-primary w-full">ขอลิงก์ตั้งรหัสผ่านใหม่</Link></>}
      {message && <FormMessage type={message.type}>{message.text}</FormMessage>}
      {linkState === 'valid' && message?.type !== 'success' && <><div><label className="field-label" htmlFor="password">รหัสผ่านใหม่</label><input id="password" type="password" className="field-input" value={password} onChange={(event) => setPassword(event.target.value)} /></div>
      <div><label className="field-label" htmlFor="confirmPassword">ยืนยันรหัสผ่านใหม่</label><input id="confirmPassword" type="password" className="field-input" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกรหัสผ่านใหม่'}</button></>}
      {message?.type === 'success' && <Link to="/login" className="btn-secondary w-full">เข้าสู่ระบบ</Link>}
    </form>
  </AuthLayout>
}
