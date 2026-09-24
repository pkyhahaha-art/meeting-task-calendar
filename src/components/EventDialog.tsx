import { useEffect, useRef, useState } from 'react'
import { Bell, CalendarClock, Download, FileText, Loader2, Mail, Paperclip, Plus, Repeat2, Trash2, UserPlus, X } from 'lucide-react'
import type { Database } from '../lib/database.types'
import { bangkokDate, invalidGuestEmails, isPastBangkokDate, recurrenceFromRule, reminderOptions, validateAttachments, type Recurrence, type ReminderKey } from '../lib/eventForm'

type EventRow = Database['public']['Tables']['events']['Row']
type AttachmentRow = Database['public']['Tables']['attachments']['Row']
type AttachmentView = AttachmentRow & { signedUrl: string }
export type EventDetails = { guestEmails: string[]; reminderKeys: ReminderKey[]; notifyEmail: boolean; notifyLine: boolean; attachments: AttachmentView[] }
export type EventDraft = Pick<EventRow, 'title' | 'description' | 'location' | 'affiliation' | 'all_day'> & {
  date: string; start: string; end: string; recurrence: Recurrence; guestEmails: string[]; reminderKeys: ReminderKey[]
  notifyEmail: boolean; notifyLine: boolean; files: File[]
}

const blankDraft = (date?: string): EventDraft => ({
  title: '', description: '', location: '', affiliation: '', all_day: false,
  date: date ?? bangkokDate(), start: '09:00', end: '10:00',
  recurrence: 'none', guestEmails: [''], reminderKeys: ['1:day'], notifyEmail: true, notifyLine: false, files: [],
})

function localDate(value: string) {
  const date = new Date(value)
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
}

function localTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value
  return `${read('hour')}:${read('minute')}`
}

export function EventDialog({ open, event, details, selectedDate, canEdit, busy, onClose, onSave, onDelete }: {
  open: boolean; event: EventRow | null; details?: EventDetails; selectedDate?: string; canEdit: boolean; busy: boolean
  onClose: () => void; onSave: (draft: EventDraft) => Promise<void>; onDelete: () => Promise<void>
}) {
  const [draft, setDraft] = useState<EventDraft>(blankDraft(selectedDate))
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setError('')
    setDraft(event ? {
      title: event.title, description: event.description, location: event.location, affiliation: event.affiliation, all_day: event.all_day,
      date: localDate(event.start_datetime), start: localTime(event.start_datetime), end: event.all_day ? '' : localTime(event.end_datetime),
      recurrence: recurrenceFromRule(event.recurrence_rule), guestEmails: details?.guestEmails.length ? details.guestEmails : [''],
      reminderKeys: details?.reminderKeys ?? [], notifyEmail: details?.notifyEmail ?? true,
      notifyLine: details?.notifyLine ?? false, files: [],
    } : blankDraft(selectedDate))
  }, [event, details, selectedDate, open])
  if (!open) return null
  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const setGuestEmail = (index: number, value: string) => set('guestEmails', draft.guestEmails.map((email, itemIndex) => itemIndex === index ? value : email))
  const toggleReminder = (key: ReminderKey) => set('reminderKeys', draft.reminderKeys.includes(key) ? draft.reminderKeys.filter((item) => item !== key) : [...draft.reminderKeys, key])
  const creationDateInPast = !event && isPastBangkokDate(draft.date)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft.title.trim() || !draft.date || (!draft.all_day && !draft.start)) return setError('กรุณากรอกชื่อและเวลาเริ่ม')
    if (creationDateInPast) return setError('ไม่สามารถสร้าง Meeting ในวันที่ผ่านมาแล้ว')
    if (!draft.all_day && draft.end && draft.end < draft.start) return setError('เวลาสิ้นสุดต้องไม่ก่อนเวลาเริ่ม')
    const invalidEmails = invalidGuestEmails(draft.guestEmails)
    if (invalidEmails.length) return setError(`อีเมลไม่ถูกต้อง: ${invalidEmails.join(', ')}`)
    const attachmentError = validateAttachments(draft.files, details?.attachments.length ?? 0)
    if (attachmentError) return setError(attachmentError)
    if (draft.reminderKeys.length && !draft.notifyEmail && !draft.notifyLine) return setError('กรุณาเลือกช่องทางแจ้งเตือนอย่างน้อย 1 ช่องทาง')
    setError('')
    try { await onSave(draft) } catch (error) {
      setError(error instanceof Error && error.message.startsWith('เซสชันหมดอายุ') ? error.message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง')
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/35 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="event-title">
      <section className="max-h-[95vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between"><div className="flex gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><CalendarClock size={22} /></span><div><h2 id="event-title" className="text-xl font-bold">{event ? 'รายละเอียดการประชุม' : 'เพิ่มการประชุม'}</h2>{event && !canEdit && <p className="text-sm text-slate-500">ดูได้อย่างเดียว เฉพาะเจ้าของเท่านั้นที่แก้ไขได้</p>}</div></div><div className="flex items-center gap-2">{event && <p className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">สร้างโดย {event.creator_name || 'ไม่ระบุชื่อ'}</p>}<button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="ปิด"><X size={20} /></button></div></div>
        <form onSubmit={submit} className="space-y-5">
          <fieldset disabled={!canEdit || busy} className="space-y-5 disabled:opacity-75">
            <section className="space-y-4 rounded-xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800"><FileText size={18} className="text-brand-600" />ข้อมูลการประชุม</h3>
              <div><label className="field-label" htmlFor="title">ชื่อการประชุม *</label><input id="title" className="field-input" value={draft.title} onChange={(e) => set('title', e.target.value)} maxLength={180} /></div>
              <div><label className="field-label" htmlFor="event-affiliation">หน่วยงาน / สังกัด</label><input id="event-affiliation" className="field-input" placeholder="กคน.ฝลส." value={draft.affiliation} onChange={(e) => set('affiliation', e.target.value)} maxLength={250} /></div>
              <div><span className="field-label">วันที่นัดหมาย</span><p className={`rounded-xl border px-3 py-2.5 text-sm ${creationDateInPast ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>{new Date(`${draft.date}T00:00:00+07:00`).toLocaleDateString('th-TH', { dateStyle: 'full', timeZone: 'Asia/Bangkok' })}</p>{creationDateInPast && <p className="mt-1 text-sm text-red-600" role="alert">ไม่สามารถสร้าง Meeting ในวันที่ผ่านมาแล้ว กรุณาเลือกวันปัจจุบันหรือวันถัดไปจากปฏิทิน</p>}</div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={draft.all_day} onChange={(e) => { set('all_day', e.target.checked); if (e.target.checked) set('end', '') }} className="h-4 w-4 rounded border-slate-300 text-brand-600" />ทั้งวัน</label>
              {!draft.all_day && <div className="grid gap-4 sm:grid-cols-2"><div><label className="field-label" htmlFor="start">เริ่ม *</label><input id="start" type="time" className="field-input" value={draft.start} onChange={(e) => set('start', e.target.value)} /></div><div><label className="field-label" htmlFor="end">สิ้นสุด (ไม่บังคับ)</label><input id="end" type="time" className="field-input" value={draft.end} min={draft.start} onChange={(e) => set('end', e.target.value)} /></div></div>}
              <div><label className="field-label" htmlFor="location">สถานที่ / ห้องประชุม / ลิงก์ออนไลน์</label><input id="location" className="field-input" value={draft.location} onChange={(e) => set('location', e.target.value)} maxLength={250} /></div>
              <div><label className="field-label" htmlFor="description">รายละเอียด / วาระการประชุม</label><textarea id="description" className="field-input min-h-28 resize-y" value={draft.description} onChange={(e) => set('description', e.target.value)} maxLength={10000} /></div>
            </section>

            <div className="grid gap-5 md:grid-cols-2">
              <section className="space-y-3 rounded-xl border border-slate-200 p-4"><h3 className="flex items-center gap-2 font-semibold text-slate-800"><Repeat2 size={18} className="text-brand-600" />การทำซ้ำ</h3><select className="field-input" value={draft.recurrence} onChange={(e) => set('recurrence', e.target.value as Recurrence)} aria-label="การทำซ้ำ"><option value="none">ไม่ทำซ้ำ</option><option value="daily">ทุกวัน</option><option value="weekdays">ทุกวันทำงาน (จันทร์–ศุกร์)</option><option value="weekly">ทุกสัปดาห์</option><option value="monthly">ทุกเดือน</option><option value="yearly">ทุกปี</option></select></section>
              <section className="space-y-3 rounded-xl border border-slate-200 p-4"><h3 className="flex items-center gap-2 font-semibold text-slate-800"><UserPlus size={18} className="text-brand-600" />ผู้เข้าร่วม (ไม่บังคับ)</h3><div className="space-y-2">{draft.guestEmails.map((email, index) => <div key={index} className="flex gap-2"><input type="email" className="field-input min-w-0 flex-1" value={email} onChange={(e) => setGuestEmail(index, e.target.value)} placeholder="name@gmail.com" aria-label={`Gmail ผู้เข้าร่วมคนที่ ${index + 1}`} />{draft.guestEmails.length > 1 && <button type="button" className="shrink-0 rounded-xl border border-slate-300 p-2.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600" onClick={() => set('guestEmails', draft.guestEmails.filter((_, itemIndex) => itemIndex !== index))} aria-label={`ลบผู้เข้าร่วมคนที่ ${index + 1}`}><X size={18} /></button>}</div>)}</div><button type="button" className="btn-secondary w-full" onClick={() => set('guestEmails', [...draft.guestEmails, ''])}><Plus size={17} />เพิ่มผู้เข้าร่วมอีกคน</button><p className="text-xs text-slate-500">กรอก Gmail คนละ 1 ช่อง ผู้เข้าร่วมจะได้รับลิงก์เปิดดูรายละเอียดทางอีเมล</p></section>
            </div>

            <section className="space-y-4 rounded-xl border border-slate-200 p-4"><h3 className="flex items-center gap-2 font-semibold text-slate-800"><Bell size={18} className="text-brand-600" />การแจ้งเตือน</h3><div className="flex flex-wrap gap-2">{reminderOptions.map((option) => <label key={option.key} className={`cursor-pointer rounded-full border px-3 py-2 text-sm ${draft.reminderKeys.includes(option.key) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600'}`}><input type="checkbox" className="sr-only" checked={draft.reminderKeys.includes(option.key)} onChange={() => toggleReminder(option.key)} />{option.label}</label>)}</div><div className="flex flex-wrap gap-5 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={draft.notifyEmail} onChange={(e) => set('notifyEmail', e.target.checked)} className="h-4 w-4 rounded" /><Mail size={17} />Gmail / Email</label><label className="flex items-center gap-2"><input type="checkbox" checked={draft.notifyLine} onChange={(e) => set('notifyLine', e.target.checked)} className="h-4 w-4 rounded" />LINE</label></div><p className="text-xs text-slate-500">LINE ใช้งานได้หลังจากเชื่อมบัญชีในหน้าโปรไฟล์</p></section>

            <section className="space-y-3 rounded-xl border border-slate-200 p-4"><h3 className="flex items-center gap-2 font-semibold text-slate-800"><Paperclip size={18} className="text-brand-600" />ไฟล์แนบ</h3>{details?.attachments.map((file) => <div key={file.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"><FileText size={16} /><span className="min-w-0 flex-1 truncate">{file.file_name}</span><span className="shrink-0 text-xs text-slate-400">{(file.file_size / 1024 / 1024).toFixed(1)} MB</span><a className="btn-secondary shrink-0" href={file.signedUrl} download={file.file_name}><Download size={17} />ดาวน์โหลด</a></div>)}{canEdit && <>{draft.files.map((file, index) => <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm"><FileText size={16} /><span className="truncate">{file.name}</span><button type="button" className="ml-auto text-slate-500 hover:text-red-600" onClick={() => set('files', draft.files.filter((_, itemIndex) => itemIndex !== index))} aria-label={`นำ ${file.name} ออก`}><X size={16} /></button></div>)}<input ref={fileInput} type="file" multiple className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png" onChange={(e) => { const files = [...(e.target.files ?? [])]; const message = validateAttachments([...draft.files, ...files], details?.attachments.length ?? 0); if (message) setError(message); else { setError(''); set('files', [...draft.files, ...files]) }; e.target.value = '' }} /><button type="button" className="btn-secondary" onClick={() => fileInput.current?.click()}><Paperclip size={17} />อัปโหลดเอกสาร</button><p className="text-xs text-slate-500">สูงสุด 5 ไฟล์ ไฟล์ละไม่เกิน 10 MB: PDF, Office, JPG และ PNG</p></>}</section>
          </fieldset>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4">{event && canEdit ? <button type="button" onClick={onDelete} className="btn-secondary border-red-200 text-red-600 hover:bg-red-50" disabled={busy}><Trash2 size={17} />ลบ</button> : <span />}<div className="ml-auto flex gap-2"><button type="button" onClick={onClose} className="btn-secondary">{canEdit ? 'ยกเลิก' : 'ปิด'}</button>{canEdit && <button className="btn-primary" disabled={busy || creationDateInPast}>{busy && <Loader2 className="animate-spin" size={17} />}{event ? 'บันทึกการแก้ไข' : 'สร้างการประชุม'}</button>}</div></div>
        </form>
      </section>
    </div>
  )
}
