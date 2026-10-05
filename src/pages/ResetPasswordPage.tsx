import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { FormMessage } from '../components/FormMessage'
import { supabase } from '../lib/supabase'

export function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [linkState, setLinkState] = useState<'checking' | 'valid' | 'invalid'>('checking')
  const preparation = useRef<Promise<string | null> | null>(null)
  const recoveryUserId = useRef<string | null>(null)
  const saving = useRef(false)

  useEffect(() => {
    let active = true
    const prepareRecoverySession = async () => {
      const nestedFragment = window.location.hash.split('#').at(-1) ?? ''
      const params = new URLSearchParams(nestedFragment.includes('?') ? nestedFragment.split('?').slice(1).join('?') : nestedFragment)
      const searchParams = new URLSearchParams(window.location.search)
      searchParams.forEach((value, key) => params.set(key, value))
      if (['error', 'error_description', 'error_code'].some((key) => params.has(key)) || (params.has('type') && params.get('type') !== 'recovery')) return null
      if (params.has('access_token') || params.has('refresh_token')) {
        const accessToken = params.get('access_token')
        const refreshToken = params.get('refresh_token')
        if (!accessToken || !refreshToken) return null
        const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        return error ? null : data.session?.user.id ?? null
      }
      if (params.has('token_hash')) {
        const tokenHash = params.get('token_hash')
        if (!tokenHash) return null
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
        return error ? null : data.session?.user.id ?? null
      }
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (params.has('code')) {
        const code = params.get('code')
        if (!code) return null
        // SDK initialization may have exchanged the URL code and removed it already.
        if (searchParams.has('code') && !new URLSearchParams(window.location.search).has('code') && sessionData.session) return sessionData.session.user.id
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        return error ? null : data.session?.user.id ?? null
      }
      return sessionData.session?.user.id ?? null
    }
    preparation.current ??= prepareRecoverySession()
    void preparation.current.then((userId) => {
      if (!active) return
      recoveryUserId.current = userId
      if (userId) {
        const url = new URL(window.location.href)
        for (const key of ['access_token', 'refresh_token', 'token_hash', 'code', 'type', 'expires_in', 'expires_at', 'token_type']) url.searchParams.delete(key)
        window.history.replaceState(null, '', `${url.pathname}${url.search}#/reset-password`)
      }
      setLinkState(userId ? 'valid' : 'invalid')
    }).catch(() => { if (active) setLinkState('invalid') })
    return () => { active = false }
  }, [])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saving.current || linkState !== 'valid') return
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) { setMessage({ type: 'error', text: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัว และมีทั้งตัวอักษรกับตัวเลข' }); return }
    if (password !== confirmPassword) { setMessage({ type: 'error', text: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' }); return }
    saving.current = true; setBusy(true); setMessage(null)
    try {
      const { data, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (!recoveryUserId.current || data.session?.user.id !== recoveryUserId.current) { setLinkState('invalid'); return }
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setMessage({ type: 'success', text: 'ตั้งรหัสผ่านใหม่สำเร็จแล้ว' })
    } catch {
      setMessage({ type: 'error', text: 'ลิงก์หมดอายุหรือไม่สามารถตั้งรหัสผ่านได้ กรุณาลองใหม่' })
    } finally { saving.current = false; setBusy(false) }
  }
  return <AuthLayout title="ตั้งรหัสผ่านใหม่" subtitle="กำหนดรหัสผ่านใหม่สำหรับบัญชีของคุณ">
    <form onSubmit={submit} className="space-y-4">
      {linkState === 'checking' && <p className="text-center text-slate-600">กำลังตรวจสอบลิงก์…</p>}
      {linkState === 'invalid' && <><FormMessage type="error">ลิงก์ไม่ถูกต้อง ถูกใช้แล้ว หรือหมดอายุ กรุณาขอลิงก์ใหม่</FormMessage><Link to="/forgot-password" className="btn-primary w-full">ขอลิงก์ตั้งรหัสผ่านใหม่</Link></>}
      {message && <FormMessage type={message.type}>{message.text}</FormMessage>}
      {linkState === 'valid' && message?.type !== 'success' && <><div><label className="field-label" htmlFor="password">รหัสผ่านใหม่</label>
        <div className="relative"><input id="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" className="field-input min-h-11 pr-12" value={password} onChange={(event) => setPassword(event.target.value)} />
          <button type="button" className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-xl text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'ซ่อนรหัสผ่านใหม่' : 'แสดงรหัสผ่านใหม่'} aria-controls="password" aria-pressed={showPassword}>{showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
        </div></div>
      <div><label className="field-label" htmlFor="confirmPassword">ยืนยันรหัสผ่านใหม่</label>
        <div className="relative"><input id="confirmPassword" type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" className="field-input min-h-11 pr-12" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          <button type="button" className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-xl text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500" onClick={() => setShowConfirmPassword((value) => !value)} aria-label={showConfirmPassword ? 'ซ่อนรหัสผ่านยืนยัน' : 'แสดงรหัสผ่านยืนยัน'} aria-controls="confirmPassword" aria-pressed={showConfirmPassword}>{showConfirmPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
        </div></div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกรหัสผ่านใหม่'}</button></>}
      {message?.type === 'success' && <Link to="/login" className="btn-secondary w-full">เข้าสู่ระบบ</Link>}
    </form>
  </AuthLayout>
}
