import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, CheckCircle2, Loader2, MailCheck, ShieldCheck, Users } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { appUrl } from '../lib/appUrl'
import type { Database } from '../lib/database.types'
import { supabase } from '../lib/supabase'

type Profile = Database['public']['Tables']['profiles']['Row']

const statusText: Record<Profile['status'], string> = {
  pending_verification: 'รอยืนยัน Gmail', active: 'ใช้งานอยู่', disabled: 'ระงับแล้ว',
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : 'ยังไม่ยืนยัน'
}

export function AdminPage() {
  const { profile, user } = useAuth()
  const queryClient = useQueryClient()
  const [working, setWorking] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const profilesQuery = useQuery({
    queryKey: ['admin-profiles'],
    enabled: profile?.role === 'admin',
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('full_name').returns<Profile[]>()
      if (error) throw error
      return data
    },
  })
  if (profile?.role !== 'admin') return <Navigate to="/calendar" replace />

  const resendVerification = async (account: Profile) => {
    if (!window.confirm(`ส่งอีเมลยืนยันการสมัครใหม่ไปที่ ${account.email} หรือไม่?`)) return
    setWorking(account.id); setMessage('')
    const { error } = await supabase.auth.resend({ type: 'signup', email: account.email, options: { emailRedirectTo: appUrl('/auth/callback') } })
    setWorking(null)
    setMessage(error ? `ส่งไม่สำเร็จ: ${error.message}` : `ส่งอีเมลยืนยันไปที่ ${account.email} แล้ว`)
  }

  const changeStatus = async (account: Profile, nextStatus: 'active' | 'disabled') => {
    const action = nextStatus === 'disabled' ? 'ระงับ' : 'เปิดใช้งาน'
    if (!window.confirm(`ยืนยัน${action}บัญชี ${account.email} หรือไม่?`)) return
    setWorking(account.id); setMessage('')
    const { error } = await supabase.rpc('admin_set_profile_status', { target_user_id: account.id, next_status: nextStatus })
    if (!error) await queryClient.invalidateQueries({ queryKey: ['admin-profiles'] })
    setWorking(null)
    setMessage(error ? `${action}บัญชีไม่สำเร็จ: ${error.message}` : `${action}บัญชี ${account.email} แล้ว`)
  }

  return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
    <div><h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><ShieldCheck className="text-brand-600" />ตั้งค่าผู้ดูแลระบบ</h1><p className="mt-1 text-sm text-slate-500">ตรวจสอบสถานะ ยืนยันการสมัคร และควบคุมการใช้งานบัญชีพนักงาน</p></div>
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900"><strong>การลืมรหัสผ่านเป็นบริการแบบทำเอง:</strong> ให้พนักงานกด “ลืมรหัสผ่าน” ที่หน้าเข้าสู่ระบบ Admin ไม่จำเป็นต้องรีเซ็ตรหัสผ่านแทน</div>
    {message && <p className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-800" role="status">{message}</p>}
    <section className="card overflow-hidden"><div className="border-b border-slate-200 p-5"><h2 className="flex items-center gap-2 text-lg font-bold"><Users size={20} className="text-brand-600" />บัญชีพนักงาน</h2><p className="mt-1 text-sm text-slate-500">บัญชีที่ระงับจะถูกปฏิเสธไม่ให้เข้าใช้งานข้อมูลของระบบ</p></div>
      {profilesQuery.isLoading ? <div className="flex justify-center p-10"><Loader2 className="animate-spin text-brand-600" /></div> : profilesQuery.isError ? <p className="p-5 text-red-600">โหลดรายชื่อไม่สำเร็จ กรุณาตรวจสอบสิทธิ์ Admin</p> : <div className="divide-y divide-slate-100">{profilesQuery.data?.map((account) => {
        const isWorking = working === account.id
        return <article key={account.id} className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(250px,0.8fr)_auto] lg:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold">{account.full_name}</p>{account.role === 'admin' && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-bold text-violet-700">Admin</span>}<span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${account.status === 'active' ? 'bg-green-50 text-green-700' : account.status === 'disabled' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{statusText[account.status]}</span></div><p className="truncate text-sm text-slate-500">{account.email}{account.employee_id ? ` · ${account.employee_id}` : ''}</p></div><dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className="font-semibold text-slate-500">วันที่สมัคร</dt><dd className="mt-1 text-slate-700">{formatDate(account.created_at)}</dd></div><div><dt className="font-semibold text-slate-500">ยืนยัน Gmail</dt><dd className="mt-1 text-slate-700">{formatDate(account.email_verified_at)}</dd></div></dl><div className="flex flex-wrap gap-2 lg:justify-end">{!account.email_verified_at && <button type="button" className="btn-secondary" disabled={isWorking} onClick={() => void resendVerification(account)}>{isWorking ? <Loader2 size={17} className="animate-spin" /> : <MailCheck size={17} />}ส่งอีเมลยืนยันใหม่</button>}{account.status === 'active' ? <button type="button" className="btn-secondary border-red-200 text-red-600 hover:bg-red-50" disabled={isWorking || account.id === user?.id} title={account.id === user?.id ? 'ไม่สามารถระงับบัญชีของตัวเอง' : undefined} onClick={() => void changeStatus(account, 'disabled')}><Ban size={17} />ระงับบัญชี</button> : account.status === 'disabled' ? <button type="button" className="btn-secondary border-green-200 text-green-700 hover:bg-green-50" disabled={isWorking} onClick={() => void changeStatus(account, 'active')}><CheckCircle2 size={17} />เปิดใช้งาน</button> : null}</div></article>
      })}</div>}
    </section>
  </main>
}
