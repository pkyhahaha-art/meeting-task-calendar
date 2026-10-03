import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, CheckCircle2, Download, Loader2, MailCheck, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useConfirm } from '../components/ConfirmDialogProvider'
import { appUrl } from '../lib/appUrl'
import { supabase } from '../lib/supabase'
import { departmentsFor, organizationUnits } from '../lib/organization'
import { downloadCsv, filterAdminProfiles, reportDateBounds, reportPageSize, type AdminProfile, type MemberFilters } from '../lib/adminReports'
import { loadAdminOverview, loadAdminProfiles, loadLatestSystemLog } from '../lib/adminReportQueries'
import { AdminFilter, AdminPager, AdminStatus, adminDate } from '../components/AdminReportControls'
import { AdminHistoryPanel } from '../components/AdminHistoryPanel'

const statusText = { pending_verification: 'รอยืนยัน Gmail', active: 'ใช้งานอยู่', disabled: 'ระงับแล้ว' }
const emptyFilters: MemberFilters = { search: '', status: '', unit: '', department: '', missing: false }
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)

export function AdminPage() {
  const { profile, user } = useAuth()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [working, setWorking] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [filters, setFilters] = useState(emptyFilters)
  const [page, setPage] = useState(0)
  const [dates, setDates] = useState(() => ({ from: `${today().slice(0, 7)}-01`, to: today() }))
  const allowed = profile?.role === 'admin' && profile.status === 'active'
  let dateError = ''
  try { reportDateBounds(dates) } catch (error) { dateError = error instanceof Error ? error.message : 'ช่วงวันที่ไม่ถูกต้อง' }
  const profilesQuery = useQuery({ queryKey: ['admin-profiles', user?.id], enabled: allowed, queryFn: loadAdminProfiles })
  const overviewQuery = useQuery({ queryKey: ['admin-overview', user?.id, dates], enabled: allowed && !dateError, queryFn: () => loadAdminOverview(dates) })
  const latestSystem = useQuery({ queryKey: ['admin-latest-system', user?.id], enabled: allowed, queryFn: loadLatestSystemLog })
  const members = profilesQuery.data || []
  const filtered = filterAdminProfiles(members, filters)
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / reportPageSize) - 1))
  const updateFilters = (value: Partial<MemberFilters>) => { setFilters({ ...filters, ...value }); setPage(0); setMessage('') }
  if (!allowed) return <Navigate to="/calendar" replace />

  // Keep the existing confirmed account actions and RPC permissions.
  const resendVerification = async (account: AdminProfile) => {
    if (!await confirm({ title: 'ส่งอีเมลยืนยันใหม่?', message: `ระบบจะส่งอีเมลยืนยันการสมัครไปที่ ${account.email}`, confirmLabel: 'ส่งอีเมล' })) return
    setWorking(account.id); setMessage('')
    const { error } = await supabase.auth.resend({ type: 'signup', email: account.email, options: { emailRedirectTo: appUrl('/auth/callback') } })
    setWorking(null)
    setMessage(error ? `ส่งไม่สำเร็จ: ${error.message}` : `ส่งอีเมลยืนยันไปที่ ${account.email} แล้ว`)
  }
  const changeStatus = async (account: AdminProfile, nextStatus: 'active' | 'disabled') => {
    const action = nextStatus === 'disabled' ? 'ระงับ' : 'เปิดใช้งาน'
    if (!await confirm({ title: `${action}บัญชี?`, message: `${action}การใช้งานบัญชี ${account.email}`, confirmLabel: action, tone: nextStatus === 'disabled' ? 'danger' : 'default' })) return
    setWorking(account.id); setMessage('')
    const { error } = await supabase.rpc('admin_set_profile_status', { target_user_id: account.id, next_status: nextStatus })
    if (!error) await queryClient.invalidateQueries({ queryKey: ['admin-profiles'] })
    setWorking(null)
    setMessage(error ? `${action}บัญชีไม่สำเร็จ: ${error.message}` : `${action}บัญชี ${account.email} แล้ว`)
  }
  const exportMembers = () => {
    downloadCsv('members-filtered.csv', ['ชื่อ', 'รหัสพนักงาน', 'Gmail', 'หน่วยงาน', 'แผนก', 'สิทธิ์', 'สถานะ', 'วันที่สมัคร', 'ยืนยัน Gmail'], filtered.map((account) => [account.full_name, account.employee_id, account.email, account.organization_unit, account.department, account.role, statusText[account.status], adminDate(account.created_at), adminDate(account.email_verified_at)]))
    setMessage(`ส่งออกสมาชิก ${filtered.length} รายการตามตัวกรองแล้ว`)
  }
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-profiles'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-latest-system'] })
  }

  return <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><ShieldCheck className="text-brand-600" />ผู้ดูแลระบบ</h1><p className="mt-1 text-sm text-slate-500">จัดการสมาชิก ตรวจการแจ้งเตือน และดูรายงาน</p></div><button type="button" className="btn-secondary" onClick={refresh} disabled={profilesQuery.isFetching || overviewQuery.isFetching || latestSystem.isFetching}><RefreshCw size={16} />โหลดภาพรวมใหม่</button></header>
    <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900"><strong>การลืมรหัสผ่านเป็นบริการแบบทำเอง:</strong> ให้พนักงานกด “ลืมรหัสผ่าน” ที่หน้าเข้าสู่ระบบ อีเมลยืนยันส่งอัตโนมัติเมื่อสมัคร ปุ่มส่งใหม่ใช้เฉพาะเมื่อสมาชิกยังไม่ยืนยันและต้องการลิงก์ใหม่</div>
    {message && <p role="status" className="rounded-xl bg-purple-50 p-3 text-sm text-brand-800">{message}</p>}
    <section className="grid gap-3 sm:grid-cols-3" aria-label="ภาพรวมบัญชีสมาชิกทั้งหมด">
      {Object.entries(statusText).map(([status, label]) => <div key={status} className="card p-4"><p className="text-2xl font-bold text-brand-700">{profilesQuery.isSuccess ? members.filter((member) => member.status === status).length : '—'}</p><p className="text-sm text-slate-500">สมาชิก{label} · ทุกช่วงเวลา</p></div>)}
    </section>
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4"><div><h2 className="flex items-center gap-2 text-lg font-bold"><Users size={20} className="text-brand-600" />บัญชีพนักงาน</h2><p className="mt-1 text-xs text-slate-500">ค้นหาจากสมาชิกทั้งหมด บัญชีที่ระงับจะถูกปฏิเสธการใช้งานตามเงื่อนไขเดิม</p></div><button type="button" className="btn-secondary" disabled={!profilesQuery.isSuccess || profilesQuery.isFetching || !filtered.length} onClick={exportMembers}><Download size={16} />CSV ตามตัวกรอง</button></div>
      <div className="grid gap-3 border-b border-slate-100 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminFilter label="ชื่อ / รหัสพนักงาน / Gmail"><input className="field-input" value={filters.search} onChange={(e) => updateFilters({ search: e.target.value })} /></AdminFilter>
        <AdminFilter label="สถานะสมาชิก"><select className="field-input" value={filters.status} onChange={(e) => updateFilters({ status: e.target.value })}><option value="">ทุกสถานะ</option>{Object.entries(statusText).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></AdminFilter>
        <AdminFilter label="หน่วยงาน"><select className="field-input" value={filters.unit} onChange={(e) => updateFilters({ unit: e.target.value, department: '' })}><option value="">ทุกหน่วยงาน</option>{organizationUnits.map((unit) => <option key={unit}>{unit}</option>)}</select></AdminFilter>
        <AdminFilter label="แผนก"><select className="field-input" disabled={!departmentsFor(filters.unit).length} value={filters.department} onChange={(e) => updateFilters({ department: e.target.value })}><option value="">ทุกแผนก</option>{departmentsFor(filters.unit).map((department) => <option key={department}>{department}</option>)}</select></AdminFilter>
        <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={filters.missing} onChange={(e) => updateFilters({ missing: e.target.checked })} />เฉพาะสมาชิกที่ข้อมูลสังกัดยังไม่ครบ</label>
        <button type="button" className="btn-secondary justify-self-start" onClick={() => { setFilters(emptyFilters); setPage(0) }}>ล้างตัวกรองสมาชิก</button>
      </div>
      {profilesQuery.isPending ? <p role="status" className="p-5 text-slate-500">กำลังโหลดสมาชิก…</p> : profilesQuery.isError ? <p role="alert" className="p-5 text-red-700">โหลดรายชื่อไม่สำเร็จ กรุณาตรวจสิทธิ์ Admin และโหลดใหม่</p> : <>
        <div className="divide-y divide-slate-100">{filtered.slice(currentPage * reportPageSize, (currentPage + 1) * reportPageSize).map((account) => <article key={account.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-1"><p className="flex flex-wrap items-center gap-2 font-semibold">{account.full_name}{account.role === 'admin' && <span className="text-xs text-brand-700">Admin</span>}<AdminStatus value={account.status} label={statusText[account.status]} /></p><p className="break-words text-sm text-slate-600">{account.email} · {account.employee_id || 'ไม่ระบุรหัสพนักงาน'}</p><p className="text-sm text-slate-500">{[account.department, account.organization_unit].filter(Boolean).join(' · ') || 'ยังไม่ระบุสังกัด'}</p><p className="text-xs text-slate-400">สมัคร {adminDate(account.created_at)} · ยืนยัน Gmail {account.email_verified_at ? adminDate(account.email_verified_at) : 'ยังไม่ยืนยัน'}</p></div>
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">{!account.email_verified_at && <button type="button" className="btn-secondary" disabled={Boolean(working)} onClick={() => void resendVerification(account)}>{working === account.id ? <Loader2 size={16} className="animate-spin" /> : <MailCheck size={16} />}ส่งอีเมลยืนยันใหม่</button>}{account.status === 'active' ? <button type="button" className="btn-secondary text-red-700" disabled={Boolean(working) || account.id === user?.id} title={account.id === user?.id ? 'ไม่สามารถระงับบัญชีของตัวเอง' : undefined} onClick={() => void changeStatus(account, 'disabled')}><Ban size={16} />ระงับบัญชี</button> : account.status === 'disabled' ? <button type="button" className="btn-secondary text-green-700" disabled={Boolean(working)} onClick={() => void changeStatus(account, 'active')}><CheckCircle2 size={16} />เปิดใช้งาน</button> : null}</div>
        </article>)}</div>
        <AdminPager count={filtered.length} page={currentPage} busy={profilesQuery.isFetching} onPage={setPage} />
      </>}
    </section>
    <section className="card space-y-4 p-4">
      <h2 className="font-bold">ช่วงวันที่รายงานงาน/ประชุมและประวัติ</h2>
      <div className="flex flex-wrap items-end gap-3"><AdminFilter label="ตั้งแต่วันที่"><input type="date" className="field-input" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} /></AdminFilter><AdminFilter label="ถึงวันที่"><input type="date" className="field-input" value={dates.to} onChange={(e) => setDates({ ...dates, to: e.target.value })} /></AdminFilter><button type="button" className="btn-secondary" onClick={() => setDates({ from: '', to: '' })}>ทุกช่วงเวลา</button></div>
      <p className="text-xs text-slate-500">นับตามวันที่สร้าง/บันทึกรายการ เวลาไทย รวมวันสิ้นสุด · ไม่รวมงาน/ประชุมที่ลบ · ประชุมทำซ้ำนับชุดละ 1 รายการ</p>
      {dateError ? <p role="alert" className="text-sm text-amber-800">{dateError}</p> : overviewQuery.isError ? <p role="alert" className="text-sm text-red-700">โหลดภาพรวมไม่สำเร็จ กรุณาลองใหม่</p> : <div className="grid gap-3 sm:grid-cols-3">{[['Meeting ที่สร้าง', overviewQuery.data?.eventCount], ['Task ที่สร้าง', overviewQuery.data?.taskCount], ['แจ้งเตือนที่ต้องตรวจสอบ', overviewQuery.data?.problemCount]].map(([label, value]) => <div key={label} className="rounded-xl bg-purple-50 p-4"><p className="text-2xl font-bold text-brand-700">{overviewQuery.isPending || overviewQuery.isFetching ? '…' : value}</p><p className="text-sm text-slate-600">{label}</p></div>)}</div>}
      <p className="text-xs text-slate-500">แจ้งเตือนที่ต้องตรวจสอบนับสถานะ “ส่งไม่สำเร็จ” และ “รอโควตา” ครบทุกแถวในช่วงวันที่ ไม่จำกัด 20 รายการล่าสุด</p>
    </section>
    <section className="card space-y-2 p-4"><h2 className="font-bold">งานระบบล่าสุด · ทุกช่วงเวลา</h2>{latestSystem.isPending ? <p role="status" className="text-sm text-slate-500">กำลังตรวจงานระบบ…</p> : latestSystem.isError ? <p role="alert" className="text-sm text-red-700">ตรวจงานระบบไม่ได้ กรุณาโหลดภาพรวมใหม่</p> : latestSystem.data ? <p className="text-sm text-slate-600">{latestSystem.data.job_name} · <AdminStatus value={latestSystem.data.status} /> · {adminDate(latestSystem.data.created_at)} · ประมวลผล {latestSystem.data.processed_count} รายการ</p> : <p className="text-sm text-slate-500">ยังไม่มีประวัติงานระบบ</p>}</section>
    <AdminHistoryPanel members={members} dates={dates} />
  </main>
}
