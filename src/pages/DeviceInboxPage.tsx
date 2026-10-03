import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { BellRing, CheckCircle2, ChevronLeft, Loader2, RefreshCw, Smartphone } from 'lucide-react'
import peaLogo from '../../ภาพประกอบUI/PEA Logo (1).png'
import { listDeviceAlerts, markDeviceAlertRead, type DevicePairing } from '../lib/deviceInbox'
import { restoreDevicePairing } from '../lib/mobilePush'

function dateLabel(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
  }).format(date)
}

export function DeviceInboxPage() {
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('notification')
  const [device, setDevice] = useState<DevicePairing | null>(null)
  const [checking, setChecking] = useState(true)
  const [connectionError, setConnectionError] = useState('')
  const alerts = useQuery({ queryKey: ['device-inbox'], queryFn: listDeviceAlerts })
  const refreshAlerts = alerts.refetch
  const selected = alerts.data?.find((alert) => alert.id === selectedId)

  useEffect(() => {
    let cancelled = false
    restoreDevicePairing().then((result) => { if (!cancelled) setDevice(result) })
      .catch(() => { if (!cancelled) setConnectionError('ตรวจการเชื่อมต่อไม่ได้ ข้อความที่เคยรับยังเปิดอ่านได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่') })
      .finally(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const refresh = () => { void refreshAlerts() }
    const onMessage = (event: MessageEvent) => { if (event.data?.type === 'PEA_INBOX_UPDATED') refresh() }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onMessage)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [refreshAlerts])

  useEffect(() => {
    if (selected && !selected.read) void markDeviceAlertRead(selected.id).then(() => refreshAlerts())
      .catch(() => setConnectionError('บันทึกสถานะอ่านแล้วไม่ได้ กรุณาลองใหม่'))
  }, [selected, refreshAlerts])

  const unread = (alerts.data ?? []).filter((alert) => !alert.read).length
  const details = selected?.details
  const detailRows = [
    ['เริ่มประชุม', dateLabel(details?.start_datetime)],
    ['สิ้นสุด', dateLabel(details?.end_datetime)],
    ['กำหนดส่ง', [details?.due_date, details?.due_time].filter(Boolean).join(' ')],
    ['สถานที่', details?.location],
  ].filter(([, value]) => value)

  return <main className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-amber-50 p-4 sm:p-6">
    <div className="mx-auto max-w-lg space-y-4">
      <header className="flex items-center justify-between gap-3 pt-3">
        <img src={peaLogo} alt="PEA" className="h-10 object-contain" />
        <span className="text-sm font-bold text-brand-700">แจ้งเตือนงานและประชุม</span>
      </header>
      <section className="rounded-2xl border border-purple-100 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 font-semibold text-slate-800">
          {checking ? <Loader2 size={18} className="animate-spin" /> : device ? <CheckCircle2 size={18} className="text-green-600" /> : <Smartphone size={18} />}
          <span>{checking ? 'กำลังตรวจอุปกรณ์…' : device ? `เชื่อมต่อแล้ว${device.userName ? ` · ${device.userName}` : ''}` : 'ยังไม่ได้เชื่อมต่อรับข้อความใหม่'}</span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">เมื่อเชื่อมต่อแล้ว ปัดปิดแอปได้ เปิดจาก Home Screen อีกครั้งเพื่ออ่านข้อความ ไม่ต้องใส่ลิงก์ซ้ำ</p>
        {connectionError && <p role="alert" className="mt-2 text-sm text-amber-800">{connectionError}</p>}
        {!checking && !device && !connectionError && <Link to="/pair-device?reconnect=1" className="mt-3 inline-flex min-h-11 items-center font-semibold text-brand-700">เชื่อมต่ออุปกรณ์</Link>}
      </section>
      <section className="overflow-hidden rounded-2xl border border-purple-100 bg-white shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-purple-50 p-4">
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900"><BellRing size={20} className="text-brand-700" />{selected ? 'รายละเอียดแจ้งเตือน' : 'กล่องแจ้งเตือน'}{!selected && unread > 0 && <span className="rounded-full bg-brand-700 px-2 py-0.5 text-xs text-white">{unread}</span>}</h1>
          <button type="button" onClick={() => void alerts.refetch()} aria-label="โหลดข้อความใหม่" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-brand-700"><RefreshCw size={18} className={alerts.isFetching ? 'animate-spin' : ''} /></button>
        </div>
        {selected ? <article className="space-y-4 p-5">
          <button type="button" onClick={() => setParams({})} className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand-700"><ChevronLeft size={18} />กลับไปกล่องแจ้งเตือน</button>
          <h2 className="break-words text-xl font-bold text-slate-900">{details?.title || selected.title}</h2>
          <p className="text-xs text-slate-500">{selected.title} · รับเมื่อ {dateLabel(selected.receivedAt)}</p>
          {detailRows.length > 0 && <dl className="space-y-3 rounded-xl bg-purple-50 p-4 text-sm">{detailRows.map(([label, value]) => <div key={label}><dt className="font-semibold text-brand-700">{label}</dt><dd className="mt-1 break-words text-slate-800">{value}</dd></div>)}</dl>}
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{details?.description || selected.body}</p>
          <p className="text-xs text-slate-500">ข้อมูลตามข้อความที่ได้รับ หากต้องการดูข้อมูลล่าสุดหรือแก้ไข ให้เข้าสู่ปฏิทิน</p>
        </article> : alerts.isPending ? <p className="p-6 text-center text-slate-500">กำลังโหลดข้อความ…</p>
          : alerts.error ? <p role="alert" className="p-6 text-red-700">อ่านกล่องข้อความไม่ได้ กรุณาเปิดแอปอีกครั้ง</p>
            : (alerts.data ?? []).length === 0 ? <div className="space-y-2 p-8 text-center"><BellRing size={32} className="mx-auto text-purple-300" /><p className="font-semibold text-slate-700">ยังไม่มีข้อความแจ้งเตือน</p><p className="text-sm text-slate-500">ข้อความใหม่ที่ส่งมายังมือถือเครื่องนี้จะแสดงที่นี่ แตะข้อความเพื่อดูงานหรือประชุมได้ทันที</p></div>
              : <ul className="divide-y divide-purple-50">{alerts.data?.map((alert) => <li key={alert.id}><button type="button" onClick={() => setParams({ notification: alert.id })} className={`w-full space-y-1 p-4 text-left transition hover:bg-purple-50 ${alert.read ? '' : 'bg-purple-50/60'}`}><span className="block break-words font-semibold text-slate-900">{!alert.read && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-brand-700" />}{alert.title}</span><span className="block line-clamp-2 text-sm text-slate-600">{alert.body}</span><time className="block text-xs text-slate-400">{dateLabel(alert.receivedAt)}</time></button></li>)}</ul>}
      </section>
      <footer className="flex flex-wrap items-center justify-between gap-2 pb-4 text-xs">
        <Link to="/calendar" className="inline-flex min-h-11 items-center font-semibold text-brand-700">ดูปฏิทิน / จัดการงาน (เข้าสู่ระบบ)</Link>
        <Link to="/pair-device?reconnect=1" className="inline-flex min-h-11 items-center text-slate-500">เปลี่ยนบัญชีที่เชื่อมต่อ</Link>
      </footer>
    </div>
  </main>
}
