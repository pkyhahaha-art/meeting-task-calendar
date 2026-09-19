import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { UserPlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../components/AuthLayout'
import { FormMessage } from '../components/FormMessage'
import { useLanguage } from '../i18n/LanguageProvider'
import { appUrl } from '../lib/appUrl'
import { supabase } from '../lib/supabase'
import { registrationSchema, type RegistrationValues } from '../lib/validation'

export function RegisterPage() {
  const { t, language } = useLanguage()
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<RegistrationValues>({ resolver: zodResolver(registrationSchema) })

  const submit = async (values: RegistrationValues) => {
    setMessage(null)
    const { error } = await supabase.auth.signUp({
      email: values.email.toLowerCase(),
      password: values.password,
      options: {
        emailRedirectTo: appUrl('/auth/callback'),
        data: { full_name: values.fullName.trim(), employee_id: values.employeeId.trim().toUpperCase() },
      },
    })
    if (error) { setMessage({ type: 'error', text: language === 'th' ? 'สมัครไม่สำเร็จ Gmail หรือรหัสพนักงานอาจถูกใช้งานแล้ว' : 'Registration failed. The Gmail or Employee ID may already be in use.' }); return }
    reset()
    setMessage({ type: 'success', text: language === 'th' ? 'สมัครสำเร็จ กรุณาเปิด Gmail และกดลิงก์ยืนยันก่อนเข้าสู่ระบบ' : 'Registration submitted. Open Gmail and confirm your account before signing in.' })
  }

  return (
    <AuthLayout title={t('createAccount')} subtitle={language === 'th' ? 'ยืนยันบัญชีผ่านลิงก์ที่ส่งไปยัง Gmail' : 'Confirm your account using the link sent to Gmail'}>
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        {message && <FormMessage type={message.type}>{message.text}</FormMessage>}
        <div><label className="field-label" htmlFor="fullName">{t('fullName')}</label><input id="fullName" autoComplete="name" className="field-input" {...register('fullName')} />{errors.fullName && <p className="form-error">{errors.fullName.message}</p>}</div>
        <div><label className="field-label" htmlFor="employeeId">{t('employeeId')}</label><input id="employeeId" autoComplete="off" className="field-input uppercase" {...register('employeeId')} />{errors.employeeId && <p className="form-error">{errors.employeeId.message}</p>}</div>
        <div><label className="field-label" htmlFor="email">{t('email')}</label><input id="email" type="email" autoComplete="email" className="field-input" placeholder="name@gmail.com" {...register('email')} />{errors.email && <p className="form-error">{errors.email.message}</p>}</div>
        <div><label className="field-label" htmlFor="password">{t('password')}</label><input id="password" type="password" autoComplete="new-password" className="field-input" {...register('password')} />{errors.password && <p className="form-error">{errors.password.message}</p>}</div>
        <div><label className="field-label" htmlFor="confirmPassword">{t('confirmPassword')}</label><input id="confirmPassword" type="password" autoComplete="new-password" className="field-input" {...register('confirmPassword')} />{errors.confirmPassword && <p className="form-error">{errors.confirmPassword.message}</p>}</div>
        <button className="btn-primary w-full" disabled={isSubmitting}><UserPlus size={18} />{isSubmitting ? t('loading') : t('createAccount')}</button>
        <p className="text-center text-sm text-slate-600">{t('haveAccount')} <Link to="/login" className="font-semibold text-brand-600 hover:underline">{t('signIn')}</Link></p>
      </form>
    </AuthLayout>
  )
}
