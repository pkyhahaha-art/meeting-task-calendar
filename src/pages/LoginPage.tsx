import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, LogIn } from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { AuthLayout } from '../components/AuthLayout'
import { Captcha } from '../components/Captcha'
import { FormMessage } from '../components/FormMessage'
import { useLanguage } from '../i18n/LanguageProvider'
import { homePathForRole } from '../lib/authRouting'
import type { Database } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { loginSchema, type LoginValues } from '../lib/validation'

export function LoginPage() {
  const { user, profile, profileLoading } = useAuth()
  const { t, language } = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) })

  if (user && profileLoading) return <div className="flex min-h-screen items-center justify-center text-slate-500">กำลังตรวจสอบสิทธิ์…</div>
  if (user) return <Navigate to={homePathForRole(profile?.role)} replace />
  const returnTo = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from
  const from = `${returnTo?.pathname || '/calendar'}${returnTo?.search || ''}`

  const submit = async (values: LoginValues) => {
    setMessage(null)
    const { data, error } = await supabase.auth.signInWithPassword({ email: values.email.toLowerCase(), password: values.password, options: { captchaToken: captchaToken ?? undefined } })
    if (error) { setMessage(language === 'th' ? 'Gmail หรือรหัสผ่านไม่ถูกต้อง หรือบัญชียังไม่ได้ยืนยัน' : 'Incorrect Gmail or password, or the account is not verified.'); return }
    type ProfileRole = Pick<Database['public']['Tables']['profiles']['Row'], 'role'>
    const { data: signedInProfile } = await supabase.from('profiles').select('role').eq('id', data.user.id).returns<ProfileRole[]>().maybeSingle()
    navigate(signedInProfile?.role === 'admin' ? '/admin' : from, { replace: true })
  }

  return (
    <AuthLayout title={t('signIn')} subtitle={language === 'th' ? 'เข้าสู่ระบบด้วย Gmail ที่ยืนยันแล้ว' : 'Use your verified Gmail account'}>
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        {message && <FormMessage type="error">{message}</FormMessage>}
        <div><label className="field-label" htmlFor="email">{t('email')}</label><input id="email" type="email" autoComplete="email" className="field-input" placeholder="name@gmail.com" {...register('email')} />{errors.email && <p className="form-error">{errors.email.message}</p>}</div>
        <div>
          <div className="flex items-center justify-between"><label className="field-label" htmlFor="password">{t('password')}</label><Link className="mb-1.5 text-sm font-medium text-brand-600 hover:underline" to="/forgot-password">{t('forgotPassword')}</Link></div>
          <div className="relative"><input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" className="field-input pr-11" {...register('password')} /><button type="button" className="absolute inset-y-0 right-0 px-3 text-slate-500" onClick={() => setShowPassword((value) => !value)} aria-label="แสดงหรือซ่อนรหัสผ่าน">{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
          {errors.password && <p className="form-error">{errors.password.message}</p>}
        </div>
        <Captcha onToken={setCaptchaToken} />
        <button className="btn-primary w-full" disabled={isSubmitting}><LogIn size={18} />{isSubmitting ? t('loading') : t('signIn')}</button>
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-center text-xs text-slate-500">ผู้ดูแลระบบเข้าสู่ระบบด้วย Gmail เดียวกัน ระบบจะตรวจสิทธิ์และเปิดหน้าตั้งค่าระบบให้อัตโนมัติ</p>
        <p className="text-center text-sm text-slate-600">{t('noAccount')} <Link to="/register" className="font-semibold text-brand-600 hover:underline">{t('register')}</Link></p>
      </form>
    </AuthLayout>
  )
}
