import { Download, ExternalLink, FileText, Loader2, RefreshCw } from 'lucide-react'
import type { DeviceAlert, DeviceInboxDocument } from '../lib/deviceInbox'
import { deviceDocumentRoute } from '../lib/deviceDocument'

function dateLabel(value?: string, allDay = false) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium', ...(allDay ? {} : { timeStyle: 'short' as const }), timeZone: 'Asia/Bangkok',
  }).format(date)
}

export function DeviceNotificationDetails({ alert, details = alert.details, documents = [], fetching = false,
  error, onlineDetails = false, canLoad = false, onRefresh }: {
  alert: DeviceAlert; details?: DeviceAlert['details']; documents?: DeviceInboxDocument[];
  fetching?: boolean; error?: string; onlineDetails?: boolean; canLoad?: boolean; onRefresh?: () => void;
}) {
  const rows = [
    [details?.entity === 'task' ? 'ชื่องาน' : 'ชื่อการประชุม', details?.title],
    ['หน่วยงาน / สังกัด', details?.affiliation || (onlineDetails ? 'ไม่ระบุ' : '')],
    ['เริ่มประชุม', dateLabel(details?.start_datetime, details?.all_day)],
    ['สิ้นสุดประชุม', dateLabel(details?.end_datetime, details?.all_day)],
    ['ครบกำหนดงาน', details?.due_date ? dateLabel(`${details.due_date}T${details.due_time || '09:00:00'}+07:00`) : ''],
    ['สถานที่', details?.location],
  ].filter(([, value]) => value)

  return <>
    <h2 className="break-words text-xl font-bold text-slate-900">{details?.title || alert.title}</h2>
    <p className="text-xs text-slate-500">{alert.title} · รับเมื่อ {dateLabel(alert.receivedAt)}</p>
    {rows.length > 0 && <dl className="space-y-3 rounded-xl bg-purple-50 p-4 text-sm">{rows.map(([label, value]) => <div key={label}><dt className="font-semibold text-brand-700">{label}</dt><dd className="mt-1 break-words text-slate-800">{value}</dd></div>)}</dl>}
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-brand-700">{details?.entity === 'task' ? 'รายละเอียด / คำสั่งงาน' : 'รายละเอียด / วาระการประชุม'}</h3>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{details?.description || alert.body}</p>
    </div>
    {canLoad && <section className="space-y-3 rounded-xl border border-purple-100 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold text-slate-800"><FileText size={18} className="text-brand-700" />เอกสารแนบ</h3>
        <button type="button" onClick={onRefresh} disabled={fetching} aria-label="โหลดรายละเอียดและเอกสารใหม่" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-brand-700 disabled:opacity-50"><RefreshCw size={17} className={fetching ? 'animate-spin' : ''} /></button>
      </div>
      {fetching && <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />กำลังโหลดรายละเอียดและเอกสาร…</p>}
      {error && <p role="alert" className="text-sm text-amber-800">{error} ข้อความที่เคยรับยังอ่านได้ กรุณาตรวจอินเทอร์เน็ตแล้วโหลดใหม่</p>}
      {onlineDetails && !error && !documents.length && <p className="text-sm text-slate-500">ไม่มีเอกสารแนบ</p>}
      {!error && documents.map((file) => <div key={file.id} className="space-y-2 rounded-xl bg-slate-50 p-3">
        <p className="break-words text-sm font-semibold text-slate-800">{file.name}</p>
        {typeof file.size === 'number' && file.size > 0 && <p className="text-xs text-slate-500">{file.size < 1024 * 1024 ? `${Math.ceil(file.size / 1024)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}</p>}
        <div className="flex flex-wrap gap-2">
          {file.previewUrl && <a href={file.kind === 'file' ? `#${deviceDocumentRoute(alert.id, file.id)}` : file.previewUrl} target={file.kind === 'drive' ? '_blank' : undefined} rel="noopener noreferrer" className="btn-secondary text-sm"><ExternalLink size={16} />เปิดดูเอกสาร</a>}
          {file.downloadUrl && <a href={`#${deviceDocumentRoute(alert.id, file.id, true)}`} className="btn-secondary text-sm"><Download size={16} />ดาวน์โหลด</a>}
        </div>
        {file.kind === 'drive' && file.previewUrl && <p className="text-xs text-slate-500">ดูและดาวน์โหลดจาก Google Drive ตามสิทธิ์ที่ผู้สร้างแชร์ไว้</p>}
        {file.error && <p className="text-xs text-amber-800">{file.error}</p>}
      </div>)}
      {documents.length > 0 && !error && <p className="text-xs text-slate-500">ปุ่มเอกสารโหลดลิงก์ใหม่ทุกครั้งที่กด ต้องเชื่อมต่ออินเทอร์เน็ต ไฟล์ PDF/รูปภาพเปิดดูได้ในเบราว์เซอร์ ส่วนไฟล์ Office เปิดด้วยแอปที่รองรับหรือดาวน์โหลด</p>}
    </section>}
    {!canLoad && details?.entity && <p className="text-xs text-amber-800">เชื่อมต่อมือถือและเปิดอินเทอร์เน็ตเพื่อโหลดรายละเอียดล่าสุดและเอกสารแนบ</p>}
    <p className="text-xs text-slate-500">{onlineDetails ? 'รายละเอียดล่าสุดจากระบบ เอกสารเปิดได้ตามสิทธิ์ของผู้รับข้อความ' : 'ข้อมูลที่บันทึกไว้ในข้อความ หากต้องการดูข้อมูลล่าสุดหรือเอกสาร ให้เชื่อมต่ออินเทอร์เน็ต'}</p>
  </>
}
