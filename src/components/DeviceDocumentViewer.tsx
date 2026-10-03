import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, Download, ExternalLink, FileText, X } from 'lucide-react'
import { PdfDocumentPreview } from './PdfDocumentPreview'

/** Keep the app and its return controls alive while the browser displays a file. */
export function DeviceDocumentViewer({ name, previewUrl, downloadUrl, download = false }: {
  name: string; previewUrl?: string; downloadUrl?: string; download?: boolean
}) {
  const [loaded, setLoaded] = useState(false)
  return <main className="flex h-[100dvh] flex-col bg-slate-100">
    <header className="z-10 shrink-0 border-b border-purple-100 bg-white px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <Link replace to="/device-inbox" className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand-700"><ChevronLeft size={20} />กลับกล่องแจ้งเตือน</Link>
        <Link replace to="/device-inbox" aria-label="ปิดเอกสารและกลับกล่องแจ้งเตือน" className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-purple-50"><X size={22} /></Link>
      </div>
      <h1 className="flex items-center gap-2 break-all text-sm font-semibold text-slate-800"><FileText size={18} className="shrink-0 text-brand-700" />{name}</h1>
    </header>
    {download ? <section className="m-4 space-y-4 rounded-2xl bg-white p-5 shadow-sm">
      <p role="status" className="text-sm text-slate-700">ส่งคำขอดาวน์โหลดแล้ว ตรวจรายการดาวน์โหลด / แอปไฟล์ หากยังไม่เริ่ม ให้กดดาวน์โหลดอีกครั้ง</p>
      {downloadUrl && <iframe title="คำขอดาวน์โหลดเอกสาร" src={downloadUrl} referrerPolicy="no-referrer" className="hidden" />}
      {downloadUrl && <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary"><Download size={16} />ดาวน์โหลดอีกครั้ง</a>}
      <p className="text-xs text-slate-500">หากระบบเปิดหน้าต่างเอกสาร ให้ปิดหน้าต่างนั้นเพื่อกลับมาแอป แล้วกดกลับกล่องแจ้งเตือนด้านบน</p>
    </section> : <>
      <div className="shrink-0 space-y-2 bg-white px-3 py-2 text-xs text-slate-500">
        <p>{loaded || /\.pdf$/i.test(name) ? 'ปิดเอกสารด้วยกากบาทด้านบน หรือกดกลับกล่องแจ้งเตือน' : 'กำลังเปิดเอกสาร… ปุ่มกลับและกากบาทด้านบนใช้งานได้ตลอด'}</p>
        <div className="flex flex-wrap gap-2">
          {previewUrl && <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand-700"><ExternalLink size={15} />เปิดด้วยเบราว์เซอร์</a>}
          {downloadUrl && <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 font-semibold text-brand-700"><Download size={15} />ดาวน์โหลด</a>}
        </div>
        <p>หากตัวอย่างไม่แสดง เช่นไฟล์ Office ให้เปิดด้วยเบราว์เซอร์หรือดาวน์โหลด หน้าต่างที่เปิดแยกปิดแล้วกลับมาแอปนี้ได้</p>
      </div>
      {previewUrl && (/\.pdf$/i.test(name) ? <PdfDocumentPreview url={previewUrl} name={name} />
        : <iframe title={`เอกสาร: ${name}`} src={previewUrl} referrerPolicy="no-referrer" onLoad={() => setLoaded(true)} className="min-h-0 w-full flex-1 border-0 bg-white" />)}
    </>}
  </main>
}
