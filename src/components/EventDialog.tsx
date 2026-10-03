import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bell, CalendarClock, ChevronDown, Download, FileText, Loader2, Mail, Paperclip, Plus, Repeat2, Smartphone, Sparkles, Trash2, UserPlus, X } from 'lucide-react'
import Swal from 'sweetalert2'
import { useLanguage } from '../i18n/LanguageProvider'
import type { Database } from '../lib/database.types'
import {
  bangkokDate,
  daysBetweenBangkokDates,
  endOfYearBangkokDate,
  formatDisplayDate,
  invalidGuestEmails,
  isMeetingReminderKeyPast,
  isPastBangkokDate,
  meetingRecurrenceFromRule,
  meetingRecurrenceSummary,
  meetingReminderOptionLabel,
  meetingWeekdayForDate,
  pastMeetingReminderKeys,
  reminderOptions,
  validateAttachments,
  weekdayEnglishFull,
  weekdayEnglishShort,
  weekdayThaiFull,
  weekdayThaiShort,
  type MeetingRecurrence,
  type MeetingRecurrenceFrequency,
  type MeetingWeekday,
  type ReminderKey,
} from '../lib/eventForm'
import { TimeSelect } from './TimeSelect'
import { SaveActionMenu } from './SaveActionMenu'
import { NotificationDeliveryStatus, type DeliveryStatusRow } from './NotificationDeliveryStatus'

type EventRow = Database['public']['Tables']['events']['Row']
type AttachmentRow = Database['public']['Tables']['attachments']['Row']
type AttachmentView = AttachmentRow & { signedUrl: string }
export type OccurrenceReminder = Pick<Database['public']['Tables']['reminders']['Row'], 'id' | 'scheduled_at' | 'channel_email' | 'channel_line' | 'status'>
export type EventDetails = {
  guestEmails: string[]
  occurrenceGuestEmails: string[]
  guestAcknowledgements: Record<string, string | null>
  reminderKeys: ReminderKey[]
  notifyEmail: boolean
  notifyLine: boolean
  attachments: AttachmentView[]
  occurrenceId: string | null
  occurrenceOverride: { description?: string; location?: string } | null
  hasOccurrenceChanges: boolean
  notificationDeliveries: DeliveryStatusRow[]
  occurrenceReminders: OccurrenceReminder[]
  occurrenceNotificationDeliveries: DeliveryStatusRow[]
}
export type EventDraft = Pick<EventRow, 'title' | 'description' | 'location' | 'affiliation' | 'all_day'> & {
  date: string
  start: string
  end: string
  recurrence: MeetingRecurrence
  guestEmails: string[]
  reminderKeys: ReminderKey[]
  sendImmediate: boolean
  notifyEmail: boolean
  notifyLine: boolean
  files: File[]
}

const blankDraft = (date?: string): EventDraft => {
  const targetDate = date ?? bangkokDate()
  const daysDiff = daysBetweenBangkokDates(bangkokDate(), targetDate)
  const defaultReminderKeys: ReminderKey[] = daysDiff >= 1 ? ['1:day'] : ['0:minute']

  return {
    title: '',
    description: '',
    location: '',
    affiliation: '',
    all_day: false,
    date: targetDate,
    start: '09:00',
    end: '10:00',
    recurrence: { frequency: 'none', interval: 1, weekdays: [], until: '', count: null },
    guestEmails: [''],
    reminderKeys: defaultReminderKeys,
    sendImmediate: true,
    notifyEmail: true,
    notifyLine: false,
    files: [],
  }
}

const weekdayOrder: MeetingWeekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']


function localTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value
  return `${read('hour')}:${read('minute')}`
}

export function EventDialog({
  open,
  event,
  details,
  selectedDate,
  occurrenceStart,
  canEdit,
  canViewDeliveryStatus,
  hasConnectedDevices = false,
  busy,
  onClose,
  onSave,
  onDelete,
  onDeleteAttachment,
  onRetryNotification,
}: {
  open: boolean
  event: EventRow | null
  details?: EventDetails
  selectedDate?: string
  occurrenceStart?: string
  canEdit: boolean
  busy: boolean
  hasConnectedDevices?: boolean
  onClose: () => void
  onSave: (draft: EventDraft, notifyRecipients: boolean, scope: 'series' | 'occurrence') => Promise<void>
  onDelete: () => Promise<void>
  onDeleteAttachment: (attachment: AttachmentRow) => Promise<void>
  canViewDeliveryStatus: boolean
  onRetryNotification: (deliveryId: string) => Promise<void>
}) {
  const { language, text } = useLanguage()
  const [draft, setDraft] = useState<EventDraft>(blankDraft(selectedDate))
  const [editScope, setEditScope] = useState<'series' | 'occurrence'>('series')
  const [endMode, setEndMode] = useState<'end_of_year' | 'until_date' | 'count'>('end_of_year')
  const [error, setError] = useState('')
  const [savingNew, setSavingNew] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const initializedDraft = useRef<string | null>(null)

  useEffect(() => {
    if (!open) {
      initializedDraft.current = null
      return
    }
    if (event && !details) return
    const key = event ? `${event.id}:${occurrenceStart ?? ''}` : `new:${selectedDate ?? ''}`
    if (initializedDraft.current === key) return
    initializedDraft.current = key
    setError('')
    const useOccurrenceValues = Boolean(event && occurrenceStart && details?.hasOccurrenceChanges)
    setEditScope(useOccurrenceValues ? 'occurrence' : 'series')
    const initialRecurrence = event
      ? meetingRecurrenceFromRule(event.recurrence_rule, bangkokDate(new Date(event.start_datetime)), event.recurrence_until, event.recurrence_count)
      : blankDraft(selectedDate).recurrence
    const initialEndOfYear = endOfYearBangkokDate(event ? bangkokDate(new Date(event.start_datetime)) : (selectedDate ?? bangkokDate()))
    setEndMode(
      initialRecurrence.count && initialRecurrence.count > 0
        ? 'count'
        : initialRecurrence.until && initialRecurrence.until !== initialEndOfYear
        ? 'until_date'
        : 'end_of_year',
    )
    setDraft(
      event
        ? {
            title: event.title,
            description: useOccurrenceValues && details?.occurrenceOverride?.description !== undefined ? details.occurrenceOverride.description : event.description,
            location: useOccurrenceValues && details?.occurrenceOverride?.location !== undefined ? details.occurrenceOverride.location : event.location,
            affiliation: event.affiliation,
            all_day: event.all_day,
            date: bangkokDate(new Date(event.start_datetime)),
            start: localTime(event.start_datetime) || '09:00',
            end: event.all_day ? '' : (localTime(event.end_datetime) || ''),
            recurrence: initialRecurrence,
            guestEmails: useOccurrenceValues ? (details?.occurrenceGuestEmails.length ? details.occurrenceGuestEmails : ['']) : (details?.guestEmails.length ? details.guestEmails : ['']),
            reminderKeys: details?.reminderKeys ?? [],
            sendImmediate: false,
            notifyEmail: details?.notifyEmail ?? true,
            notifyLine: hasConnectedDevices ? (details?.notifyLine ?? false) : false,
            files: [],
          }
        : blankDraft(selectedDate),
    )
  }, [event, details, selectedDate, occurrenceStart, open])

  if (!open) return null

  if (event && !details) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true">
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-8 shadow-2xl">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
          <p className="text-sm font-semibold text-slate-700">{text('กำลังโหลดข้อมูลการประชุม...', 'Loading meeting details...')}</p>
        </div>
      </div>
    )
  }

  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const setGuestEmail = (index: number, value: string) => set('guestEmails', draft.guestEmails.map((email, itemIndex) => (itemIndex === index ? value : email)))
  const toggleReminder = (key: ReminderKey) => set('reminderKeys', draft.reminderKeys.includes(key) ? draft.reminderKeys.filter((item) => item !== key) : [...draft.reminderKeys, key])

  const canEditOccurrence = Boolean(event?.recurrence_rule && occurrenceStart && details?.occurrenceId && new Date(occurrenceStart).getTime() > Date.now())
  const isOccurrenceEdit = canEditOccurrence && editScope === 'occurrence'

  const changeEditScope = (scope: 'series' | 'occurrence') => {
    if (!event) return
    setEditScope(scope)
    setDraft((current) =>
      scope === 'occurrence'
        ? {
            ...current,
            description: details?.occurrenceOverride?.description ?? event.description,
            location: details?.occurrenceOverride?.location ?? event.location,
            guestEmails: details ? (details.occurrenceGuestEmails.length ? details.occurrenceGuestEmails : ['']) : [''],
            files: [],
          }
        : {
            ...current,
            description: event.description,
            location: event.location,
            guestEmails: details?.guestEmails.length ? details.guestEmails : [''],
            files: [],
          },
    )
  }

  const creationDateInPast = !event && isPastBangkokDate(draft.date)
  const reminderStart = new Date(`${draft.date}T${draft.start || '00:00'}:00+07:00`)
  const expiredReminderKeys = Number.isNaN(reminderStart.getTime()) ? [] : pastMeetingReminderKeys(reminderStart, draft.reminderKeys)
  const recurringReminders = draft.recurrence.frequency !== 'none'
  const hasExpiredReminders = !isOccurrenceEdit && !recurringReminders && expiredReminderKeys.length > 0
  const attachmentCountForScope = details?.attachments.filter((file) => (isOccurrenceEdit ? file.scope === 'occurrence' : file.scope === 'series')).length ?? 0
  const reminderLabel = (key: ReminderKey) =>
    text(
      ({ '0:minute': 'เมื่อถึงเวลานัด', '1:month': '1 เดือนก่อน', '1:week': '1 สัปดาห์ก่อน', '3:day': '3 วันก่อน', '1:day': '1 วันก่อน' } as const)[key],
      ({ '0:minute': 'At the meeting time', '1:month': '1 month before', '1:week': '1 week before', '3:day': '3 days before', '1:day': '1 day before' } as const)[key],
    )
  const expiredReminderLabels = expiredReminderKeys.map(reminderLabel).join(', ')

  const currentWeekday = meetingWeekdayForDate(draft.date)
  const currentDayNum = Number(draft.date.slice(8, 10)) || 1
  const endOfYear = endOfYearBangkokDate(draft.date)

  const updateRecurrence = (patch: Partial<MeetingRecurrence>) => {
    set('recurrence', { ...draft.recurrence, ...patch })
  }

  const handleFrequencyChange = (freq: MeetingRecurrenceFrequency) => {
    if (freq === 'none') {
      set('recurrence', { frequency: 'none', interval: 1, weekdays: [], until: '', count: null })
      return
    }
    const currentCount = endMode === 'count' ? (draft.recurrence.count || 10) : null
    const currentUntil = endMode === 'count' ? '' : (draft.recurrence.until || endOfYear)
    if (freq === 'week') {
      set('recurrence', {
        frequency: 'week',
        interval: draft.recurrence.interval || 1,
        weekdays: draft.recurrence.weekdays.length ? draft.recurrence.weekdays : [currentWeekday],
        until: currentUntil,
        count: currentCount,
      })
    } else {
      set('recurrence', {
        frequency: freq,
        interval: draft.recurrence.interval || 1,
        weekdays: [],
        until: currentUntil,
        count: currentCount,
      })
    }
  }

  const toggleWeekday = (day: MeetingWeekday) => {
    const currentDays = draft.recurrence.weekdays
    const isSelected = currentDays.includes(day)
    let nextDays: readonly MeetingWeekday[]
    if (isSelected) {
      nextDays = currentDays.length > 1 ? currentDays.filter((d) => d !== day) : currentDays
    } else {
      nextDays = [...currentDays, day].sort((a, b) => weekdayOrder.indexOf(a) - weekdayOrder.indexOf(b))
    }
    updateRecurrence({ weekdays: nextDays })
  }

  const setWeekdaysShortcut = (shortcut: 'weekdays' | 'daily' | 'today') => {
    if (shortcut === 'weekdays') {
      updateRecurrence({ weekdays: ['MO', 'TU', 'WE', 'TH', 'FR'] })
    } else if (shortcut === 'daily') {
      updateRecurrence({ weekdays: ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] })
    } else if (shortcut === 'today') {
      updateRecurrence({ weekdays: [currentWeekday] })
    }
  }

  const handleEndTypeChange = (type: 'end_of_year' | 'until_date' | 'count') => {
    setEndMode(type)
    if (type === 'end_of_year') {
      updateRecurrence({ until: endOfYear, count: null })
    } else if (type === 'until_date') {
      updateRecurrence({ until: draft.recurrence.until || endOfYear, count: null })
    } else if (type === 'count') {
      updateRecurrence({ until: '', count: draft.recurrence.count || 10 })
    }
  }

  const save = async (notifyRecipients: boolean) => {
    if (!draft.title.trim() || !draft.date || !draft.start) {
      setError(text('กรุณากรอกชื่อและเวลาเริ่ม', 'Enter a title and start time.'))
      return false
    }
    if (creationDateInPast) {
      setError(text('ไม่สามารถสร้าง Meeting ในวันที่ผ่านมาแล้ว', 'A meeting cannot be created in the past.'))
      return false
    }
    if (!isOccurrenceEdit && draft.end && draft.end < draft.start) {
      setError(text('เวลาสิ้นสุดต้องไม่ก่อนเวลาเริ่ม', 'The end time cannot be earlier than the start time.'))
      return false
    }
    if (!isOccurrenceEdit && draft.recurrence.until && draft.recurrence.until < draft.date) {
      setError(text('วันสิ้นสุดการทำซ้ำต้องไม่ก่อนวันนัดหมาย', 'The recurrence end date cannot be before the meeting date.'))
      return false
    }
    if (!isOccurrenceEdit && draft.sendImmediate && !draft.notifyEmail) {
      setError(text('การส่งคำเชิญทันทีต้องเปิดการแจ้งเตือนทาง Email', 'Sending an invitation immediately requires Email notifications.'))
      return false
    }
    if (!isOccurrenceEdit && hasExpiredReminders) {
      setError(
        text(
          `ไม่สามารถบันทึกได้ เนื่องจากเวลาแจ้งเตือน (${expiredReminderLabels}) ผ่านมาแล้ว กรุณาเลือกเฉพาะเวลาที่ยังมาไม่ถึง`,
          `Cannot save: reminder time (${expiredReminderLabels}) has already passed. Please choose only upcoming reminder times.`
        )
      )
      return false
    }
    const invalidEmails = invalidGuestEmails(draft.guestEmails)
    if (invalidEmails.length) {
      setError(text(`อีเมลไม่ถูกต้อง: ${invalidEmails.join(', ')}`, `Invalid email: ${invalidEmails.join(', ')}`))
      return false
    }
    const attachmentError = validateAttachments(draft.files, attachmentCountForScope)
    if (attachmentError) {
      setError(attachmentError)
      return false
    }
    const activeNotifyLine = hasConnectedDevices && draft.notifyLine
    if (!isOccurrenceEdit && draft.reminderKeys.length && !draft.notifyEmail && !activeNotifyLine) {
      setError(text('กรุณาเลือกช่องทางแจ้งเตือนอย่างน้อย 1 ช่องทาง', 'Choose at least one notification channel.'))
      return false
    }
    setError('')
    try {
      await onSave({ ...draft, notifyLine: hasConnectedDevices ? draft.notifyLine : false }, isOccurrenceEdit ? false : notifyRecipients, isOccurrenceEdit ? 'occurrence' : 'series')
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
          await Swal.fire({
            icon: 'success',
            title: text('สำเร็จ', 'Success'),
            text: text('สร้างการประชุมเรียบร้อยแล้ว', 'Meeting created.'),
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: true,
          })
          onClose()
        }
      } finally {
        setSavingNew(false)
      }
    })()
  }

  const viewedOccurrenceDate = occurrenceStart ? bangkokDate(new Date(occurrenceStart)) : ''
  const isViewingLaterOccurrence = Boolean(event && viewedOccurrenceDate && viewedOccurrenceDate !== bangkokDate(new Date(event.start_datetime)))
  const occurrenceDateTime = occurrenceStart
    ? new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
        dateStyle: 'medium',
        timeStyle: event?.all_day ? undefined : 'short',
        timeZone: 'Asia/Bangkok',
      }).format(new Date(occurrenceStart))
    : ''
  const reminderStatus = (status: OccurrenceReminder['status']) =>
    text(
      ({ scheduled: 'กำหนดส่ง', processing: 'กำลังจัดคิว', completed: 'จัดคิวส่งแล้ว', cancelled: 'ข้ามการส่ง' } as const)[status],
      ({ scheduled: 'Scheduled', processing: 'Queueing', completed: 'Queued', cancelled: 'Skipped' } as const)[status],
    )

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/35 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="event-title">
      <section className="max-h-[95vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between">
          <div className="flex gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
              <CalendarClock size={22} />
            </span>
            <div>
              <h2 id="event-title" className="text-xl font-bold">
                {event ? text('รายละเอียดการประชุม', 'Meeting details') : text('เพิ่มการประชุม', 'Add meeting')}
              </h2>
              {event && !canEdit && (
                <p className="text-sm text-slate-500">
                  {text('ดูได้อย่างเดียว เฉพาะเจ้าของเท่านั้นที่แก้ไขได้', 'View only. Only the owner can edit this meeting.')}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {event && (
              <p className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {text('สร้างโดย', 'Created by')} {event.creator_name || text('ไม่ระบุชื่อ', 'Unknown')}
              </p>
            )}
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label={text('ปิด', 'Close')}>
              <X size={20} />
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-5">
          {isViewingLaterOccurrence && (
            <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-950">
              <p className="font-semibold">
                {text('รอบนัดหมายที่กำลังดู', 'Meeting occurrence being viewed')}: {text(`${formatDisplayDate(viewedOccurrenceDate)} เวลา ${localTime(occurrenceStart!)} น.`, `${formatDisplayDate(viewedOccurrenceDate)} at ${localTime(occurrenceStart!)}`)}
              </p>
              <p className="mt-1 text-xs text-brand-800">
                {text('เลือกได้ว่าจะให้การแก้ไขมีผลกับทุกนัดในชุด หรือเฉพาะนัดรอบนี้', 'Choose whether the change applies to the whole series or only this occurrence.')}
              </p>
            </div>
          )}

          {canEditOccurrence && (
            <fieldset disabled={!canEdit || busy || savingNew} className="rounded-xl border border-brand-200 bg-brand-50/50 p-4 disabled:opacity-75">
              <legend className="px-1 text-sm font-semibold text-slate-800">{text('การแก้ไขนี้มีผลกับ', 'Apply these changes to')}</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className={`cursor-pointer rounded-lg border p-3 ${editScope === 'series' ? 'border-brand-600 bg-white' : 'border-slate-200 bg-white/70'}`}>
                  <input type="radio" name="event-edit-scope" className="sr-only" checked={editScope === 'series'} onChange={() => changeEditScope('series')} />
                  <span className="block text-sm font-semibold text-slate-800">{text('ทุกนัดในชุด', 'Every meeting in the series')}</span>
                  <span className="mt-1 block text-xs text-slate-600">{text('แก้ข้อมูลและการแจ้งเตือนของทั้งชุดนัดหมาย', 'Updates the details and notifications for the whole series.')}</span>
                </label>
                <label className={`cursor-pointer rounded-lg border p-3 ${editScope === 'occurrence' ? 'border-brand-600 bg-white' : 'border-slate-200 bg-white/70'}`}>
                  <input type="radio" name="event-edit-scope" className="sr-only" checked={editScope === 'occurrence'} onChange={() => changeEditScope('occurrence')} />
                  <span className="block text-sm font-semibold text-slate-800">{text(`เฉพาะนัดวันที่ ${occurrenceDateTime}`, `Only ${occurrenceDateTime}`)}</span>
                  <span className="mt-1 block text-xs text-slate-600">{text('แก้ได้เฉพาะรายละเอียด สถานที่ ผู้เข้าร่วม และเอกสาร', 'Only details, location, attendees, and documents can be changed.')}</span>
                </label>
              </div>
              {isOccurrenceEdit && (
                <p className="mt-3 text-xs text-brand-900">
                  {text('ระบบจะส่งการแจ้งเตือนตามกำหนดเดิมเพียงครั้งเดียว โดยใช้ข้อมูลของนัดนี้ที่บันทึกล่าสุด', 'The existing scheduled reminder is sent once, using the latest saved details for this occurrence.')}
                </p>
              )}
            </fieldset>
          )}

          <fieldset disabled={!canEdit || busy || savingNew} className="space-y-5 disabled:opacity-75">
            <section className="space-y-4 rounded-xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800">
                <FileText size={18} className="text-brand-600" />
                {text('ข้อมูลการประชุม', 'Meeting details')}
              </h3>
              <div>
                <label className="field-label" htmlFor="title">{text('ชื่อการประชุม *', 'Meeting title *')}</label>
                <input id="title" className="field-input" value={draft.title} onChange={(e) => set('title', e.target.value)} maxLength={180} disabled={isOccurrenceEdit} />
              </div>
              <div>
                <label className="field-label" htmlFor="event-affiliation">{text('หน่วยงาน / สังกัด', 'Department / affiliation')}</label>
                <input id="event-affiliation" className="field-input" placeholder={text('กคน.ฝลส.', 'e.g. Department')} value={draft.affiliation} onChange={(e) => set('affiliation', e.target.value)} maxLength={250} disabled={isOccurrenceEdit} />
              </div>
              <div>
                <span className="field-label">{text(isViewingLaterOccurrence ? 'วันเริ่มชุดนัดหมาย' : 'วันที่นัดหมาย', isViewingLaterOccurrence ? 'Series start date' : 'Meeting date')}</span>
                <p className={`rounded-xl border px-3 py-2.5 text-sm ${creationDateInPast ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
                  {formatDisplayDate(draft.date)}
                </p>
                {creationDateInPast && (
                  <p className="mt-1 text-sm text-red-600" role="alert">
                    {text('ไม่สามารถสร้าง Meeting ในวันที่ผ่านมาแล้ว กรุณาเลือกวันปัจจุบันหรือวันถัดไปจากปฏิทิน', 'A meeting cannot be created in the past. Choose today or a later date in the calendar.')}
                  </p>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="start">{text('เริ่ม *', 'Start *')}</label>
                  <TimeSelect id="start" value={draft.start} onChange={(value) => set('start', value)} disabled={isOccurrenceEdit} />
                </div>
                <div>
                  <label className="field-label" htmlFor="end">{text('สิ้นสุด (ไม่บังคับ)', 'End (optional)')}</label>
                  <TimeSelect id="end" value={draft.end} onChange={(value) => set('end', value)} optional disabled={isOccurrenceEdit} />
                </div>
              </div>
              <div>
                <label className="field-label" htmlFor="location">{text('สถานที่ / ห้องประชุม / ลิงก์ออนไลน์', 'Location / meeting room / online link')}</label>
                <input id="location" className="field-input" value={draft.location} onChange={(e) => set('location', e.target.value)} maxLength={250} />
              </div>
              <div>
                <label className="field-label" htmlFor="description">{text('รายละเอียด / วาระการประชุม', 'Details / agenda')}</label>
                <textarea id="description" className="field-input min-h-28 resize-y" value={draft.description} onChange={(e) => set('description', e.target.value)} maxLength={10000} />
              </div>
            </section>

            {!event && (
              <section className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
                <h3 className="flex items-center gap-2 font-semibold text-slate-800">
                  <Mail size={18} className="text-brand-600" />
                  {text('การส่งเมื่อบันทึก', 'Send when saved')}
                </h3>
                <label className="flex cursor-pointer items-start gap-3">
                  <input type="checkbox" checked={draft.sendImmediate} onChange={(e) => set('sendImmediate', e.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600" />
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">{text('ส่งคำเชิญทันทีหลังบันทึก', 'Send invitation immediately after saving')}</span>
                    <span className="mt-0.5 block text-xs text-slate-600">{text('ส่งครั้งเดียว ไม่ทำซ้ำตามกำหนดการ', 'Sent once only; it does not repeat with the schedule.')}</span>
                  </span>
                </label>
              </section>
            )}

            <section className="space-y-4 rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-semibold text-slate-800">
                  <Repeat2 size={18} className="text-brand-600" />
                  {text('การทำซ้ำของการประชุม', 'Meeting Recurrence')}
                </h3>
                {draft.recurrence.frequency !== 'none' && !isOccurrenceEdit && (
                  <button
                    type="button"
                    onClick={() => handleFrequencyChange('none')}
                    className="text-xs font-semibold text-red-600 hover:text-red-700"
                  >
                    {text('ยกเลิกการทำซ้ำ', 'Reset recurrence')}
                  </button>
                )}
              </div>

              <div>
                <label className="field-label" htmlFor="recurrence-frequency">
                  {text('ความถี่การประชุม', 'Repeat Frequency')}
                </label>
                <select
                  id="recurrence-frequency"
                  className="field-input font-medium"
                  value={draft.recurrence.frequency}
                  onChange={(e) => handleFrequencyChange(e.target.value as MeetingRecurrenceFrequency)}
                  disabled={isOccurrenceEdit}
                >
                  <option value="none">{text('ไม่ทำซ้ำ (นัดหมายครั้งเดียว)', 'Does not repeat (single meeting)')}</option>
                  <option value="week">{text('รายสัปดาห์ (เลือกวันได้ เช่น จ.-ศ., ทุกวัน, วันเฉพาะ)', 'Weekly (Select days: Weekdays, Daily, or specific days)')}</option>
                  <option value="month">{text(`รายเดือน (ทุกวันที่ ${currentDayNum} ของเดือน)`, `Monthly (Every day ${currentDayNum} of month)`)}</option>
                  <option value="year">{text(`รายปี (ทุกวันที่ ${formatDisplayDate(draft.date)})`, `Yearly (Every ${formatDisplayDate(draft.date)})`)}</option>
                </select>
              </div>

              {draft.recurrence.frequency !== 'none' && !isOccurrenceEdit && (
                <div className="space-y-4 rounded-xl border border-brand-200/80 bg-brand-50/40 p-4">
                  {/* WEEK FREQUENCY CONTROLS */}
                  {draft.recurrence.frequency === 'week' && (
                    <div className="space-y-3">
                      <div>
                        <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                          {text('ทางลัดเลือกวันด่วน:', 'Quick Day Shortcuts:')}
                        </span>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setWeekdaysShortcut('weekdays')}
                            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                              draft.recurrence.weekdays.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every((d) => draft.recurrence.weekdays.includes(d as MeetingWeekday))
                                ? 'bg-brand-600 text-white shadow-sm'
                                : 'border border-slate-300 bg-white text-slate-700 hover:bg-brand-50'
                            }`}
                          >
                            {text('⭐ วันทำงาน (จ.-ศ.)', '⭐ Weekdays (Mon-Fri)')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setWeekdaysShortcut('daily')}
                            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                              draft.recurrence.weekdays.length === 7
                                ? 'bg-brand-600 text-white shadow-sm'
                                : 'border border-slate-300 bg-white text-slate-700 hover:bg-brand-50'
                            }`}
                          >
                            {text('🔄 ทุกวัน (จ.-อา.)', '🔄 Every day (Mon-Sun)')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setWeekdaysShortcut('today')}
                            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                              draft.recurrence.weekdays.length === 1 && draft.recurrence.weekdays[0] === currentWeekday
                                ? 'bg-brand-600 text-white shadow-sm'
                                : 'border border-slate-300 bg-white text-slate-700 hover:bg-brand-50'
                            }`}
                          >
                            {text(`📅 วันนี้ (${weekdayThaiShort[currentWeekday]}.)`, `📅 Today (${weekdayEnglishShort[currentWeekday]})`)}
                          </button>
                        </div>
                      </div>

                      <div>
                        <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                          {text('หรือเลือกวันในสัปดาห์:', 'Or select days of the week:')}
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {weekdayOrder.map((day) => {
                            const selected = draft.recurrence.weekdays.includes(day)
                            return (
                              <button
                                key={day}
                                type="button"
                                onClick={() => toggleWeekday(day)}
                                className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold transition-all ${
                                  selected
                                    ? 'bg-brand-600 text-white shadow-md shadow-brand-600/25 ring-2 ring-brand-500 ring-offset-1'
                                    : 'border border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50'
                                }`}
                                title={text(weekdayThaiFull[day], weekdayEnglishFull[day])}
                              >
                                {text(weekdayThaiShort[day], weekdayEnglishShort[day])}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <span className="text-xs font-semibold text-slate-700">{text('รอบสัปดาห์:', 'Repeat interval:')}</span>
                        <span className="text-sm text-slate-600">{text('ทุกๆ', 'Every')}</span>
                        <input
                          className="field-input w-16 py-1 text-center font-bold"
                          type="number"
                          min="1"
                          max="52"
                          value={draft.recurrence.interval}
                          onChange={(e) => updateRecurrence({ interval: Math.max(1, Number(e.target.value) || 1) })}
                        />
                        <span className="text-sm text-slate-600">
                          {text('สัปดาห์ (1 = ทุกสัปดาห์, 2 = สัปดาห์เว้นสัปดาห์)', 'week(s) (1 = weekly, 2 = biweekly)')}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* MONTH FREQUENCY CONTROLS */}
                  {draft.recurrence.frequency === 'month' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-700">{text('ทำซ้ำทุกๆ', 'Repeat every')}</span>
                      <input
                        className="field-input w-16 py-1 text-center font-bold"
                        type="number"
                        min="1"
                        max="12"
                        value={draft.recurrence.interval}
                        onChange={(e) => updateRecurrence({ interval: Math.max(1, Number(e.target.value) || 1) })}
                      />
                      <span className="text-sm text-slate-600">
                        {text(`เดือน (ทุกวันที่ ${currentDayNum} ของเดือน)`, `month(s) (on day ${currentDayNum} of month)`)}
                      </span>
                    </div>
                  )}

                  {/* YEAR FREQUENCY CONTROLS */}
                  {draft.recurrence.frequency === 'year' && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-700">{text('ทำซ้ำทุกๆ', 'Repeat every')}</span>
                      <input
                        className="field-input w-16 py-1 text-center font-bold"
                        type="number"
                        min="1"
                        max="10"
                        value={draft.recurrence.interval}
                        onChange={(e) => updateRecurrence({ interval: Math.max(1, Number(e.target.value) || 1) })}
                      />
                      <span className="text-sm text-slate-600">
                        {text(`ปี (ทุกวันที่ ${formatDisplayDate(draft.date)})`, `year(s) (on ${formatDisplayDate(draft.date)})`)}
                      </span>
                    </div>
                  )}

                  {/* END CONDITIONS (ZERO UNBOUNDED / NEVER) */}
                  <fieldset className="border-t border-brand-200/80 pt-3">
                    <legend className="mb-2 text-xs font-semibold text-slate-700">
                      {text('สิ้นสุดการทำซ้ำ', 'End recurrence')}
                    </legend>
                    <div className="space-y-2.5 text-sm text-slate-800">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="meeting-end-type"
                          checked={endMode === 'end_of_year'}
                          onChange={() => handleEndTypeChange('end_of_year')}
                          className="text-brand-600 focus:ring-brand-500"
                        />
                        <span className="font-medium">{text(`สิ้นปีนี้ (${formatDisplayDate(endOfYear)})`, `End of current year (${formatDisplayDate(endOfYear)})`)}</span>
                        <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">
                          {text('แนะนำ', 'Recommended')}
                        </span>
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="radio"
                            name="meeting-end-type"
                            checked={endMode === 'until_date'}
                            onChange={() => handleEndTypeChange('until_date')}
                            className="text-brand-600 focus:ring-brand-500"
                          />
                          <span>{text('สิ้นสุด ณ วันที่:', 'On date:')}</span>
                        </label>
                        <input
                          className="field-input w-36 py-1 text-sm disabled:opacity-50"
                          type="date"
                          disabled={endMode !== 'until_date'}
                          min={draft.date}
                          value={draft.recurrence.until || endOfYear}
                          onClick={() => { if (endMode !== 'until_date') handleEndTypeChange('until_date') }}
                          onChange={(e) => {
                            setEndMode('until_date')
                            updateRecurrence({ until: e.target.value, count: null })
                          }}
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="radio"
                            name="meeting-end-type"
                            checked={endMode === 'count'}
                            onChange={() => handleEndTypeChange('count')}
                            className="text-brand-600 focus:ring-brand-500"
                          />
                          <span>{text('สิ้นสุดหลังครบ:', 'End after:')}</span>
                        </label>
                        <input
                          className="field-input w-20 py-1 text-center font-semibold disabled:opacity-50"
                          type="number"
                          min="1"
                          max="999"
                          disabled={endMode !== 'count'}
                          value={draft.recurrence.count ?? 10}
                          onClick={() => { if (endMode !== 'count') handleEndTypeChange('count') }}
                          onChange={(e) => {
                            setEndMode('count')
                            updateRecurrence({ until: '', count: Math.max(1, Number(e.target.value) || 1) })
                          }}
                        />
                        <span>{text('ครั้ง', 'occurrences')}</span>
                      </div>
                    </div>
                  </fieldset>

                  {/* SUMMARY BANNER */}
                  <div className="flex items-start gap-2.5 rounded-xl border border-brand-300 bg-white/90 p-3.5 text-xs text-brand-950 shadow-sm">
                    <Sparkles size={16} className="mt-0.5 shrink-0 text-brand-600" />
                    <div>
                      <p className="font-bold text-brand-800 uppercase tracking-wider text-[11px]">
                        {text('สรุปรูปแบบการประชุมซ้ำ', 'Recurrence Summary')}
                      </p>
                      <p className="mt-0.5 font-semibold leading-relaxed text-brand-950">
                        {meetingRecurrenceSummary(
                          draft.recurrence,
                          draft.date,
                          draft.start,
                          draft.end,
                          language,
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </section>

            <section className="space-y-3 rounded-xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800">
                <UserPlus size={18} className="text-brand-600" />
                {text('ผู้เข้าร่วม (ไม่บังคับ)', 'Attendees (optional)')}
              </h3>
              <div className="space-y-2">
                {draft.guestEmails.map((email, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="email"
                      className="field-input min-w-0 flex-1"
                      value={email}
                      onChange={(e) => setGuestEmail(index, e.target.value)}
                      placeholder="name@gmail.com"
                      aria-label={`${text('Attendee Gmail', 'Attendee Gmail')} ${index + 1}`}
                    />
                    {details?.guestAcknowledgements?.[email.trim().toLowerCase()] && (
                      <span className="shrink-0 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
                        {text('รับทราบแล้ว', 'Acknowledged')}
                      </span>
                    )}
                    {draft.guestEmails.length > 1 && (
                      <button
                        type="button"
                        className="shrink-0 rounded-xl border border-slate-300 p-2.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                        onClick={() => set('guestEmails', draft.guestEmails.filter((_, itemIndex) => itemIndex !== index))}
                        aria-label={`${text('ลบผู้เข้าร่วม', 'Remove attendee')} ${index + 1}`}
                      >
                        <X size={18} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={() => set('guestEmails', [...draft.guestEmails, ''])}
              >
                <Plus size={17} />
                {text('เพิ่มผู้เข้าร่วมอีกคน', 'Add another attendee')}
              </button>
              <p className="text-xs text-slate-500">
                {text('ผู้เข้าร่วมกดรับทราบจากลิงก์ในอีเมลได้', 'Attendees can acknowledge from the link in their email.')}
              </p>
            </section>

            <section className="space-y-4 rounded-xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800">
                <Bell size={18} className="text-brand-600" />
                {text('การแจ้งเตือน', 'Notifications')}
              </h3>
              <fieldset disabled={isOccurrenceEdit} className="space-y-4 disabled:opacity-60">
                <div className="flex flex-wrap gap-2">
                  {reminderOptions.map((option) => {
                    const isPast = isMeetingReminderKeyPast(reminderStart, option.key)
                    const isChecked = draft.reminderKeys.includes(option.key)
                    return (
                      <label
                        key={option.key}
                        className={`cursor-pointer select-none rounded-full border px-3 py-2 text-sm transition-colors ${
                          isChecked && isPast
                            ? 'border-red-500 bg-red-50 font-medium text-red-800'
                            : isChecked
                            ? 'border-brand-600 bg-brand-50 font-medium text-brand-700'
                            : isPast
                            ? 'border-slate-200 bg-slate-100 text-slate-400 opacity-60'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={isChecked}
                          disabled={isPast && !isChecked && !recurringReminders}
                          onChange={() => toggleReminder(option.key)}
                        />
                        <span>
                          {text(
                            option.label,
                            ({ '0:minute': 'At the time', '1:month': '1 month before', '1:week': '1 week before', '3:day': '3 days before', '1:day': '1 day before' } as const)[option.key] || option.label,
                          )}
                        </span>
                        {isPast && (
                          <span className={`ml-1 text-[11px] ${isChecked ? 'font-bold text-red-700' : 'text-slate-400'}`}>
                            {recurringReminders ? text('(ครั้งแรกผ่านมาแล้ว)', '(First reminder passed)') : text('(ผ่านมาแล้ว)', '(Passed)')}
                          </span>
                        )}
                      </label>
                    )
                  })}
                </div>

                {hasExpiredReminders && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50/90 p-3 text-sm text-red-900" role="alert">
                    <AlertTriangle className="mt-0.5 shrink-0 text-red-600" size={18} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-red-950">
                        {text('ตัวเลือกแจ้งเตือนไม่สอดคล้องกับวัน/เวลานัดหมาย', 'Reminder timing is incompatible with meeting date/time')}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-red-800">
                        {text(
                          `การแจ้งเตือน [${expiredReminderKeys.map((k) => meetingReminderOptionLabel(k, 'th')).join(', ')}] เป็นเวลาที่ผ่านมาแล้ว ไม่สามารถตั้งแจ้งเตือนได้ กรุณาคลิกเอาเครื่องหมายถูกออก`,
                          `The reminder(s) [${expiredReminderKeys.map((k) => meetingReminderOptionLabel(k, 'en')).join(', ')}] have already passed. Please click to uncheck them.`
                        )}
                      </p>
                    </div>
                  </div>
                )}
                {recurringReminders && expiredReminderKeys.length > 0 && <p role="status" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">{text('เวลาเตือนของครั้งแรกผ่านไปแล้ว ระบบจะข้ามเวลาที่ผ่านไป และใช้ตัวเลือกนี้กับการประชุมครั้งถัดไปที่ยังไม่ถึงเวลาเตือน', 'The first reminder time has passed. Past times will be skipped; this timing will apply to upcoming occurrences.')}</p>}
                <div className="flex flex-wrap gap-5 text-sm">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={draft.notifyEmail} onChange={(e) => set('notifyEmail', e.target.checked)} className="h-4 w-4 rounded" />
                    <Mail size={17} />
                    Gmail / Email
                  </label>
                  <label
                    className={`flex items-center gap-2 select-none ${hasConnectedDevices ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                    title={
                      !hasConnectedDevices
                        ? text('ยังไม่ได้เชื่อมต่อการแจ้งเตือนบนมือถือ กรุณาเชื่อมต่อในเมนู "เชื่อมต่อการแจ้งเตือนผ่านมือถือ"', 'Mobile notifications not connected. Please connect in Mobile Notifications menu.')
                        : ''
                    }
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(hasConnectedDevices && draft.notifyLine)}
                      disabled={!hasConnectedDevices}
                      onChange={(e) => set('notifyLine', e.target.checked)}
                      className="h-4 w-4 rounded"
                    />
                    <Smartphone size={17} className={hasConnectedDevices ? 'text-brand-600' : 'text-slate-400'} />
                    <span>{text('แจ้งเตือนผ่านมือถือ', 'Mobile notification')}</span>
                    {!hasConnectedDevices ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 border border-amber-200">
                        {text('ยังไม่เชื่อมต่อ', 'Not connected')}
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200">
                        {text('เชื่อมต่อแล้ว', 'Connected')}
                      </span>
                    )}
                  </label>
                </div>
                {!hasConnectedDevices ? (
                  <p className="text-xs text-amber-700">
                    {text('💡 ยังไม่ได้เชื่อมต่อการแจ้งเตือนบนมือถือ ไปที่เมนู "เชื่อมต่อการแจ้งเตือนผ่านมือถือ" เพื่อสแกน QR Code เปิดใช้งาน', '💡 Mobile notification is not connected yet. Go to "Mobile Notifications" menu to pair your device.')}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">
                    {text('แจ้งเตือนผ่านมือถือพร้อมใช้งาน (เชื่อมต่ออุปกรณ์แล้ว)', 'Mobile notification is ready (device connected).')}
                  </p>
                )}
              </fieldset>
              {isOccurrenceEdit && (
                <p className="text-xs text-slate-500">
                  {text('นัดนี้ใช้กำหนดการแจ้งเตือนเดิมของชุดนัดหมาย', 'This occurrence uses the series’ existing notification schedule.')}
                </p>
              )}
            </section>

            <section className="space-y-3 rounded-xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800">
                <Paperclip size={18} className="text-brand-600" />
                {text('ไฟล์แนบ', 'Attachments')}
              </h3>
              {details?.attachments?.map((file) => (
                <div key={file.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <FileText size={16} />
                  <span className="min-w-0 flex-1 truncate">{file.file_name}</span>
                  {file.scope === 'occurrence' && (
                    <span className="shrink-0 rounded-full bg-brand-100 px-2 py-1 text-xs font-medium text-brand-800">
                      {text('เฉพาะนัดนี้', 'This occurrence only')}
                    </span>
                  )}
                  <span className="shrink-0 text-xs text-slate-400">{(file.file_size / 1024 / 1024).toFixed(1)} MB</span>
                  <a className="btn-secondary shrink-0" href={file.signedUrl} download={file.file_name}>
                    <Download size={17} />
                    {text('ดาวน์โหลด', 'Download')}
                  </a>
                  {canEdit && (isOccurrenceEdit ? file.scope === 'occurrence' : file.scope === 'series') && (
                    <button
                      type="button"
                      className="btn-secondary shrink-0 border-red-200 text-red-600"
                      disabled={busy}
                      onClick={() => void onDeleteAttachment(file).catch(() => setError(text('ลบไฟล์แนบไม่สำเร็จ', 'Could not delete attachment.')))}
                      aria-label={`${text('ลบ', 'Delete')} ${file.file_name}`}
                    >
                      <Trash2 size={16} />
                      {text('ลบ', 'Delete')}
                    </button>
                  )}
                </div>
              ))}
              {canEdit && (
                <>
                  {draft.files.map((file, index) => (
                    <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm">
                      <FileText size={16} />
                      <span className="truncate">{file.name}</span>
                      <button
                        type="button"
                        className="ml-auto text-slate-500 hover:text-red-600"
                        onClick={() => set('files', draft.files.filter((_, itemIndex) => itemIndex !== index))}
                        aria-label={`${text('นำ', 'Remove')} ${file.name} ${text('ออก', '')}`}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    className="hidden"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png"
                    onChange={(e) => {
                      const files = [...(e.target.files ?? [])]
                      const message = validateAttachments([...draft.files, ...files], attachmentCountForScope)
                      if (message) setError(message)
                      else {
                        setError('')
                        set('files', [...draft.files, ...files])
                      }
                      e.target.value = ''
                    }}
                  />
                  <button type="button" className="btn-secondary" onClick={() => fileInput.current?.click()}>
                    <Paperclip size={17} />
                    {text('อัปโหลดเอกสาร', 'Upload document')}
                  </button>
                  <p className="text-xs text-slate-500">
                    {text('สูงสุด 5 ไฟล์ ไฟล์ละไม่เกิน 10 MB: PDF, Office, JPG และ PNG', 'Up to 5 files, 10 MB each: PDF, Office, JPG, and PNG.')}
                  </p>
                </>
              )}
            </section>
          </fieldset>

          {event && (occurrenceStart || canViewDeliveryStatus) && (
            <section className="rounded-xl border border-brand-200 bg-brand-50/40 p-4">
              <div className="flex items-start gap-2">
                <Bell size={18} className="mt-0.5 shrink-0 text-brand-600" />
                <div>
                  <h3 className="font-semibold text-brand-950">{text('การแจ้งเตือน', 'Notifications')}</h3>
                  {occurrenceStart && <p className="mt-1 text-xs text-brand-800">{text(`นัดที่กำลังดู: ${occurrenceDateTime}`, `Occurrence being viewed: ${occurrenceDateTime}`)}</p>}
                </div>
              </div>
              {occurrenceStart && (
                <details className="group mt-3 border-t border-brand-200/80">
                  <summary className="flex cursor-pointer list-none items-center gap-2 py-3 [&::-webkit-details-marker]:hidden">
                    <Bell size={17} className="shrink-0 text-brand-600" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-800">{text('แจ้งเตือนตามกำหนดนัด', 'Scheduled appointment reminders')}</span>
                      <span className="block text-xs text-slate-600">{text('สำหรับนัดรอบที่กำลังดู', 'For the occurrence being viewed')}</span>
                    </span>
                    <span className="flex items-center gap-1 text-xs font-medium text-slate-600">
                      {details?.occurrenceReminders?.length
                        ? text(`${details.occurrenceReminders.length} รายการ`, `${details.occurrenceReminders.length} item${details.occurrenceReminders.length === 1 ? '' : 's'}`)
                        : text('ยังไม่ได้ตั้ง', 'Not set')}
                      <ChevronDown size={16} className="transition-transform group-open:rotate-180" />
                    </span>
                  </summary>
                  <div className="space-y-3 pb-4">
                    {!details?.occurrenceReminders?.length && (
                      <p className="rounded-lg bg-white/70 px-3 py-3 text-sm text-slate-600">
                        {text('ยังไม่ได้ตั้งการแจ้งเตือนสำหรับนัดรอบนี้', 'No reminder has been set for this occurrence.')}
                      </p>
                    )}
                    <div className="space-y-2">
                      {details?.occurrenceReminders?.map((reminder) => (
                        <div key={reminder.id} className="rounded-lg bg-white/80 px-3 py-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium text-slate-800">
                              {text('กำหนดส่ง', 'Scheduled')}{' '}
                              {new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                                timeZone: 'Asia/Bangkok',
                              }).format(new Date(reminder.scheduled_at))}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
                              {reminderStatus(reminder.status)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-600">
                            {[reminder.channel_email && 'Email', reminder.channel_line && text('แจ้งเตือนมือถือ', 'Mobile Push')].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                      ))}
                    </div>
                    {canViewDeliveryStatus && (
                      <NotificationDeliveryStatus
                        embedded
                        deliveries={details?.occurrenceNotificationDeliveries ?? []}
                        acknowledgements={details?.guestAcknowledgements ?? {}}
                        onRetry={onRetryNotification}
                        title={{ thai: 'ผลการส่ง', english: 'Delivery status' }}
                        description={{ thai: 'แสดงเฉพาะการส่งตามกำหนดนัดนี้', english: 'Only deliveries for this scheduled reminder.' }}
                        emptyMessage={{ thai: 'ยังไม่ถึงเวลาส่ง หรือยังไม่มีผลการส่ง', english: 'This has not been sent yet or has no delivery result.' }}
                      />
                    )}
                  </div>
                </details>
              )}
              {canViewDeliveryStatus && (
                <details className={`group ${occurrenceStart ? 'border-t border-brand-200/80' : 'mt-3 border-t border-brand-200/80'}`}>
                  <summary className="flex cursor-pointer list-none items-center gap-2 py-3 [&::-webkit-details-marker]:hidden">
                    <Mail size={17} className="shrink-0 text-brand-600" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-800">{text('แจ้งเตือนเมื่อสร้างหรือแก้ไขนัดหมาย', 'Notifications when a meeting is created or updated')}</span>
                      <span className="block text-xs text-slate-600">{text('ไม่ใช่การเตือนก่อนถึงเวลานัด', 'Not the before-appointment reminders above')}</span>
                    </span>
                    <span className="flex items-center gap-1 text-xs font-medium text-slate-600">
                      {details?.notificationDeliveries?.length ? text('ดูสถานะ', 'View status') : text('ยังไม่มีรายการ', 'No messages')}
                      <ChevronDown size={16} className="transition-transform group-open:rotate-180" />
                    </span>
                  </summary>
                  <div className="pb-4">
                    <NotificationDeliveryStatus
                      embedded
                      deliveries={details?.notificationDeliveries ?? []}
                      acknowledgements={details?.guestAcknowledgements ?? {}}
                      onRetry={onRetryNotification}
                      title={{ thai: 'ผลการส่ง', english: 'Delivery status' }}
                      description={{ thai: 'แสดงข้อความที่ส่งเมื่อสร้างหรือแก้ไขนัดหมาย', english: 'Shows messages sent when this meeting was created or updated.' }}
                      emptyMessage={{ thai: 'ยังไม่มีการส่งข้อความเมื่อสร้างหรือแก้ไขนัดหมายนี้', english: 'No messages have been sent for creating or updating this meeting.' }}
                    />
                  </div>
                </details>
              )}
            </section>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4">
            {event && canEdit && !isOccurrenceEdit ? (
              <button
                type="button"
                onClick={onDelete}
                className="btn-secondary border-red-200 text-red-600 hover:bg-red-50"
                disabled={busy}
              >
                <Trash2 size={17} />
                {text('ลบ', 'Delete')}
              </button>
            ) : (
              <span />
            )}
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={onClose} className="btn-secondary">
                {canEdit ? text('ยกเลิก', 'Cancel') : text('ปิด', 'Close')}
              </button>
              {canEdit &&
                (event ? (
                  <SaveActionMenu busy={busy} onSave={save} onComplete={onClose} allowNotification={!isOccurrenceEdit} disabled={hasExpiredReminders} />
                ) : (
                  <button className="btn-primary" disabled={busy || savingNew || creationDateInPast || hasExpiredReminders}>
                    {(busy || savingNew) && <Loader2 className="animate-spin" size={17} />}
                    {text('สร้างการประชุม', 'Create meeting')}
                  </button>
                ))}
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}
