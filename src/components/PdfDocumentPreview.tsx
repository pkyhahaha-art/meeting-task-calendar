import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from 'lucide-react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

/** Render one page at a time to keep large documents within a phone's memory. */
export function PdfDocumentPreview({ url, name }: { url: string; name: string }) {
  const container = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [width, setWidth] = useState(320)
  const [zoom, setZoom] = useState(1)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!container.current) return
    const resize = () => setWidth(Math.max(200, container.current!.clientWidth - 24))
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!canvas.current) return
    let cancelled = false
    let destroy: (() => Promise<void>) | undefined
    setPdf(null); setPage(1); setError(''); setBusy(true)
    void import('pdfjs-dist/legacy/build/pdf.mjs').then(async (library) => {
      if (cancelled) return
      library.GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).href
      const assets = new URL(import.meta.env.PROD ? './pdfjs/' : '/node_modules/pdfjs-dist/', document.baseURI).href
      const loading = library.getDocument({ url, cMapUrl: `${assets}cmaps/`, cMapPacked: true,
        standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`, iccUrl: `${assets}iccs/` })
      destroy = () => loading.destroy()
      const documentPdf = await loading.promise
      if (!cancelled) setPdf(documentPdf)
    }).catch(() => {
      if (!cancelled) { setError('แสดง PDF ไม่ได้ กรุณากลับไปเปิดเอกสารใหม่ หรือใช้ปุ่มดาวน์โหลดด้านบน'); setBusy(false) }
    })
    return () => { cancelled = true; void destroy?.().catch(() => {}) }
  }, [url])

  useEffect(() => {
    if (!pdf || !canvas.current) return
    let cancelled = false
    let rendering: RenderTask | undefined
    const target = canvas.current
    setBusy(true); setError('')
    void pdf.getPage(page).then(async (pdfPage) => {
      if (cancelled) return
      const base = pdfPage.getViewport({ scale: 1 })
      const viewport = pdfPage.getViewport({ scale: width / base.width * zoom })
      // Limit backing pixels on iPhones while keeping the visible page zoomable.
      const density = Math.min(window.devicePixelRatio || 1, 2, 2400 / viewport.width, 3200 / viewport.height)
      target.width = Math.floor(viewport.width * density)
      target.height = Math.floor(viewport.height * density)
      target.style.width = `${Math.floor(viewport.width)}px`
      target.style.height = `${Math.floor(viewport.height)}px`
      rendering = pdfPage.render({ canvas: target, viewport, transform: [density, 0, 0, density, 0, 0] })
      await rendering.promise
      if (!cancelled) setBusy(false)
    }).catch(() => {
      if (!cancelled) { setError('แสดงหน้านี้ไม่ได้ กรุณาใช้ปุ่มดาวน์โหลดด้านบน'); setBusy(false) }
    })
    return () => { cancelled = true; rendering?.cancel() }
  }, [pdf, page, width, zoom])

  return <section className="flex min-h-0 flex-1 flex-col" aria-label="ตัวอ่าน PDF ในแอป">
    <div className="flex shrink-0 items-center justify-center gap-2 border-y border-slate-200 bg-white px-2">
      <button type="button" aria-label="หน้าก่อนหน้า" disabled={!pdf || page <= 1 || busy} onClick={() => setPage((value) => value - 1)} className="flex min-h-11 min-w-11 items-center justify-center text-brand-700 disabled:opacity-30"><ChevronLeft size={20} /></button>
      <span className="text-sm text-slate-700">หน้า {page} / {pdf?.numPages || '…'}</span>
      <button type="button" aria-label="หน้าถัดไป" disabled={!pdf || page >= pdf.numPages || busy} onClick={() => setPage((value) => value + 1)} className="flex min-h-11 min-w-11 items-center justify-center text-brand-700 disabled:opacity-30"><ChevronRight size={20} /></button>
      <button type="button" aria-label="ย่อเอกสาร" disabled={zoom <= 1 || busy} onClick={() => setZoom((value) => value - 0.5)} className="flex min-h-11 min-w-11 items-center justify-center text-brand-700 disabled:opacity-30"><ZoomOut size={18} /></button>
      <button type="button" aria-label="ขยายเอกสาร" disabled={zoom >= 3 || busy} onClick={() => setZoom((value) => value + 0.5)} className="flex min-h-11 min-w-11 items-center justify-center text-brand-700 disabled:opacity-30"><ZoomIn size={18} /></button>
    </div>
    {busy && <p role="status" className="flex shrink-0 items-center justify-center gap-2 bg-white p-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />กำลังโหลด PDF…</p>}
    {error && <p role="alert" className="shrink-0 bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
    <div ref={container} className="min-h-0 flex-1 overflow-auto p-3"><canvas ref={canvas} aria-label={`${name} หน้า ${page}`} className={`mx-auto bg-white shadow-sm ${busy || error ? 'invisible' : ''}`} /></div>
  </section>
}
