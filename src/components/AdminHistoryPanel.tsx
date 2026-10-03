import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Loader2, RefreshCw } from 'lucide-react'
import { collectReportRows, deliveryAdvice, deliveryRecipient, deliveryTitle, downloadCsv, jsonText, reportDateBounds, reportPageSize, safeDiagnosticText,
  type AdminProfile, type ReportDates } from '../lib/adminReports'
import { loadAuditReport, loadDeliveryReport, loadSystemReport } from '../lib/adminReportQueries'
import { AdminFilter, AdminPager, AdminStatus, adminDate, adminDeliveryStatus } from './AdminReportControls'

export function AdminHistoryPanel({ members, dates }: { members: AdminProfile[]; dates: ReportDates }) {
  const [tab, setTab] = useState<'deliveries' | 'audit' | 'system'>('deliveries')
  const [page, setPage] = useState(0)
  const [delivery, setDelivery] = useState({ channel: '', status: '', entity: '', search: '' })
  const [audit, setAudit] = useState({ actor: '', action: '', entity: '' })
  const [system, setSystem] = useState({ status: '', search: '' })
  const [exporting, setExporting] = useState(false)
  const [message, setMessage] = useState('')
  let validDates = true
  try { reportDateBounds(dates) } catch { validDates = false }
  useEffect(() => { setPage(0); setMessage('') }, [dates.from, dates.to])
  const deliveries = useQuery({ queryKey: ['admin-delivery-report', dates, delivery, page],
    queryFn: () => loadDeliveryReport({ ...dates, ...delivery }, page * reportPageSize, reportPageSize), enabled: validDates && tab === 'deliveries' })
  const audits = useQuery({ queryKey: ['admin-audit-report', dates, audit, page],
    queryFn: () => loadAuditReport({ ...dates, ...audit }, page * reportPageSize, reportPageSize), enabled: validDates && tab === 'audit' })
  const systems = useQuery({ queryKey: ['admin-system-report', dates, system, page],
    queryFn: () => loadSystemReport({ ...dates, ...system }, page * reportPageSize, reportPageSize), enabled: validDates && tab === 'system' })
  const report = tab === 'deliveries' ? deliveries : tab === 'audit' ? audits : systems
  useEffect(() => {
    if (report.data) setPage((value) => Math.min(value, Math.max(0, Math.ceil(report.data.count / reportPageSize) - 1)))
  }, [report.data])
  const actorName = (id: string | null) => id ? members.find((member) => member.id === id)?.full_name || `บัญชีเดิม ${id}` : 'ระบบอัตโนมัติ / ไม่ระบุผู้ดำเนินการ'
  const exportReport = async () => {
    setExporting(true); setMessage('')
    const cutoff = new Date().toISOString()
    try {
      if (tab === 'deliveries') {
        const rows = await collectReportRows((offset, limit) => loadDeliveryReport({ ...dates, ...delivery }, offset, limit, cutoff))
        downloadCsv(`notifications-${dates.from || 'all'}-${dates.to || 'all'}.csv`, ['รายการ', 'ชื่องาน/ประชุม', 'รหัสงาน/ประชุม', 'ผู้รับ', 'ประเภทผู้รับ', 'ช่องทาง', 'สถานะ', 'กำหนดส่ง', 'ส่งเมื่อ', 'ลองส่งถัดไป', 'จำนวนครั้ง', 'ข้อผิดพลาด'],
          rows.map((row) => [row.id, deliveryTitle(row), row.task_id || row.event_id, deliveryRecipient(row, members), row.recipient_type, row.channel, adminDeliveryStatus[row.status], adminDate(row.scheduled_at), adminDate(row.sent_at), adminDate(row.next_attempt_at), row.attempt, safeDiagnosticText(row.error_message || '')]))
        setMessage(`ส่งออก ${rows.length} รายการตามตัวกรองแล้ว`)
      } else if (tab === 'audit') {
        const rows = await collectReportRows((offset, limit) => loadAuditReport({ ...dates, ...audit }, offset, limit, cutoff))
        downloadCsv(`audit-${dates.from || 'all'}-${dates.to || 'all'}.csv`, ['รายการ', 'ผู้ดำเนินการ', 'การดำเนินการ', 'ประเภทข้อมูล', 'รหัสข้อมูล', 'เวลา'], rows.map((row) => [row.id, actorName(row.actor_user_id), row.action, row.entity_type, row.entity_id, adminDate(row.created_at)]))
        setMessage(`ส่งออก ${rows.length} รายการตามตัวกรองแล้ว`)
      } else {
        const rows = await collectReportRows((offset, limit) => loadSystemReport({ ...dates, ...system }, offset, limit, cutoff))
        downloadCsv(`system-${dates.from || 'all'}-${dates.to || 'all'}.csv`, ['รายการ', 'ชื่องานระบบ', 'สถานะ', 'ประมวลผล', 'เวลา', 'ข้อผิดพลาด'], rows.map((row) => [row.id, row.job_name, row.status, row.processed_count, adminDate(row.created_at), safeDiagnosticText(jsonText(row.details, 'error') || jsonText(row.details, 'message'))]))
        setMessage(`ส่งออก ${rows.length} รายการตามตัวกรองแล้ว`)
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'ส่งออกไม่ได้ กรุณาลองใหม่') }
    finally { setExporting(false) }
  }
  return <section className="card overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
      <div className="flex flex-wrap gap-2" aria-label="เลือกประวัติที่ตรวจสอบ">{([['deliveries', 'การส่งแจ้งเตือน'], ['audit', 'ประวัติการดำเนินการ'], ['system', 'งานระบบ']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={tab === value} className={tab === value ? 'btn-primary' : 'btn-secondary'} onClick={() => { setTab(value); setPage(0); setMessage('') }}>{label}</button>)}</div>
      <div className="flex gap-2"><button type="button" className="btn-secondary" disabled={!validDates || report.isFetching} onClick={() => void report.refetch()}><RefreshCw size={16} />โหลดใหม่</button><button type="button" className="btn-secondary" disabled={exporting || !validDates || report.isPending || report.isError || !report.data?.count} onClick={() => void exportReport()}>{exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}CSV ตามตัวกรอง</button></div>
    </div>
    <div className="space-y-3 border-b border-slate-100 p-4">
      <p className="text-xs text-slate-500">กรองตามวันที่บันทึกรายการ เวลาไทย · ยอดรวมและ CSV นับครบทุกหน้า · ประวัติแสดงเฉพาะสิ่งที่ระบบบันทึกไว้</p>
      {tab === 'deliveries' ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AdminFilter label="ช่องทาง"><select className="field-input" value={delivery.channel} onChange={(e) => { setDelivery({ ...delivery, channel: e.target.value }); setPage(0) }}><option value="">ทุกช่องทาง</option><option value="email">Gmail / Email</option><option value="push">แจ้งเตือนมือถือ</option><option value="line">LINE (ข้อมูลเดิม)</option></select></AdminFilter>
        <AdminFilter label="สถานะแจ้งเตือน"><select className="field-input" value={delivery.status} onChange={(e) => { setDelivery({ ...delivery, status: e.target.value }); setPage(0) }}><option value="">ทุกสถานะ</option>{Object.entries(adminDeliveryStatus).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></AdminFilter>
        <AdminFilter label="ประเภท"><select className="field-input" value={delivery.entity} onChange={(e) => { setDelivery({ ...delivery, entity: e.target.value }); setPage(0) }}><option value="">งานและประชุมทั้งหมด</option><option value="task">Task</option><option value="meeting">Meeting</option></select></AdminFilter>
        <AdminFilter label="ชื่องาน/ประชุม หรือรหัสรายการ"><input className="field-input" value={delivery.search} onChange={(e) => { setDelivery({ ...delivery, search: e.target.value }); setPage(0) }} placeholder="ชื่อที่บันทึกในข้อความ / UUID" /></AdminFilter>
      </div> : tab === 'audit' ? <div className="grid gap-3 sm:grid-cols-3">
        <AdminFilter label="ผู้ดำเนินการ"><select className="field-input" value={audit.actor} onChange={(e) => { setAudit({ ...audit, actor: e.target.value }); setPage(0) }}><option value="">ทุกคนและระบบอัตโนมัติ</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name} · {member.employee_id}</option>)}</select></AdminFilter>
        <AdminFilter label="ค้นหาการดำเนินการ"><input className="field-input" value={audit.action} onChange={(e) => { setAudit({ ...audit, action: e.target.value }); setPage(0) }} placeholder="เช่น CREATED / UPDATED" /></AdminFilter>
        <AdminFilter label="ประเภทข้อมูล"><select className="field-input" value={audit.entity} onChange={(e) => { setAudit({ ...audit, entity: e.target.value }); setPage(0) }}><option value="">ทุกประเภท</option><option value="task">Task</option><option value="event">Meeting</option><option value="event_occurrence">นัดในประชุมทำซ้ำ</option><option value="profile">สมาชิก</option><option value="notification_delivery">การแจ้งเตือน</option></select></AdminFilter>
      </div> : <div className="grid gap-3 sm:grid-cols-2"><AdminFilter label="สถานะงานระบบ"><select className="field-input" value={system.status} onChange={(e) => { setSystem({ ...system, status: e.target.value }); setPage(0) }}><option value="">ทุกสถานะ</option><option value="started">started</option><option value="completed">completed</option><option value="failed">failed</option></select></AdminFilter><AdminFilter label="ค้นหาชื่องานระบบ"><input className="field-input" value={system.search} onChange={(e) => { setSystem({ ...system, search: e.target.value }); setPage(0) }} /></AdminFilter></div>}
      {message && <p role="status" className="text-sm text-brand-700">{message}</p>}
    </div>
    {!validDates ? <p role="alert" className="p-5 text-amber-800">กรุณาแก้ช่วงวันที่ด้านบน</p> : report.isPending ? <p role="status" className="p-5 text-slate-500">กำลังโหลดประวัติ…</p> : report.isError ? <p role="alert" className="p-5 text-red-700">โหลดประวัติไม่ได้ กรุณาลองใหม่และตรวจสิทธิ์ Admin</p> : <>
      <div className="divide-y divide-slate-100">
        {tab === 'deliveries' && deliveries.data?.rows.map((row) => <details key={row.id} className="p-4">
          <summary className="cursor-pointer space-y-2"><span className="font-semibold">{deliveryTitle(row)}</span><span className="ml-2"><AdminStatus value={row.status} label={adminDeliveryStatus[row.status]} /></span><span className="block break-words text-sm text-slate-600">{deliveryRecipient(row, members)} · {row.channel === 'email' ? 'Gmail / Email' : row.channel === 'push' ? 'แจ้งเตือนมือถือ' : 'LINE'}</span><span className="block text-xs text-slate-400">บันทึก {adminDate(row.created_at)} · กดดูรายละเอียดและวิธีแก้</span></summary>
          <dl className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">{[['รหัสงาน/ประชุม', row.task_id || row.event_id || 'ข้อความทดสอบ'], ['ประเภทข้อความ', row.template_key], ['ประเภทผู้รับ', row.recipient_type], ['กำหนดส่ง', adminDate(row.scheduled_at)], ['ส่งเมื่อ', adminDate(row.sent_at)], ['ลองส่งครั้งถัดไป', adminDate(row.next_attempt_at)], ['จำนวนครั้งที่ส่ง', row.attempt], ['รหัสข้อผิดพลาด', row.error_code || '—']].map(([label, value]) => <div key={label}><dt className="font-semibold text-slate-500">{label}</dt><dd className="mt-1 break-all">{value}</dd></div>)}</dl>
          {row.error_message && <p className="mt-3 break-words text-sm text-red-700">{safeDiagnosticText(row.error_message)}</p>}
          <p className="mt-3 rounded-xl bg-purple-50 p-3 text-sm text-brand-800"><strong>แนวทางตรวจ/แก้: </strong>{deliveryAdvice(row)}</p>
        </details>)}
        {tab === 'audit' && audits.data?.rows.map((row) => <article key={row.id} className="space-y-1 p-4 text-sm"><p className="font-semibold">{row.action}</p><p>{actorName(row.actor_user_id)}</p><p className="break-all text-slate-500">{row.entity_type} · {row.entity_id || '—'}</p><time className="text-xs text-slate-400">{adminDate(row.created_at)}</time></article>)}
        {tab === 'system' && systems.data?.rows.map((row) => <article key={row.id} className="space-y-2 p-4 text-sm"><p className="font-semibold">{row.job_name} <AdminStatus value={row.status} /></p><p className="text-slate-600">ประมวลผล {row.processed_count} รายการ · {adminDate(row.created_at)}</p>{(jsonText(row.details, 'error') || jsonText(row.details, 'message')) && <p className="break-words text-red-700">{safeDiagnosticText(jsonText(row.details, 'error') || jsonText(row.details, 'message'))}</p>}{row.status === 'failed' && <p className="rounded-xl bg-amber-50 p-3 text-amber-900">ให้ผู้ดูแลด้านเทคนิคตรวจข้อผิดพลาดและการตั้งค่างานนี้ แล้วตรวจรอบทำงานถัดไปจากปุ่มโหลดใหม่</p>}</article>)}
      </div>
      <AdminPager count={report.data?.count || 0} page={page} busy={report.isFetching} onPage={setPage} />
    </>}
  </section>
}
