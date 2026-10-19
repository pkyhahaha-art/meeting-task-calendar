import { Fragment, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, Loader2, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { useConfirm } from './ConfirmDialogProvider'
import { AdminTrashAllDialog } from './AdminTrashAllDialog'
import { AdminFilter, AdminPager, AdminStatus, adminDate } from './AdminReportControls'
import { reportDateBounds, reportPageSize, type AdminProfile } from '../lib/adminReports'
import { adminItemKey, cancelAdminMeetingOccurrence, loadAdminCalendarItems, loadAdminMeetingOccurrences, trashAdminCalendarItems,
  type AdminCalendarFilters, type AdminCalendarItem } from '../lib/adminCalendarItems'
import adminMascot from '../../ภาพประกอบUI/02_Hand I-Pad.jpg'

const initialFilters: AdminCalendarFilters = { entity: '', creator: '', search: '', from: '', to: '' }
const statusLabel: Record<string, string> = { pending: 'ยังไม่เสร็จ', completed: 'เสร็จแล้ว', cancelled: 'ยกเลิกแล้ว', scheduled: 'ตามกำหนด' }
const isMeetingSeries = (item: AdminCalendarItem) => item.entity === 'meeting' && item.recurring
const isLegacyTaskSeries = (item: AdminCalendarItem) => item.entity === 'task' && item.recurring

export function AdminCalendarItemsPanel({ adminUserId, members }: { adminUserId: string; members: AdminProfile[] }) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState(initialFilters)
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [series, setSeries] = useState<AdminCalendarItem | null>(null)
  const [occurrenceId, setOccurrenceId] = useState('')
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  const [trashAllAdminId, setTrashAllAdminId] = useState<string | null>(null)
  const trashAllOpen = trashAllAdminId === adminUserId
  const trashAllTrigger = useRef<HTMLButtonElement | null>(null)
  const saving = useRef(false)
  let dateError = ''
  try { reportDateBounds(filters) } catch (error) { dateError = error instanceof Error ? error.message : 'ช่วงวันที่ไม่ถูกต้อง' }
  const items = useQuery({ queryKey: ['admin-calendar-items', adminUserId, filters, page], enabled: !dateError,
    queryFn: () => loadAdminCalendarItems(filters, page) })
  const occurrences = useQuery({ queryKey: ['admin-meeting-occurrences', adminUserId, series?.id], enabled: Boolean(series),
    queryFn: () => loadAdminMeetingOccurrences(series!.id) })
  const rows = items.data?.rows || []
  const picked = rows.filter(item => selected.includes(adminItemKey(item)))
  const selectedOccurrence = occurrences.data?.find(item => item.id === occurrenceId)
  const futureOccurrence = Boolean(selectedOccurrence && new Date(selectedOccurrence.start_datetime).getTime() > Date.now())
  const blocked = working || items.isFetching || trashAllOpen
  const validReason = Boolean(reason.trim()) && reason.trim().length <= 500
  useEffect(() => { setSelected([]); setSeries(null); setOccurrenceId('') }, [adminUserId, filters, page])
  useEffect(() => { setTrashAllAdminId(null) }, [adminUserId])
  useEffect(() => {
    if (!trashAllOpen && trashAllTrigger.current && !working) {
      trashAllTrigger.current.focus()
      trashAllTrigger.current = null
    }
  }, [trashAllOpen, working])
  useEffect(() => {
    setSelected([])
    if (items.data) setPage(value => Math.min(value, Math.max(0, Math.ceil(items.data.count / reportPageSize) - 1)))
  }, [items.data])
  const updateFilters = (next: Partial<AdminCalendarFilters>) => { setFilters({ ...filters, ...next }); setPage(0); setMessage(null) }
  const invalidate = async (throwOnError = false) => {
    await Promise.all(['admin-calendar-items', 'admin-meeting-occurrences', 'admin-overview', 'admin-audit-report',
      'admin-delivery-report', 'events', 'tasks', 'event-details', 'task-details', 'meeting-exceptions',
      'event-creation-stats', 'recent-documents'].map(key => queryClient.invalidateQueries({ queryKey: [key] }, { throwOnError })))
  }
  const trash = async (targets: AdminCalendarItem[]) => {
    if (saving.current || !targets.length || !validReason) return
    saving.current = true; setWorking(true); setMessage(null)
    try {
      const names = targets.slice(0, 3).map(item => `“${item.title.slice(0, 100)}”`).join(' · ')
      const more = targets.length > 3 ? ` และอีก ${targets.length - 3} รายการ` : ''
      const seriesNotice = targets.some(isMeetingSeries) ? ' ประชุมทำซ้ำที่เลือกจะลบทั้งชุด' : ''
      const taskSeriesNotice = targets.some(isLegacyTaskSeries) ? ' งานทำซ้ำเดิมที่เลือกจะรวมงานถัดไปที่ยังไม่เสร็จในชุดด้วย' : ''
      if (!await confirm({ title: `ย้าย ${targets.length} รายการเข้าถังขยะ?`, tone: 'danger', confirmLabel: 'ย้ายเข้าถังขยะ',
        message: `${names}${more} จะนำออกจากปฏิทินและหยุดการเตือน${seriesNotice}${taskSeriesNotice}` })) return
      const count = await trashAdminCalendarItems(targets, reason)
      setSelected([]); setSeries(null); setOccurrenceId(''); setReason('')
      setMessage({ error: false, text: `ย้าย ${count} รายการเข้าถังขยะแล้ว` })
      await invalidate()
    } catch (error) { setMessage({ error: true, text: `ลบรายการไม่ได้: ${error instanceof Error ? error.message : 'กรุณาลองใหม่'}` }) }
    finally { saving.current = false; setWorking(false) }
  }
  const cancelOccurrence = async () => {
    if (saving.current || !series || !selectedOccurrence || !futureOccurrence || !validReason) return
    saving.current = true; setWorking(true); setMessage(null)
    try {
      if (!await confirm({ title: 'ลบเฉพาะนัดนี้?', tone: 'danger', confirmLabel: 'ลบเฉพาะนัดนี้',
        message: `“${series.title}” วันที่ ${adminDate(selectedOccurrence.start_datetime)} วันอื่นในชุดยังคงอยู่` })) return
      await cancelAdminMeetingOccurrence(series.id, selectedOccurrence.occurrence_key, reason)
      setOccurrenceId(''); setReason(''); setMessage({ error: false, text: 'ลบเฉพาะนัดที่เลือกแล้ว วันอื่นในชุดยังคงอยู่' })
      await invalidate()
    } catch (error) { setMessage({ error: true, text: `ลบนัดไม่ได้: ${error instanceof Error ? error.message : 'กรุณาลองใหม่'}` }) }
    finally { saving.current = false; setWorking(false) }
  }
  const allTrashed = async ({ taskCount, meetingCount, totalCount }: { taskCount: number; meetingCount: number; totalCount: number }) => {
    setTrashAllAdminId(null); setSelected([]); setSeries(null); setOccurrenceId(''); setReason(''); setPage(0)
    const result = `ย้าย Task ${taskCount.toLocaleString('th-TH')} และ Meeting ${meetingCount.toLocaleString('th-TH')} รวม ${totalCount.toLocaleString('th-TH')} รายการเข้าถังขยะแล้ว`
    setMessage({ error: false, text: result })
    saving.current = true; setWorking(true)
    try { await invalidate(true) }
    catch { setMessage({ error: true, text: `${result} แต่โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณากดโหลดรายการใหม่` }) }
    finally { saving.current = false; setWorking(false) }
  }
  return <><section className="card overflow-hidden border-purple-100" aria-labelledby="admin-items-title" aria-hidden={trashAllOpen || undefined}>
    <div className="flex items-center justify-between gap-4 border-b border-purple-100 bg-gradient-to-br from-purple-50 via-white to-amber-50 p-4 sm:p-6">
      <div className="min-w-0 space-y-3">
        <span className="inline-flex rounded-full border border-purple-100 bg-white px-3 py-1 text-xs font-bold tracking-wide text-brand-700">PEA · ADMIN</span>
        <div><h2 id="admin-items-title" className="flex items-center gap-2 text-xl font-bold text-brand-800 sm:text-2xl"><CalendarDays size={22} className="shrink-0 text-brand-600" />จัดการงานและประชุม</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">ค้นหา ตรวจสอบ และจัดการรายการของสมาชิก</p></div>
        <button type="button" className="btn-secondary bg-white" disabled={blocked || Boolean(dateError)} onClick={() => void items.refetch()}><RefreshCw size={16} />โหลดรายการใหม่</button>
      </div>
      <div className="shrink-0 rounded-2xl border border-amber-200/70 bg-white p-1 shadow-sm sm:p-2"><img src={adminMascot} alt="" aria-hidden="true" width={1500} height={1500} className="h-20 w-20 rounded-xl object-contain sm:h-28 sm:w-28" /></div>
    </div>
    <div className="space-y-4 border-b border-slate-100 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <AdminFilter label="ชื่องาน/ประชุม หรือรหัสรายการ"><input className="field-input" maxLength={200} disabled={working} value={filters.search} onChange={e => updateFilters({ search: e.target.value })} /></AdminFilter>
        <AdminFilter label="ประเภท"><select className="field-input" disabled={working} value={filters.entity} onChange={e => updateFilters({ entity: e.target.value })}><option value="">งานและประชุมทั้งหมด</option><option value="task">Task</option><option value="meeting">Meeting</option></select></AdminFilter>
        <AdminFilter label="ผู้สร้าง"><select className="field-input" disabled={working} value={filters.creator} onChange={e => updateFilters({ creator: e.target.value })}><option value="">ทุกคน</option>{members.map(member => <option key={member.id} value={member.id}>{member.full_name} · {member.employee_id}</option>)}</select></AdminFilter>
        <AdminFilter label="สร้างตั้งแต่วันที่"><input type="date" className="field-input" disabled={working} value={filters.from} onChange={e => updateFilters({ from: e.target.value })} /></AdminFilter>
        <AdminFilter label="สร้างถึงวันที่"><input type="date" className="field-input" disabled={working} value={filters.to} onChange={e => updateFilters({ to: e.target.value })} /></AdminFilter>
        <button type="button" className="btn-secondary self-end justify-self-start" disabled={working} onClick={() => { setFilters(initialFilters); setPage(0); setMessage(null) }}>ล้างตัวกรอง</button>
      </div>
      <p className="text-xs text-slate-500">กรองตามวันที่สร้าง เวลาไทย · ประชุมทำซ้ำแสดงชุดละ 1 รายการ · งานทำซ้ำเดิมจะรวมงานถัดไปที่ยังไม่เสร็จเมื่อย้ายเข้าถังขยะ · เก็บประวัติการส่งแจ้งเตือนเดิมไว้</p>
      <div className="rounded-2xl border border-amber-100 bg-amber-50/50 p-3 sm:p-4"><label className="field-label" htmlFor="admin-trash-reason">เหตุผลที่ Admin ลบรายการ</label><textarea id="admin-trash-reason" className="field-input bg-white" rows={2} maxLength={500} disabled={working} value={reason} onChange={e => setReason(e.target.value)} placeholder="เช่น ผู้สร้างไม่สามารถลบรายการซ้ำได้" /><p className="mt-1 text-xs text-slate-500">กรอกเหตุผลก่อนลบ ระบบจะบันทึกผู้ดำเนินการและรายการที่ลบ</p></div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-purple-50/70 px-3 py-2">
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" disabled={blocked || items.isError || !rows.length} checked={Boolean(rows.length) && picked.length === rows.length} onChange={e => setSelected(e.target.checked ? rows.map(adminItemKey) : [])} />เลือกทั้งหมดในหน้านี้ ({rows.length})</label>
        <button type="button" className="btn-secondary text-red-700" disabled={blocked || items.isError || !picked.length || !validReason} onClick={() => void trash(picked)}>{working ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}ย้ายที่เลือกเข้าถังขยะ ({picked.length})</button>
      </div>
      {message && <p role={message.error ? 'alert' : 'status'} className={`rounded-xl p-3 text-sm ${message.error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>{message.text}</p>}
    </div>
    {dateError ? <p role="alert" className="p-5 text-amber-800">{dateError}</p> : items.isPending ? <p role="status" className="p-5 text-slate-500">กำลังโหลดงานและประชุม…</p> : items.isError ? <p role="alert" className="p-5 text-red-700">โหลดรายการไม่ได้ กรุณาโหลดใหม่และตรวจสิทธิ์ Admin</p> : <>
      {!rows.length ? <div className="p-8 text-center"><CalendarDays size={32} className="mx-auto mb-3 text-purple-300" /><p className="font-semibold text-slate-700">ไม่พบงานหรือประชุมตามตัวกรอง</p><p className="mt-1 text-sm text-slate-500">ลองเปลี่ยนคำค้นหรือช่วงวันที่สร้าง</p></div> : <div className="max-w-full overflow-x-auto">
        <table className="block w-full text-left text-sm xl:table xl:table-fixed" aria-label="รายการงานและประชุมสำหรับ Admin">
          <thead className="hidden border-b border-purple-200 bg-purple-50 text-xs font-bold text-brand-800 xl:table-header-group"><tr>
            <th scope="col" className="w-[5%] px-2 py-4"><span className="sr-only">เลือก</span></th><th scope="col" className="w-[24%] px-3 py-4">รายการ / ประเภท</th><th scope="col" className="w-[18%] px-3 py-4">ผู้สร้าง</th><th scope="col" className="w-[12%] px-3 py-4">หน่วยงาน</th><th scope="col" className="w-[16%] px-3 py-4">วันประชุม / ครบกำหนด</th><th scope="col" className="w-[10%] px-3 py-4">สถานะ</th><th scope="col" className="w-[15%] px-3 py-4">จัดการ</th>
          </tr></thead>
          <tbody className="block xl:table-row-group">{rows.map(item => <Fragment key={adminItemKey(item)}>
            <tr className={`grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2 gap-y-3 border-b border-purple-100 p-4 transition-colors xl:table-row xl:p-0 ${selected.includes(adminItemKey(item)) ? 'bg-purple-50/80' : 'bg-white hover:bg-purple-50/30'}`}>
              <td className="row-start-1 align-top xl:px-2 xl:py-4"><label className="flex min-h-11 min-w-11 items-center justify-center"><input type="checkbox" className="h-5 w-5 accent-purple-700" aria-label={`เลือก ${item.title}`} disabled={blocked} checked={selected.includes(adminItemKey(item))} onChange={e => setSelected(current => e.target.checked ? [...current, adminItemKey(item)] : current.filter(key => key !== adminItemKey(item)))} /></label></td>
              <td className="min-w-0 row-start-1 align-top xl:px-3 xl:py-4">
                <h3 className="break-words font-bold leading-relaxed text-slate-900">{item.title}</h3>
                <div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-purple-100/70 px-2 py-1 text-xs font-semibold text-brand-700">{item.entity === 'task' ? isLegacyTaskSeries(item) ? 'Task ทำซ้ำเดิม' : 'Task' : isMeetingSeries(item) ? 'Meeting ทำซ้ำ' : 'Meeting'}</span><span className="xl:hidden"><AdminStatus value={item.status} label={statusLabel[item.status] || item.status} /></span></div>
                <details className="mt-2 min-w-0"><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-brand-700 underline decoration-purple-200 underline-offset-4">ดูรายละเอียดรายการ</summary>
                  <dl className="space-y-3 rounded-xl border border-purple-100 bg-white p-3 text-xs">{[['หน่วยงาน / สังกัด', item.affiliation || '—'], ['สร้างเมื่อ', adminDate(item.created_at)],
                    ...(item.entity === 'meeting' ? [['เริ่มประชุม', adminDate(item.start_datetime)], ['สิ้นสุด', adminDate(item.end_datetime)]] : [['ครบกำหนด', item.due_date ? adminDate(`${item.due_date}T${item.due_time || '00:00:00'}+07:00`) : '—']]), ['รหัสรายการ', item.id]].map(([label, value]) => <div key={label}><dt className="font-semibold text-slate-500">{label}</dt><dd className="mt-1 break-words [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
                </details>
              </td>
              <td className="col-span-2 grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-2 align-top xl:table-cell xl:px-3 xl:py-4"><span className="text-xs font-semibold text-slate-500 xl:hidden">ผู้สร้าง</span><div className="min-w-0"><p className="break-words font-medium text-slate-800">{item.creator_name || 'ไม่ระบุชื่อ'}</p><p className="mt-1 text-xs text-slate-500 [overflow-wrap:anywhere]">{item.creator_email}</p></div></td>
              <td className="col-span-2 grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-2 align-top xl:table-cell xl:px-3 xl:py-4"><span className="text-xs font-semibold text-slate-500 xl:hidden">หน่วยงาน</span><span className="break-words text-slate-600">{item.affiliation || '—'}</span></td>
              <td className="col-span-2 grid min-w-0 grid-cols-[6rem_minmax(0,1fr)] gap-2 align-top xl:table-cell xl:px-3 xl:py-4"><span className="text-xs font-semibold text-slate-500 xl:hidden">{item.entity === 'meeting' ? 'วันประชุม' : 'ครบกำหนด'}</span><div className="min-w-0 break-words text-xs leading-relaxed text-slate-600">{item.entity === 'meeting' ? <><p>{adminDate(item.start_datetime)}</p><p className="mt-1 text-slate-400">ถึง {adminDate(item.end_datetime)}</p></> : <p>{item.due_date ? adminDate(`${item.due_date}T${item.due_time || '00:00:00'}+07:00`) : '—'}</p>}</div></td>
              <td className="hidden align-top px-3 py-4 xl:table-cell"><AdminStatus value={item.status} label={statusLabel[item.status] || item.status} /></td>
              <td className="col-span-2 min-w-0 align-top xl:px-3 xl:py-4"><div className="flex flex-wrap gap-2 xl:flex-col xl:items-stretch">{isMeetingSeries(item) && item.status === 'scheduled' && <button type="button" className="btn-secondary min-h-11 text-xs" disabled={blocked} onClick={() => { setSeries(item); setOccurrenceId(''); setMessage(null) }}><CalendarDays size={16} className="shrink-0" />เลือกวันเพื่อลบเฉพาะนัด</button>}
                {(item.entity === 'task' || item.status === 'scheduled') && <a href={`#/calendar?${item.entity === 'task' ? 'task' : 'event'}=${encodeURIComponent(item.id)}`} className={`btn-secondary min-h-11 text-xs ${blocked ? 'pointer-events-none opacity-50' : ''}`} aria-disabled={blocked} tabIndex={blocked ? -1 : undefined} onClick={event => { if (blocked) event.preventDefault() }}><Pencil size={16} className="shrink-0" />เปิดแก้ไข</a>}
                <button type="button" className="btn-secondary min-h-11 text-xs text-red-700" disabled={blocked || !validReason} onClick={() => void trash([item])}><Trash2 size={16} className="shrink-0" />{isMeetingSeries(item) ? 'ลบทั้งชุด' : isLegacyTaskSeries(item) ? 'ลบงานนี้และงานถัดไปในชุดเดิม' : 'ย้ายรายการนี้เข้าถังขยะ'}</button>
              </div></td>
            </tr>
            {series?.id === item.id && item.entity === 'meeting' && <tr className="block border-b border-purple-100 bg-purple-50/40 xl:table-row"><td colSpan={7} className="block p-4 xl:table-cell"><div className="space-y-3 rounded-xl border border-brand-200 bg-white p-4">
          <AdminFilter label="วันนัดที่ต้องการลบ (เฉพาะนัดที่ยังไม่เริ่ม)"><select className="field-input" disabled={working || occurrences.isFetching || occurrences.isError} value={occurrenceId} onChange={e => setOccurrenceId(e.target.value)}><option value="">เลือกวันนัด</option>{occurrences.data?.map(occurrence => <option key={occurrence.id} value={occurrence.id} disabled={new Date(occurrence.start_datetime).getTime() <= Date.now()}>{adminDate(occurrence.start_datetime)}{new Date(occurrence.start_datetime).getTime() <= Date.now() ? ' · ผ่านแล้ว' : ''}</option>)}</select></AdminFilter>
          {occurrences.isPending ? <p role="status" className="text-sm text-slate-500">กำลังโหลดวันนัด…</p> : occurrences.isError ? <p role="alert" className="text-sm text-red-700">โหลดวันนัดไม่ได้ <button type="button" className="font-semibold underline" disabled={working} onClick={() => void occurrences.refetch()}>ลองใหม่</button></p> : !occurrences.data?.length && <p className="text-sm text-slate-500">ไม่มีนัดที่ยังไม่ยกเลิก</p>}
          <p className="text-xs text-slate-600">ลบเฉพาะวันที่เลือก วันอื่นในชุดยังคงอยู่ นัดที่ผ่านแล้วใช้การลบทั้งชุดเมื่อจำเป็น</p>
          <button type="button" className="btn-secondary text-red-700" disabled={working || occurrences.isFetching || occurrences.isError || !futureOccurrence || !validReason} onClick={() => void cancelOccurrence()}><Trash2 size={16} />ลบเฉพาะนัดนี้</button>
            </div></td></tr>}
          </Fragment>)}</tbody>
        </table>
      </div>}
      <AdminPager count={items.data?.count || 0} page={page} busy={blocked} onPage={setPage} />
    </>}
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-rose-200 bg-rose-50/50 p-4 sm:p-5">
      <div className="min-w-0"><h3 className="font-bold text-red-900">จัดการรายการทั้งระบบ</h3><p className="mt-1 text-xs leading-relaxed text-slate-600">สำหรับ Task และ Meeting ของสมาชิกทุกคน รวมทุกหน้า โดยไม่สนตัวกรอง ต้องตรวจจำนวนและยืนยันก่อนลบ</p></div>
      <button type="button" className="btn-secondary border-red-200 text-red-700" disabled={working || trashAllOpen} onClick={event => { trashAllTrigger.current = event.currentTarget; setTrashAllAdminId(adminUserId) }}><Trash2 size={17} className="shrink-0" />ลบ Task และ Meeting ทั้งระบบ</button>
    </div>
  </section>
    {trashAllOpen && <AdminTrashAllDialog key={adminUserId} onClose={() => setTrashAllAdminId(null)} onDeleted={allTrashed} />}
  </>
}
