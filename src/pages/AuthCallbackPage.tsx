import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { FormMessage } from '../components/FormMessage'
import { supabase } from '../lib/supabase'

export function AuthCallbackPage() {
  const [state, setState] = useState<'working' | 'success' | 'error'>('working')
  const confirmation = useRef<Promise<boolean> | null>(null)
  useEffect(() => {
    let active = true
    const confirm = async () => {
      const params = new URLSearchParams(window.location.search)
      const tokenHash = params.get('token_hash')
      const type = params.get('type')
      const code = params.get('code')
      if (tokenHash) {
        if (type !== 'email' && type !== 'signup' && type !== 'invite' && type !== 'email_change') return false
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        return !error && Boolean(data.user?.email_confirmed_at)
      }
      if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)
        return !error && Boolean(data.user?.email_confirmed_at)
      }
      const { data, error } = await supabase.auth.getSession()
      return !error && Boolean(data.session?.user.email_confirmed_at)
    }
    confirmation.current ??= confirm()
    void confirmation.current.then((confirmed) => {
      if (active) setState(confirmed ? 'success' : 'error')
    }).catch(() => { if (active) setState('error') })
    return () => { active = false }
  }, [])
  return <AuthLayout title="ยืนยันบัญชี" subtitle="กำลังตรวจสอบลิงก์ยืนยันจาก Gmail">
    {state === 'working' && <p className="text-center text-slate-600">กำลังยืนยันบัญชี…</p>}
    {state === 'success' && <><FormMessage type="success">ยืนยัน Gmail สำเร็จแล้ว คุณสามารถเข้าสู่ระบบได้</FormMessage><Link to="/calendar" className="btn-primary mt-4 w-full">เปิดปฏิทิน</Link></>}
    {state === 'error' && <><FormMessage type="error">ลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุแล้ว</FormMessage><Link to="/login" className="btn-secondary mt-4 w-full">กลับไปเข้าสู่ระบบ</Link></>}
  </AuthLayout>
}

