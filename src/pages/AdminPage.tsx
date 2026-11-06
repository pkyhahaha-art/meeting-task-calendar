import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Camera, CheckCircle2, Download, Loader2, MailCheck, Pencil, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import Swal from 'sweetalert2'
import { useAuth } from '../auth/AuthProvider'
import { useConfirm } from '../components/ConfirmDialogProvider'
import { useLanguage } from '../i18n/LanguageProvider'
import { MemberAvatar, useAvatarDirectory, uploadMemberAvatar, removeMemberAvatar } from '../components/MemberAvatar'
import { appUrl } from '../lib/appUrl'
import { supabase } from '../lib/supabase'
import { departmentsFor, normalizeOrganizationSelection, organizationUnits } from '../lib/organization'
import { downloadCsv, filterAdminProfiles, reportDateBounds, reportPageSize, type AdminProfile, type MemberFilters } from '../lib/adminReports'
import { loadAdminOverview, loadAdminProfiles, loadLatestSystemLog } from '../lib/adminReportQueries'
import { AdminFilter, AdminPager, AdminStatus, adminDate } from '../components/AdminReportControls'
import { AdminHistoryPanel } from '../components/AdminHistoryPanel'
import { AdminCalendarItemsPanel } from '../components/AdminCalendarItemsPanel'
import { AdminEditMemberDialog } from '../components/AdminEditMemberDialog'

const statusText = { pending_verification: 'รอยืนยัน Gmail', active: 'ใช้งานอยู่', disabled: 'ระงับแล้ว' }
const emptyFilters: MemberFilters = { search: '', status: '', unit: '', department: '', missing: false }
const today = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10)
const memberOrganization = (account: AdminProfile) => {
  const selection = normalizeOrganizationSelection(account.organization_unit, account.department)
  return { ...selection, department: selection.department || (departmentsFor(selection.unit).length ? 'ไม่ระบุ' : '') }
}

export function AdminPage() {
  const { profile, user } = useAuth()
  const { text } = useLanguage()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const avatarsDirectory = useAvatarDirectory()
  const [working, setWorking] = useState<string | null>(null)
  const [avatarWorking, setAvatarWorking] = useState<string | null>(null)
  const [editingMember, setEditingMember] = useState<AdminProfile | null>(null)
  const [message, setMessage] = useState('')
  const [area, setArea] = useState<'overview' | 'items'>('overview')
  const [filters, setFilters] = useState(emptyFilters)
  const [page, setPage] = useState(0)
  const [dates, setDates] = useState(() => ({ from: `${today().slice(0, 7)}-01`, to: today() }))
  const allowed = profile?.role === 'admin' && profile.status === 'active'
  let dateError = ''
  try { reportDateBounds(dates) } catch (error) { dateError = error instanceof Error ? error.message : 'ช่วงวันที่ไม่ถูกต้อง' }
  const profilesQuery = useQuery({ queryKey: ['admin-profiles', user?.id], enabled: allowed, queryFn: loadAdminProfiles })
  const overviewQuery = useQuery({ queryKey: ['admin-overview', user?.id, dates], enabled: allowed && !dateError, queryFn: () => loadAdminOverview(dates) })
  const latestSystem = useQuery({ queryKey: ['admin-latest-system', user?.id], enabled: allowed, queryFn: loadLatestSystemLog })

  if (!user) return <Navigate to="/login" replace />
  if (!allowed) return <main className="admin-page-main mx-auto max-w-4xl p-6"><h1 className="text-xl font-bold text-red-700">ไม่มีสิทธิ์ใช้งาน</h1><p className="mt-2 text-slate-600">หน้านี้สำหรับ Admin ที่มีสถานะใช้งานอยู่เท่านั้น</p></main>

  const members = profilesQuery.data || []
  const filtered = filterAdminProfiles(members, filters)
  const maxPage = Math.max(0, Math.ceil(filtered.length / reportPageSize) - 1)
  const currentPage = Math.min(page, maxPage)
  const updateFilters = (next: Partial<MemberFilters>) => { setFilters((current) => ({ ...current, ...next })); setPage(0) }

  const resendVerification = async (account: AdminProfile) => {
    setWorking(account.id)
    const { error } = await supabase.auth.resend({ type: 'signup', email: account.email, options: { emailRedirectTo: appUrl('#/auth/callback') } })
    setWorking(null)
    setMessage(error ? `ส่งอีเมลยืนยันไม่สำเร็จ: ${error.message}` : `ส่งอีเมลยืนยันไปยัง ${account.email} แล้ว`)
  }

  const changeStatus = async (account: AdminProfile, nextStatus: 'active' | 'disabled') => {
    const action = nextStatus === 'disabled' ? 'ระงับ' : 'เปิดใช้งาน'
    if (!await confirm({ title: `${action}บัญชี?`, message: `${action}การใช้งานบัญชี ${account.email}`, confirmLabel: action, tone: nextStatus === 'disabled' ? 'danger' : 'default' })) return
    setWorking(account.id)
    const { error } = await supabase.rpc('admin_set_account_status' as never, { target_user_id: account.id, next_status: nextStatus } as never)
    setWorking(null)
    if (!error) await queryClient.invalidateQueries({ queryKey: ['admin-profiles'] })
    setMessage(error ? `${action}บัญชีไม่สำเร็จ: ${error.message}` : `${action}บัญชี ${account.email} สำเร็จ`)
  }

  const handleAdminUploadAvatar = async (account: AdminProfile, file: File) => {
    setAvatarWorking(account.id)
    try {
      await uploadMemberAvatar(account.id, file)
      await queryClient.invalidateQueries({ queryKey: ['member-avatars'] })
      void Swal.fire({
        icon: 'success',
        title: text('อัปโหลดรูปภาพแล้ว', 'Photo uploaded'),
        text: text(`บันทึกรูปโปรไฟล์ให้ ${account.full_name} เรียบร้อยแล้ว`, `Profile photo updated for ${account.full_name}.`),
        confirmButtonText: text('ตกลง', 'OK'),
        confirmButtonColor: '#75638F',
      })
    } catch (err) {
      console.error('Failed to upload member avatar:', err)
      const isFileErr = err instanceof Error && err.message === 'INVALID_FILE_TYPE_OR_SIZE'
      const msg = isFileErr
        ? text('เลือกรูป JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB', 'Choose a JPG, PNG or WebP up to 5 MB.')
        : text('บันทึกรูปไม่สำเร็จ กรุณาลองใหม่', 'Could not save photo. Please retry.')
      void Swal.fire({
        icon: isFileErr ? 'warning' : 'error',
        title: isFileErr ? text('ไฟล์รูปภาพไม่ถูกต้อง', 'Invalid image file') : text('บันทึกรูปไม่สำเร็จ', 'Upload failed'),
        text: msg,
        confirmButtonText: text('ตกลง', 'OK'),
        confirmButtonColor: '#75638F',
      })
    } finally {
      setAvatarWorking(null)
    }
  }

  const handleAdminRemoveAvatar = async (account: AdminProfile) => {
    if (!await confirm({
      title: text('ลบรูปโปรไฟล์?', 'Remove profile photo?'),
      message: text(`คุณต้องการลบรูปโปรไฟล์ของ ${account.full_name} ใช่หรือไม่?`, `Are you sure you want to remove the profile photo of ${account.full_name}?`),
      confirmLabel: text('ลบรูป', 'Remove photo'),
      tone: 'danger',
    })) return

    setAvatarWorking(account.id)
    try {
      await removeMemberAvatar(account.id)
      await queryClient.invalidateQueries({ queryKey: ['member-avatars'] })
      void Swal.fire({
        icon: 'success',
        title: text('ลบรูปภาพแล้ว', 'Photo removed'),
        text: text(`ลบรูปโปรไฟล์ของ ${account.full_name} เรียบร้อยแล้ว`, `Profile photo removed for ${account.full_name}.`),
        confirmButtonText: text('ตกลง', 'OK'),
        confirmButtonColor: '#75638F',
      })
    } catch (err) {
      console.error('Failed to remove member avatar:', err)
      void Swal.fire({
        icon: 'error',
        title: text('ลบรูปไม่สำเร็จ', 'Could not remove photo'),
        text: text('เกิดข้อผิดพลาดในการลบรูป กรุณาลองใหม่', 'An error occurred while removing the photo. Please retry.'),
        confirmButtonText: text('ตกลง', 'OK'),
        confirmButtonColor: '#75638F',
      })
    } finally {
      setAvatarWorking(null)
    }
  }

  const handleMemberSaved = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin-profiles'] })
    await queryClient.invalidateQueries({ queryKey: ['assignable-profiles'] })
    void Swal.fire({
      icon: 'success',
      title: text('บันทึกข้อมูลแล้ว', 'Profile updated'),
      text: text('แก้ไขข้อมูลสมาชิกเรียบร้อยแล้ว', 'Member profile updated successfully.'),
      confirmButtonText: text('ตกลง', 'OK'),
      confirmButtonColor: '#75638F',
    })
  }

  const exportMembers = () => {
    downloadCsv('members-filtered.csv', ['ชื่อ', 'รหัสพนักงาน', 'Gmail', 'หน่วยงาน', 'แผนก', 'สิทธิ์', 'สถานะ', 'วันที่สมัคร', 'ยืนยัน Gmail'], filtered.map((account) => [account.full_name, account.employee_id, account.email, memberOrganization(account).unit, memberOrganization(account).department, account.role, statusText[account.status], adminDate(account.created_at), adminDate(account.email_verified_at)]))
  }

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-profiles'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-overview'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-latest-system'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-calendar-items'] })
    void queryClient.invalidateQueries({ queryKey: ['member-avatars'] })
  }

  return <main className="admin-page-main mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
    <header className="ui-page-header flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><ShieldCheck className="text-brand-600" />จัดการระบบ</h1><p className="mt-1 text-sm text-slate-500">จัดการสมาชิก ตรวจสอบการส่ง และรายงาน</p></div><button type="button" className="btn-secondary" onClick={refresh} disabled={profilesQuery.isFetching || overviewQuery.isFetching || latestSystem.isFetching}><RefreshCw size={16} />โหลดภาพรวมใหม่</button></header>
    <div className="flex border-b border-slate-200"><button type="button" className={`px-4 py-2 font-semibold ${area === 'overview' ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500'}`} onClick={() => setArea('overview')}>ภาพรวมและสมาชิก</button><button type="button" className={`px-4 py-2 font-semibold ${area === 'items' ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-500'}`} onClick={() => setArea('items')}>จัดการรายการปฏิทิน</button></div>
    {area === 'items' ? <AdminCalendarItemsPanel adminUserId={user.id} members={members} /> : <>
    <div className="rounded-xl border border-purple-200 bg-purple-50 p-4 text-sm text-purple-900"><strong>รหัสผ่านเป็นบริการแบบจำลอง:</strong> ไม่บันทึกรหัสผ่านจริงในฐานข้อมูล ยืนยันอัตโนมัติเมื่อสมัคร เฉพาะสมาชิกที่ยังไม่ยืนยันจะต้องกดลิงก์</div>
    {message && <div role="status" className="rounded-xl border border-purple-200 bg-purple-50 p-4 text-sm text-purple-900">{message}</div>}
    <section className="grid gap-3 sm:grid-cols-3" aria-label="ภาพรวมบัญชีสมาชิกทั้งหมด">
      {Object.entries(statusText).map(([status, label]) => <div key={status} className="card p-4"><p className="text-2xl font-bold text-brand-700">{profilesQuery.isSuccess ? members.filter((member) => member.status === status).length : '—'}</p><p className="text-sm text-slate-500">สมาชิก{label} · ทุกช่วงเวลา</p></div>)}
    </section>
    <section className="ui-panel card overflow-hidden">
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
        <div className="divide-y divide-slate-100">{filtered.slice(currentPage * reportPageSize, (currentPage + 1) * reportPageSize).map((account) => <article key={account.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="relative group shrink-0">
              <MemberAvatar id={account.id} name={account.full_name} size={48} />
              <label
                title={text('เปลี่ยนรูปโปรไฟล์', 'Change profile photo')}
                className="absolute -bottom-1 -right-1 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full bg-white text-slate-600 shadow-sm border border-slate-200 hover:bg-brand-50 hover:text-brand-700 transition"
              >
                <Camera size={13} />
                <input
                  type="file"
                  className="sr-only"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={avatarWorking === account.id}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleAdminUploadAvatar(account, file)
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
            <div className="min-w-0 space-y-1">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {account.full_name}
                {account.role === 'admin' && <span className="text-xs text-brand-700">Admin</span>}
                <AdminStatus value={account.status} label={statusText[account.status]} />
              </p>
              <p className="break-words text-sm text-slate-600">{account.email} · {account.employee_id || text('ไม่ระบุรหัสพนักงาน', 'No employee ID')}</p>
              <p className="text-sm text-slate-500">{[memberOrganization(account).department, memberOrganization(account).unit].filter(Boolean).join(' · ') || text('ยังไม่ระบุสังกัด', 'Affiliation not specified')}</p>
              <p className="text-xs text-slate-400">สมัคร {adminDate(account.created_at)} · ยืนยัน Gmail {account.email_verified_at ? adminDate(account.email_verified_at) : text('ยังไม่ยืนยัน', 'Unverified')}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <label className="btn-secondary cursor-pointer text-xs" title={text('อัปโหลดรูปโปรไฟล์', 'Upload profile photo')}>
              <Camera size={15} />
              {avatarWorking === account.id ? text('กำลังบันทึก…', 'Saving…') : text('เปลี่ยนรูป', 'Change photo')}
              <input
                type="file"
                className="sr-only"
                accept="image/jpeg,image/png,image/webp"
                disabled={avatarWorking === account.id}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleAdminUploadAvatar(account, file)
                  e.target.value = ''
                }}
              />
            </label>
            {avatarsDirectory.data?.[account.id] && (
              <button
                type="button"
                className="btn-secondary text-xs text-slate-500 hover:text-red-700"
                disabled={avatarWorking === account.id}
                title={text('ลบรูปโปรไฟล์', 'Remove profile photo')}
                onClick={() => void handleAdminRemoveAvatar(account)}
              >
                <Trash2 size={14} />
                {text('ลบรูป', 'Remove')}
              </button>
            )}
            <button
              type="button"
              className="btn-secondary text-xs"
              title={text('แก้ไขข้อมูลสมาชิก', 'Edit member profile')}
              onClick={() => setEditingMember(account)}
            >
              <Pencil size={14} />
              {text('แก้ไขข้อมูล', 'Edit')}
            </button>
            {!account.email_verified_at && <button type="button" className="btn-secondary text-xs" disabled={Boolean(working)} onClick={() => void resendVerification(account)}>{working === account.id ? <Loader2 size={16} className="animate-spin" /> : <MailCheck size={16} />}ส่งอีเมลยืนยันใหม่</button>}
            {account.status === 'active' ? <button type="button" className="btn-secondary text-xs text-red-700" disabled={Boolean(working) || account.id === user?.id} title={account.id === user?.id ? 'ไม่สามารถระงับบัญชีของตัวเอง' : undefined} onClick={() => void changeStatus(account, 'disabled')}><Ban size={16} />ระงับบัญชี</button> : account.status === 'disabled' ? <button type="button" className="btn-secondary text-xs text-green-700" disabled={Boolean(working)} onClick={() => void changeStatus(account, 'active')}><CheckCircle2 size={16} />เปิดใช้งาน</button> : null}
          </div>
        </article>)}</div>
        <AdminPager count={filtered.length} page={currentPage} busy={profilesQuery.isFetching} onPage={setPage} />
      </>}
    </section>
    <section className="ui-panel card space-y-4 p-4">
      <h2 className="font-bold">ช่วงวันที่รายงานงาน/ประชุมและประวัติ</h2>
      <div className="flex flex-wrap items-end gap-3"><AdminFilter label="ตั้งแต่วันที่"><input type="date" className="field-input" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} /></AdminFilter><AdminFilter label="ถึงวันที่"><input type="date" className="field-input" value={dates.to} onChange={(e) => setDates({ ...dates, to: e.target.value })} /></AdminFilter><button type="button" className="btn-secondary" onClick={() => setDates({ from: '', to: '' })}>ทุกช่วงเวลา</button></div>
      <p className="text-xs text-slate-500">นับตามวันที่สร้าง/บันทึกรายการ เวลาไทย รวมวันสิ้นสุด · ไม่รวมงาน/ประชุมที่ลบ · ประชุมทำซ้ำนับชุดละ 1 รายการ</p>
      {dateError ? <p role="alert" className="text-sm text-amber-800">{dateError}</p> : overviewQuery.isError ? <p role="alert" className="text-sm text-red-700">โหลดภาพรวมไม่สำเร็จ กรุณาลองใหม่</p> : <div className="grid gap-3 sm:grid-cols-3">{[['Meeting ที่สร้าง', overviewQuery.data?.eventCount], ['Task ที่สร้าง', overviewQuery.data?.taskCount], ['แจ้งเตือนที่ต้องตรวจสอบ', overviewQuery.data?.problemCount]].map(([label, value]) => <div key={label} className="rounded-xl bg-purple-50 p-4"><p className="text-2xl font-bold text-brand-700">{overviewQuery.isPending || overviewQuery.isFetching ? '…' : value}</p><p className="text-sm text-slate-600">{label}</p></div>)}</div>}
      <p className="text-xs text-slate-500">แจ้งเตือนที่ต้องตรวจสอบนับสถานะ “ส่งไม่สำเร็จ” และ “รอโควตา” ครบทุกแถวในช่วงวันที่ ไม่จำกัด 20 รายการล่าสุด</p>
    </section>
    <section className="ui-panel card space-y-2 p-4"><h2 className="font-bold">งานระบบล่าสุด · ทุกช่วงเวลา</h2>{latestSystem.isPending ? <p role="status" className="text-sm text-slate-500">กำลังตรวจงานระบบ…</p> : latestSystem.isError ? <p role="alert" className="text-sm text-red-700">ตรวจงานระบบไม่ได้ กรุณาโหลดภาพรวมใหม่</p> : latestSystem.data ? <p className="text-sm text-slate-600">{latestSystem.data.job_name} · <AdminStatus value={latestSystem.data.status} /> · {adminDate(latestSystem.data.created_at)} · ประมวลผล {latestSystem.data.processed_count} รายการ</p> : <p className="text-sm text-slate-500">ยังไม่มีประวัติงานระบบ</p>}</section>
    <AdminHistoryPanel members={members} dates={dates} />
    </>}
    {editingMember && (
      <AdminEditMemberDialog
        account={editingMember}
        onClose={() => setEditingMember(null)}
        onSaved={handleMemberSaved}
      />
    )}
  </main>
}
