import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { BellRing, CheckCircle2, ChevronLeft, Loader2, RefreshCw, Smartphone, Send, Trash2 } from 'lucide-react'
import peaLogo from '../../ภาพประกอบUI/PEA Logo (1).png'
import { deleteDeviceAlerts, listDeviceAlerts, markDeviceAlertRead, requestDeviceInboxBadgeSync, updateDeviceAlertDetails, type DevicePairing } from '../lib/deviceInbox'
import { loadPairedDeviceNotification, restoreDevicePairing, sendPairedDeviceTestNotification } from '../lib/mobilePush'
import { DeviceNotificationDetails } from '../components/DeviceNotificationDetails'
import { useConfirm } from '../components/ConfirmDialogProvider'
import { useAuth } from '../auth/AuthProvider'

function dateLabel(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
  }).format(date)
}

export function DeviceInboxPage() {
  const confirm = useConfirm()
  const { user, loading } = useAuth()
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('notification')
  const [device, setDevice] = useState<DevicePairing | null>(null)
  const [checking, setChecking] = useState(true)
  const [connectionError, setConnectionError] = useState('')
  const [testing, setTesting] = useState(false)
  const [testId, setTestId] = useState('')
  const [testStatus, setTestStatus] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteStatus, setDeleteStatus] = useState('')
  const alerts = useQuery({ queryKey: ['device-inbox'], queryFn: listDeviceAlerts })
  const refreshAlerts = alerts.refetch
  const selected = alerts.data?.find((alert) => alert.id === selectedId)
  const canLoadDetails = Boolean(device && selected && /^[0-9a-f-]{36}$/i.test(selected.id))
  const content = useQuery({
    queryKey: ['device-notification-details', device?.subscriptionId, selectedId],
    queryFn: () => loadPairedDeviceNotification(selectedId!), enabled: canLoadDetails,
    retry: false, staleTime: 0, gcTime: 0,
  })
  const testReceived = Boolean(testId && alerts.data?.some((alert) => alert.id === testId))

  const removeMessages = async (ids: string[], all = false) => {
    if (deleting || !ids.length) return
    setDeleting(true)
    setDeleteStatus('')
    try {
      const accepted = await confirm({
        title: all ? 'ล้างกล่องแจ้งเตือน?' : 'ลบข้อความนี้?',
        message: `ลบ${all ? `ข้อความ ${ids.length} รายการ` : 'ข้อความนี้'}จากมือถือเครื่องนี้เท่านั้น ไม่ลบงานหรือประชุม และยังรับข้อความใหม่ได้ตามเดิม ข้อความที่ลบแล้วกู้คืนไม่ได้`,
        confirmLabel: all ? 'ล้างข้อความทั้งหมด' : 'ลบข้อความ', tone: 'danger',
      })
      if (!accepted) return
      await deleteDeviceAlerts(ids)
      if (selectedId && ids.includes(selectedId)) setParams({})
      if (ids.includes(testId)) { setTestId(''); setTestStatus('') }
      await refreshAlerts()
      setDeleteStatus(`ลบข้อความ ${ids.length} รายการแล้ว`)
    } catch {
      setConnectionError('ลบข้อความไม่ได้ กรุณาลองใหม่')
    } finally { setDeleting(false) }
  }

  const testNotification = async () => {
    if (testing) return
    setTesting(true)
    setTestId('')
    setTestStatus('')
    try {
      setTestId(await sendPairedDeviceTestNotification())
      setTestStatus('ผู้ให้บริการ Push รับข้อความทดสอบแล้ว กำลังรอข้อความเข้ามาในเครื่องนี้')
    } catch (error) {
      setTestStatus(error instanceof Error ? error.message : 'ส่งข้อความทดสอบไม่ได้ กรุณาลองใหม่')
    } finally { setTesting(false) }
  }

  useEffect(() => {
    let cancelled = false
    restoreDevicePairing().then((result) => { if (!cancelled) setDevice(result) })
      .catch(() => { if (!cancelled) setConnectionError('ตรวจการเชื่อมต่อไม่ได้ ข้อความที่เคยรับยังเปิดอ่านได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่') })
      .finally(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const refresh = () => { void refreshAlerts(); requestDeviceInboxBadgeSync() }
    const onMessage = (event: MessageEvent) => { if (event.data?.type === 'PEA_INBOX_UPDATED') refresh() }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    requestDeviceInboxBadgeSync()
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

  useEffect(() => {
    if (selectedId && content.data) void updateDeviceAlertDetails(selectedId, content.data.details)
      .then(() => refreshAlerts()).catch(() => {})
  }, [selectedId, content.data, refreshAlerts])

  useEffect(() => {
    if (!testId || testReceived) return
    const poll = setInterval(() => void refreshAlerts(), 2000)
    const timeout = setTimeout(() => {
      clearInterval(poll)
      setTestStatus('ยังไม่พบข้อความทดสอบในเครื่องนี้ กรุณาตรวจอินเทอร์เน็ต และการตั้งค่าการแจ้งเตือนของ PEA Calendar แล้วลองใหม่')
    }, 20000)
    return () => { clearInterval(poll); clearTimeout(timeout) }
  }, [testId, testReceived, refreshAlerts])

  const unread = (alerts.data ?? []).filter((alert) => !alert.read).length

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
        <p className="mt-2 text-xs leading-relaxed text-slate-500">ตัวเลขบนไอคอนนับข้อความที่ยังไม่ได้อ่าน และลดลงเมื่อเปิดอ่านหรือลบข้อความ บน Android อาจแสดงเป็นจุดตามระบบของเครื่อง</p>
        {connectionError && <p role="alert" className="mt-2 text-sm text-amber-800">{connectionError}</p>}
        {!checking && !device && !connectionError && <Link to="/pair-device?reconnect=1" className="mt-3 inline-flex min-h-11 items-center font-semibold text-brand-700">เชื่อมต่ออุปกรณ์</Link>}
        {device && <button type="button" onClick={() => void testNotification()} disabled={testing} className="btn-primary mt-3 w-full text-sm">{testing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}ทดสอบส่งจากเซิร์ฟเวอร์มามือถือเครื่องนี้</button>}
        {(testStatus || testReceived) && <p role="status" className={`mt-3 rounded-xl p-3 text-sm ${testReceived ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}>{testReceived ? 'มือถือเครื่องนี้รับข้อความทดสอบแล้ว เปิดอ่านจากกล่องแจ้งเตือนได้เลย' : testStatus}</p>}
      </section>
      <section className="overflow-hidden rounded-2xl border border-purple-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-50 p-4">
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900"><BellRing size={20} className="text-brand-700" />{selected ? 'รายละเอียดแจ้งเตือน' : 'กล่องแจ้งเตือน'}{!selected && unread > 0 && <span className="rounded-full bg-brand-700 px-2 py-0.5 text-xs text-white">{unread}</span>}</h1>
          <div className="flex items-center gap-1">
            <button type="button" disabled={deleting || !alerts.data?.length} onClick={() => void removeMessages(selected ? [selected.id] : (alerts.data ?? []).map((alert) => alert.id), !selected)} className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40"><Trash2 size={16} />{selected ? 'ลบข้อความนี้' : 'ล้างทั้งหมด'}</button>
          <button type="button" onClick={() => { void alerts.refetch(); if (canLoadDetails) void content.refetch() }} aria-label="โหลดข้อความใหม่" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-brand-700"><RefreshCw size={18} className={alerts.isFetching ? 'animate-spin' : ''} /></button>
          </div>
        </div>
        {deleteStatus && <p role="status" className="border-b border-purple-50 bg-green-50 px-4 py-3 text-sm text-green-800">{deleteStatus}</p>}
        {selected ? <article className="space-y-4 p-5">
          <button type="button" onClick={() => setParams({})} className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand-700"><ChevronLeft size={18} />กลับไปกล่องแจ้งเตือน</button>
          <DeviceNotificationDetails alert={selected} details={content.data?.details ?? selected.details}
            documents={content.data?.documents} fetching={content.isFetching} onlineDetails={Boolean(content.data)}
            error={content.fetchStatus === 'paused' ? 'ไม่มีอินเทอร์เน็ต' : content.error instanceof Error ? content.error.message : undefined}
            canLoad={canLoadDetails} onRefresh={() => void content.refetch()} />
        </article> : alerts.isPending ? <p className="p-6 text-center text-slate-500">กำลังโหลดข้อความ…</p>
          : alerts.error ? <p role="alert" className="p-6 text-red-700">อ่านกล่องข้อความไม่ได้ กรุณาเปิดแอปอีกครั้ง</p>
            : (alerts.data ?? []).length === 0 ? <div className="space-y-2 p-8 text-center"><BellRing size={32} className="mx-auto text-purple-300" /><p className="font-semibold text-slate-700">ยังไม่มีข้อความแจ้งเตือน</p><p className="text-sm text-slate-500">ข้อความใหม่ที่ส่งมายังมือถือเครื่องนี้จะแสดงที่นี่ แตะข้อความเพื่อดูงานหรือประชุมได้ทันที</p></div>
              : <ul className="divide-y divide-purple-50">{alerts.data?.map((alert) => <li key={alert.id} className={`flex items-start ${alert.read ? '' : 'bg-purple-50/60'}`}><button type="button" onClick={() => setParams({ notification: alert.id })} className="min-w-0 flex-1 space-y-1 p-4 text-left transition hover:bg-purple-50"><span className="block break-words font-semibold text-slate-900">{!alert.read && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-brand-700" />}{alert.title}</span><span className="block line-clamp-2 text-sm text-slate-600">{alert.body}</span><time className="block text-xs text-slate-400">{dateLabel(alert.receivedAt)}</time></button><button type="button" disabled={deleting} aria-label={`ลบข้อความ: ${alert.title}`} onClick={() => void removeMessages([alert.id])} className="mr-2 mt-2 flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"><Trash2 size={18} /></button></li>)}</ul>}
      </section>
      <footer className="flex flex-wrap items-center justify-between gap-2 pb-4 text-xs">
        {!loading && <Link to={user ? '/calendar' : '/login'} className="inline-flex min-h-11 items-center font-semibold text-brand-700">{user ? 'เปิดปฏิทิน' : 'เข้าสู่ระบบ'}</Link>}
        <Link to="/pair-device?reconnect=1" className="inline-flex min-h-11 items-center text-slate-500">เปลี่ยนบัญชีที่เชื่อมต่อ</Link>
      </footer>
    </div>
  </main>
}
