import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, Loader2, RefreshCw, Trash2, X } from 'lucide-react'
import { loadAdminCalendarTrashPreview, trashAllAdminCalendarItems, type AdminCalendarTrashPreview } from '../lib/adminCalendarItems'
import adminMascot from '../../ภาพประกอบUI/02_Hand I-Pad.jpg'

type TrashResult = { taskCount: number; meetingCount: number; totalCount: number }

export function AdminTrashAllDialog({ onClose, onDeleted }: { onClose: () => void; onDeleted: (result: TrashResult) => Promise<void> }) {
  const [preview, setPreview] = useState<AdminCalendarTrashPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const mounted = useRef(false)
  const dialog = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    let current = true
    setLoading(true); setPreview(null); setError(''); setConfirmation('')
    void loadAdminCalendarTrashPreview().then(data => {
      if (current) setPreview(data)
    }).catch(reason => {
      if (current) setError(`ตรวจจำนวนรายการไม่ได้: ${reason instanceof Error ? reason.message : 'กรุณาลองใหม่'}`)
    }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [revision])

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element.querySelector<HTMLButtonElement>('[data-cancel]')?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending.current) { event.preventDefault(); close.current(); return }
      if (event.key !== 'Tab') return
      const controls = [...element.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]')]
      if (!controls.length) { event.preventDefault(); element.focus(); return }
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [])

  const canSubmit = Boolean(preview && preview.totalCount > 0 && reason.trim() && reason.trim().length <= 500 && confirmation === 'ลบทั้งหมด' && !loading && !busy)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending.current || !canSubmit || !preview) return
    pending.current = true; setBusy(true); setError('')
    try {
      const result = await trashAllAdminCalendarItems(preview, reason, confirmation)
      if (mounted.current) await onDeleted(result)
    } catch (reason) {
      if (mounted.current) {
        setPreview(null); setConfirmation('')
        setError(`ยังยืนยันผลการลบไม่ได้: ${reason instanceof Error ? reason.message : 'กรุณาลองใหม่'} กรุณาตรวจจำนวนรายการใหม่ก่อนดำเนินการอีกครั้ง`)
      }
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#291333]/60 p-3 backdrop-blur-sm sm:p-5" role="dialog" aria-modal="true" aria-labelledby="admin-trash-all-title" aria-describedby="admin-trash-all-scope" ref={dialog} tabIndex={-1}>
    <form onSubmit={event => void submit(event)} className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-3xl border border-purple-100 bg-white shadow-2xl">
      <div className="h-2 bg-gradient-to-r from-brand-700 via-fuchsia-600 to-amber-400" />
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><span className="text-xs font-bold text-brand-700">PEA · ADMIN</span><h2 id="admin-trash-all-title" className="mt-1 text-xl font-bold text-slate-900">ลบ Task และ Meeting ทั้งระบบ</h2></div>
          <button type="button" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-purple-50 disabled:opacity-50" data-cancel disabled={busy} onClick={onClose} aria-label="ปิด"><X size={20} /></button>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-purple-100 bg-gradient-to-br from-purple-50 to-amber-50 p-3">
          <img src={adminMascot} alt="" aria-hidden="true" width={1500} height={1500} className="h-20 w-20 shrink-0 rounded-xl bg-white object-contain" />
          <p id="admin-trash-all-scope" className="text-sm font-semibold leading-relaxed text-brand-900">ครอบคลุมรายการของสมาชิกทุกคน รวมทุกหน้า โดยไม่สนตัวกรองที่ใช้อยู่</p>
        </div>
        {loading ? <p role="status" className="flex items-center gap-2 rounded-xl bg-slate-50 p-4 text-sm text-slate-600"><Loader2 size={18} className="animate-spin" />กำลังตรวจจำนวนรายการทั้งระบบ…</p> : preview && <div className="grid grid-cols-3 gap-2 rounded-2xl border border-purple-100 p-3 text-center" aria-label="จำนวนรายการทั้งระบบก่อนลบ">
          {[["Task", preview.taskCount], ["Meeting", preview.meetingCount], ["รวม", preview.totalCount]].map(([label, count]) => <div key={label}><p className="break-words text-xl font-bold text-brand-700">{Number(count).toLocaleString('th-TH')}</p><p className="text-xs font-semibold text-slate-500">{label}</p></div>)}
        </div>}
        {!loading && preview?.totalCount === 0 && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">ไม่มี Task หรือ Meeting ที่ต้องย้ายเข้าถังขยะ</p>}
        {error && <div role="alert" className="space-y-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><p className="break-words">{error}</p><button type="button" className="btn-secondary text-xs" disabled={busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} />ตรวจจำนวนรายการใหม่</button></div>}
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900"><AlertTriangle size={18} className="shrink-0" />รายการจะออกจากปฏิทินและหยุดการเตือนที่รอส่ง ประชุมทำซ้ำจะย้ายทั้งชุดเข้าถังขยะตามเงื่อนไขเดิม ระบบจะเก็บประวัติการดำเนินการ</p>
        <div><label className="field-label" htmlFor="admin-trash-all-reason">เหตุผลที่ลบทั้งระบบ</label><textarea id="admin-trash-all-reason" className="field-input" rows={2} maxLength={500} value={reason} disabled={busy || !preview || preview.totalCount === 0} onChange={event => setReason(event.target.value)} placeholder="ระบุเหตุผลในการลบรายการทั้งหมด" /></div>
        <div><label className="field-label" htmlFor="admin-trash-all-confirmation">พิมพ์ “ลบทั้งหมด” เพื่อยืนยัน</label><input id="admin-trash-all-confirmation" className="field-input" autoComplete="off" spellCheck={false} value={confirmation} disabled={busy || !preview || preview.totalCount === 0} onChange={event => setConfirmation(event.target.value)} placeholder="ลบทั้งหมด" /></div>
        <div className="grid gap-3 sm:grid-cols-2"><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>ยกเลิก</button><button type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canSubmit}>{busy ? <Loader2 size={17} className="shrink-0 animate-spin" /> : <Trash2 size={17} className="shrink-0" />}{busy ? 'กำลังย้ายเข้าถังขยะ…' : 'ยืนยันลบทั้งหมด'}</button></div>
        {busy && <p role="status" className="text-center text-xs text-slate-500">กำลังดำเนินการ กรุณารอผล</p>}
      </div>
    </form>
  </div>
}
