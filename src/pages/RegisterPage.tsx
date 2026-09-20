import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { MailWarning, UserPlus, X } from 'lucide-react'
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
  const [showExistingAccount, setShowExistingAccount] = useState(false)
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<RegistrationValues>({ resolver: zodResolver(registrationSchema) })

  const submit = async (values: RegistrationValues) => {
    setMessage(null)
    const fullName = `${values.namePrefix} ${values.firstName.trim()} ${values.lastName.trim()}`
    const { data, error } = await supabase.auth.signUp({
      email: values.email.toLowerCase(),
      password: values.password,
      options: {
        emailRedirectTo: appUrl('/auth/callback'),
        data: { full_name: fullName, employee_id: values.employeeId },
      },
    })
    if (data.user?.identities?.length === 0 || error?.message.toLowerCase().includes('already registered')) {
      setShowExistingAccount(true)
      return
    }
    if (error) { setMessage({ type: 'error', text: language === 'th' ? 'สมัครไม่สำเร็จ Gmail หรือรหัสพนักงานอาจถูกใช้งานแล้ว' : 'Registration failed. The Gmail or Employee ID may already be in use.' }); return }
    reset()
    setMessage({ type: 'success', text: language === 'th' ? 'สมัครสำเร็จ กรุณาเปิด Gmail และกดลิงก์ยืนยันก่อนเข้าสู่ระบบ' : 'Registration submitted. Open Gmail and confirm your account before signing in.' })
  }

  return (
    <AuthLayout title={t('createAccount')} subtitle={language === 'th' ? 'ยืนยันบัญชีผ่านลิงก์ที่ส่งไปยัง Gmail' : 'Confirm your account using the link sent to Gmail'}>
      <form onSubmit={handleSubmit(submit)} className="space-y-4" noValidate>
        {message && <FormMessage type={message.type}>{message.text}</FormMessage>}
        <fieldset>
          <div className="grid gap-3 sm:grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)]">
            <div><label className="field-label" htmlFor="namePrefix">คำนำหน้า</label><select id="namePrefix" autoComplete="honorific-prefix" className="field-input" defaultValue="" {...register('namePrefix')}><option value="" disabled>เลือก</option><option value="นาย">นาย</option><option value="นาง">นาง</option><option value="นางสาว">นางสาว</option></select>{errors.namePrefix && <p className="form-error">{errors.namePrefix.message}</p>}</div>
            <div><label className="field-label" htmlFor="firstName">ชื่อ</label><input id="firstName" autoComplete="given-name" className="field-input" placeholder="กรอกชื่อ" {...register('firstName')} />{errors.firstName && <p className="form-error">{errors.firstName.message}</p>}</div>
            <div><label className="field-label" htmlFor="lastName">นามสกุล</label><input id="lastName" autoComplete="family-name" className="field-input" placeholder="กรอกนามสกุล" {...register('lastName')} />{errors.lastName && <p className="form-error">{errors.lastName.message}</p>}</div>
          </div>
          <p className="mt-2 text-xs text-slate-500">ใช้เฉพาะตัวอักษรไทยหรืออังกฤษ ห้ามใส่ตัวเลขและสัญลักษณ์</p>
        </fieldset>
        <div><label className="field-label" htmlFor="employeeId">{t('employeeId')}</label><input id="employeeId" autoComplete="off" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} className="field-input" placeholder="ตัวเลข 6 หลัก" {...register('employeeId')} onInput={(event) => { event.currentTarget.value = event.currentTarget.value.replace(/\D/g, '').slice(0, 6) }} />{errors.employeeId && <p className="form-error">{errors.employeeId.message}</p>}</div>
        <div><label className="field-label" htmlFor="email">{t('email')}</label><input id="email" type="email" autoComplete="email" className="field-input" placeholder="name@gmail.com" {...register('email')} />{errors.email && <p className="form-error">{errors.email.message}</p>}</div>
        <div><label className="field-label" htmlFor="password">{t('password')}</label><input id="password" type="password" autoComplete="new-password" className="field-input" {...register('password')} />{errors.password && <p className="form-error">{errors.password.message}</p>}</div>
        <div><label className="field-label" htmlFor="confirmPassword">{t('confirmPassword')}</label><input id="confirmPassword" type="password" autoComplete="new-password" className="field-input" {...register('confirmPassword')} />{errors.confirmPassword && <p className="form-error">{errors.confirmPassword.message}</p>}</div>
        <button className="btn-primary w-full" disabled={isSubmitting}><UserPlus size={18} />{isSubmitting ? t('loading') : t('createAccount')}</button>
        <p className="text-center text-sm text-slate-600">{t('haveAccount')} <Link to="/login" className="font-semibold text-brand-600 hover:underline">{t('signIn')}</Link></p>
      </form>
      {showExistingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="existing-account-title">
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
            <button type="button" className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setShowExistingAccount(false)} aria-label="ปิด"><X size={20} /></button>
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-600"><MailWarning size={30} /></div>
            <h2 id="existing-account-title" className="text-xl font-bold text-slate-900">Gmail นี้สมัครสมาชิกแล้ว</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">หากคุณเคยสมัครสมาชิกแล้วและจำรหัสผ่านไม่ได้ โปรดกด “ลืมรหัสผ่าน” เพื่อตั้งรหัสผ่านใหม่</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button type="button" className="btn-secondary justify-center" onClick={() => setShowExistingAccount(false)}>ปิด</button>
              <Link to="/forgot-password" className="btn-primary justify-center">ลืมรหัสผ่าน</Link>
            </div>
          </div>
        </div>
      )}
    </AuthLayout>
  )
}
