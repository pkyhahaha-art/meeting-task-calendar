import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FileText, Loader2, RefreshCw } from 'lucide-react'
import { loadPairedDeviceNotification } from '../lib/mobilePush'
import { deviceDocumentUrl } from '../lib/deviceDocument'

export function DeviceDocumentPage() {
  const [params] = useSearchParams()
  const notificationId = params.get('notification') || ''
  const fileId = params.get('file') || ''
  const download = params.get('mode') === 'download'
  const [error, setError] = useState('')
  const [readyUrl, setReadyUrl] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setError(''); setReadyUrl('')
    void loadPairedDeviceNotification(notificationId).then((content) => {
      if (!cancelled) {
        const url = deviceDocumentUrl(content, fileId, download)
        setReadyUrl(url)
        window.location.replace(url)
      }
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'เปิดเอกสารไม่ได้ กรุณาลองใหม่') })
    return () => { cancelled = true }
  }, [notificationId, fileId, download, attempt])
  return <main className="flex min-h-screen items-center justify-center bg-purple-50 p-5">
    <section className="w-full max-w-lg space-y-4 rounded-2xl border border-purple-100 bg-white p-6 shadow-sm">
      <h1 className="flex items-center gap-2 text-lg font-bold text-brand-700"><FileText size={22} />{download ? 'ดาวน์โหลดเอกสาร' : 'เปิดดูเอกสาร'}</h1>
      {error ? <><p role="alert" className="text-sm text-amber-800">{error}</p><button type="button" className="btn-secondary" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} />ลองใหม่</button></>
        : readyUrl ? <><p role="status" className="text-sm text-slate-600">ส่งคำขอ{download ? 'ดาวน์โหลด' : 'เปิด'}เอกสารแล้ว หากยังไม่เริ่ม ให้กดปุ่มด้านล่าง</p><a className="btn-secondary" href={readyUrl}>{download ? 'ดาวน์โหลดเอกสารอีกครั้ง' : 'เปิดเอกสารอีกครั้ง'}</a></>
          : <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={18} className="animate-spin" />กำลังโหลดลิงก์เอกสารใหม่…</p>}
      <p className="text-xs text-slate-500">PDF และรูปภาพเปิดดูได้ในเบราว์เซอร์ ส่วนไฟล์ Office ใช้แอปที่รองรับ เมื่อดาวน์โหลดแล้วให้ตรวจในรายการดาวน์โหลด / แอปไฟล์</p>
      <Link className="inline-flex min-h-11 items-center font-semibold text-brand-700" to={`/device-inbox?${new URLSearchParams({ notification: notificationId })}`}>กลับไปข้อความแจ้งเตือน</Link>
    </section>
  </main>
}
