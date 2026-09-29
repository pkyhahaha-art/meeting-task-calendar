import { useEffect, useRef, useState } from 'react'
import { Bell, CalendarDays, CheckCircle2, FileText, Link2, Loader2, Mail, Paperclip, Plus, Repeat2, Trash2, UserRound, X } from 'lucide-react'
import Swal from 'sweetalert2'
import { useLanguage } from '../i18n/LanguageProvider'
import type { Database } from '../lib/database.types'
import { bangkokDate, formatDisplayDate, isPastBangkokDate, parseDisplayDate, recurrenceFromRule, validateAttachments, type Recurrence } from '../lib/eventForm'
import { invalidExternalEmails, isGoogleDocumentUrl, normalizeExternalEmails, taskReminderOptions, type TaskReminderKey } from '../lib/taskForm'
import { TimeSelect } from './TimeSelect'
import { NotificationDeliveryStatus, type DeliveryStatusRow } from './NotificationDeliveryStatus'

type TaskRow = Database['public']['Tables']['tasks']['Row']
type ProfileRow = Database['public']['Tables']['profiles']['Row']
type EventRow = Database['public']['Tables']['events']['Row']
type TaskAttachmentRow = Database['public']['Tables']['task_attachments']['Row'] & { signedUrl?: string }
type DocumentLinkRow = Database['public']['Tables']['document_links']['Row']
type RecipientTab = 'self' | 'internal' | 'external'

export type DriveLinkDraft = { displayName: string; url: string }
export type TaskDetails = {
  reminderKeys: TaskReminderKey[]
  notifyEmail: boolean
  notifyLine: boolean
  attachments: TaskAttachmentRow[]
  documentLinks: DocumentLinkRow[]
  internalRecipients: Array<{ user_id: string; acknowledged_at: string | null }>
  externalRecipients: Array<{ email: string; acknowledged_at: string | null }>
  notificationDeliveries: DeliveryStatusRow[]
}
export type TaskDraft = Pick<TaskRow, 'title' | 'description' | 'affiliation'> & {
  dueDate: string
  dueTime: string
  internalUserIds: string[]
  externalEmails: string[]
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
    title: '', description: '', affiliation: '', dueDate: date ?? bangkokDate(), dueTime: '', internalUserIds: [userId],
    externalEmails: [''], linkedEventId: '', recurrence: 'none', reminderKeys: ['1_day'], notifyEmail: true,
    notifyLine: false, files: [], driveLinks: [{ displayName: '', url: '' }],
  }
}

export function TaskDialog({ open, task, details, selectedDate, userId, profiles, events, canEdit, canComplete, canAcknowledge, canViewDeliveryStatus, busy, onClose, onSave, onDelete, onToggleComplete, onAcknowledge, onDeleteAttachment, onRetryNotification }: {
  open: boolean
  task: TaskRow | null
  details?: TaskDetails
  selectedDate?: string
  userId: string
  profiles: ProfileRow[]
  events: EventRow[]
  canEdit: boolean
  canComplete: boolean
  canAcknowledge: boolean
  canViewDeliveryStatus: boolean
  busy: boolean
  onClose: () => void
  onSave: (draft: TaskDraft, notifyRecipients: boolean) => Promise<void>
  onDelete: () => Promise<void>
  onToggleComplete: () => Promise<void>
  onAcknowledge: () => Promise<void>
  onDeleteAttachment: (attachment: TaskAttachmentRow) => Promise<void>
  onRetryNotification: (deliveryId: string) => Promise<void>
}) {
  const { text } = useLanguage()
  const [draft, setDraft] = useState<TaskDraft>(blankDraft(selectedDate, userId))
  const [dueDateText, setDueDateText] = useState(() => formatDisplayDate(selectedDate ?? bangkokDate()))
  const [recipientTab, setRecipientTab] = useState<RecipientTab>('self')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const initializedDraft = useRef<string | null>(null)

  useEffect(() => {
    if (!open) { initializedDraft.current = null; return }
    if (task && !details) return
    const key = task?.id ?? `new:${selectedDate ?? ''}`
    if (initializedDraft.current === key) return
    initializedDraft.current = key
    setError('')
    if (!task) {
      setDraft(blankDraft(selectedDate, userId))
      setDueDateText(formatDisplayDate(selectedDate ?? bangkokDate()))
      setRecipientTab('self')
      return
    }
    const internalIds = details?.internalRecipients.map((recipient) => recipient.user_id) ?? (task.assignee_user_id ? [task.assignee_user_id] : [])
    setRecipientTab(internalIds.includes(userId) ? 'self' : internalIds.length ? 'internal' : 'external')
    setDueDateText(formatDisplayDate(task.due_date))
    setDraft({
      title: task.title,
      description: task.description,
      affiliation: task.affiliation,
      dueDate: task.due_date,
      dueTime: task.due_time?.slice(0, 5) ?? '',
      internalUserIds: internalIds,
      externalEmails: details?.externalRecipients.length ? details.externalRecipients.map((recipient) => recipient.email) : [task.external_assignee_email ?? ''],
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
  const setExternalEmail = (index: number, value: string) => set('externalEmails', draft.externalEmails.map((email, itemIndex) => itemIndex === index ? value : email))
  const creationDateInPast = !task && isPastBangkokDate(draft.dueDate)
  const selfProfile = profiles.find((profile) => profile.id === userId)
  const selfSelected = draft.internalUserIds.includes(userId)
  const otherInternalCount = draft.internalUserIds.filter((id) => id !== userId).length
  const externalCount = normalizeExternalEmails(draft.externalEmails).length
  const recipientTabs: Array<{ key: RecipientTab; label: string; count: number }> = [
    { key: 'self', label: text('มอบหมายให้ตนเอง', 'Assign to myself'), count: selfSelected ? 1 : 0 },
    { key: 'internal', label: text('พนักงานในระบบ', 'Internal employees'), count: otherInternalCount },
    { key: 'external', label: text('ผู้รับภายนอก (Gmail)', 'External recipients (Gmail)'), count: externalCount },
  ]

  const save = async (notifyRecipients: boolean) => {
    if (!draft.title.trim() || !draft.dueDate) { setError(text('กรุณากรอกชื่องานและวันที่ครบกำหนด', 'Enter a task title and due date.')); return false }
    if (creationDateInPast) { setError(text('ไม่สามารถสร้าง Task ในวันที่ผ่านมาแล้ว', 'A task cannot be created in the past.')); return false }
    const externalEmails = normalizeExternalEmails(draft.externalEmails)
    if (!draft.internalUserIds.length && !externalEmails.length) { setError(text('กรุณาเลือกผู้รับมอบหมายอย่างน้อยหนึ่งคน', 'Choose at least one assignee.')); return false }
    if (invalidExternalEmails(draft.externalEmails).length) { setError(text('ผู้รับภายนอกต้องเป็น Gmail ที่ถูกต้อง', 'External recipients must use valid Gmail addresses.')); return false }
    const links = draft.driveLinks.filter((link) => link.displayName.trim() || link.url.trim())
    if (links.length > 10) { setError(text('เพิ่มลิงก์ Google Drive ได้สูงสุด 10 รายการ', 'You can add up to 10 Google Drive links.')); return false }
    if (links.some((link) => !link.displayName.trim() || !isGoogleDocumentUrl(link.url.trim()))) { setError(text('กรุณาใส่ชื่อและลิงก์ Google Drive/Docs ที่ถูกต้อง', 'Enter a name and a valid Google Drive or Docs link.')); return false }
    const attachmentError = validateAttachments(draft.files, details?.attachments.length ?? 0)
    if (attachmentError) { setError(attachmentError); return false }
    if (draft.reminderKeys.length && !draft.notifyEmail && !draft.notifyLine) { setError(text('กรุณาเลือกช่องทางแจ้งเตือนอย่างน้อย 1 ช่องทาง', 'Choose at least one notification channel.')); return false }
    setError('')
    try {
      await onSave({ ...draft, driveLinks: links, notifyLine: draft.internalUserIds.length ? draft.notifyLine : false }, notifyRecipients)
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : text('บันทึก Task ไม่สำเร็จ กรุณาลองใหม่', 'Could not save the task. Please try again.'))
      return false
    }
  }
  const confirmSave = async () => {
    const result = await Swal.fire({
      icon: 'question',
      title: text('ยืนยันการบันทึก Task', 'Confirm task update'),
      text: text('เลือกวิธีการบันทึกที่ต้องการ', 'Choose how to save your changes.'),
      showCancelButton: true,
      showDenyButton: true,
      confirmButtonText: text('บันทึกการแก้ไข', 'Save changes'),
      denyButtonText: text('บันทึกการแก้ไขและแจ้งเตือน', 'Save and notify'),
      cancelButtonText: text('ยกเลิก', 'Cancel'),
      confirmButtonColor: '#0f766e',
      denyButtonColor: '#b45309',
    })
    if (!result.isConfirmed && !result.isDenied) return
    const notifyRecipients = result.isDenied
    if (notifyRecipients && task?.status !== 'pending') {
      await Swal.fire({
        icon: 'warning',
        title: text('ไม่สามารถแจ้งเตือนได้', 'Cannot send notification'),
        text: task?.status === 'completed' ? text('Task นี้เสร็จแล้ว จึงไม่สามารถส่งการแจ้งเตือนได้', 'This task is complete, so no notification can be sent.') : text('Task นี้ถูกยกเลิกแล้ว จึงไม่สามารถส่งการแจ้งเตือนได้', 'This task is cancelled, so no notification can be sent.'),
        showConfirmButton: false,
        timer: 2500,
        timerProgressBar: true,
      })
      return
    }
    setSaving(true)
    try {
      if (await save(notifyRecipients)) {
        await Swal.fire({
          icon: 'success',
          title: text('สำเร็จ', 'Success'),
          text: notifyRecipients ? text('บันทึกการแก้ไขและแจ้งเตือนผู้รับแล้ว', 'Changes saved and recipients notified.') : text('บันทึกการแก้ไขเรียบร้อยแล้ว', 'Changes saved.'),
          showConfirmButton: false,
          timer: 2000,
          timerProgressBar: true,
        })
        onClose()
      }
    } finally { setSaving(false) }
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (task) { void confirmSave(); return }
    void (async () => {
      setSaving(true)
      try {
        if (await save(true)) {
          await Swal.fire({ icon: 'success', title: text('สำเร็จ', 'Success'), text: text('สร้าง Task เรียบร้อยแล้ว', 'Task created.'), showConfirmButton: false, timer: 2000, timerProgressBar: true })
          onClose()
        }
      } finally { setSaving(false) }
    })()
  }

  const notificationAcknowledgements: Record<string, string | null> = {}
  for (const recipient of details?.externalRecipients ?? []) notificationAcknowledgements[recipient.email.toLowerCase()] = recipient.acknowledged_at
  for (const recipient of details?.internalRecipients ?? []) {
    const email = profiles.find((profile) => profile.id === recipient.user_id)?.email
    if (email) notificationAcknowledgements[email.toLowerCase()] = recipient.acknowledged_at
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/35 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="task-title">
      <section className="max-h-[95vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between">
          <div className="flex gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><CheckCircle2 size={22} /></span><div><h2 id="task-title" className="text-xl font-bold">{task ? text('รายละเอียด Task', 'Task details') : text('เพิ่ม Task', 'Add task')}</h2>{task && !canEdit && <p className="text-sm text-slate-500">{text('ดูและดาวน์โหลดเอกสารได้ โดยแก้ไขรายละเอียดไม่ได้', 'You can view and download documents, but cannot edit the details.')}</p>}</div></div>
          <div className="flex items-center gap-2">{task && <p className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{text('สร้างโดย', 'Created by')} {task.creator_name || text('ไม่ระบุชื่อ', 'Unknown')}</p>}<button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label={text('ปิด', 'Close')}><X size={20} /></button></div>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <fieldset disabled={!canEdit || busy || saving} className="space-y-5 disabled:opacity-75">
            <section className="space-y-4 rounded-xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800"><FileText size={18} className="text-amber-700" />{text('ข้อมูลงาน', 'Task details')}</h3>
              <div><label className="field-label" htmlFor="task-name">{text('ชื่องาน *', 'Task title *')}</label><input id="task-name" className="field-input" value={draft.title} onChange={(event) => set('title', event.target.value)} maxLength={180} /></div>
              <div><label className="field-label" htmlFor="task-affiliation">{text('หน่วยงาน / สังกัด', 'Department / affiliation')}</label><input id="task-affiliation" className="field-input" placeholder={text('กคน.ฝลส.', 'e.g. Department')} value={draft.affiliation} onChange={(event) => set('affiliation', event.target.value)} maxLength={250} /></div>
              <div><label className="field-label" htmlFor="task-description">{text('รายละเอียด / คำสั่งงาน', 'Details / instructions')}</label><textarea id="task-description" className="field-input min-h-28 resize-y" value={draft.description} onChange={(event) => set('description', event.target.value)} maxLength={10000} /></div>
              <div className="grid gap-4 sm:grid-cols-2"><div><label className="field-label" htmlFor="task-date">{text('วันครบกำหนด *', 'Due date *')}</label><div className="relative"><input id="task-date" type="text" inputMode="numeric" placeholder="dd/mm/yyyy" maxLength={10} className="field-input pr-12" value={dueDateText} onChange={(event) => { const value = event.target.value; setDueDateText(value); set('dueDate', parseDisplayDate(value) ?? '') }} onBlur={() => { const date = parseDisplayDate(dueDateText); if (date) setDueDateText(formatDisplayDate(date)) }} /><label className="absolute inset-y-1 right-1 flex w-10 items-center justify-center rounded-lg text-brand-600 hover:bg-brand-50"><CalendarDays size={19} aria-hidden="true" /><input type="date" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label={text('เลือกวันครบกำหนดจากปฏิทิน', 'Choose due date from calendar')} value={draft.dueDate} min={task ? undefined : bangkokDate()} onChange={(event) => { set('dueDate', event.target.value); setDueDateText(formatDisplayDate(event.target.value)) }} /></label></div>{creationDateInPast && <p className="mt-1 text-sm text-red-600" role="alert">{text('ไม่สามารถสร้าง Task ในวันที่ผ่านมาแล้ว', 'A task cannot be created in the past.')}</p>}</div><div><label className="field-label" htmlFor="task-time">{text('เวลา (ไม่บังคับ)', 'Time (optional)')}</label><TimeSelect id="task-time" value={draft.dueTime} onChange={(value) => set('dueTime', value)} optional /></div></div>
            </section>
          </fieldset>

          <section className="space-y-3 rounded-xl border border-slate-200 p-4">
            <h3 className="flex items-center gap-2 font-semibold text-slate-800"><UserRound size={18} className="text-amber-700" />{text('ผู้รับมอบหมาย', 'Assignees')}</h3>
            <div role="tablist" aria-label={text('ประเภทผู้รับมอบหมาย', 'Assignee type')} className="grid grid-cols-1 gap-1 rounded-xl bg-slate-100 p-1 sm:grid-cols-3">
              {recipientTabs.map(({ key, label, count }) => <button key={key} type="button" role="tab" id={`task-recipient-tab-${key}`} aria-controls={`task-recipient-panel-${key}`} aria-selected={recipientTab === key} onClick={() => setRecipientTab(key)} className={`rounded-lg px-2 py-2 text-sm font-medium transition-colors ${recipientTab === key ? 'bg-white text-amber-800 shadow-sm' : 'text-slate-600 hover:bg-white/70'}`}>{label}{count > 0 && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{count}</span>}</button>)}
            </div>
            <fieldset disabled={!canEdit || busy || saving} className="disabled:opacity-75">
              {recipientTab === 'self' && <div role="tabpanel" id="task-recipient-panel-self" aria-labelledby="task-recipient-tab-self"><label className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm"><input type="checkbox" checked={selfSelected} onChange={(event) => set('internalUserIds', event.target.checked ? [...draft.internalUserIds, userId] : draft.internalUserIds.filter((id) => id !== userId))} /><span className="min-w-0 flex-1 truncate">{selfProfile ? `${selfProfile.full_name} — ${selfProfile.email}` : text('ฉัน', 'Me')}</span>{details?.internalRecipients.find((recipient) => recipient.user_id === userId)?.acknowledged_at && <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">{text('รับทราบแล้ว', 'Acknowledged')}</span>}</label></div>}
              {recipientTab === 'internal' && <div role="tabpanel" id="task-recipient-panel-internal" aria-labelledby="task-recipient-tab-internal" className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">{profiles.filter((profile) => profile.status === 'active' && profile.id !== userId).map((profile) => <label key={profile.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"><input type="checkbox" checked={draft.internalUserIds.includes(profile.id)} onChange={(event) => set('internalUserIds', event.target.checked ? [...draft.internalUserIds, profile.id] : draft.internalUserIds.filter((id) => id !== profile.id))} /><span className="min-w-0 flex-1 truncate">{profile.full_name} — {profile.email}</span>{details?.internalRecipients.find((recipient) => recipient.user_id === profile.id)?.acknowledged_at && <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">{text('รับทราบแล้ว', 'Acknowledged')}</span>}</label>)}{!profiles.some((profile) => profile.status === 'active' && profile.id !== userId) && <p className="px-2 py-1.5 text-sm text-slate-500">{text('ไม่มีพนักงานอื่นในระบบ', 'There are no other employees in the system.')}</p>}</div>}
              {recipientTab === 'external' && <div role="tabpanel" id="task-recipient-panel-external" aria-labelledby="task-recipient-tab-external" className="space-y-2">{draft.externalEmails.map((email, index) => <div key={index} className="flex items-center gap-2"><input id={index === 0 ? 'external-email' : `external-email-${index + 1}`} type="email" className="field-input min-w-0 flex-1" placeholder="name@gmail.com" value={email} onChange={(event) => setExternalEmail(index, event.target.value)} aria-label={`${text('Gmail ผู้รับภายนอกคนที่', 'External Gmail recipient')} ${index + 1}`} />{details?.externalRecipients.find((recipient) => recipient.email === email.trim().toLowerCase())?.acknowledged_at && <span className="shrink-0 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">{text('รับทราบแล้ว', 'Acknowledged')}</span>}{draft.externalEmails.length > 1 && <button type="button" className="shrink-0 rounded-xl border border-slate-300 p-2.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600" onClick={() => set('externalEmails', draft.externalEmails.filter((_, itemIndex) => itemIndex !== index))} aria-label={`${text('ลบผู้รับภายนอก', 'Remove external recipient')} ${index + 1}`}><X size={18} /></button>}</div>)}<button type="button" className="btn-secondary w-full" onClick={() => set('externalEmails', [...draft.externalEmails, ''])}><Plus size={17} />{text('เพิ่มผู้รับทางอีเมล', 'Add email recipient')}</button></div>}
            </fieldset>
            <p className="text-xs text-slate-500">{text('เลือกได้หลายคนและสลับแท็บได้โดยรายชื่อที่เลือกไว้ยังอยู่ ผู้สร้าง Task เท่านั้นที่ยืนยันว่าเสร็จแล้ว', 'You can select multiple people and switch tabs without losing selections. Only the task creator can mark it complete.')}</p>
          </section>

          <fieldset disabled={!canEdit || busy || saving} className="space-y-5 disabled:opacity-75">
            <div><label className="field-label" htmlFor="linked-event">{text('เชื่อมกับ Meeting (ไม่บังคับ)', 'Link to a meeting (optional)')}</label><select id="linked-event" className="field-input" value={draft.linkedEventId} onChange={(event) => set('linkedEventId', event.target.value)}><option value="">{text('ไม่เชื่อม Meeting', 'No linked meeting')}</option>{events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></div>

            <div className="grid gap-5 md:grid-cols-2">
              <section className="space-y-3 rounded-xl border border-slate-200 p-4"><h3 className="flex items-center gap-2 font-semibold text-slate-800"><Repeat2 size={18} className="text-amber-700" />{text('การทำซ้ำ', 'Recurrence')}</h3><select className="field-input" value={draft.recurrence} onChange={(event) => set('recurrence', event.target.value as Recurrence)}><option value="none">{text('ไม่ทำซ้ำ', 'Does not repeat')}</option><option value="daily">{text('ทุกวัน', 'Daily')}</option><option value="weekdays">{text('ทุกวันทำงาน', 'Weekdays')}</option><option value="weekly">{text('ทุกสัปดาห์', 'Weekly')}</option><option value="monthly">{text('ทุกเดือน', 'Monthly')}</option><option value="yearly">{text('ทุกปี', 'Yearly')}</option></select></section>
              <section className="space-y-3 rounded-xl border border-slate-200 p-4"><h3 className="flex items-center gap-2 font-semibold text-slate-800"><Bell size={18} className="text-amber-700" />{text('การแจ้งเตือน', 'Notifications')}</h3><div className="flex flex-wrap gap-2">{taskReminderOptions.map((option) => <label key={option.key} className={`cursor-pointer rounded-full border px-3 py-2 text-sm ${draft.reminderKeys.includes(option.key) ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-600'}`}><input type="checkbox" className="sr-only" checked={draft.reminderKeys.includes(option.key)} onChange={() => toggleReminder(option.key)} />{text(option.label, ({ due: 'At the due time', '1_hour': '1 hour before', '1_day': '1 day before', '3_days': '3 days before', overdue: 'When overdue' } as const)[option.key])}</label>)}</div><div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={draft.notifyEmail} onChange={(event) => set('notifyEmail', event.target.checked)} /><Mail size={16} />Gmail</label><label className="flex items-center gap-2"><input type="checkbox" checked={draft.notifyLine} disabled={!draft.internalUserIds.length} onChange={(event) => set('notifyLine', event.target.checked)} />LINE</label></div></section>
            </div>

            <section className="space-y-3 rounded-xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800"><Paperclip size={18} className="text-amber-700" />{text('เอกสารประกอบ', 'Supporting documents')}</h3>
              {details?.attachments.map((file) => <div key={file.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"><FileText size={16} /><span className="min-w-0 flex-1 truncate">{file.file_name}</span><span className="text-xs text-slate-400">{(file.file_size / 1024 / 1024).toFixed(1)} MB</span>{file.signedUrl && <a className="font-medium text-brand-600 hover:underline" href={file.signedUrl} download={file.file_name}>{text('ดาวน์โหลด', 'Download')}</a>}{canEdit && <button type="button" className="font-medium text-red-600 hover:underline" disabled={busy} onClick={() => void onDeleteAttachment(file).catch(() => setError(text('ลบเอกสารไม่สำเร็จ', 'Could not delete document.')))} aria-label={`${text('ลบ', 'Delete')} ${file.file_name}`}>{text('ลบ', 'Delete')}</button>}</div>)}
              {details?.documentLinks.map((link) => <div key={link.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"><Link2 size={16} /><a className="truncate font-medium text-brand-600 hover:underline" href={link.url} target="_blank" rel="noreferrer">{link.display_name}</a></div>)}
              {draft.files.map((file, index) => <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm"><FileText size={16} /><span className="truncate">{file.name}</span><button type="button" className="ml-auto text-slate-500 hover:text-red-600" onClick={() => set('files', draft.files.filter((_, itemIndex) => itemIndex !== index))}><X size={16} /></button></div>)}
              <input ref={fileInput} type="file" multiple className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png" onChange={(event) => { const files = [...(event.target.files ?? [])]; const message = validateAttachments([...draft.files, ...files], details?.attachments.length ?? 0); if (message) setError(message); else set('files', [...draft.files, ...files]); event.target.value = '' }} />
              <button type="button" className="btn-secondary" onClick={() => fileInput.current?.click()}><Paperclip size={17} />{text('อัปโหลดไฟล์', 'Upload file')}</button>
              <div className="space-y-2 border-t border-slate-100 pt-3"><p className="flex items-center gap-2 text-sm font-medium"><Link2 size={16} />{text('ลิงก์ Google Drive', 'Google Drive links')}</p>{draft.driveLinks.map((link, index) => <div key={index} className="grid gap-2 sm:grid-cols-[0.8fr_1.5fr_auto]"><input className="field-input" placeholder={text('ชื่อเอกสาร', 'Document name')} value={link.displayName} onChange={(event) => setDriveLink(index, { ...link, displayName: event.target.value })} /><input type="url" className="field-input" placeholder="https://drive.google.com/..." value={link.url} onChange={(event) => setDriveLink(index, { ...link, url: event.target.value })} /><button type="button" className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:text-red-600" onClick={() => set('driveLinks', draft.driveLinks.filter((_, itemIndex) => itemIndex !== index))} aria-label={text('ลบลิงก์', 'Delete link')}><X size={18} /></button></div>)}{draft.driveLinks.length < 10 && <button type="button" className="btn-secondary" onClick={() => set('driveLinks', [...draft.driveLinks, { displayName: '', url: '' }])}><Plus size={17} />{text('เพิ่มลิงก์', 'Add link')}</button>}</div>
            </section>
          </fieldset>

          {task && canViewDeliveryStatus && <NotificationDeliveryStatus deliveries={details?.notificationDeliveries ?? []} acknowledgements={notificationAcknowledgements} onRetry={onRetryNotification} />}

          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4">
            {task && canEdit ? <button type="button" onClick={onDelete} className="btn-secondary border-red-200 text-red-600" disabled={busy}><Trash2 size={17} />{text('ย้ายไปถังขยะ', 'Move to trash')}</button> : <span />}
            <div className="ml-auto flex flex-wrap gap-2"><button type="button" onClick={onClose} className="btn-secondary">{text('ปิด', 'Close')}</button>{task && canAcknowledge && <button type="button" className="btn-secondary" disabled={busy || saving} onClick={onAcknowledge}>{text('รับทราบ', 'Acknowledge')}</button>}{task && canComplete && <button type="button" className="btn-secondary" disabled={busy || saving} onClick={onToggleComplete}><CheckCircle2 size={17} />{task.status === 'completed' ? text('เปิดงานอีกครั้ง', 'Reopen task') : text('ยืนยันว่าทำ Task เสร็จแล้ว', 'Mark task complete')}</button>}{canEdit && (task ? <button type="button" className="btn-primary" disabled={busy || saving} onClick={() => void confirmSave()}>{(busy || saving) && <Loader2 className="animate-spin" size={17} />}{text('บันทึก', 'Save')}</button> : <button className="btn-primary" disabled={busy || saving || creationDateInPast}>{(busy || saving) && <Loader2 className="animate-spin" size={17} />}{text('สร้าง Task', 'Create task')}</button>)}</div>
          </div>
        </form>
      </section>
    </div>
  )
}
