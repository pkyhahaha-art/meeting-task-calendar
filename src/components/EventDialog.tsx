import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bell, CalendarClock, Download, FileText, Loader2, Mail, Paperclip, Plus, Repeat2, Trash2, UserPlus, X } from 'lucide-react'
import Swal from 'sweetalert2'
import { useLanguage } from '../i18n/LanguageProvider'
import type { Database } from '../lib/database.types'
import { bangkokDate, formatDisplayDate, invalidGuestEmails, isPastBangkokDate, meetingRecurrenceFromRule, meetingWeekdayForDate, pastMeetingReminderKeys, reminderOptions, validateAttachments, type MeetingRecurrence, type MeetingRecurrenceFrequency, type MeetingWeekday, type ReminderKey } from '../lib/eventForm'
import { TimeSelect } from './TimeSelect'
import { SaveActionMenu } from './SaveActionMenu'
import { NotificationDeliveryStatus, type DeliveryStatusRow } from './NotificationDeliveryStatus'

type EventRow = Database['public']['Tables']['events']['Row']
type AttachmentRow = Database['public']['Tables']['attachments']['Row']
type AttachmentView = AttachmentRow & { signedUrl: string }
export type OccurrenceReminder = Pick<Database['public']['Tables']['reminders']['Row'], 'id' | 'scheduled_at' | 'channel_email' | 'channel_line' | 'status'>
export type EventDetails = { guestEmails: string[]; guestAcknowledgements: Record<string, string | null>; reminderKeys: ReminderKey[]; notifyEmail: boolean; notifyLine: boolean; attachments: AttachmentView[]; notificationDeliveries: DeliveryStatusRow[]; occurrenceReminders: OccurrenceReminder[]; occurrenceNotificationDeliveries: DeliveryStatusRow[] }
export type EventDraft = Pick<EventRow, 'title' | 'description' | 'location' | 'affiliation' | 'all_day'> & {
  date: string; start: string; end: string; recurrence: MeetingRecurrence; guestEmails: string[]; reminderKeys: ReminderKey[]
  sendImmediate: boolean; notifyEmail: boolean; notifyLine: boolean; files: File[]
}

const blankDraft = (date?: string): EventDraft => ({
  title: '', description: '', location: '', affiliation: '', all_day: false,
  date: date ?? bangkokDate(), start: '09:00', end: '10:00',
  recurrence: { frequency: 'none', interval: 1, weekdays: [], until: '', count: null }, guestEmails: [''], reminderKeys: ['1:day'], sendImmediate: true, notifyEmail: true, notifyLine: false, files: [],
})

const weekdayOptions: { value: MeetingWeekday; thai: string; english: string }[] = [
  { value: 'MO', thai: 'จ', english: 'Mon' }, { value: 'TU', thai: 'อ', english: 'Tue' }, { value: 'WE', thai: 'พ', english: 'Wed' },
  { value: 'TH', thai: 'พฤ', english: 'Thu' }, { value: 'FR', thai: 'ศ', english: 'Fri' }, { value: 'SA', thai: 'ส', english: 'Sat' }, { value: 'SU', thai: 'อา', english: 'Sun' },
]

function quickRecurrence(value: string, date: string): MeetingRecurrence {
  const weekday = meetingWeekdayForDate(date)
  if (value === 'daily') return { frequency: 'day', interval: 1, weekdays: [], until: '', count: null }
  if (value === 'weekdays') return { frequency: 'week', interval: 1, weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'], until: '', count: null }
  if (value === 'weekly' || value === 'biweekly') return { frequency: 'week', interval: value === 'biweekly' ? 2 : 1, weekdays: [weekday], until: '', count: null }
  if (value === 'monthly') return { frequency: 'month', interval: 1, weekdays: [], until: '', count: null }
  if (value === 'yearly') return { frequency: 'year', interval: 1, weekdays: [], until: '', count: null }
  return { frequency: 'none', interval: 1, weekdays: [], until: '', count: null }
}

function recurrencePreset(value: MeetingRecurrence, date: string) {
  if (value.frequency === 'none') return 'none'
  if (value.frequency === 'day' && value.interval === 1 && !value.until && !value.count) return 'daily'
  if (value.frequency === 'week' && value.interval === 1 && !value.until && !value.count) {
    if (value.weekdays.join(',') === 'MO,TU,WE,TH,FR') return 'weekdays'
    if (value.weekdays.length === 1 && value.weekdays[0] === meetingWeekdayForDate(date)) return 'weekly'
  }
  if (value.frequency === 'week' && value.interval === 2 && value.weekdays.length === 1 && value.weekdays[0] === meetingWeekdayForDate(date) && !value.until && !value.count) return 'biweekly'
  if (value.frequency === 'month' && value.interval === 1 && !value.until && !value.count) return 'monthly'
  if (value.frequency === 'year' && value.interval === 1 && !value.until && !value.count) return 'yearly'
  return 'custom'
}

function localTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value
  return `${read('hour')}:${read('minute')}`
}

export function EventDialog({ open, event, details, selectedDate, occurrenceStart, canEdit, canViewDeliveryStatus, busy, onClose, onSave, onDelete, onDeleteAttachment, onRetryNotification }: {
  open: boolean; event: EventRow | null; details?: EventDetails; selectedDate?: string; occurrenceStart?: string; canEdit: boolean; busy: boolean
  onClose: () => void; onSave: (draft: EventDraft, notifyRecipients: boolean) => Promise<void>; onDelete: () => Promise<void>
  onDeleteAttachment: (attachment: AttachmentRow) => Promise<void>
  canViewDeliveryStatus: boolean; onRetryNotification: (deliveryId: string) => Promise<void>
}) {
  const { language, text } = useLanguage()
  const [draft, setDraft] = useState<EventDraft>(blankDraft(selectedDate))
  const [customRecurrence, setCustomRecurrence] = useState<MeetingRecurrence | null>(null)
  const [error, setError] = useState('')
  const [savingNew, setSavingNew] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const initializedDraft = useRef<string | null>(null)
  useEffect(() => {
    if (!open) { initializedDraft.current = null; return }
    if (event && !details) return
    const key = event?.id ?? `new:${selectedDate ?? ''}`
    if (initializedDraft.current === key) return
    initializedDraft.current = key
    setError('')
    setDraft(event ? {
      title: event.title, description: event.description, location: event.location, affiliation: event.affiliation, all_day: event.all_day,
      date: bangkokDate(new Date(event.start_datetime)), start: localTime(event.start_datetime), end: event.all_day ? '' : localTime(event.end_datetime),
      recurrence: meetingRecurrenceFromRule(event.recurrence_rule, bangkokDate(new Date(event.start_datetime)), event.recurrence_until, event.recurrence_count), guestEmails: details?.guestEmails.length ? details.guestEmails : [''],
      reminderKeys: details?.reminderKeys ?? [], sendImmediate: false, notifyEmail: details?.notifyEmail ?? true,
      notifyLine: details?.notifyLine ?? false, files: [],
    } : blankDraft(selectedDate))
  }, [event, details, selectedDate, open])
  if (!open) return null
  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const setGuestEmail = (index: number, value: string) => set('guestEmails', draft.guestEmails.map((email, itemIndex) => itemIndex === index ? value : email))
  const toggleReminder = (key: ReminderKey) => set('reminderKeys', draft.reminderKeys.includes(key) ? draft.reminderKeys.filter((item) => item !== key) : [...draft.reminderKeys, key])
  const creationDateInPast = !event && isPastBangkokDate(draft.date)
  const reminderStart = new Date(`${draft.date}T${draft.all_day ? '00:00' : draft.start || '00:00'}:00+07:00`)
  const expiredReminderKeys = Number.isNaN(reminderStart.getTime()) ? [] : pastMeetingReminderKeys(reminderStart, draft.reminderKeys)
  const reminderLabel = (key: ReminderKey) => text(({ '0:minute': 'เมื่อถึงเวลานัด', '1:month': '1 เดือนก่อน', '1:week': '1 สัปดาห์ก่อน', '3:day': '3 วันก่อน', '1:day': '1 วันก่อน' } as const)[key], ({ '0:minute': 'At the meeting time', '1:month': '1 month before', '1:week': '1 week before', '3:day': '3 days before', '1:day': '1 day before' } as const)[key])
  const expiredReminderLabels = expiredReminderKeys.map(reminderLabel).join(', ')
  const openCustomRecurrence = () => {
    const recurrence = draft.recurrence.frequency === 'none' ? quickRecurrence('weekly', draft.date) : draft.recurrence
    setCustomRecurrence({ ...recurrence, weekdays: [...recurrence.weekdays] })
  }
  const save = async (notifyRecipients: boolean) => {
    if (!draft.title.trim() || !draft.date || (!draft.all_day && !draft.start)) { setError(text('กรุณากรอกชื่อและเวลาเริ่ม', 'Enter a title and start time.')); return false }
    if (creationDateInPast) { setError(text('ไม่สามารถสร้าง Meeting ในวันที่ผ่านมาแล้ว', 'A meeting cannot be created in the past.')); return false }
    if (!draft.all_day && draft.end && draft.end < draft.start) { setError(text('เวลาสิ้นสุดต้องไม่ก่อนเวลาเริ่ม', 'The end time cannot be earlier than the start time.')); return false }
    if (draft.recurrence.until && draft.recurrence.until < draft.date) { setError(text('วันสิ้นสุดการทำซ้ำต้องไม่ก่อนวันนัดหมาย', 'The recurrence end date cannot be before the meeting date.')); return false }
    if (draft.sendImmediate && !draft.notifyEmail) { setError(text('การส่งคำเชิญทันทีต้องเปิดการแจ้งเตือนทาง Email', 'Sending an invitation immediately requires Email notifications.')); return false }
    if (expiredReminderKeys.length) {
      const result = await Swal.fire({
        icon: 'warning', title: text('Reminder ที่จะไม่ส่งย้อนหลัง', 'Reminders that will not be sent'),
        text: text(expiredReminderLabels, expiredReminderLabels),
        showCancelButton: true, confirmButtonText: text('บันทึกโดยไม่ส่งย้อนหลัง', 'Save without sending'), cancelButtonText: text('แก้ไข', 'Edit'), reverseButtons: true,
      })
      if (!result.isConfirmed) return false
    }
    const invalidEmails = invalidGuestEmails(draft.guestEmails)
    if (invalidEmails.length) { setError(text(`อีเมลไม่ถูกต้อง: ${invalidEmails.join(', ')}`, `Invalid email: ${invalidEmails.join(', ')}`)); return false }
    const attachmentError = validateAttachments(draft.files, details?.attachments.length ?? 0)
    if (attachmentError) { setError(attachmentError); return false }
    if (draft.reminderKeys.length && !draft.notifyEmail && !draft.notifyLine) { setError(text('กรุณาเลือกช่องทางแจ้งเตือนอย่างน้อย 1 ช่องทาง', 'Choose at least one notification channel.')); return false }
    setError('')
    try {
      await onSave(draft, notifyRecipients)
      return true
    } catch (error) {
      setError(error instanceof Error && error.message.startsWith('เซสชันหมดอายุ') ? error.message : text('บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 'Could not save. Please try again.'))
      return false
    }
  }
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    void (async () => {
      setSavingNew(true)
      try {
        if (await save(!event) && !event) {
          await Swal.fire({ icon: 'success', title: text('สำเร็จ', 'Success'), text: text('สร้างการประชุมเรียบร้อยแล้ว', 'Meeting created.'), showConfirmButton: false, timer: 2000, timerProgressBar: true })
          onClose()
        }
      } finally { setSavingNew(false) }
    })()
  }
  const viewedOccurrenceDate = occurrenceStart ? bangkokDate(new Date(occurrenceStart)) : ''
  const isViewingLaterOccurrence = Boolean(event && viewedOccurrenceDate && viewedOccurrenceDate !== bangkokDate(new Date(event.start_datetime)))
  const occurrenceDateTime = occurrenceStart ? new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'medium', timeStyle: event?.all_day ? undefined : 'short', timeZone: 'Asia/Bangkok' }).format(new Date(occurrenceStart)) : ''
  const reminderStatus = (status: OccurrenceReminder['status']) => text(({ scheduled: 'กำหนดส่ง', processing: 'กำลังจัดคิว', completed: 'จัดคิวส่งแล้ว', cancelled: 'ข้ามการส่ง' } as const)[status], ({ scheduled: 'Scheduled', processing: 'Queueing', completed: 'Queued', cancelled: 'Skipped' } as const)[status])
  return (
    <>
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/35 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="event-title">
      <section className="max-h-[95vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between"><div className="flex gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><CalendarClock size={22} /></span><div><h2 id="event-title" className="text-xl font-bold">{event ? text('รายละเอียดการประชุม', 'Meeting details') : text('เพิ่มการประชุม', 'Add meeting')}</h2>{event && !canEdit && <p className="text-sm text-slate-500">{text('ดูได้อย่างเดียว เฉพาะเจ้าของเท่านั้นที่แก้ไขได้', 'View only. Only the owner can edit this meeting.')}</p>}</div></div><div className="flex items-center gap-2">{event && <p className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{text('สร้างโดย', 'Created by')} {event.creator_name || text('ไม่ระบุชื่อ', 'Unknown')}</p>}<button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label={text('ปิด', 'Close')}><X size={20} /></button></div></div>
        <form onSubmit={submit} className="space-y-5">
          {isViewingLaterOccurrence && <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-950"><p className="font-semibold">{text('รอบนัดหมายที่กำลังดู', 'Meeting occurrence being viewed')}: {text(`${formatDisplayDate(viewedOccurrenceDate)} เวลา ${localTime(occurrenceStart!)} น.`, `${formatDisplayDate(viewedOccurrenceDate)} at ${localTime(occurrenceStart!)}`)}</p><p className="mt-1 text-xs text-brand-800">{text('ฟอร์มด้านล่างใช้แก้ไขทั้งชุดนัดหมาย วันเริ่มชุดจะแสดงแยกไว้เพื่อไม่ให้สับสน', 'The form below edits the whole series. Its start date is shown separately to avoid confusion.')}</p></div>}
          <fieldset disabled={!canEdit || busy || savingNew} className="space-y-5 disabled:opacity-75">
            <section className="space-y-4 rounded-xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800"><FileText size={18} className="text-brand-600" />{text('ข้อมูลการประชุม', 'Meeting details')}</h3>
              <div><label className="field-label" htmlFor="title">{text('ชื่อการประชุม *', 'Meeting title *')}</label><input id="title" className="field-input" value={draft.title} onChange={(e) => set('title', e.target.value)} maxLength={180} /></div>
              <div><label className="field-label" htmlFor="event-affiliation">{text('หน่วยงาน / สังกัด', 'Department / affiliation')}</label><input id="event-affiliation" className="field-input" placeholder={text('กคน.ฝลส.', 'e.g. Department')} value={draft.affiliation} onChange={(e) => set('affiliation', e.target.value)} maxLength={250} /></div>
              <div><span className="field-label">{text(isViewingLaterOccurrence ? 'วันเริ่มชุดนัดหมาย' : 'วันที่นัดหมาย', isViewingLaterOccurrence ? 'Series start date' : 'Meeting date')}</span><p className={`rounded-xl border px-3 py-2.5 text-sm ${creationDateInPast ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>{formatDisplayDate(draft.date)}</p>{creationDateInPast && <p className="mt-1 text-sm text-red-600" role="alert">{text('ไม่สามารถสร้าง Meeting ในวันที่ผ่านมาแล้ว กรุณาเลือกวันปัจจุบันหรือวันถัดไปจากปฏิทิน', 'A meeting cannot be created in the past. Choose today or a later date in the calendar.')}</p>}</div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={draft.all_day} onChange={(e) => { set('all_day', e.target.checked); if (e.target.checked) set('end', '') }} className="h-4 w-4 rounded border-slate-300 text-brand-600" />{text('ทั้งวัน', 'All day')}</label>
              {!draft.all_day && <div className="grid gap-4 sm:grid-cols-2"><div><label className="field-label" htmlFor="start">{text('เริ่ม *', 'Start *')}</label><TimeSelect id="start" value={draft.start} onChange={(value) => set('start', value)} /></div><div><label className="field-label" htmlFor="end">{text('สิ้นสุด (ไม่บังคับ)', 'End (optional)')}</label><TimeSelect id="end" value={draft.end} onChange={(value) => set('end', value)} optional /></div></div>}
              <div><label className="field-label" htmlFor="location">{text('สถานที่ / ห้องประชุม / ลิงก์ออนไลน์', 'Location / meeting room / online link')}</label><input id="location" className="field-input" value={draft.location} onChange={(e) => set('location', e.target.value)} maxLength={250} /></div>
              <div><label className="field-label" htmlFor="description">{text('รายละเอียด / วาระการประชุม', 'Details / agenda')}</label><textarea id="description" className="field-input min-h-28 resize-y" value={draft.description} onChange={(e) => set('description', e.target.value)} maxLength={10000} /></div>
            </section>

            {!event && <section className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/40 p-4"><h3 className="flex items-center gap-2 font-semibold text-slate-800"><Mail size={18} className="text-brand-600" />{text('การส่งเมื่อบันทึก', 'Send when saved')}</h3><label className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={draft.sendImmediate} onChange={(e) => set('sendImmediate', e.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600" /><span><span className="block text-sm font-semibold text-slate-800">{text('ส่งคำเชิญทันทีหลังบันทึก', 'Send invitation immediately after saving')}</span><span className="mt-0.5 block text-xs text-slate-600">{text('ส่งครั้งเดียว ไม่ทำซ้ำตามกำหนดการ', 'Sent once only; it does not repeat with the schedule.')}</span></span></label></section>}

            <div className="grid gap-5 md:grid-cols-2">
              <section className="space-y-3 rounded-xl border border-slate-200 p-4"><h3 className="flex items-center gap-2 font-semibold text-slate-800"><Repeat2 size={18} className="text-brand-600" />{text('การทำซ้ำ', 'Recurrence')}</h3><select className="field-input" value={recurrencePreset(draft.recurrence, draft.date)} onChange={(e) => { if (e.target.value === 'custom') openCustomRecurrence(); else set('recurrence', quickRecurrence(e.target.value, draft.date)) }} aria-label={text('การทำซ้ำ', 'Recurrence')}><option value="none">{text('ไม่ทำซ้ำ', 'Does not repeat')}</option><option value="daily">{text('ทุกวัน', 'Daily')}</option><option value="weekdays">{text('ทุกวันทำงาน (จันทร์–ศุกร์)', 'Weekdays (Monday–Friday)')}</option><option value="weekly">{text('ทุกสัปดาห์', 'Weekly')}</option><option value="biweekly">{text('ทุก 2 สัปดาห์', 'Every 2 weeks')}</option><option value="monthly">{text('ทุกเดือน', 'Monthly')}</option><option value="yearly">{text('ทุกปี', 'Yearly')}</option><option value="custom">{text('กำหนดเอง…', 'Custom…')}</option></select>{recurrencePreset(draft.recurrence, draft.date) === 'custom' && <button type="button" className="text-sm font-semibold text-brand-700 hover:text-brand-800" onClick={openCustomRecurrence}>{text('แก้ไขรูปแบบกำหนดเอง', 'Edit custom recurrence')}</button>}</section>
              <section className="space-y-3 rounded-xl border border-slate-200 p-4"><h3 className="flex items-center gap-2 font-semibold text-slate-800"><UserPlus size={18} className="text-brand-600" />{text('ผู้เข้าร่วม (ไม่บังคับ)', 'Attendees (optional)')}</h3><div className="space-y-2">{draft.guestEmails.map((email, index) => <div key={index} className="flex items-center gap-2"><input type="email" className="field-input min-w-0 flex-1" value={email} onChange={(e) => setGuestEmail(index, e.target.value)} placeholder="name@gmail.com" aria-label={`${text('Attendee Gmail', 'Attendee Gmail')} ${index + 1}`} />{details?.guestAcknowledgements[email.trim().toLowerCase()] && <span className="shrink-0 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">{text('รับทราบแล้ว', 'Acknowledged')}</span>}{draft.guestEmails.length > 1 && <button type="button" className="shrink-0 rounded-xl border border-slate-300 p-2.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600" onClick={() => set('guestEmails', draft.guestEmails.filter((_, itemIndex) => itemIndex !== index))} aria-label={`${text('ลบผู้เข้าร่วม', 'Remove attendee')} ${index + 1}`}><X size={18} /></button>}</div>)}</div><button type="button" className="btn-secondary w-full" onClick={() => set('guestEmails', [...draft.guestEmails, ''])}><Plus size={17} />{text('เพิ่มผู้เข้าร่วมอีกคน', 'Add another attendee')}</button><p className="text-xs text-slate-500">{text('ผู้เข้าร่วมกดรับทราบจากลิงก์ในอีเมลได้', 'Attendees can acknowledge from the link in their email.')}</p></section>
            </div>

            <section className="space-y-4 rounded-xl border border-slate-200 p-4"><h3 className="flex items-center gap-2 font-semibold text-slate-800"><Bell size={18} className="text-brand-600" />{text('การแจ้งเตือน', 'Notifications')}</h3><div className="flex flex-wrap gap-2">{reminderOptions.map((option) => <label key={option.key} className={`cursor-pointer rounded-full border px-3 py-2 text-sm ${draft.reminderKeys.includes(option.key) ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-600'}`}><input type="checkbox" className="sr-only" checked={draft.reminderKeys.includes(option.key)} onChange={() => toggleReminder(option.key)} />{text(option.label, ({ '0:minute': 'At the time', '1:month': '1 month before', '1:week': '1 week before', '3:day': '3 days before', '1:day': '1 day before' } as const)[option.key])}</label>)}</div><div className="flex flex-wrap gap-5 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={draft.notifyEmail} onChange={(e) => set('notifyEmail', e.target.checked)} className="h-4 w-4 rounded" /><Mail size={17} />Gmail / Email</label><label className="flex items-center gap-2"><input type="checkbox" checked={draft.notifyLine} onChange={(e) => set('notifyLine', e.target.checked)} className="h-4 w-4 rounded" />LINE</label></div><p className="text-xs text-slate-500">{text('LINE ใช้งานได้หลังจากเชื่อมบัญชีในหน้าโปรไฟล์', 'LINE is available after you connect your account in Profile.')}</p></section>

            <section className="space-y-3 rounded-xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800"><Paperclip size={18} className="text-brand-600" />{text('ไฟล์แนบ', 'Attachments')}</h3>
              {details?.attachments.map((file) => <div key={file.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"><FileText size={16} /><span className="min-w-0 flex-1 truncate">{file.file_name}</span><span className="shrink-0 text-xs text-slate-400">{(file.file_size / 1024 / 1024).toFixed(1)} MB</span><a className="btn-secondary shrink-0" href={file.signedUrl} download={file.file_name}><Download size={17} />{text('ดาวน์โหลด', 'Download')}</a>{canEdit && <button type="button" className="btn-secondary shrink-0 border-red-200 text-red-600" disabled={busy} onClick={() => void onDeleteAttachment(file).catch(() => setError(text('ลบไฟล์แนบไม่สำเร็จ', 'Could not delete attachment.')))} aria-label={`${text('ลบ', 'Delete')} ${file.file_name}`}><Trash2 size={16} />{text('ลบ', 'Delete')}</button>}</div>)}
              {canEdit && <>{draft.files.map((file, index) => <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm"><FileText size={16} /><span className="truncate">{file.name}</span><button type="button" className="ml-auto text-slate-500 hover:text-red-600" onClick={() => set('files', draft.files.filter((_, itemIndex) => itemIndex !== index))} aria-label={`${text('นำ', 'Remove')} ${file.name} ${text('ออก', '')}`}><X size={16} /></button></div>)}<input ref={fileInput} type="file" multiple className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png" onChange={(e) => { const files = [...(e.target.files ?? [])]; const message = validateAttachments([...draft.files, ...files], details?.attachments.length ?? 0); if (message) setError(message); else { setError(''); set('files', [...draft.files, ...files]) }; e.target.value = '' }} /><button type="button" className="btn-secondary" onClick={() => fileInput.current?.click()}><Paperclip size={17} />{text('อัปโหลดเอกสาร', 'Upload document')}</button><p className="text-xs text-slate-500">{text('สูงสุด 5 ไฟล์ ไฟล์ละไม่เกิน 10 MB: PDF, Office, JPG และ PNG', 'Up to 5 files, 10 MB each: PDF, Office, JPG, and PNG.')}</p></>}
            </section>
          </fieldset>
          {event && occurrenceStart && <section className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/40 p-4"><div><h3 className="flex items-center gap-2 font-semibold text-brand-950"><Bell size={18} className="text-brand-600" />{text('Reminder ของรอบที่กำลังดู', 'Reminder for this occurrence')}</h3><p className="mt-1 text-xs text-brand-800">{occurrenceDateTime}</p></div>{!details?.occurrenceReminders.length && <p className="rounded-lg bg-white/70 px-3 py-3 text-sm text-slate-600">{text('ไม่มี Reminder ที่ตั้งไว้สำหรับรอบนี้', 'No reminder is scheduled for this occurrence.')}</p>}<div className="space-y-2">{details?.occurrenceReminders.map((reminder) => <div key={reminder.id} className="rounded-lg bg-white/80 px-3 py-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-slate-800">{text('กำหนดส่ง', 'Scheduled')} {new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(reminder.scheduled_at))}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{reminderStatus(reminder.status)}</span></div><p className="mt-1 text-xs text-slate-600">{[reminder.channel_email && 'Email', reminder.channel_line && 'LINE'].filter(Boolean).join(' · ')}</p></div>)}</div>{canViewDeliveryStatus && <NotificationDeliveryStatus deliveries={details?.occurrenceNotificationDeliveries ?? []} acknowledgements={details?.guestAcknowledgements ?? {}} onRetry={onRetryNotification} title={{ thai: 'ผลการส่ง Reminder รอบนี้', english: 'Delivery for this occurrence' }} description={{ thai: 'แสดงเฉพาะการส่งที่ผูกกับ Reminder ของวันที่ด้านบน', english: 'Shows only deliveries linked to the reminder above.' }} emptyMessage={{ thai: 'Reminder นี้ยังไม่ถึงเวลาส่ง หรือยังไม่มีผลการส่ง', english: 'This reminder is not due yet or has no delivery result.' }} />}</section>}
          {event && canViewDeliveryStatus && <NotificationDeliveryStatus deliveries={details?.notificationDeliveries ?? []} acknowledgements={details?.guestAcknowledgements ?? {}} onRetry={onRetryNotification} title={{ thai: 'การส่งระดับชุดนัดหมาย', english: 'Series-level notifications' }} description={{ thai: 'คำเชิญและการแจ้งแก้ไขของทั้งชุด ไม่นับ Reminder รายรอบ', english: 'Invitations and series updates; occurrence reminders are excluded.' }} emptyMessage={{ thai: 'ยังไม่มีคำเชิญหรือการแจ้งแก้ไขของชุดนัดหมายนี้', english: 'There are no invitations or series updates yet.' }} />}
          {expiredReminderKeys.length > 0 && <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert"><AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={18} /><span>{text(`ระบบจะไม่ส่งย้อนหลัง: ${expiredReminderLabels}`, `Will not be sent retroactively: ${expiredReminderLabels}`)}</span></p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4">{event && canEdit ? <button type="button" onClick={onDelete} className="btn-secondary border-red-200 text-red-600 hover:bg-red-50" disabled={busy}><Trash2 size={17} />{text('ลบ', 'Delete')}</button> : <span />}<div className="ml-auto flex gap-2"><button type="button" onClick={onClose} className="btn-secondary">{canEdit ? text('ยกเลิก', 'Cancel') : text('ปิด', 'Close')}</button>{canEdit && (event ? <SaveActionMenu busy={busy} onSave={save} onComplete={onClose} /> : <button className="btn-primary" disabled={busy || savingNew || creationDateInPast}>{(busy || savingNew) && <Loader2 className="animate-spin" size={17} />}{text('สร้างการประชุม', 'Create meeting')}</button>)}</div></div>
        </form>
      </section>
    </div>
    {customRecurrence && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="custom-recurrence-title">
      <section className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <h2 id="custom-recurrence-title" className="text-xl font-bold text-slate-900">{text('กำหนดการทำซ้ำเอง', 'Custom recurrence')}</h2>
        <div className="mt-5 space-y-5">
          <div className="flex items-center gap-3"><span className="text-sm text-slate-600">{text('เกิดทุก', 'Repeat every')}</span><input className="field-input w-20" type="number" min="1" max="99" value={customRecurrence.interval} onChange={(e) => setCustomRecurrence({ ...customRecurrence, interval: Math.max(1, Number(e.target.value) || 1) })} /><select className="field-input flex-1" value={customRecurrence.frequency} onChange={(e) => { const frequency = e.target.value as MeetingRecurrenceFrequency; setCustomRecurrence({ ...customRecurrence, frequency, weekdays: frequency === 'week' ? (customRecurrence.weekdays.length ? customRecurrence.weekdays : [meetingWeekdayForDate(draft.date)]) : [] }) }}><option value="day">{text('วัน', 'day(s)')}</option><option value="week">{text('สัปดาห์', 'week(s)')}</option><option value="month">{text('เดือน', 'month(s)')}</option><option value="year">{text('ปี', 'year(s)')}</option></select></div>
          {customRecurrence.frequency === 'week' && <div><p className="mb-2 text-sm font-medium text-slate-700">{text('ทำซ้ำในวัน', 'Repeat on')}</p><div className="flex flex-wrap gap-2">{weekdayOptions.map((day) => { const selected = customRecurrence.weekdays.includes(day.value); return <button key={day.value} type="button" onClick={() => setCustomRecurrence({ ...customRecurrence, weekdays: selected ? customRecurrence.weekdays.filter((value) => value !== day.value) : [...customRecurrence.weekdays, day.value] })} className={`rounded-lg px-3 py-2 text-sm font-semibold ${selected ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-brand-50'}`}>{text(day.thai, day.english)}</button> })}</div></div>}
          <fieldset><legend className="mb-2 text-sm font-medium text-slate-700">{text('สิ้นสุด', 'Ends')}</legend><div className="space-y-3 text-sm text-slate-700"><label className="flex items-center gap-2"><input type="radio" name="recurrence-end" checked={!customRecurrence.until && !customRecurrence.count} onChange={() => setCustomRecurrence({ ...customRecurrence, until: '', count: null })} />{text('ไม่สิ้นสุด', 'Never')}</label><label className="flex items-center gap-2"><input type="radio" name="recurrence-end" checked={Boolean(customRecurrence.until)} onChange={() => setCustomRecurrence({ ...customRecurrence, until: customRecurrence.until || draft.date, count: null })} />{text('วันที่', 'On date')}<input className="field-input ml-auto w-40" type="date" disabled={!customRecurrence.until} min={draft.date} value={customRecurrence.until} onChange={(e) => setCustomRecurrence({ ...customRecurrence, until: e.target.value, count: null })} /></label><label className="flex items-center gap-2"><input type="radio" name="recurrence-end" checked={Boolean(customRecurrence.count)} onChange={() => setCustomRecurrence({ ...customRecurrence, until: '', count: customRecurrence.count || 1 })} />{text('หลังจาก', 'After')}<input className="field-input ml-auto w-20" type="number" min="1" max="999" disabled={!customRecurrence.count} value={customRecurrence.count ?? ''} onChange={(e) => setCustomRecurrence({ ...customRecurrence, until: '', count: Math.max(1, Number(e.target.value) || 1) })} />{text('ครั้ง', 'occurrences')}</label></div></fieldset>
        </div>
        <div className="mt-6 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setCustomRecurrence(null)}>{text('ยกเลิก', 'Cancel')}</button><button type="button" className="btn-primary" onClick={() => { if (customRecurrence.frequency === 'week' && !customRecurrence.weekdays.length) return; set('recurrence', customRecurrence); setCustomRecurrence(null) }}>{text('เสร็จสิ้น', 'Done')}</button></div>
      </section>
    </div>}
    </>
  )
}
