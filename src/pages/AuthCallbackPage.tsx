import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { FormMessage } from '../components/FormMessage'
import { supabase } from '../lib/supabase'

export function AuthCallbackPage() {
  const [state, setState] = useState<'working' | 'success' | 'error'>('working')
  useEffect(() => {
    const confirm = async () => {
      const params = new URLSearchParams(window.location.search)
      const tokenHash = params.get('token_hash')
      const type = params.get('type')
      const code = params.get('code')
      let error: Error | null = null
      if (tokenHash && type) ({ error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as 'email' }))
      else if (code) ({ error } = await supabase.auth.exchangeCodeForSession(code))
      else ({ error } = await supabase.auth.getSession())
      setState(error ? 'error' : 'success')
    }
    void confirm()
  }, [])
  return <AuthLayout title="ยืนยันบัญชี" subtitle="กำลังตรวจสอบลิงก์ยืนยันจาก Gmail">
    {state === 'working' && <p className="text-center text-slate-600">กำลังยืนยันบัญชี…</p>}
    {state === 'success' && <><FormMessage type="success">ยืนยัน Gmail สำเร็จแล้ว คุณสามารถเข้าสู่ระบบได้</FormMessage><Link to="/calendar" className="btn-primary mt-4 w-full">เปิดปฏิทิน</Link></>}
    {state === 'error' && <><FormMessage type="error">ลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุแล้ว</FormMessage><Link to="/login" className="btn-secondary mt-4 w-full">กลับไปเข้าสู่ระบบ</Link></>}
  </AuthLayout>
}

