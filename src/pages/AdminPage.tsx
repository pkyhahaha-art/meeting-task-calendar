import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Ban, BellRing, CalendarDays, CheckCircle2, Loader2, MailCheck, ShieldCheck, Users } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useConfirm } from '../components/ConfirmDialogProvider'
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
  const confirm = useConfirm()
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
  const overviewQuery = useQuery({
    queryKey: ['admin-overview'],
    enabled: profile?.role === 'admin',
    queryFn: async () => {
      const [events, tasks, deliveries, audit, system] = await Promise.all([
        supabase.from('events').select('*', { count: 'exact', head: true }).is('deleted_at', null),
        supabase.from('tasks').select('*', { count: 'exact', head: true }).is('deleted_at', null),
        supabase.from('notification_deliveries').select('*').order('created_at', { ascending: false }).limit(20),
        supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(20),
        supabase.from('system_logs').select('*').order('created_at', { ascending: false }).limit(20),
      ])
      const error = events.error || tasks.error || deliveries.error || audit.error || system.error
      if (error) throw error
      return { eventCount: events.count ?? 0, taskCount: tasks.count ?? 0, deliveries: deliveries.data, audit: audit.data, system: system.data }
    },
  })
  if (profile?.role !== 'admin') return <Navigate to="/calendar" replace />

  const resendVerification = async (account: Profile) => {
    if (!await confirm({ title: 'ส่งอีเมลยืนยันใหม่?', message: `ระบบจะส่งอีเมลยืนยันการสมัครไปที่ ${account.email}`, confirmLabel: 'ส่งอีเมล' })) return
    setWorking(account.id); setMessage('')
    const { error } = await supabase.auth.resend({ type: 'signup', email: account.email, options: { emailRedirectTo: appUrl('/auth/callback') } })
    setWorking(null)
    setMessage(error ? `ส่งไม่สำเร็จ: ${error.message}` : `ส่งอีเมลยืนยันไปที่ ${account.email} แล้ว`)
  }

  const changeStatus = async (account: Profile, nextStatus: 'active' | 'disabled') => {
    const action = nextStatus === 'disabled' ? 'ระงับ' : 'เปิดใช้งาน'
    if (!await confirm({ title: `${action}บัญชี?`, message: `${action}การใช้งานบัญชี ${account.email}`, confirmLabel: action, tone: nextStatus === 'disabled' ? 'danger' : 'default' })) return
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
    <section className="grid gap-4 sm:grid-cols-3"><div className="card p-5"><CalendarDays className="text-brand-600" /><p className="mt-3 text-3xl font-bold">{overviewQuery.data?.eventCount ?? '—'}</p><p className="text-sm text-slate-500">Meeting ที่ใช้งานอยู่</p></div><div className="card p-5"><Activity className="text-amber-600" /><p className="mt-3 text-3xl font-bold">{overviewQuery.data?.taskCount ?? '—'}</p><p className="text-sm text-slate-500">Task ที่ใช้งานอยู่</p></div><div className="card p-5"><BellRing className="text-violet-600" /><p className="mt-3 text-3xl font-bold">{overviewQuery.data?.deliveries.filter((item) => item.status === 'failed' || item.status === 'deferred_quota').length ?? '—'}</p><p className="text-sm text-slate-500">การแจ้งเตือนที่ต้องตรวจสอบล่าสุด</p></div></section>
    {overviewQuery.isError && <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">โหลดข้อมูลระบบไม่สำเร็จ กรุณาตรวจสอบ migration และสิทธิ์ Admin</p>}
    <section className="grid gap-5 xl:grid-cols-2"><div className="card overflow-hidden"><div className="border-b p-5"><h2 className="font-bold">การส่งแจ้งเตือนล่าสุด</h2></div><div className="divide-y text-sm">{overviewQuery.data?.deliveries.map((item) => <div key={item.id} className="grid grid-cols-[auto_1fr_auto] gap-3 p-4"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.status === 'sent' ? 'bg-green-50 text-green-700' : item.status === 'failed' || item.status === 'deferred_quota' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{item.status}</span><div className="min-w-0"><p className="truncate font-medium">{item.template_key}</p><p className="truncate text-xs text-slate-500">{item.channel} · {item.recipient_type}{item.error_message ? ` · ${item.error_message}` : ''}</p></div><time className="text-xs text-slate-400">{formatDate(item.created_at)}</time></div>)}{overviewQuery.data?.deliveries.length === 0 && <p className="p-5 text-slate-500">ยังไม่มีข้อมูล</p>}</div></div><div className="card overflow-hidden"><div className="border-b p-5"><h2 className="font-bold">งานระบบล่าสุด</h2></div><div className="divide-y text-sm">{overviewQuery.data?.system.map((item) => <div key={item.id} className="flex items-center gap-3 p-4"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${item.status === 'completed' ? 'bg-green-50 text-green-700' : item.status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-sky-50 text-sky-700'}`}>{item.status}</span><div><p className="font-medium">{item.job_name}</p><p className="text-xs text-slate-500">ประมวลผล {item.processed_count} รายการ</p></div><time className="ml-auto text-xs text-slate-400">{formatDate(item.created_at)}</time></div>)}{overviewQuery.data?.system.length === 0 && <p className="p-5 text-slate-500">ยังไม่มีข้อมูล</p>}</div></div></section>
    <section className="card overflow-hidden"><div className="border-b p-5"><h2 className="font-bold">Audit Log ล่าสุด</h2></div><div className="divide-y text-sm">{overviewQuery.data?.audit.map((item) => <div key={item.id} className="grid gap-1 p-4 sm:grid-cols-[180px_1fr_auto]"><strong>{item.action}</strong><span className="text-slate-600">{item.entity_type}{item.entity_id ? ` · ${item.entity_id}` : ''}</span><time className="text-xs text-slate-400">{formatDate(item.created_at)}</time></div>)}{overviewQuery.data?.audit.length === 0 && <p className="p-5 text-slate-500">ยังไม่มีข้อมูล</p>}</div></section>
  </main>
}
