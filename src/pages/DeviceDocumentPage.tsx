import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FileText, Loader2, RefreshCw } from 'lucide-react'
import { loadPairedDeviceNotification } from '../lib/mobilePush'
import { deviceDocumentUrl } from '../lib/deviceDocument'
import { DeviceDocumentViewer } from '../components/DeviceDocumentViewer'
import type { DeviceInboxDocument } from '../lib/deviceInbox'

export function DeviceDocumentPage() {
  const [params] = useSearchParams()
  const notificationId = params.get('notification') || ''
  const fileId = params.get('file') || ''
  const download = params.get('mode') === 'download'
  const [error, setError] = useState('')
  const [file, setFile] = useState<DeviceInboxDocument | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setError(''); setFile(null)
    void loadPairedDeviceNotification(notificationId).then((content) => {
      if (!cancelled) {
        // Validate the requested action, then display it inside the app. Sending
        // the top-level window to Storage strands iOS Home Screen return controls.
        deviceDocumentUrl(content, fileId, download)
        setFile(content.documents.find((item) => item.id === fileId)!)
      }
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'เปิดเอกสารไม่ได้ กรุณาลองใหม่') })
    return () => { cancelled = true }
  }, [notificationId, fileId, download, attempt])
  if (file) return <DeviceDocumentViewer key={`${fileId}-${attempt}`} name={file.name}
    previewUrl={file.previewUrl} downloadUrl={file.downloadUrl} download={download} />
  return <main className="flex min-h-screen items-center justify-center bg-purple-50 p-5">
    <section className="w-full max-w-lg space-y-4 rounded-2xl border border-purple-100 bg-white p-6 shadow-sm">
      <h1 className="flex items-center gap-2 text-lg font-bold text-brand-700"><FileText size={22} />{download ? 'ดาวน์โหลดเอกสาร' : 'เปิดดูเอกสาร'}</h1>
      {error ? <><p role="alert" className="text-sm text-amber-800">{error}</p><button type="button" className="btn-secondary" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} />ลองใหม่</button></>
        : <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 size={18} className="animate-spin" />กำลังโหลดลิงก์เอกสารใหม่…</p>}
      <p className="text-xs text-slate-500">PDF และรูปภาพเปิดดูได้ในเบราว์เซอร์ ส่วนไฟล์ Office ใช้แอปที่รองรับ เมื่อดาวน์โหลดแล้วให้ตรวจในรายการดาวน์โหลด / แอปไฟล์</p>
      <Link replace className="inline-flex min-h-11 items-center font-semibold text-brand-700" to="/device-inbox">กลับกล่องแจ้งเตือน</Link>
    </section>
  </main>
}
