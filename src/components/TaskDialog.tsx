import { useEffect, useRef, useState } from 'react'
import { Bell, CheckCircle2, FileText, Link2, Loader2, Mail, Paperclip, Plus, Repeat2, Trash2, UserRound, X } from 'lucide-react'
import type { Database } from '../lib/database.types'
import { recurrenceFromRule, validateAttachments, type Recurrence } from '../lib/eventForm'
import { isGoogleDocumentUrl, taskReminderOptions, type TaskReminderKey } from '../lib/taskForm'

type TaskRow = Database['public']['Tables']['tasks']['Row']
type ProfileRow = Database['public']['Tables']['profiles']['Row']
type EventRow = Database['public']['Tables']['events']['Row']
type TaskAttachmentRow = Database['public']['Tables']['task_attachments']['Row']
type DocumentLinkRow = Database['public']['Tables']['document_links']['Row']

export type DriveLinkDraft = { displayName: string; url: string }
export type TaskDetails = {
  reminderKeys: TaskReminderKey[]
  notifyEmail: boolean
  notifyLine: boolean
  attachments: TaskAttachmentRow[]
  documentLinks: DocumentLinkRow[]
}
export type TaskDraft = Pick<TaskRow, 'title' | 'description'> & {
  dueDate: string
  dueTime: string
  assigneeKind: 'self' | 'internal' | 'external'
  assigneeUserId: string
  externalEmail: string
  linkedEventId: string
  recurrence: Recurrence
  reminderKeys: TaskReminderKey[]
  notifyEmail: boolean
  notifyLine: boolean
  files: File[]
  driveLinks: DriveLinkDraft[]
}

function blankDraft(date: string | undefined, userId: string): TaskDraft {
  return {
    title: '', description: '', dueDate: date ?? '', dueTime: '', assigneeKind: 'self', assigneeUserId: userId,
    externalEmail: '', linkedEventId: '', recurrence: 'none', reminderKeys: ['1_day'], notifyEmail: true,
    notifyLine: false, files: [], driveLinks: [{ displayName: '', url: '' }],
  }
}

export function TaskDialog({ open, task, details, selectedDate, userId, profiles, events, canEdit, canComplete, busy, onClose, onSave, onDelete, onToggleComplete }: {
  open: boolean
  task: TaskRow | null
  details?: TaskDetails
  selectedDate?: string
  userId: string
  profiles: ProfileRow[]
  events: EventRow[]
  canEdit: boolean
  canComplete: boolean
  busy: boolean
  onClose: () => void
  onSave: (draft: TaskDraft) => Promise<void>
  onDelete: () => Promise<void>
  onToggleComplete: () => Promise<void>
}) {
  const [draft, setDraft] = useState<TaskDraft>(blankDraft(selectedDate, userId))
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setError('')
    if (!task) {
      setDraft(blankDraft(selectedDate, userId))
      return
    }
    const assigneeKind = task.assignee_type === 'external' ? 'external' : task.assignee_user_id === userId ? 'self' : 'internal'
    setDraft({
      title: task.title,
      description: task.description,
      dueDate: task.due_date,
      dueTime: task.due_time?.slice(0, 5) ?? '',
      assigneeKind,
      assigneeUserId: task.assignee_user_id ?? '',
      externalEmail: task.external_assignee_email ?? '',
      linkedEventId: task.linked_event_id ?? '',
      recurrence: recurrenceFromRule(task.recurrence_rule),
      reminderKeys: details?.reminderKeys ?? [],
      notifyEmail: details?.notifyEmail ?? true,
      notifyLine: details?.notifyLine ?? false,
      files: [],
      driveLinks: details?.documentLinks.length
        ? details.documentLinks.map((link) => ({ displayName: link.display_name, url: link.url }))
        : [{ displayName: '', url: '' }],
    })
  }, [details, open, selectedDate, task, userId])

  if (!open) return null
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const toggleReminder = (key: TaskReminderKey) => set('reminderKeys', draft.reminderKeys.includes(key) ? draft.reminderKeys.filter((item) => item !== key) : [...draft.reminderKeys, key])
  const setDriveLink = (index: number, value: DriveLinkDraft) => set('driveLinks', draft.driveLinks.map((item, itemIndex) => itemIndex === index ? value : item))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!draft.title.trim() || !draft.dueDate) return setError('กรุณากรอกชื่องานและวันที่ครบกำหนด')
    if (draft.assigneeKind === 'internal' && !draft.assigneeUserId) return setError('กรุณาเลือกผู้รับมอบหมาย')
    if (draft.assigneeKind === 'external' && !/^[^\s@]+@gmail\.com$/i.test(draft.externalEmail.trim())) return setError('ผู้รับภายนอกต้องเป็น Gmail ที่ถูกต้อง')
    const links = draft.driveLinks.filter((link) => link.displayName.trim() || link.url.trim())
    if (links.length > 10) return setError('เพิ่มลิงก์ Google Drive ได้สูงสุด 10 รายการ')
    if (links.some((link) => !link.displayName.trim() || !isGoogleDocumentUrl(link.url.trim()))) return setError('กรุณาใส่ชื่อและลิงก์ Google Drive/Docs ที่ถูกต้อง')
    const attachmentError = validateAttachments(draft.files, details?.attachments.length ?? 0)
    if (attachmentError) return setError(attachmentError)
    if (draft.reminderKeys.length && !draft.notifyEmail && !draft.notifyLine) return setError('กรุณาเลือกช่องทางแจ้งเตือนอย่างน้อย 1 ช่องทาง')
    setError('')
    try { await onSave({ ...draft, driveLinks: links, notifyLine: draft.assigneeKind === 'external' ? false : draft.notifyLine }) }
    catch { setError('บันทึก Task ไม่สำเร็จ กรุณาลองใหม่') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/35 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="task-title">
      <section className="max-h-[95vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between">
          <div className="flex gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><CheckCircle2 size={22} /></span><div><h2 id="task-title" className="text-xl font-bold">{task ? 'รายละเอียด Task' : 'เพิ่ม Task'}</h2>{task && !canEdit && <p className="text-sm text-slate-500">ผู้รับมอบหมายเปลี่ยนได้เฉพาะสถานะเสร็จแล้ว</p>}</div></div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="ปิด"><X size={20} /></button>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <fieldset disabled={!canEdit || busy} className="space-y-5 disabled:opacity-75">
            <section className="space-y-4 rounded-xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800"><FileText size={18} className="text-amber-700" />ข้อมูลงาน</h3>
              <div><label className="field-label" htmlFor="task-name">ชื่องาน *</label><input id="task-name" className="field-input" value={draft.title} onChange={(event) => set('title', event.target.value)} maxLength={180} /></div>
              <div><label className="field-label" htmlFor="task-description">รายละเอียด / คำสั่งงาน</label><textarea id="task-description" className="field-input min-h-28 resize-y" value={draft.description} onChange={(event) => set('description', event.target.value)} maxLength={10000} /></div>
              <div className="grid gap-4 sm:grid-cols-2"><div><label className="field-label" htmlFor="task-date">วันครบกำหนด *</label><input id="task-date" type="date" className="field-input" value={draft.dueDate} onChange={(event) => set('dueDate', event.target.value)} /></div><div><label className="field-label" htmlFor="task-time">เวลา (ไม่บังคับ)</label><input id="task-time" type="time" className="field-input" value={draft.dueTime} onChange={(event) => set('dueTime', event.target.value)} /></div></div>
            </section>

            <section className="space-y-4 rounded-xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800"><UserRound size={18} className="text-amber-700" />ผู้รับมอบหมาย</h3>
              <div className="grid gap-3 sm:grid-cols-3">{(['self', 'internal', 'external'] as const).map((kind) => <label key={kind} className={`cursor-pointer rounded-xl border p-3 text-sm ${draft.assigneeKind === kind ? 'border-amber-500 bg-amber-50' : 'border-slate-200'}`}><input type="radio" className="mr-2" checked={draft.assigneeKind === kind} onChange={() => set('assigneeKind', kind)} />{kind === 'self' ? 'มอบหมายให้ตัวเอง' : kind === 'internal' ? 'พนักงานในระบบ' : 'ผู้รับภายนอก'}</label>)}</div>
              {draft.assigneeKind === 'internal' && <select className="field-input" value={draft.assigneeUserId} onChange={(event) => set('assigneeUserId', event.target.value)} aria-label="ผู้รับมอบหมาย"><option value="">เลือกพนักงาน</option>{profiles.filter((profile) => profile.id !== userId && profile.status === 'active').map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name} — {profile.email}</option>)}</select>}
              {draft.assigneeKind === 'external' && <div><label className="field-label" htmlFor="external-email">Gmail ผู้รับภายนอก *</label><input id="external-email" type="email" className="field-input" placeholder="name@gmail.com" value={draft.externalEmail} onChange={(event) => set('externalEmail', event.target.value)} /><p className="mt-1 text-xs text-slate-500">ผู้รับเปิดได้เฉพาะ Task นี้ และไม่สามารถเข้าปฏิทินได้</p></div>}
              <div><label className="field-label" htmlFor="linked-event">เชื่อมกับ Meeting (ไม่บังคับ)</label><select id="linked-event" className="field-input" value={draft.linkedEventId} onChange={(event) => set('linkedEventId', event.target.value)}><option value="">ไม่เชื่อม Meeting</option>{events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></div>
            </section>

            <div className="grid gap-5 md:grid-cols-2">
              <section className="space-y-3 rounded-xl border border-slate-200 p-4"><h3 className="flex items-center gap-2 font-semibold text-slate-800"><Repeat2 size={18} className="text-amber-700" />การทำซ้ำ</h3><select className="field-input" value={draft.recurrence} onChange={(event) => set('recurrence', event.target.value as Recurrence)}><option value="none">ไม่ทำซ้ำ</option><option value="daily">ทุกวัน</option><option value="weekdays">ทุกวันทำงาน</option><option value="weekly">ทุกสัปดาห์</option><option value="monthly">ทุกเดือน</option><option value="yearly">ทุกปี</option></select></section>
              <section className="space-y-3 rounded-xl border border-slate-200 p-4"><h3 className="flex items-center gap-2 font-semibold text-slate-800"><Bell size={18} className="text-amber-700" />การแจ้งเตือน</h3><div className="flex flex-wrap gap-2">{taskReminderOptions.map((option) => <label key={option.key} className={`cursor-pointer rounded-full border px-3 py-2 text-sm ${draft.reminderKeys.includes(option.key) ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-600'}`}><input type="checkbox" className="sr-only" checked={draft.reminderKeys.includes(option.key)} onChange={() => toggleReminder(option.key)} />{option.label}</label>)}</div><div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={draft.notifyEmail} onChange={(event) => set('notifyEmail', event.target.checked)} /><Mail size={16} />Gmail</label><label className="flex items-center gap-2"><input type="checkbox" checked={draft.notifyLine} disabled={draft.assigneeKind === 'external'} onChange={(event) => set('notifyLine', event.target.checked)} />LINE</label></div></section>
            </div>

            <section className="space-y-3 rounded-xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800"><Paperclip size={18} className="text-amber-700" />เอกสารประกอบ</h3>
              {details?.attachments.map((file) => <div key={file.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"><FileText size={16} /><span className="truncate">{file.file_name}</span><span className="ml-auto text-xs text-slate-400">{(file.file_size / 1024 / 1024).toFixed(1)} MB</span></div>)}
              {draft.files.map((file, index) => <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm"><FileText size={16} /><span className="truncate">{file.name}</span><button type="button" className="ml-auto text-slate-500 hover:text-red-600" onClick={() => set('files', draft.files.filter((_, itemIndex) => itemIndex !== index))}><X size={16} /></button></div>)}
              <input ref={fileInput} type="file" multiple className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png" onChange={(event) => { const files = [...(event.target.files ?? [])]; const message = validateAttachments([...draft.files, ...files], details?.attachments.length ?? 0); if (message) setError(message); else set('files', [...draft.files, ...files]); event.target.value = '' }} />
              <button type="button" className="btn-secondary" onClick={() => fileInput.current?.click()}><Paperclip size={17} />อัปโหลดไฟล์</button>
              <div className="space-y-2 border-t border-slate-100 pt-3"><p className="flex items-center gap-2 text-sm font-medium"><Link2 size={16} />ลิงก์ Google Drive</p>{draft.driveLinks.map((link, index) => <div key={index} className="grid gap-2 sm:grid-cols-[0.8fr_1.5fr_auto]"><input className="field-input" placeholder="ชื่อเอกสาร" value={link.displayName} onChange={(event) => setDriveLink(index, { ...link, displayName: event.target.value })} /><input type="url" className="field-input" placeholder="https://drive.google.com/..." value={link.url} onChange={(event) => setDriveLink(index, { ...link, url: event.target.value })} /><button type="button" className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:text-red-600" onClick={() => set('driveLinks', draft.driveLinks.filter((_, itemIndex) => itemIndex !== index))}><X size={18} /></button></div>)}{draft.driveLinks.length < 10 && <button type="button" className="btn-secondary" onClick={() => set('driveLinks', [...draft.driveLinks, { displayName: '', url: '' }])}><Plus size={17} />เพิ่มลิงก์</button>}</div>
            </section>
          </fieldset>

          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4">
            {task && canEdit ? <button type="button" onClick={onDelete} className="btn-secondary border-red-200 text-red-600" disabled={busy}><Trash2 size={17} />ย้ายไปถังขยะ</button> : <span />}
            <div className="ml-auto flex flex-wrap gap-2"><button type="button" onClick={onClose} className="btn-secondary">ปิด</button>{task && canComplete && <button type="button" className="btn-secondary" disabled={busy} onClick={onToggleComplete}><CheckCircle2 size={17} />{task.status === 'completed' ? 'เปิดงานอีกครั้ง' : 'ทำเครื่องหมายว่าเสร็จ'}</button>}{canEdit && <button className="btn-primary" disabled={busy}>{busy && <Loader2 className="animate-spin" size={17} />}{task ? 'บันทึกการแก้ไข' : 'สร้าง Task'}</button>}</div>
          </div>
        </form>
      </section>
    </div>
  )
}
