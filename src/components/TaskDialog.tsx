import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bell, CalendarDays, CheckCircle2, ChevronDown, FileText, Link2, Loader2, Mail, Paperclip, Plus, Smartphone, Trash2, UserRound, X } from 'lucide-react'
import Swal from 'sweetalert2'
import { useLanguage } from '../i18n/LanguageProvider'
import type { Database } from '../lib/database.types'
import { bangkokDate, formatDisplayDate, isPastBangkokDate, parseDisplayDate, validateAttachments } from '../lib/eventForm'
import {
  calculateContinuousStartDate,
  daysBetweenBangkokDates,
  invalidExternalEmails,
  isGoogleDocumentUrl,
  isTaskReminderKeyPast,
  normalizeExternalEmails,
  pastTaskSingleReminderKeys,
  taskSingleReminderOptionLabel,
  taskSingleReminderOptions,
  type TaskContinuousConfig,
  type TaskReminderKey,
  type TaskReminderMode,
} from '../lib/taskForm'
import { TimeSelect } from './TimeSelect'
import { NotificationDeliveryStatus, type DeliveryStatusRow } from './NotificationDeliveryStatus'

type TaskRow = Database['public']['Tables']['tasks']['Row']
type ProfileRow = Database['public']['Tables']['profiles']['Row']
type EventRow = Database['public']['Tables']['events']['Row']
type TaskAttachmentRow = Database['public']['Tables']['task_attachments']['Row'] & { signedUrl?: string }
type DocumentLinkRow = Database['public']['Tables']['document_links']['Row']
type RecipientTab = 'self' | 'internal' | 'external'

export type DriveLinkDraft = { displayName: string; url: string }
export type TaskReminderStatusRow = Pick<Database['public']['Tables']['task_reminders']['Row'], 'id' | 'reminder_key' | 'scheduled_at' | 'channel_email' | 'channel_line' | 'status'>
export type TaskDeliveryStatusRow = DeliveryStatusRow & Pick<Database['public']['Tables']['notification_deliveries']['Row'], 'task_reminder_id' | 'template_key'>
export type TaskDetails = {
  reminderMode?: TaskReminderMode
  reminderKeys: TaskReminderKey[]
  continuousConfig?: TaskContinuousConfig
  notifyEmail: boolean
  notifyLine: boolean
  attachments: TaskAttachmentRow[]
  documentLinks: DocumentLinkRow[]
  internalRecipients: Array<{ user_id: string; acknowledged_at: string | null }>
  externalRecipients: Array<{ email: string; acknowledged_at: string | null }>
  notificationDeliveries: DeliveryStatusRow[]
  reminders: TaskReminderStatusRow[]
  reminderNotificationDeliveries: DeliveryStatusRow[]
}
export type TaskDraft = Pick<TaskRow, 'title' | 'description' | 'affiliation'> & {
  dueDate: string
  dueTime: string
  internalUserIds: string[]
  externalEmails: string[]
  linkedEventId: string
  reminderMode: TaskReminderMode
  reminderKeys: TaskReminderKey[]
  continuousConfig: TaskContinuousConfig
  notifyEmail: boolean
  notifyLine: boolean
  files: File[]
  driveLinks: DriveLinkDraft[]
}

const continuousDayOptions = [
  { days: 1, labelTh: 'เริ่มก่อนครบกำหนด 1 วัน', labelEn: '1 day before due date' },
  { days: 2, labelTh: 'เริ่มก่อนครบกำหนด 2 วัน', labelEn: '2 days before due date' },
  { days: 3, labelTh: 'เริ่มก่อนครบกำหนด 3 วัน', labelEn: '3 days before due date' },
  { days: 5, labelTh: 'เริ่มก่อนครบกำหนด 5 วัน', labelEn: '5 days before due date' },
  { days: 7, labelTh: 'เริ่มก่อนครบกำหนด 7 วัน (1 สัปดาห์)', labelEn: '7 days before due date (1 week)' },
  { days: 14, labelTh: 'เริ่มก่อนครบกำหนด 14 วัน (2 สัปดาห์)', labelEn: '14 days before due date (2 weeks)' },
  { days: 30, labelTh: 'เริ่มก่อนครบกำหนด 30 วัน (1 เดือน)', labelEn: '30 days before due date (1 month)' },
]

function blankDraft(date: string | undefined, userId: string): TaskDraft {
  const targetDate = date ?? bangkokDate()
  const daysDiff = daysBetweenBangkokDates(bangkokDate(), targetDate)
  const defaultKeys: TaskReminderKey[] = daysDiff >= 3 ? ['3_days', '1_day'] : daysDiff >= 1 ? ['1_day'] : ['due']

  return {
    title: '',
    description: '',
    affiliation: '',
    dueDate: targetDate,
    dueTime: '',
    internalUserIds: [userId],
    externalEmails: [''],
    linkedEventId: '',
    reminderMode: 'single',
    reminderKeys: defaultKeys,
    continuousConfig: { startDaysBefore: Math.max(1, Math.min(3, daysDiff || 1)), frequency: 'daily' },
    notifyEmail: true,
    notifyLine: false,
    files: [],
    driveLinks: [{ displayName: '', url: '' }],
  }
}

export function TaskDialog({
  open,
  task,
  details,
  selectedDate,
  defaultAffiliation = '',
  userId,
  profiles,
  canEdit,
  canComplete,
  canAcknowledge,
  canViewDeliveryStatus,
  hasConnectedDevices = false,
  busy,
  onClose,
  onSave,
  onDelete,
  onToggleComplete,
  onAcknowledge,
  onDeleteAttachment,
  onRetryNotification,
}: {
  open: boolean
  task: TaskRow | null
  details?: TaskDetails
  selectedDate?: string
  defaultAffiliation?: string
  userId: string
  profiles: ProfileRow[]
  events: EventRow[]
  canEdit: boolean
  canComplete: boolean
  canAcknowledge: boolean
  canViewDeliveryStatus: boolean
  hasConnectedDevices?: boolean
  busy: boolean
  onClose: () => void
  onSave: (draft: TaskDraft, notifyRecipients: boolean) => Promise<void>
  onDelete: () => Promise<void>
  onToggleComplete: () => Promise<void>
  onAcknowledge: () => Promise<void>
  onDeleteAttachment: (attachment: TaskAttachmentRow) => Promise<void>
  onRetryNotification: (deliveryId: string) => Promise<void>
}) {
  const { language, text } = useLanguage()
  const [draft, setDraft] = useState<TaskDraft>(blankDraft(selectedDate, userId))
  const [dueDateText, setDueDateText] = useState(() => formatDisplayDate(selectedDate ?? bangkokDate()))
  const [recipientTab, setRecipientTab] = useState<RecipientTab>('self')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const initializedDraft = useRef<string | null>(null)
  const affiliationEdited = useRef(false)

  useEffect(() => {
    if (!open) {
      initializedDraft.current = null
      return
    }
    if (task && !details) return
    const key = task?.id ?? `new:${selectedDate ?? ''}`
    if (initializedDraft.current === key) return
    initializedDraft.current = key
    affiliationEdited.current = false
    setError('')
    if (!task) {
      setDraft({ ...blankDraft(selectedDate, userId), affiliation: defaultAffiliation })
      setDueDateText(formatDisplayDate(selectedDate ?? bangkokDate()))
      setRecipientTab('self')
      return
    }
    const internalIds = details?.internalRecipients.map((recipient) => recipient.user_id) ?? (task.assignee_user_id ? [task.assignee_user_id] : [])
    setRecipientTab(internalIds.includes(userId) ? 'self' : internalIds.length ? 'internal' : 'external')
    setDueDateText(formatDisplayDate(task.due_date))
    const isContinuous = details?.reminderMode === 'continuous' || details?.reminderKeys.includes('continuous')
    setDraft({
      title: task.title,
      description: task.description,
      affiliation: task.affiliation,
      dueDate: task.due_date,
      dueTime: task.due_time?.slice(0, 5) ?? '',
      internalUserIds: internalIds,
      externalEmails: details?.externalRecipients.length ? details.externalRecipients.map((recipient) => recipient.email) : [task.external_assignee_email ?? ''],
      linkedEventId: task.linked_event_id ?? '',
      reminderMode: isContinuous ? 'continuous' : 'single',
      reminderKeys: details?.reminderKeys.filter((k) => k !== 'continuous') ?? [],
      continuousConfig: details?.continuousConfig ?? { startDaysBefore: 3, frequency: 'daily' },
      notifyEmail: details?.notifyEmail ?? true,
      notifyLine: details?.notifyLine ?? false,
      files: [],
      driveLinks: details?.documentLinks.length
        ? details.documentLinks.map((link) => ({ displayName: link.display_name, url: link.url }))
        : [{ displayName: '', url: '' }],
    })
  }, [details, open, selectedDate, task, userId, hasConnectedDevices, defaultAffiliation])

  useEffect(() => {
    if (open && !task && !affiliationEdited.current && defaultAffiliation) {
      setDraft((current) => current.affiliation === defaultAffiliation ? current : { ...current, affiliation: defaultAffiliation })
    }
  }, [open, task, defaultAffiliation])

  if (!open) return null

  if (task && !details) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4" role="dialog" aria-modal="true">
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white p-8 shadow-2xl">
          <Loader2 className="h-8 w-8 animate-spin text-amber-700" />
          <p className="text-sm font-semibold text-slate-700">{text('กำลังโหลดข้อมูลงาน...', 'Loading task details...')}</p>
        </div>
      </div>
    )
  }
  const set = <K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const toggleReminder = (key: TaskReminderKey) =>
    set('reminderKeys', draft.reminderKeys.includes(key) ? draft.reminderKeys.filter((item) => item !== key) : [...draft.reminderKeys, key])
  const setDriveLink = (index: number, value: DriveLinkDraft) =>
    set('driveLinks', draft.driveLinks.map((item, itemIndex) => (itemIndex === index ? value : item)))
  const setExternalEmail = (index: number, value: string) =>
    set('externalEmails', draft.externalEmails.map((email, itemIndex) => (itemIndex === index ? value : email)))

  const creationDateInPast = !task && isPastBangkokDate(draft.dueDate)
  const continuousStartDate = draft.dueDate ? calculateContinuousStartDate(draft.dueDate, draft.continuousConfig.startDaysBefore) : ''
  const isContinuousStartInPast = draft.reminderMode === 'continuous' && Boolean(continuousStartDate) && isPastBangkokDate(continuousStartDate)
  const expiredSingleReminderKeys = draft.reminderMode === 'single'
    ? pastTaskSingleReminderKeys(draft.dueDate, draft.dueTime, draft.reminderKeys)
    : []
  const hasExpiredSingleReminders = expiredSingleReminderKeys.length > 0
  const daysRemaining = draft.dueDate ? daysBetweenBangkokDates(bangkokDate(), draft.dueDate) : 0

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
    if (!draft.title.trim() || !draft.dueDate) {
      setError(text('กรุณากรอกชื่องานและวันที่ครบกำหนด', 'Enter a task title and due date.'))
      return false
    }
    if (creationDateInPast) {
      setError(text('ไม่สามารถสร้าง Task ในวันที่ผ่านมาแล้ว', 'A task cannot be created in the past.'))
      return false
    }
    if (draft.reminderMode === 'single' && hasExpiredSingleReminders) {
      const labels = expiredSingleReminderKeys.map((k) => taskSingleReminderOptionLabel(k, language)).join(', ')
      setError(
        text(
          `ไม่สามารถบันทึกได้ เนื่องจากเวลาแจ้งเตือน (${labels}) ผ่านมาแล้ว กรุณาเลือกเฉพาะเวลาที่ยังมาไม่ถึง`,
          `Cannot save: reminder time (${labels}) has already passed. Please choose only upcoming reminder times.`
        )
      )
      return false
    }
    if (draft.reminderMode === 'continuous' && isContinuousStartInPast) {
      setError(
        text(
          `วันที่เริ่มแจ้งเตือน (${formatDisplayDate(continuousStartDate)}) เป็นวันที่ผ่านมาแล้ว (คงเหลืออีก ${Math.max(0, daysRemaining)} วันก่อนครบกำหนด) กรุณาเลือกจำนวนวันล่วงหน้าไม่เกินวันคงเหลือ`,
          `Reminder start date (${formatDisplayDate(continuousStartDate)}) has already passed (${Math.max(0, daysRemaining)} days remaining). Please choose within remaining days.`
        )
      )
      return false
    }
    const externalEmails = normalizeExternalEmails(draft.externalEmails)
    if (!draft.internalUserIds.length && !externalEmails.length) {
      setError(text('กรุณาเลือกผู้รับมอบหมายอย่างน้อยหนึ่งคน', 'Choose at least one assignee.'))
      return false
    }
    if (invalidExternalEmails(draft.externalEmails).length) {
      setError(text('ผู้รับภายนอกต้องเป็น Gmail ที่ถูกต้อง', 'External recipients must use valid Gmail addresses.'))
      return false
    }
    const links = draft.driveLinks.filter((link) => link.displayName.trim() || link.url.trim())
    if (links.length > 10) {
      setError(text('เพิ่มลิงก์ Google Drive ได้สูงสุด 10 รายการ', 'You can add up to 10 Google Drive links.'))
      return false
    }
    if (links.some((link) => !link.displayName.trim() || !isGoogleDocumentUrl(link.url.trim()))) {
      setError(text('กรุณาใส่ชื่อและลิงก์ Google Drive/Docs ที่ถูกต้อง', 'Enter a name and a valid Google Drive or Docs link.'))
      return false
    }
    const attachmentError = validateAttachments(draft.files, details?.attachments.length ?? 0)
    if (attachmentError) {
      setError(attachmentError)
      return false
    }
    const hasReminders = draft.reminderMode === 'continuous' || draft.reminderKeys.length > 0
    const activeNotifyLine = draft.notifyLine && draft.internalUserIds.length > 0
    if (hasReminders && !draft.notifyEmail && !activeNotifyLine) {
      setError(text('กรุณาเลือกช่องทางแจ้งเตือนอย่างน้อย 1 ช่องทาง', 'Choose at least one notification channel.'))
      return false
    }
    setError('')
    try {
      await onSave({ ...draft, driveLinks: links }, notifyRecipients)
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
        text:
          task?.status === 'completed'
            ? text('Task นี้เสร็จแล้ว จึงไม่สามารถส่งการแจ้งเตือนได้', 'This task is complete, so no notification can be sent.')
            : text('Task นี้ถูกยกเลิกแล้ว จึงไม่สามารถส่งการแจ้งเตือนได้', 'This task is cancelled, so no notification can be sent.'),
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
          text: notifyRecipients
            ? text('บันทึกการแก้ไขและแจ้งเตือนผู้รับแล้ว', 'Changes saved and recipients notified.')
            : text('บันทึกการแก้ไขเรียบร้อยแล้ว', 'Changes saved.'),
          showConfirmButton: false,
          timer: 2000,
          timerProgressBar: true,
        })
        onClose()
      }
    } finally {
      setSaving(false)
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (task) {
      void confirmSave()
      return
    }
    void (async () => {
      setSaving(true)
      try {
        if (await save(true)) {
          await Swal.fire({
            icon: 'success',
            title: text('สำเร็จ', 'Success'),
            text: text('สร้าง Task เรียบร้อยแล้ว', 'Task created.'),
            showConfirmButton: false,
            timer: 2000,
            timerProgressBar: true,
          })
          onClose()
        }
      } finally {
        setSaving(false)
      }
    })()
  }

  const notificationAcknowledgements: Record<string, string | null> = {}
  for (const recipient of details?.externalRecipients ?? []) notificationAcknowledgements[recipient.email.toLowerCase()] = recipient.acknowledged_at
  for (const recipient of details?.internalRecipients ?? []) {
    const email = profiles.find((profile) => profile.id === recipient.user_id)?.email
    if (email) notificationAcknowledgements[email.toLowerCase()] = recipient.acknowledged_at
  }
  const reminderStatus = (status: TaskReminderStatusRow['status']) => text(
    ({ scheduled: 'กำหนดส่ง', processing: 'กำลังจัดคิว', completed: 'จัดคิวส่งแล้ว', cancelled: 'ข้ามการส่ง', deferred_quota: 'รอโควตา' } as const)[status],
    ({ scheduled: 'Scheduled', processing: 'Queueing', completed: 'Queued', cancelled: 'Skipped', deferred_quota: 'Waiting for quota' } as const)[status],
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/35 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="task-title">
      <section className="max-h-[95vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between">
          <div className="flex gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700">
              <CheckCircle2 size={22} />
            </span>
            <div>
              <h2 id="task-title" className="text-xl font-bold">
                {task ? text('รายละเอียด Task', 'Task details') : text('เพิ่ม Task', 'Add task')}
              </h2>
              {task && !canEdit && (
                <p className="text-sm text-slate-500">
                  {text('ดูและดาวน์โหลดเอกสารได้ โดยแก้ไขรายละเอียดไม่ได้', 'You can view and download documents, but cannot edit the details.')}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {task && (
              <p className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {text('สร้างโดย', 'Created by')} {task.creator_name || text('ไม่ระบุชื่อ', 'Unknown')}
              </p>
            )}
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label={text('ปิด', 'Close')}>
              <X size={20} />
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <fieldset disabled={!canEdit || busy || saving} className="space-y-5 disabled:opacity-75">
            <section className="space-y-4 rounded-xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800">
                <FileText size={18} className="text-amber-700" />
                {text('ข้อมูลงาน', 'Task details')}
              </h3>
              <div>
                <label className="field-label" htmlFor="task-name">
                  {text('ชื่องาน *', 'Task title *')}
                </label>
                <input id="task-name" className="field-input" value={draft.title} onChange={(event) => set('title', event.target.value)} maxLength={180} />
              </div>
              <div>
                <label className="field-label" htmlFor="task-affiliation">
                  {text('หน่วยงาน / สังกัด', 'Department / affiliation')}
                </label>
                <input
                  id="task-affiliation"
                  className="field-input"
                  placeholder={text('กคน.ฝลส.', 'e.g. Department')}
                  value={draft.affiliation}
                  onChange={(event) => { affiliationEdited.current = true; set('affiliation', event.target.value) }}
                  maxLength={250}
                />
                {!task && defaultAffiliation && <p className="mt-1 text-xs text-slate-500">{text('เติมสังกัดจากข้อมูลสมาชิกแล้ว ปรับได้ตามงานนี้', 'Filled from your profile. You can adjust it for this task.')}</p>}
              </div>
              <div>
                <label className="field-label" htmlFor="task-description">
                  {text('รายละเอียด / คำสั่งงาน', 'Details / instructions')}
                </label>
                <textarea
                  id="task-description"
                  className="field-input min-h-28 resize-y"
                  value={draft.description}
                  onChange={(event) => set('description', event.target.value)}
                  maxLength={10000}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="task-date">
                    {text('วันครบกำหนด *', 'Due date *')}
                  </label>
                  <div className="relative">
                    <input
                      id="task-date"
                      type="text"
                      inputMode="numeric"
                      placeholder="dd/mm/yyyy"
                      maxLength={10}
                      className="field-input pr-12"
                      value={dueDateText}
                      onChange={(event) => {
                        const value = event.target.value
                        setDueDateText(value)
                        set('dueDate', parseDisplayDate(value) ?? '')
                      }}
                      onBlur={() => {
                        const date = parseDisplayDate(dueDateText)
                        if (date) setDueDateText(formatDisplayDate(date))
                      }}
                    />
                    <label className="absolute inset-y-1 right-1 flex w-10 items-center justify-center rounded-lg text-brand-600 hover:bg-brand-50">
                      <CalendarDays size={19} aria-hidden="true" />
                      <input
                        type="date"
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        aria-label={text('เลือกวันครบกำหนดจากปฏิทิน', 'Choose due date from calendar')}
                        value={draft.dueDate}
                        min={task ? undefined : bangkokDate()}
                        onChange={(event) => {
                          set('dueDate', event.target.value)
                          setDueDateText(formatDisplayDate(event.target.value))
                        }}
                      />
                    </label>
                  </div>
                  {creationDateInPast && (
                    <p className="mt-1 text-sm text-red-600" role="alert">
                      {text('ไม่สามารถสร้าง Task ในวันที่ผ่านมาแล้ว', 'A task cannot be created in the past.')}
                    </p>
                  )}
                </div>
                <div>
                  <label className="field-label" htmlFor="task-time">
                    {text('เวลา (ไม่บังคับ)', 'Time (optional)')}
                  </label>
                  <TimeSelect id="task-time" value={draft.dueTime} onChange={(value) => set('dueTime', value)} optional />
                </div>
              </div>
            </section>
          </fieldset>

          <section className="space-y-3 rounded-xl border border-slate-200 p-4">
            <h3 className="flex items-center gap-2 font-semibold text-slate-800">
              <UserRound size={18} className="text-amber-700" />
              {text('ผู้รับมอบหมาย', 'Assignees')}
            </h3>
            <div role="tablist" aria-label={text('ประเภทผู้รับมอบหมาย', 'Assignee type')} className="grid grid-cols-1 gap-1 rounded-xl bg-slate-100 p-1 sm:grid-cols-3">
              {recipientTabs.map(({ key, label, count }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`task-recipient-tab-${key}`}
                  aria-controls={`task-recipient-panel-${key}`}
                  aria-selected={recipientTab === key}
                  onClick={() => setRecipientTab(key)}
                  className={`rounded-lg px-2 py-2 text-sm font-medium transition-colors ${recipientTab === key ? 'bg-white text-amber-800 shadow-sm' : 'text-slate-600 hover:bg-white/70'
                    }`}
                >
                  {label}
                  {count > 0 && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{count}</span>}
                </button>
              ))}
            </div>
            <fieldset disabled={!canEdit || busy || saving} className="disabled:opacity-75">
              {recipientTab === 'self' && (
                <div role="tabpanel" id="task-recipient-panel-self" aria-labelledby="task-recipient-tab-self">
                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={selfSelected}
                      onChange={(event) =>
                        set('internalUserIds', event.target.checked ? [...draft.internalUserIds, userId] : draft.internalUserIds.filter((id) => id !== userId))
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{selfProfile ? `${selfProfile.full_name} — ${selfProfile.email}` : text('ฉัน', 'Me')}</span>
                    {details?.internalRecipients.find((recipient) => recipient.user_id === userId)?.acknowledged_at && (
                      <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">{text('รับทราบแล้ว', 'Acknowledged')}</span>
                    )}
                  </label>
                </div>
              )}
              {recipientTab === 'internal' && (
                <div role="tabpanel" id="task-recipient-panel-internal" aria-labelledby="task-recipient-tab-internal" className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
                  {profiles
                    .filter((profile) => profile.status === 'active' && profile.id !== userId)
                    .map((profile) => (
                      <label key={profile.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={draft.internalUserIds.includes(profile.id)}
                          onChange={(event) =>
                            set('internalUserIds', event.target.checked ? [...draft.internalUserIds, profile.id] : draft.internalUserIds.filter((id) => id !== profile.id))
                          }
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {profile.full_name} — {profile.email}
                        </span>
                        {details?.internalRecipients.find((recipient) => recipient.user_id === profile.id)?.acknowledged_at && (
                          <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">{text('รับทราบแล้ว', 'Acknowledged')}</span>
                        )}
                      </label>
                    ))}
                  {!profiles.some((profile) => profile.status === 'active' && profile.id !== userId) && (
                    <p className="px-2 py-1.5 text-sm text-slate-500">{text('ไม่มีพนักงานอื่นในระบบ', 'There are no other employees in the system.')}</p>
                  )}
                </div>
              )}
              {recipientTab === 'external' && (
                <div role="tabpanel" id="task-recipient-panel-external" aria-labelledby="task-recipient-tab-external" className="space-y-2">
                  {draft.externalEmails.map((email, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <input
                        id={index === 0 ? 'external-email' : `external-email-${index + 1}`}
                        type="email"
                        className="field-input min-w-0 flex-1"
                        placeholder="name@gmail.com"
                        value={email}
                        onChange={(event) => setExternalEmail(index, event.target.value)}
                        aria-label={`${text('Gmail ผู้รับภายนอกคนที่', 'External Gmail recipient')} ${index + 1}`}
                      />
                      {details?.externalRecipients.find((recipient) => recipient.email === email.trim().toLowerCase())?.acknowledged_at && (
                        <span className="shrink-0 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">{text('รับทราบแล้ว', 'Acknowledged')}</span>
                      )}
                      {draft.externalEmails.length > 1 && (
                        <button
                          type="button"
                          className="shrink-0 rounded-xl border border-slate-300 p-2.5 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                          onClick={() => set('externalEmails', draft.externalEmails.filter((_, itemIndex) => itemIndex !== index))}
                          aria-label={`${text('ลบผู้รับภายนอก', 'Remove external recipient')} ${index + 1}`}
                        >
                          <X size={18} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" className="btn-secondary w-full" onClick={() => set('externalEmails', [...draft.externalEmails, ''])}>
                    <Plus size={17} />
                    {text('เพิ่มผู้รับทางอีเมล', 'Add email recipient')}
                  </button>
                </div>
              )}
            </fieldset>
            <p className="text-xs text-slate-500">
              {text('เลือกได้หลายคนและสลับแท็บได้โดยรายชื่อที่เลือกไว้ยังอยู่ ผู้สร้าง Task เท่านั้นที่ยืนยันว่าเสร็จแล้ว', 'You can select multiple people and switch tabs without losing selections. Only the task creator can mark it complete.')}
            </p>
          </section>

          <fieldset disabled={!canEdit || busy || saving} className="space-y-5 disabled:opacity-75">

            {/* Notification Section with 2 Modes */}
            <section className="space-y-4 rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 font-semibold text-slate-800">
                  <Bell size={18} className="text-amber-700" />
                  {text('การแจ้งเตือน', 'Notifications')}
                </h3>
              </div>

              {/* Mode Selector Tabs */}
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => set('reminderMode', 'single')}
                  className={`rounded-lg py-2 text-sm font-medium transition-all ${draft.reminderMode === 'single' ? 'bg-white text-amber-800 shadow-sm' : 'text-slate-600 hover:bg-white/60'
                    }`}
                >
                  {text('1. แจ้งครั้งเดียว', '1. Single reminder')}
                </button>
                <button
                  type="button"
                  onClick={() => set('reminderMode', 'continuous')}
                  className={`rounded-lg py-2 text-sm font-medium transition-all ${draft.reminderMode === 'continuous' ? 'bg-white text-amber-800 shadow-sm' : 'text-slate-600 hover:bg-white/60'
                    }`}
                >
                  {text('2. แจ้งต่อเนื่อง', '2. Continuous reminder')}
                </button>
              </div>

              {/* Mode 1: Single Reminders */}
              {draft.reminderMode === 'single' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">
                    {text('เลือกเวลาที่ต้องการให้ระบบแจ้งเตือน (เลือกได้หลายข้อ)', 'Choose notification timing (can select multiple)')}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {taskSingleReminderOptions.map((option) => {
                      const isPast = isTaskReminderKeyPast(draft.dueDate, draft.dueTime, option.key)
                      const isChecked = draft.reminderKeys.includes(option.key)
                      return (
                        <label
                          key={option.key}
                          className={`cursor-pointer select-none rounded-full border px-3 py-1.5 text-sm transition-colors ${isChecked && isPast
                              ? 'border-red-500 bg-red-50 font-medium text-red-800'
                              : isChecked
                                ? 'border-amber-500 bg-amber-50 font-medium text-amber-800'
                                : isPast
                                  ? 'border-slate-200 bg-slate-100 text-slate-400 opacity-60'
                                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={isChecked}
                            disabled={isPast && !isChecked}
                            onChange={() => toggleReminder(option.key)}
                          />
                          <span>
                            {text(
                              option.label,
                              ({
                                due: 'At the due time',
                                '1_hour': '1 hour before',
                                '1_day': '1 day before',
                                '3_days': '3 days before',
                                overdue: 'When overdue',
                                continuous: 'Continuous',
                              } as Record<string, string>)[option.key] || option.label
                            )}
                          </span>
                          {isPast && (
                            <span className={`ml-1 text-[11px] ${isChecked ? 'font-bold text-red-700' : 'text-slate-400'}`}>
                              {text('(ผ่านมาแล้ว)', '(Passed)')}
                            </span>
                          )}
                        </label>
                      )
                    })}
                  </div>

                  {hasExpiredSingleReminders && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50/90 p-3 text-sm text-red-900" role="alert">
                      <AlertTriangle className="mt-0.5 shrink-0 text-red-600" size={18} />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-red-950">
                          {text('ตัวเลือกแจ้งเตือนไม่สอดคล้องกับวันครบกำหนด', 'Reminder timing is incompatible with due date')}
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-red-800">
                          {text(
                            `การแจ้งเตือน [${expiredSingleReminderKeys.map((k) => taskSingleReminderOptionLabel(k, 'th')).join(', ')}] เป็นเวลาที่ผ่านมาแล้ว ไม่สามารถตั้งแจ้งเตือนได้ กรุณาคลิกเอาเครื่องหมายถูกออก`,
                            `The reminder(s) [${expiredSingleReminderKeys.map((k) => taskSingleReminderOptionLabel(k, 'en')).join(', ')}] have already passed. Please click to uncheck them.`
                          )}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Mode 2: Continuous Reminders */}
              {draft.reminderMode === 'continuous' && (
                <div className="space-y-3 rounded-xl border border-amber-200/70 bg-amber-50/50 p-3.5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="field-label text-xs" htmlFor="continuous-days">
                        {text('เริ่มแจ้งเตือนล่วงหน้า', 'Start notifying in advance')}
                      </label>
                      <select
                        id="continuous-days"
                        className={`field-input text-sm ${isContinuousStartInPast ? 'border-red-500 focus:border-red-500 focus:ring-red-200 bg-red-50/30' : ''}`}
                        value={draft.continuousConfig.startDaysBefore}
                        onChange={(event) =>
                          set('continuousConfig', {
                            ...draft.continuousConfig,
                            startDaysBefore: Number(event.target.value),
                          })
                        }
                      >
                        {continuousDayOptions.map((opt) => {
                          const optStartDate = draft.dueDate ? calculateContinuousStartDate(draft.dueDate, opt.days) : ''
                          const isOptPast = Boolean(optStartDate) && isPastBangkokDate(optStartDate)
                          return (
                            <option key={opt.days} value={opt.days} disabled={isOptPast}>
                              {text(
                                `${opt.labelTh}${isOptPast ? ' (ผ่านมาแล้ว)' : ''}`,
                                `${opt.labelEn}${isOptPast ? ' (Passed)' : ''}`
                              )}
                            </option>
                          )
                        })}
                      </select>
                      {isContinuousStartInPast ? (
                        <p className="mt-1 text-xs font-semibold text-red-600" role="alert">
                          ⚠️ {text(
                            `วันที่เริ่มแจ้งเตือน (${formatDisplayDate(continuousStartDate)}) เป็นวันที่ผ่านมาแล้ว (คงเหลืออีก ${Math.max(0, daysRemaining)} วันก่อนครบกำหนด) กรุณาเลือกจำนวนวันล่วงหน้าไม่เกินวันคงเหลือ`,
                            `Reminder start date (${formatDisplayDate(continuousStartDate)}) has already passed (${Math.max(0, daysRemaining)} days remaining). Please choose within remaining days.`
                          )}
                        </p>
                      ) : (
                        continuousStartDate && (
                          <p className="mt-1 text-[11px] text-slate-500">
                            {text(`ระบบจะเริ่มส่งแจ้งเตือนตั้งแต่วันที่ ${formatDisplayDate(continuousStartDate)}`, `Reminders will start on ${formatDisplayDate(continuousStartDate)}`)}
                          </p>
                        )
                      )}
                    </div>

                    <div>
                      <label className="field-label text-xs">
                        {text('ความถี่ในการแจ้งเตือน', 'Notification frequency')}
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            set('continuousConfig', {
                              ...draft.continuousConfig,
                              frequency: 'daily',
                            })
                          }
                          className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${draft.continuousConfig.frequency === 'daily'
                              ? 'border-amber-500 bg-amber-50 text-amber-800'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                          {text('ทุกวัน', 'Every day')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            set('continuousConfig', {
                              ...draft.continuousConfig,
                              frequency: 'weekdays',
                            })
                          }
                          className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-colors ${draft.continuousConfig.frequency === 'weekdays'
                              ? 'border-amber-500 bg-amber-50 text-amber-800'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                          {text('ทุกวันทำงาน (จ.-ศ.)', 'Every weekday (Mon-Fri)')}
                        </button>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-amber-800/85">
                    {text(
                      '🔔 แจ้งเตือนต่อเนื่องจนถึงวันครบกำหนด และหยุดแจ้งทันทีเมื่อกด “เสร็จสิ้น” (Task จะแสดงในปฏิทินเพียง 1 รายการในวันครบกำหนด)',
                      '🔔 Notifies continuously until due date and stops immediately when marked completed. (Task appears only once on its due date)'
                    )}
                  </p>
                </div>
              )}

              {/* Delivery Channels */}
              <div className="flex flex-wrap items-center gap-5 border-t border-slate-100 pt-3 text-sm">
                <span className="text-xs font-medium text-slate-500">{text('ช่องทางแจ้งเตือน:', 'Channels:')}</span>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={draft.notifyEmail} onChange={(event) => set('notifyEmail', event.target.checked)} />
                  <Mail size={16} className="text-slate-600" />
                  Gmail
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
                    checked={draft.notifyLine}
                    disabled={!hasConnectedDevices}
                    onChange={(event) => set('notifyLine', event.target.checked)}
                  />
                  <Smartphone size={16} className={hasConnectedDevices ? 'text-amber-700' : 'text-slate-400'} />
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
              {!task && (
                <p className="mt-2 text-xs text-slate-500">
                  {text('เมื่อเลือกแจ้งเตือนผ่านมือถือ ผู้สร้างจะได้รับข้อความยืนยันหลังบันทึกงาน ส่วนการเตือนตามกำหนดส่งให้ผู้รับมอบหมายในระบบ', 'With mobile notifications selected, the creator receives a confirmation after saving. Scheduled reminders go to internal assignees.')}
                </p>
              )}
              {!hasConnectedDevices && (
                <p className="mt-2 text-xs text-amber-700">
                  {text('💡 ยังไม่ได้เชื่อมต่อการแจ้งเตือนบนมือถือ ไปที่เมนู "เชื่อมต่อการแจ้งเตือนผ่านมือถือ" เพื่อสแกน QR Code เปิดใช้งาน', '💡 Mobile notification is not connected yet. Go to "Mobile Notifications" menu to pair your device.')}
                </p>
              )}
            </section>

            <section className="space-y-3 rounded-xl border border-slate-200 p-4">
              <h3 className="flex items-center gap-2 font-semibold text-slate-800">
                <Paperclip size={18} className="text-amber-700" />
                {text('เอกสารประกอบ', 'Supporting documents')}
              </h3>
              {details?.attachments.map((file) => (
                <div key={file.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <FileText size={16} />
                  <span className="min-w-0 flex-1 truncate">{file.file_name}</span>
                  <span className="text-xs text-slate-400">{(file.file_size / 1024 / 1024).toFixed(1)} MB</span>
                  {file.signedUrl && (
                    <a className="font-medium text-brand-600 hover:underline" href={file.signedUrl} download={file.file_name}>
                      {text('ดาวน์โหลด', 'Download')}
                    </a>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      className="font-medium text-red-600 hover:underline"
                      disabled={busy}
                      onClick={() => void onDeleteAttachment(file).catch(() => setError(text('ลบเอกสารไม่สำเร็จ', 'Could not delete document.')))}
                      aria-label={`${text('ลบ', 'Delete')} ${file.file_name}`}
                    >
                      {text('ลบ', 'Delete')}
                    </button>
                  )}
                </div>
              ))}
              {details?.documentLinks.map((link) => (
                <div key={link.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <Link2 size={16} />
                  <a className="truncate font-medium text-brand-600 hover:underline" href={link.url} target="_blank" rel="noreferrer">
                    {link.display_name}
                  </a>
                </div>
              ))}
              {draft.files.map((file, index) => (
                <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm">
                  <FileText size={16} />
                  <span className="truncate">{file.name}</span>
                  <button type="button" className="ml-auto text-slate-500 hover:text-red-600" onClick={() => set('files', draft.files.filter((_, itemIndex) => itemIndex !== index))}>
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
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])]
                  const message = validateAttachments([...draft.files, ...files], details?.attachments.length ?? 0)
                  if (message) setError(message)
                  else set('files', [...draft.files, ...files])
                  event.target.value = ''
                }}
              />
              <button type="button" className="btn-secondary" onClick={() => fileInput.current?.click()}>
                <Paperclip size={17} />
                {text('อัปโหลดไฟล์', 'Upload file')}
              </button>
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Link2 size={16} />
                  {text('ลิงก์ Google Drive', 'Google Drive links')}
                </p>
                {draft.driveLinks.map((link, index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-[0.8fr_1.5fr_auto]">
                    <input
                      className="field-input"
                      placeholder={text('ชื่อเอกสาร', 'Document name')}
                      value={link.displayName}
                      onChange={(event) => setDriveLink(index, { ...link, displayName: event.target.value })}
                    />
                    <input
                      type="url"
                      className="field-input"
                      placeholder="https://drive.google.com/..."
                      value={link.url}
                      onChange={(event) => setDriveLink(index, { ...link, url: event.target.value })}
                    />
                    <button
                      type="button"
                      className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:text-red-600"
                      onClick={() => set('driveLinks', draft.driveLinks.filter((_, itemIndex) => itemIndex !== index))}
                      aria-label={text('ลบลิงก์', 'Delete link')}
                    >
                      <X size={18} />
                    </button>
                  </div>
                ))}
                {draft.driveLinks.length < 10 && (
                  <button type="button" className="btn-secondary" onClick={() => set('driveLinks', [...draft.driveLinks, { displayName: '', url: '' }])}>
                    <Plus size={17} />
                    {text('เพิ่มลิงก์', 'Add link')}
                  </button>
                )}
              </div>
            </section>
          </fieldset>

          {task && canViewDeliveryStatus && (
            <section className="rounded-xl border border-brand-200 bg-brand-50/40 p-4">
              <div className="flex items-start gap-2">
                <Bell size={18} className="mt-0.5 shrink-0 text-brand-600" />
                <div>
                  <h3 className="font-semibold text-brand-950">{text('การแจ้งเตือน', 'Notifications')}</h3>
                  <p className="mt-1 text-xs text-brand-800">
                    {text('กำหนดงาน:', 'Task due:')}{' '}
                    {new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
                      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
                    }).format(new Date(`${task.due_date}T${task.due_time || '09:00:00'}+07:00`))}
                  </p>
                </div>
              </div>
              <details className="group mt-3 border-t border-brand-200/80">
                <summary className="flex cursor-pointer list-none items-center gap-2 py-3 [&::-webkit-details-marker]:hidden">
                  <Bell size={17} className="shrink-0 text-brand-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-800">{text('แจ้งเตือนตามกำหนดงาน', 'Scheduled task reminders')}</span>
                    <span className="block text-xs text-slate-600">{text('การเตือนล่วงหน้า เมื่อครบกำหนด และเกินกำหนด', 'Before the due time, at the due time and overdue')}</span>
                  </span>
                  <span className="flex items-center gap-1 text-xs font-medium text-slate-600">
                    {details?.reminders.length
                      ? text(`${details.reminders.length} รายการ`, `${details.reminders.length} item${details.reminders.length === 1 ? '' : 's'}`)
                      : text('ยังไม่ได้ตั้ง', 'Not set')}
                    <ChevronDown size={16} className="transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <div className="space-y-3 pb-4">
                  {!details?.reminders.length && (
                    <p className="rounded-lg bg-white/70 px-3 py-3 text-sm text-slate-600">
                      {text('ยังไม่ได้ตั้งการแจ้งเตือนสำหรับงานนี้', 'No reminder has been set for this task.')}
                    </p>
                  )}
                  <div className="space-y-2">
                    {details?.reminders.map((reminder) => (
                      <div key={reminder.id} className="rounded-lg bg-white/80 px-3 py-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-slate-800">
                            {text('กำหนดส่ง', 'Scheduled')}{' '}
                            {new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
                              dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
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
                  <NotificationDeliveryStatus
                    embedded deliveries={details?.reminderNotificationDeliveries ?? []}
                    acknowledgements={notificationAcknowledgements} onRetry={onRetryNotification}
                    title={{ thai: 'ผลการส่ง', english: 'Delivery status' }}
                    description={{ thai: 'แสดงเฉพาะการส่งตามกำหนดงานนี้', english: 'Only deliveries for this task’s scheduled reminders.' }}
                    emptyMessage={{ thai: 'ยังไม่ถึงเวลาส่ง หรือยังไม่มีผลการส่ง', english: 'This has not been sent yet or has no delivery result.' }}
                  />
                </div>
              </details>
              <details className="group border-t border-brand-200/80">
                <summary className="flex cursor-pointer list-none items-center gap-2 py-3 [&::-webkit-details-marker]:hidden">
                  <Mail size={17} className="shrink-0 text-brand-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-800">{text('แจ้งเตือนเมื่อสร้างหรือแก้ไขงาน', 'Notifications when a task is created or updated')}</span>
                    <span className="block text-xs text-slate-600">{text('ไม่ใช่การเตือนก่อนถึงกำหนดงาน', 'Not the before-due reminders above')}</span>
                  </span>
                  <span className="flex items-center gap-1 text-xs font-medium text-slate-600">
                    {details?.notificationDeliveries.length ? text('ดูสถานะ', 'View status') : text('ยังไม่มีรายการ', 'No messages')}
                    <ChevronDown size={16} className="transition-transform group-open:rotate-180" />
                  </span>
                </summary>
                <div className="pb-4">
                  <NotificationDeliveryStatus
                    embedded deliveries={details?.notificationDeliveries ?? []}
                    acknowledgements={notificationAcknowledgements} onRetry={onRetryNotification}
                    title={{ thai: 'ผลการส่ง', english: 'Delivery status' }}
                    description={{ thai: 'แสดงข้อความที่ส่งเมื่อสร้างหรือแก้ไขงาน', english: 'Shows messages sent when this task was created or updated.' }}
                    emptyMessage={{ thai: 'ยังไม่มีการส่งข้อความเมื่อสร้างหรือแก้ไขงานนี้', english: 'No messages have been sent for creating or updating this task.' }}
                  />
                </div>
              </details>
            </section>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-4">
            {task && canEdit ? (
              <button type="button" onClick={onDelete} className="btn-secondary border-red-200 text-red-600" disabled={busy}>
                <Trash2 size={17} />
                {text('ย้ายไปถังขยะ', 'Move to trash')}
              </button>
            ) : (
              <span />
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              <button type="button" onClick={onClose} className="btn-secondary">
                {text('ปิด', 'Close')}
              </button>
              {task && canAcknowledge && (
                <button type="button" className="btn-secondary" disabled={busy || saving} onClick={onAcknowledge}>
                  {text('รับทราบ', 'Acknowledge')}
                </button>
              )}
              {task && canComplete && (
                <button type="button" className="btn-secondary" disabled={busy || saving} onClick={onToggleComplete}>
                  <CheckCircle2 size={17} />
                  {task.status === 'completed' ? text('เปิดงานอีกครั้ง', 'Reopen task') : text('ยืนยันว่าทำ Task เสร็จแล้ว', 'Mark task complete')}
                </button>
              )}
              {canEdit &&
                (task ? (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy || saving || isContinuousStartInPast || hasExpiredSingleReminders}
                    onClick={() => void confirmSave()}
                  >
                    {(busy || saving) && <Loader2 className="animate-spin" size={17} />}
                    {text('บันทึก', 'Save')}
                  </button>
                ) : (
                  <button
                    className="btn-primary"
                    disabled={busy || saving || creationDateInPast || isContinuousStartInPast || hasExpiredSingleReminders}
                  >
                    {(busy || saving) && <Loader2 className="animate-spin" size={17} />}
                    {text('สร้าง Task', 'Create task')}
                  </button>
                ))}
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}
