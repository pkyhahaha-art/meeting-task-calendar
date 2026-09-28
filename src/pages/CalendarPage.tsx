import { useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import type { EventHoveringArg } from '@fullcalendar/core'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import thLocale from '@fullcalendar/core/locales/th'
import enGbLocale from '@fullcalendar/core/locales/en-gb'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck2, CalendarDays, CalendarPlus, CheckCircle2, Clock3, FileText, Link2, ListTodo, Search, Sparkles, Zap } from 'lucide-react'
import Swal from 'sweetalert2'
import bannerHero from '../../ภาพประกอบUI/PEA Calendar Banner 2D.png'
import { useAuth } from '../auth/AuthProvider'
import { useConfirm } from '../components/ConfirmDialogProvider'
import { EventDialog, type EventDetails, type EventDraft } from '../components/EventDialog'
import { TaskDialog, type TaskDetails, type TaskDraft } from '../components/TaskDialog'
import { useLanguage } from '../i18n/LanguageProvider'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Database } from '../lib/database.types'
import { bangkokDate, isPastBangkokDate, parseGuestEmails, recurrenceRule, reminderDate, type ReminderKey } from '../lib/eventForm'
import { appUrl } from '../lib/appUrl'
import { canManageMeeting, meetingCreateArgs } from '../lib/meetingAccess'
import { expandEvent } from '../lib/recurrence'
import { isTaskOverdue, normalizeExternalEmails, taskDueDateTime, taskReminderDate, type TaskReminderKey } from '../lib/taskForm'
import { supabase } from '../lib/supabase'

type EventRow = Database['public']['Tables']['events']['Row']
type GuestRow = Database['public']['Tables']['event_guests']['Row']
type ReminderRow = Database['public']['Tables']['reminders']['Row']
type AttachmentRow = Database['public']['Tables']['attachments']['Row']
type TaskRow = Database['public']['Tables']['tasks']['Row']
type TaskReminderRow = Database['public']['Tables']['task_reminders']['Row']
type TaskAttachmentRow = Database['public']['Tables']['task_attachments']['Row']
type TaskExternalRecipientRow = Database['public']['Tables']['task_external_recipients']['Row']
type TaskInternalRecipientRow = Database['public']['Tables']['task_internal_recipients']['Row']
type DocumentLinkRow = Database['public']['Tables']['document_links']['Row']
type ProfileRow = Database['public']['Tables']['profiles']['Row']
type CalendarTooltipItem = { kind: 'event' | 'task'; title: string; affiliation: string; date: Date; isOverdue: boolean }
type CalendarTooltip = { items: CalendarTooltipItem[]; x: number; y: number }
type RecentDocument = { id: string; kind: 'file' | 'link'; parent: 'event' | 'task'; parentId: string; name: string; addedAt: string }

function toIso(date: string, time: string, allDay: boolean) {
  if (allDay) return new Date(`${date}T00:00:00+07:00`).toISOString()
  return new Date(`${date}T${time}:00+07:00`).toISOString()
}

function reminderKey(row: ReminderRow): ReminderKey | null {
const key = `${row.offset_value}:${row.offset_unit}`
return ['0:minute', '1:month', '1:week', '3:day', '1:day'].includes(key) ? key as ReminderKey : null
}

function safeFileName(name: string) {
  return name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment'
}

function calendarDateLabel(date: Date, language: 'th' | 'en') {
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(date)
}

async function confirmDeletion(title: string, text: string, confirmButtonText: string) {
  const result = await Swal.fire({
    customClass: { popup: 'pea-swal-danger' },
    icon: 'error',
    title,
    text,
    showCancelButton: true,
    confirmButtonText,
    cancelButtonText: 'ยกเลิก',
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    reverseButtons: true,
    focusCancel: true,
  })
  return result.isConfirmed
}

function calendarDayKey(date: Date | string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(date))
  const value = (type: Intl.DateTimeFormatPart['type']) => parts.find((part) => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

export function CalendarPage() {
  const { user } = useAuth()
  const { language } = useLanguage()
  const { search: locationSearch } = useLocation()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showMeetings, setShowMeetings] = useState(true)
  const [showTasks, setShowTasks] = useState(true)
  const [showCompletedTasks, setShowCompletedTasks] = useState(true)
  const [showOverdue, setShowOverdue] = useState(true)
  const [sideTab, setSideTab] = useState<'upcoming' | 'documents'>('upcoming')
  const [taskSaveWarning, setTaskSaveWarning] = useState('')
  const [eventDialog, setEventDialog] = useState<{ open: boolean; event: EventRow | null; date?: string }>({ open: false, event: null })
  const [taskDialog, setTaskDialog] = useState<{ open: boolean; task: TaskRow | null; date?: string }>({ open: false, task: null })
  const [openedEventLink, setOpenedEventLink] = useState<string | null>(null)
  const [openedTaskLink, setOpenedTaskLink] = useState<string | null>(null)
  const [calendarTooltip, setCalendarTooltip] = useState<CalendarTooltip | null>(null)
  const attemptedEmailAcknowledgement = useRef<string | null>(null)

  const eventsQuery = useQuery({
    queryKey: ['events'],
    queryFn: async () => {
      const { data, error } = await supabase.from('events').select('*').eq('status', 'scheduled').is('deleted_at', null).order('start_datetime').returns<EventRow[]>()
      if (error) throw error
      return data
    },
  })
  const tasksQuery = useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tasks').select('*').is('deleted_at', null).order('due_date').order('due_time').returns<TaskRow[]>()
      if (error) throw error
      return data
    },
  })
  const linkedEventId = useMemo(() => new URLSearchParams(locationSearch).get('event'), [locationSearch])
  const linkedTaskId = useMemo(() => new URLSearchParams(locationSearch).get('task'), [locationSearch])
  const acknowledgeFromEmail = useMemo(() => new URLSearchParams(locationSearch).get('ack') === '1', [locationSearch])

  useEffect(() => {
    if (!linkedEventId || linkedEventId === openedEventLink) return
    const event = eventsQuery.data?.find((item) => item.id === linkedEventId)
    if (!event) return
    setEventDialog({ open: true, event })
    setOpenedEventLink(linkedEventId)
  }, [eventsQuery.data, linkedEventId, openedEventLink])

  useEffect(() => {
    if (!linkedTaskId || linkedTaskId === openedTaskLink) return
    const task = tasksQuery.data?.find((item) => item.id === linkedTaskId)
    if (!task) return
    setTaskDialog({ open: true, task })
    setOpenedTaskLink(linkedTaskId)
  }, [linkedTaskId, openedTaskLink, tasksQuery.data])
  const profilesQuery = useQuery({
    queryKey: ['assignable-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').eq('status', 'active').order('full_name').returns<ProfileRow[]>()
      if (error) throw error
      return data
    },
  })
  const recentDocumentsQuery = useQuery({
    queryKey: ['recent-documents'],
    enabled: sideTab === 'documents',
    queryFn: async (): Promise<RecentDocument[]> => {
      const [meetingFiles, taskFiles, taskLinks] = await Promise.all([
        supabase.from('attachments').select('*').order('uploaded_at', { ascending: false }).limit(10).returns<AttachmentRow[]>(),
        supabase.from('task_attachments').select('*').order('uploaded_at', { ascending: false }).limit(10).returns<TaskAttachmentRow[]>(),
        supabase.from('document_links').select('*').order('created_at', { ascending: false }).limit(10).returns<DocumentLinkRow[]>(),
      ])
      if (meetingFiles.error) throw meetingFiles.error
      if (taskFiles.error) throw taskFiles.error
      if (taskLinks.error) throw taskLinks.error
      return [
        ...meetingFiles.data.map((file) => ({ id: `meeting-file-${file.id}`, kind: 'file' as const, parent: 'event' as const, parentId: file.event_id, name: file.file_name, addedAt: file.uploaded_at })),
        ...taskFiles.data.map((file) => ({ id: `task-file-${file.id}`, kind: 'file' as const, parent: 'task' as const, parentId: file.task_id, name: file.file_name, addedAt: file.uploaded_at })),
        ...taskLinks.data.filter((link) => link.task_id).map((link) => ({ id: `task-link-${link.id}`, kind: 'link' as const, parent: 'task' as const, parentId: link.task_id!, name: link.display_name, addedAt: link.created_at })),
      ].sort((first, second) => second.addedAt.localeCompare(first.addedAt))
    },
  })

  const selectedEvent = eventDialog.event
  const eventDetailsQuery = useQuery({
    queryKey: ['event-details', selectedEvent?.id],
    enabled: Boolean(selectedEvent),
    refetchInterval: selectedEvent ? 3_000 : false,
    queryFn: async (): Promise<EventDetails> => {
      const eventId = selectedEvent!.id
      const [guests, reminders, attachments] = await Promise.all([
        supabase.from('event_guests').select('*').eq('event_id', eventId).is('revoked_at', null).returns<GuestRow[]>(),
        supabase.from('reminders').select('*').eq('event_id', eventId).eq('status', 'scheduled').returns<ReminderRow[]>(),
        supabase.from('attachments').select('*').eq('event_id', eventId).order('uploaded_at').returns<AttachmentRow[]>(),
      ])
      if (guests.error) throw guests.error
      if (reminders.error) throw reminders.error
      if (attachments.error) throw attachments.error
      const attachmentViews = await Promise.all(attachments.data.map(async (file) => {
        const { data, error } = await supabase.storage.from('meeting-documents').createSignedUrl(file.storage_path, 300, { download: file.file_name })
        if (error || !data) throw error ?? new Error('ไม่สามารถเปิดไฟล์แนบได้')
        return { ...file, signedUrl: data.signedUrl }
      }))
      const keys = reminders.data.map(reminderKey).filter((key): key is ReminderKey => Boolean(key))
      return { guestEmails: guests.data.map((guest) => guest.email), guestAcknowledgements: Object.fromEntries(guests.data.map((guest) => [guest.email.toLowerCase(), guest.acknowledged_at])), reminderKeys: keys, notifyEmail: reminders.data.some((item) => item.channel_email), notifyLine: reminders.data.some((item) => item.channel_line), attachments: attachmentViews }
    },
  })

  const selectedTask = taskDialog.task
  const taskDetailsQuery = useQuery({
    queryKey: ['task-details', selectedTask?.id],
    enabled: Boolean(selectedTask),
    refetchInterval: selectedTask ? 3_000 : false,
    queryFn: async (): Promise<TaskDetails> => {
      const taskId = selectedTask!.id
      const [reminders, attachments, documentLinks, externalRecipients, internalRecipients] = await Promise.all([
        supabase.from('task_reminders').select('*').eq('task_id', taskId).eq('status', 'scheduled').returns<TaskReminderRow[]>(),
        supabase.from('task_attachments').select('*').eq('task_id', taskId).order('uploaded_at').returns<TaskAttachmentRow[]>(),
        supabase.from('document_links').select('*').eq('task_id', taskId).order('created_at').returns<DocumentLinkRow[]>(),
        supabase.from('task_external_recipients').select('*').eq('task_id', taskId).order('email').returns<TaskExternalRecipientRow[]>(),
        supabase.from('task_internal_recipients').select('*').eq('task_id', taskId).returns<TaskInternalRecipientRow[]>(),
      ])
      if (reminders.error) throw reminders.error
      if (attachments.error) throw attachments.error
      if (documentLinks.error) throw documentLinks.error
      if (externalRecipients.error) throw externalRecipients.error
      if (internalRecipients.error) throw internalRecipients.error
      const attachmentViews = await Promise.all(attachments.data.map(async (file) => {
        const { data, error } = await supabase.storage.from('task-documents').createSignedUrl(file.storage_path, 300, { download: file.file_name })
        if (error || !data) throw error ?? new Error('ไม่สามารถเปิดเอกสารประกอบได้')
        return { ...file, signedUrl: data.signedUrl }
      }))
      return {
        reminderKeys: [...new Set(reminders.data.map((item) => item.reminder_key))] as TaskReminderKey[],
        notifyEmail: reminders.data.some((item) => item.channel_email),
        notifyLine: reminders.data.some((item) => item.channel_line),
        attachments: attachmentViews,
        documentLinks: documentLinks.data,
        externalRecipients: externalRecipients.data.map(({ email, acknowledged_at }) => ({ email, acknowledged_at })),
        internalRecipients: internalRecipients.data.map(({ user_id, acknowledged_at }) => ({ user_id, acknowledged_at })),
      }
    },
  })

  const eventMutation = useMutation({
    mutationFn: async ({ draft, event, notifyRecipients }: { draft: EventDraft; event: EventRow | null; notifyRecipients: boolean }) => {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) throw new Error('เซสชันหมดอายุ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่')
      const eventUserId = userData.user.id
      if (!event && isPastBangkokDate(draft.date)) throw new Error('ไม่สามารถสร้าง Meeting ในวันที่ผ่านมาแล้ว')
      const startIso = toIso(draft.date, draft.start, draft.all_day)
      const payload = { title: draft.title.trim(), description: draft.description.trim(), location: draft.location.trim(), affiliation: draft.affiliation.trim(), all_day: draft.all_day, start_datetime: startIso, end_datetime: draft.end ? toIso(draft.date, draft.end, draft.all_day) : null, recurrence_rule: recurrenceRule(draft.recurrence) }
      let eventId = event?.id
      if (eventId) {
        const { error } = await supabase.from('events').update({ ...payload, suppress_guest_notifications: true }).eq('id', eventId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.rpc('create_meeting_event', meetingCreateArgs(payload)).single<EventRow>()
        if (error) throw error
        eventId = data.id
      }
      const [existingGuests, deletedReminders] = await Promise.all([
        supabase.from('event_guests').select('id, email').eq('event_id', eventId).is('revoked_at', null),
        supabase.from('reminders').delete().eq('event_id', eventId),
      ])
      if (existingGuests.error) throw existingGuests.error
      if (deletedReminders.error) throw deletedReminders.error
      const emails = parseGuestEmails(draft.guestEmails)
      const removedIds = (existingGuests.data ?? []).filter((guest) => !emails.includes(guest.email.toLowerCase())).map((guest) => guest.id)
      if (removedIds.length) {
        const { error } = await supabase.from('event_guests').delete().in('id', removedIds)
        if (error) throw error
      }
      const existingEmails = new Set((existingGuests.data ?? []).map((guest) => guest.email.toLowerCase()))
      const addedEmails = emails.filter((email) => !existingEmails.has(email))
      if (addedEmails.length) {
        const { error } = await supabase.from('event_guests').insert(addedEmails.map((email) => ({ event_id: eventId!, email })))
        if (error) throw error
      }
      if (draft.reminderKeys.length) {
        const start = new Date(startIso)
        const reminders = draft.reminderKeys.map((key) => {
          const [value, unit] = key.split(':') as [string, 'minute' | 'day' | 'week' | 'month']
          const scheduledAt = reminderDate(start, key)
          return { event_id: eventId!, offset_value: Number(value), offset_unit: unit, scheduled_at: scheduledAt.toISOString(), channel_email: draft.notifyEmail, channel_line: draft.notifyLine,
            status: event && !notifyRecipients && scheduledAt.getTime() <= Date.now() ? 'cancelled' as const : 'scheduled' as const }
        })
        const { error } = await supabase.from('reminders').insert(reminders)
        if (error) throw error
      }
      for (const file of draft.files) {
        const storagePath = `${eventUserId}/${eventId}/${crypto.randomUUID()}-${safeFileName(file.name)}`
        const uploaded = await supabase.storage.from('meeting-documents').upload(storagePath, file, { contentType: file.type, upsert: false })
        if (uploaded.error) throw uploaded.error
        const { error } = await supabase.from('attachments').insert({ event_id: eventId, file_name: file.name, mime_type: file.type, file_size: file.size, storage_path: storagePath, uploaded_by: eventUserId })
        if (error) { await supabase.storage.from('meeting-documents').remove([storagePath]); throw error }
      }
      if (event) {
        const { error } = await supabase.from('events').update({
          suppress_guest_notifications: false,
          ...(notifyRecipients ? { notification_requested_at: new Date().toISOString() } : {}),
        }).eq('id', eventId)
        if (error) throw error
      }
    },
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['events'] }), queryClient.invalidateQueries({ queryKey: ['event-details'] }), queryClient.invalidateQueries({ queryKey: ['recent-documents'] }), queryClient.invalidateQueries({ queryKey: ['event-creation-stats'] })])
      setEventDialog({ open: false, event: null })
    },
  })

  const taskMutation = useMutation({
    onMutate: () => setTaskSaveWarning(''),
    mutationFn: async ({ draft, task, notifyRecipients }: { draft: TaskDraft; task: TaskRow | null; notifyRecipients: boolean }) => {
      if (!task && isPastBangkokDate(draft.dueDate)) throw new Error('ไม่สามารถสร้าง Task ในวันที่ผ่านมาแล้ว')
      const internalUserIds = [...new Set(draft.internalUserIds)]
      const externalEmails = normalizeExternalEmails(draft.externalEmails)
      const hasInternal = internalUserIds.length > 0
      const primaryInternal = hasInternal
        ? task?.assignee_user_id && internalUserIds.includes(task.assignee_user_id) ? task.assignee_user_id : internalUserIds[0]
        : null
      const primaryExternal = !hasInternal
        ? task?.external_assignee_email && externalEmails.includes(task.external_assignee_email) ? task.external_assignee_email : externalEmails[0]
        : null
      let externalAccessToken = ''
      if (externalEmails.length && notifyRecipients) {
        const { data, error } = await supabase.auth.refreshSession()
        if (error || !data.session) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง')
        externalAccessToken = data.session.access_token
      }
      const payload = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        affiliation: draft.affiliation.trim(),
        due_date: draft.dueDate,
        due_time: draft.dueTime || null,
        assignee_type: hasInternal ? 'internal' as const : 'external' as const,
        assignee_user_id: primaryInternal,
        external_assignee_email: primaryExternal,
        linked_event_id: draft.linkedEventId || null,
        recurrence_rule: recurrenceRule(draft.recurrence),
      }
      let taskId = task?.id
      let taskSaved = false
      try {
        if (taskId) {
          const { error } = await supabase.from('tasks').update(payload).eq('id', taskId)
          if (error) throw error
        } else {
          const { data, error } = await supabase.from('tasks').insert({ ...payload, creator_user_id: user!.id }).select('*').single<TaskRow>()
          if (error) throw error
          taskId = data.id
        }
        taskSaved = true

        const internalResult = await supabase.rpc('replace_task_internal_recipients', { target_task_id: taskId, recipient_user_ids: internalUserIds })
        if (internalResult.error) throw internalResult.error
        const externalResult = await supabase.rpc('replace_task_external_recipients', { target_task_id: taskId, recipient_emails: externalEmails })
        if (externalResult.error) throw externalResult.error

        const [deletedReminders, deletedLinks] = await Promise.all([
          supabase.from('task_reminders').delete().eq('task_id', taskId),
          supabase.from('document_links').delete().eq('task_id', taskId),
        ])
        if (deletedReminders.error) throw deletedReminders.error
        if (deletedLinks.error) throw deletedLinks.error

        if (draft.reminderKeys.length) {
          const due = taskDueDateTime(draft.dueDate, draft.dueTime)
          const reminders = draft.reminderKeys.map((key) => {
            const scheduledAt = taskReminderDate(due, key)
            return { task_id: taskId!, reminder_key: key, scheduled_at: scheduledAt.toISOString(),
              channel_email: draft.notifyEmail, channel_line: hasInternal && draft.notifyLine,
              status: task && !notifyRecipients && scheduledAt.getTime() <= Date.now() ? 'cancelled' as const : 'scheduled' as const }
          })
          const { error } = await supabase.from('task_reminders').insert(reminders)
          if (error) throw error
        }
        if (draft.driveLinks.length) {
          const { error } = await supabase.from('document_links').insert(draft.driveLinks.map((link) => ({
            task_id: taskId!, display_name: link.displayName.trim(), url: link.url.trim(), added_by: user!.id,
          })))
          if (error) throw error
        }
        for (const file of draft.files) {
          const storagePath = `${user!.id}/${taskId}/${crypto.randomUUID()}-${safeFileName(file.name)}`
          const uploaded = await supabase.storage.from('task-documents').upload(storagePath, file, { contentType: file.type, upsert: false })
          if (uploaded.error) throw uploaded.error
          const { error } = await supabase.from('task_attachments').insert({ task_id: taskId, file_name: file.name, mime_type: file.type, file_size: file.size, storage_path: storagePath, uploaded_by: user!.id })
          if (error) { await supabase.storage.from('task-documents').remove([storagePath]); throw error }
        }
        if (notifyRecipients && hasInternal) {
          const { error } = await supabase.from('tasks').update({ notification_requested_at: new Date().toISOString() }).eq('id', taskId)
          if (error) throw error
        }
        let warning = ''
        if (externalEmails.length && notifyRecipients) {
          try {
            const { error } = await supabase.functions.invoke('external-task', {
              // Keep publicUrl until the deployed Function accepts server-generated links.
              body: { action: 'issue', taskId, publicUrl: appUrl('/external-task'), notificationType: task ? 'task_updated' : 'task_assigned' },
              headers: { Authorization: `Bearer ${externalAccessToken}` },
            })
            if (error) {
              const context = (error as { context?: { json?: () => Promise<unknown> } }).context
              const details = context && typeof context.json === 'function'
                ? await context.json().catch(() => null) as { error?: string } | null
                : null
              throw new Error(details?.error || error.message)
            }
          } catch (reason) {
            warning = `บันทึก Task แล้ว แต่ยังยืนยันการส่งแจ้งเตือนถึงผู้รับภายนอกไม่ได้: ${reason instanceof Error ? reason.message : 'กรุณาตรวจสอบสถานะการแจ้งเตือน'}`
          }
        }
        return { warning }
      } catch (reason) {
        if (!taskSaved) throw reason
        return { warning: `บันทึก Task แล้ว แต่ข้อมูลประกอบหรือการแจ้งเตือนอาจยังไม่ครบ: ${reason instanceof Error ? reason.message : 'กรุณาตรวจสอบ Task ก่อนทำรายการซ้ำ'}` }
      }
    },
    onSuccess: async ({ warning }) => {
      setTaskSaveWarning(warning)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['tasks'] }), queryClient.invalidateQueries({ queryKey: ['task-details'] }), queryClient.invalidateQueries({ queryKey: ['recent-documents'] }), queryClient.invalidateQueries({ queryKey: ['event-creation-stats'] })])
      setTaskDialog({ open: false, task: null })
    },
  })

  const deleteEventMutation = useMutation({
    mutationFn: async (event: EventRow) => { const { error } = await supabase.from('events').update({ deleted_at: new Date().toISOString() }).eq('id', event.id); if (error) throw error },
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['events'] }), queryClient.invalidateQueries({ queryKey: ['event-creation-stats'] })]); setEventDialog({ open: false, event: null }) },
  })
  const deleteEventAttachmentMutation = useMutation({
    mutationFn: async (attachment: AttachmentRow) => {
      const { error: storageError } = await supabase.storage.from('meeting-documents').remove([attachment.storage_path])
      if (storageError) throw storageError
      const { error } = await supabase.from('attachments').delete().eq('id', attachment.id).eq('event_id', attachment.event_id)
      if (error) throw error
    },
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['event-details', selectedEvent?.id] }), queryClient.invalidateQueries({ queryKey: ['recent-documents'] })]) },
  })
  const deleteTaskMutation = useMutation({
    mutationFn: async (task: TaskRow) => { const { error } = await supabase.from('tasks').update({ deleted_at: new Date().toISOString(), status: 'cancelled' }).eq('id', task.id); if (error) throw error },
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['tasks'] }), queryClient.invalidateQueries({ queryKey: ['event-creation-stats'] })]); setTaskDialog({ open: false, task: null }) },
  })
  const deleteTaskAttachmentMutation = useMutation({
    mutationFn: async (attachment: TaskAttachmentRow) => {
      const { error: storageError } = await supabase.storage.from('task-documents').remove([attachment.storage_path])
      if (storageError) throw storageError
      const { error } = await supabase.from('task_attachments').delete().eq('id', attachment.id).eq('task_id', attachment.task_id)
      if (error) throw error
    },
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['task-details', selectedTask?.id] }), queryClient.invalidateQueries({ queryKey: ['recent-documents'] })]) },
  })
  const toggleTaskMutation = useMutation({
    mutationFn: async (task: TaskRow) => { const { error } = await supabase.from('tasks').update({ status: task.status === 'completed' ? 'pending' : 'completed' }).eq('id', task.id); if (error) throw error },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['tasks'] }); setTaskDialog({ open: false, task: null }) },
  })
  const acknowledgeTaskMutation = useMutation({
    mutationFn: async (task: TaskRow) => {
      const { error } = await supabase.rpc('acknowledge_task', { target_task_id: task.id })
      if (error) throw error
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['task-details', selectedTask?.id] }) },
  })
  useEffect(() => {
    if (!acknowledgeFromEmail) attemptedEmailAcknowledgement.current = null
  }, [acknowledgeFromEmail])
  useEffect(() => {
    if (!acknowledgeFromEmail || !linkedTaskId || selectedTask?.id !== linkedTaskId || !taskDetailsQuery.data || !user) return
    if (attemptedEmailAcknowledgement.current === linkedTaskId) return
    const recipient = taskDetailsQuery.data.internalRecipients.find((item) => item.user_id === user.id)
    if (!recipient || selectedTask.creator_user_id === user.id || selectedTask.status !== 'pending' || recipient.acknowledged_at) {
      navigate(`/calendar?task=${encodeURIComponent(linkedTaskId)}`, { replace: true })
      return
    }
    attemptedEmailAcknowledgement.current = linkedTaskId
    void acknowledgeTaskMutation.mutateAsync(selectedTask).finally(() => {
      navigate(`/calendar?task=${encodeURIComponent(linkedTaskId)}`, { replace: true })
    }).catch(() => {})
  }, [acknowledgeFromEmail, linkedTaskId, navigate, selectedTask, taskDetailsQuery.data, user, acknowledgeTaskMutation])

  const normalizedSearch = search.trim().toLowerCase()
  const eventRows = useMemo(() => (eventsQuery.data ?? []).filter((event) => `${event.title} ${event.location} ${event.affiliation} ${event.description}`.toLowerCase().includes(normalizedSearch)), [eventsQuery.data, normalizedSearch])
  const taskRows = useMemo(() => (tasksQuery.data ?? []).filter((task) => (showCompletedTasks || task.status !== 'completed') && `${task.title} ${task.affiliation} ${task.description}`.toLowerCase().includes(normalizedSearch)), [normalizedSearch, showCompletedTasks, tasksQuery.data])
  const occurrenceStart = new Date(); occurrenceStart.setFullYear(occurrenceStart.getFullYear() - 1)
  const occurrenceEnd = new Date(); occurrenceEnd.setFullYear(occurrenceEnd.getFullYear() + 1)
  const calendarEntries = [
    ...(showMeetings ? eventRows.flatMap((event) => expandEvent(event, occurrenceStart, occurrenceEnd).map((occurrence) => {
      const isOverdue = isPastBangkokDate(calendarDayKey(occurrence.start))
      return { id: `event-${occurrence.key}`, title: event.title, start: occurrence.start, end: occurrence.end || undefined, allDay: event.all_day, backgroundColor: isOverdue ? '#fee2e2' : event.owner_user_id === user?.id ? '#edddf6' : '#f1e7fa', borderColor: 'transparent', textColor: isOverdue ? '#991b1b' : '#6b2170', extendedProps: { kind: 'event', row: event, isOverdue } }
    })) : []),
    ...(showTasks ? taskRows.map((task) => {
      const isOverdue = isTaskOverdue(task.status, task.due_date)
      return { id: `task-${task.id}`, title: task.title, start: task.due_time ? `${task.due_date}T${task.due_time.slice(0, 5)}:00+07:00` : task.due_date, allDay: !task.due_time, backgroundColor: isOverdue ? '#fee2e2' : task.status === 'completed' ? '#dcf8e9' : '#fff0ce', borderColor: 'transparent', textColor: isOverdue ? '#991b1b' : task.status === 'completed' ? '#166534' : '#92400e', extendedProps: { kind: 'task', row: task, isOverdue } }
    }) : []),
  ].filter((entry) => showOverdue || !entry.extendedProps.isOverdue)
  const today = bangkokDate()
  const todayEntries = calendarEntries.filter((entry) => calendarDayKey(entry.start) === today)
  const upcomingEntries = calendarEntries.filter((entry) => calendarDayKey(entry.start) >= today)
    .sort((first, second) => new Date(first.start).getTime() - new Date(second.start).getTime()).slice(0, 3)
  const recentDocuments = (recentDocumentsQuery.data ?? []).filter((document) => document.parent === 'event'
    ? eventsQuery.data?.some((event) => event.id === document.parentId)
    : tasksQuery.data?.some((task) => task.id === document.parentId)).slice(0, 3)
  const pendingCount = (tasksQuery.data ?? []).filter((task) => task.status === 'pending').length
  const completedCount = (tasksQuery.data ?? []).filter((task) => task.status === 'completed').length
  const openCalendarEntry = (entry: (typeof calendarEntries)[number]) => {
    if (entry.extendedProps.kind === 'task') setTaskDialog({ open: true, task: entry.extendedProps.row as TaskRow })
    else setEventDialog({ open: true, event: entry.extendedProps.row as EventRow })
  }
  const openRecentDocument = (document: RecentDocument) => {
    if (document.parent === 'task') {
      const task = tasksQuery.data?.find((item) => item.id === document.parentId)
      if (task) setTaskDialog({ open: true, task })
    } else {
      const event = eventsQuery.data?.find((item) => item.id === document.parentId)
      if (event) setEventDialog({ open: true, event })
    }
  }
  const setCalendarTooltipAt = (items: CalendarTooltipItem[], clientX: number, clientY: number) => {
    setCalendarTooltip({
      items,
      x: Math.max(12, Math.min(clientX + 14, window.innerWidth - 308)),
      y: Math.max(12, Math.min(clientY + 14, window.innerHeight - 180)),
    })
  }
  const showCalendarTooltip = (info: EventHoveringArg) => {
    const isTask = info.event.extendedProps.kind === 'task'
    const row = info.event.extendedProps.row as EventRow | TaskRow
    if (!info.event.start) return
    setCalendarTooltipAt([{
      kind: isTask ? 'task' : 'event',
      title: info.event.title,
      affiliation: row.affiliation || '-',
      date: info.event.start,
      isOverdue: Boolean(info.event.extendedProps.isOverdue),
    }], info.jsEvent.clientX, info.jsEvent.clientY)
  }
  const canEditEvent = canManageMeeting(selectedEvent?.owner_user_id, user?.id)
  const canEditTask = !selectedTask || selectedTask.creator_user_id === user?.id
  const canCompleteTask = Boolean(selectedTask && selectedTask.creator_user_id === user?.id)
  const canAcknowledgeTask = Boolean(selectedTask && selectedTask.creator_user_id !== user?.id && selectedTask.status === 'pending' && taskDetailsQuery.data?.internalRecipients.some((recipient) => recipient.user_id === user?.id && !recipient.acknowledged_at))
  const busy = eventMutation.isPending || taskMutation.isPending || deleteEventMutation.isPending || deleteTaskMutation.isPending || deleteEventAttachmentMutation.isPending || deleteTaskAttachmentMutation.isPending || toggleTaskMutation.isPending || acknowledgeTaskMutation.isPending
  const warnPastCreation = async (date: string) => {
    if (!isPastBangkokDate(date)) return false
    await confirm({ title: 'ไม่สามารถสร้างรายการย้อนหลัง', message: `ไม่สามารถสร้าง Meeting หรือ Task ก่อนวันที่ ${bangkokDate()} ได้`, confirmLabel: 'รับทราบ', tone: 'danger' })
    return true
  }

  return (
    <main className="mx-auto max-w-[1600px] p-4 sm:p-6 xl:flex xl:h-[calc(100vh-4rem)] xl:flex-col xl:overflow-hidden xl:p-3">
      <section className="relative mb-6 min-h-64 overflow-hidden rounded-[28px] border border-purple-100 bg-gradient-to-r from-[#f0dcff] via-[#fff0f7] to-[#eee6ff] px-6 py-7 shadow-sm sm:min-h-72 sm:px-8 xl:mb-2 xl:h-40 xl:min-h-0 xl:shrink-0 xl:px-8 xl:py-3" aria-label="ยินดีต้อนรับ">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]" aria-hidden="true">
          <span className="absolute -left-16 -top-24 h-64 w-64 rounded-full bg-white/35 blur-2xl" />
          <span className="absolute -bottom-24 right-8 h-64 w-64 rounded-full bg-purple-300/25 blur-2xl" />
          <div className="absolute bottom-[-3rem] left-[43%] hidden h-40 w-32 rotate-[-5deg] rounded-[22px] border-4 border-white/25 bg-white/10 p-3 sm:block xl:h-28 xl:w-24 xl:p-2">
            <span className="absolute -top-3 left-5 h-6 w-2 rounded-full bg-purple-300/30" />
            <span className="absolute -top-3 right-5 h-6 w-2 rounded-full bg-purple-300/30" />
            <span className="mt-3 grid grid-cols-3 gap-2 opacity-35 xl:gap-1.5">{Array.from({ length: 6 }, (_, index) => <span key={index} className={`aspect-square rounded-md ${index === 4 ? 'bg-purple-400/45' : 'bg-white/60'}`} />)}</span>
          </div>
          <Sparkles className="absolute left-[46%] top-8 hidden text-amber-400/80 drop-shadow-sm lg:block xl:top-3" size={24} />
          <span className="absolute left-[51%] top-14 hidden h-2.5 w-2.5 rounded-full bg-pink-300/80 lg:block xl:top-8" />
          <Clock3 className="absolute bottom-5 left-[57%] hidden text-brand-500/25 xl:block" size={34} strokeWidth={1.8} />
          <CheckCircle2 className="absolute left-[62%] top-4 hidden text-amber-500/30 xl:block" size={30} strokeWidth={2} />
          <span className="absolute left-[54%] top-3 hidden h-1.5 w-1.5 rounded-full bg-brand-400/30 xl:block" />
          <span className="absolute bottom-3 left-[65%] hidden h-12 w-24 rounded-[50%] border-t-2 border-purple-400/20 xl:block" />
        </div>
        <div className="relative z-20 max-w-full sm:max-w-[54%] xl:max-w-[56%]">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold text-brand-800 xl:mb-0.5 xl:text-[11px]"><Sparkles size={16} />จัดการนัดหมาย ประชุม งานสำคัญ <CalendarCheck2 className="text-violet-500" size={18} /></p>
          <h1 className="text-3xl font-extrabold leading-tight text-brand-900 sm:text-4xl xl:text-[1.65rem]">ให้ทุกวันเป็นวันของความสำเร็จ</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 xl:mt-1 xl:text-xs xl:leading-5">ปฏิทินอัจฉริยะสำหรับชาว กฟภ. ช่วยให้การทำงานเป็นระบบมากขึ้น<br className="hidden xl:block" /> นัดหมายง่าย ไม่พลาดทุกภารกิจ สู่อนาคตพลังงานที่ยั่งยืน</p>
          <p className="mt-4 inline-flex rounded-full bg-white/55 px-5 py-2 text-sm font-bold text-brand-700 shadow-sm backdrop-blur-sm xl:mt-2 xl:px-4 xl:py-1 xl:text-xs">“ ร่วมขับเคลื่อนพลังงาน เพื่อชีวิตที่ดีกว่าของทุกคน ”</p>
        </div>
        <div className="absolute right-[25.5rem] top-2 z-30 hidden -rotate-2 rounded-[22px] border border-purple-200/70 bg-white/80 px-4 py-2 pr-8 text-center text-xs font-bold leading-4 text-brand-800 shadow-sm backdrop-blur-sm xl:block">
          <span className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rotate-45 border-r border-t border-purple-200/70 bg-white/80" />
          <span className="relative z-10">นัดง่าย<br />งานราบรื่น<br />ไปด้วยกัน</span>
          <Zap className="absolute right-2 top-1/2 -translate-y-1/2 text-amber-500" size={18} />
        </div>
        <div className="absolute right-4 top-3 z-30 hidden rounded-[20px] bg-white/65 px-4 py-2 text-center text-[10px] font-bold leading-4 text-brand-800 shadow-sm backdrop-blur-sm xl:block">พลังงาน<br />เชื่อมโยงอนาคต <span className="text-pink-500">♥</span></div>
        <img src={bannerHero} alt="มาสคอต PEA โบกมือข้างปฏิทินและต้นไม้" className="pointer-events-none absolute bottom-0 right-2 z-10 hidden w-[46%] max-w-[40rem] object-contain drop-shadow-[0_12px_8px_rgba(76,15,93,0.28)] sm:block xl:right-8 xl:h-[9.75rem] xl:w-auto xl:max-w-none" />
      </section>
      <div className="grid gap-5 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_260px] xl:gap-3">
      <div className="min-w-0 xl:flex xl:min-h-0 xl:flex-col">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between xl:mb-1 xl:min-h-9 xl:shrink-0">
        <div><h2 className="text-2xl font-bold text-brand-900 xl:text-lg">ปฏิทิน Meeting & Task</h2></div>
        <div className="flex flex-wrap gap-2 xl:gap-1.5"><button className="btn-secondary xl:min-h-9 xl:px-3 xl:py-1.5 xl:text-sm" onClick={() => setTaskDialog({ open: true, task: null })}><ListTodo size={16} />เพิ่ม Task</button><button className="btn-primary xl:min-h-9 xl:px-3 xl:py-1.5 xl:text-sm" onClick={() => setEventDialog({ open: true, event: null })}><CalendarPlus size={16} />เพิ่ม Meeting</button></div>
      </div>
      <div className="card p-3 sm:p-5 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:p-3">
        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(235px,1fr)_minmax(0,2fr)] lg:items-start lg:gap-4 xl:mb-2 xl:grid-cols-[180px_minmax(0,1fr)] xl:gap-2 xl:shrink-0">
          <div className="relative w-full max-w-md xl:max-w-none"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input className="field-input pl-10 xl:px-3 xl:py-1.5 xl:pl-9 xl:text-xs" placeholder="ค้นหา Meeting หรือ Task" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <div className="flex flex-wrap justify-start gap-1.5 text-xs font-semibold lg:justify-end xl:flex-nowrap xl:gap-1" aria-label="ตัวกรองรายการในปฏิทิน">
            <label className={`flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border px-2.5 py-1.5 shadow-sm transition focus-within:ring-2 focus-within:ring-purple-300 xl:min-h-7 xl:gap-1 xl:px-1.5 xl:py-1 xl:text-[10px] ${showMeetings ? 'border-purple-300 bg-purple-100 text-purple-900' : 'border-slate-200 bg-white text-slate-500'}`}><input type="checkbox" className="h-4 w-4 accent-brand-600 xl:h-3 xl:w-3" checked={showMeetings} onChange={(event) => setShowMeetings(event.target.checked)} /><CalendarDays size={15} aria-hidden="true" /><span className="xl:hidden">แสดง Meeting</span><span className="hidden xl:inline">Meeting</span></label>
            <label className={`flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border px-2.5 py-1.5 shadow-sm transition focus-within:ring-2 focus-within:ring-amber-300 xl:min-h-7 xl:gap-1 xl:px-1.5 xl:py-1 xl:text-[10px] ${showTasks ? 'border-amber-300 bg-amber-100 text-amber-900' : 'border-slate-200 bg-white text-slate-500'}`}><input type="checkbox" className="h-4 w-4 accent-amber-600 xl:h-3 xl:w-3" checked={showTasks} onChange={(event) => setShowTasks(event.target.checked)} /><ListTodo size={15} aria-hidden="true" /><span className="xl:hidden">แสดง Task</span><span className="hidden xl:inline">Task</span></label>
            <label className={`flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border px-2.5 py-1.5 shadow-sm transition focus-within:ring-2 focus-within:ring-green-300 xl:min-h-7 xl:gap-1 xl:px-1.5 xl:py-1 xl:text-[10px] ${showCompletedTasks ? 'border-green-300 bg-green-100 text-green-900' : 'border-slate-200 bg-white text-slate-500'}`}><input type="checkbox" className="h-4 w-4 accent-green-600 xl:h-3 xl:w-3" checked={showCompletedTasks} onChange={(event) => setShowCompletedTasks(event.target.checked)} /><CheckCircle2 size={15} aria-hidden="true" /><span className="xl:hidden">แสดง Task ที่เสร็จแล้ว</span><span className="hidden xl:inline">Task เสร็จแล้ว</span></label>
            <label className={`flex min-h-9 max-w-full cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 py-1.5 shadow-sm transition focus-within:ring-2 focus-within:ring-red-300 lg:whitespace-nowrap xl:min-h-7 xl:gap-1 xl:px-1.5 xl:py-1 xl:text-[10px] ${showOverdue ? 'border-red-300 bg-red-100 text-red-900' : 'border-slate-200 bg-white text-slate-500'}`}><input type="checkbox" className="h-4 w-4 shrink-0 accent-red-600 xl:h-3 xl:w-3" checked={showOverdue} onChange={(event) => setShowOverdue(event.target.checked)} /><Clock3 size={15} className="shrink-0" aria-hidden="true" /><span className="xl:hidden">แสดง Task / Meeting เกินวันครบกำหนด/นัดหมาย</span><span className="hidden xl:inline">เกินกำหนด</span></label>
          </div>
        </div>
        {(eventsQuery.isError || tasksQuery.isError || profilesQuery.isError) && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">โหลดข้อมูลไม่สำเร็จ กรุณาตรวจสอบว่าได้รัน migration ล่าสุดแล้ว</p>}
        <div className="calendar-fill relative xl:min-h-0 xl:flex-1">
        <FullCalendar
          plugins={[dayGridPlugin, interactionPlugin]}
          locale={language === 'th' ? thLocale : enGbLocale}
          initialView="dayGridMonth"
          firstDay={1}
          height="100%"
          expandRows
          fixedWeekCount={false}
          selectable
          dateClick={(info) => { void warnPastCreation(info.dateStr).then((isPast) => { if (!isPast) setEventDialog({ open: true, event: null, date: info.dateStr }) }) }}
          dayCellContent={(info) => {
            const items = calendarEntries.filter((entry) => calendarDayKey(entry.start) === calendarDayKey(info.date)).map((entry) => {
              const row = entry.extendedProps.row as EventRow | TaskRow
              return { kind: entry.extendedProps.kind as CalendarTooltipItem['kind'], title: entry.title, affiliation: row.affiliation || '-', date: info.date, isOverdue: Boolean(entry.extendedProps.isOverdue) }
            })
            return <span className={items.length ? 'cursor-help' : undefined} onMouseEnter={(event) => { if (items.length) setCalendarTooltipAt(items, event.clientX, event.clientY) }} onMouseLeave={() => setCalendarTooltip(null)}>{info.dayNumberText}</span>
          }}
          eventClick={(info) => {
            setCalendarTooltip(null)
            if (info.event.extendedProps.kind === 'task') setTaskDialog({ open: true, task: info.event.extendedProps.row as TaskRow })
            else setEventDialog({ open: true, event: info.event.extendedProps.row as EventRow })
          }}
          eventMouseEnter={showCalendarTooltip}
          eventMouseLeave={() => setCalendarTooltip(null)}
          eventClassNames={(info) => info.event.extendedProps.isOverdue ? 'calendar-overdue' : info.event.extendedProps.kind === 'task' ? (info.event.extendedProps.row as TaskRow).status === 'completed' ? 'calendar-task-completed' : 'calendar-task' : 'calendar-meeting'}
          eventContent={(info) => {
            const isTask = info.event.extendedProps.kind === 'task'
            const task = isTask ? info.event.extendedProps.row as TaskRow : null
            const Icon = isTask ? ListTodo : CalendarDays
            return <div className="flex min-w-0 items-center gap-0.5 px-0.5"><Icon size={12} aria-hidden="true" /><div className="fc-event-title truncate">{task?.status === 'completed' ? 'เสร็จแล้ว: ' : ''}{info.event.title}</div></div>
          }}
          events={calendarEntries}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
          dayMaxEvents={4}
        />
        {calendarTooltip && <div role="tooltip" className="pointer-events-none fixed z-50 max-h-[70vh] w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-xl" style={{ left: calendarTooltip.x, top: calendarTooltip.y }}>
          {calendarTooltip.items.map((item, index) => <section key={`${item.kind}-${item.title}-${index}`} className={index ? 'mt-3 border-t border-slate-100 pt-3' : undefined}>
            <p className={`mb-2 text-xs font-bold ${item.kind === 'task' ? 'text-amber-700' : 'text-brand-700'}`}>{item.kind === 'task' ? 'Task' : 'Meeting'}</p>
            <dl className="space-y-1.5 text-sm text-slate-700">
              <div><dt className="inline font-semibold text-slate-500">ชื่อ: </dt><dd className="inline break-words">{item.title}</dd></div>
              <div><dt className="inline font-semibold text-slate-500">หน่วยงาน: </dt><dd className="inline break-words">{item.affiliation}</dd></div>
              <div><dt className="inline font-semibold text-slate-500">{item.kind === 'task' ? 'วันครบกำหนด: ' : 'วันนัดหมาย: '}</dt><dd className="inline">{calendarDateLabel(item.date, language)}</dd></div>
              {item.isOverdue && <p className="pt-1 font-semibold text-red-600">{item.kind === 'task' ? 'เกินวันครบกำหนดแล้ว' : 'เลยวันนัดหมายแล้ว'}</p>}
            </dl>
          </section>)}
        </div>}
        </div>
      </div>
      </div>
      <aside className="grid content-start gap-4 sm:grid-cols-2 xl:min-h-0 xl:grid-cols-1 xl:gap-3 xl:overflow-y-auto" aria-label="สรุปปฏิทิน">
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-brand-900">นัดหมายวันนี้</h2><span className="rounded-full bg-purple-50 px-2.5 py-1 text-sm font-bold text-brand-700">{todayEntries.length}</span></div>
          {todayEntries.length ? <div className="space-y-2">{todayEntries.slice(0, 4).map((entry) =>
            <button key={entry.id} type="button" onClick={() => openCalendarEntry(entry)} className="flex w-full min-w-0 items-start gap-2 rounded-xl bg-purple-50/70 p-3 text-left hover:bg-purple-100"><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${entry.extendedProps.isOverdue ? 'bg-red-500' : entry.extendedProps.kind === 'task' ? 'bg-amber-500' : 'bg-brand-600'}`} /><span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-800">{entry.title}</span><span className="text-xs text-slate-500">{entry.extendedProps.kind === 'task' ? 'Task' : 'Meeting'}</span></span></button>
          )}</div> : <p className="rounded-xl bg-purple-50/70 p-3 text-sm text-slate-500">วันนี้ยังไม่มีรายการในปฏิทิน</p>}
        </section>
        <section className="card p-4">
          <h2 className="mb-3 font-bold text-brand-900">ภาพรวมงาน</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-amber-50 px-1 py-3"><Clock3 className="mx-auto mb-1 text-amber-600" size={20} /><strong className="block text-xl text-amber-800">{pendingCount}</strong><span className="text-[11px] text-slate-600">รอดำเนินการ</span></div>
            <div className="rounded-xl bg-green-50 px-1 py-3"><CheckCircle2 className="mx-auto mb-1 text-green-600" size={20} /><strong className="block text-xl text-green-700">{completedCount}</strong><span className="text-[11px] text-slate-600">เสร็จแล้ว</span></div>
            <div className="rounded-xl bg-purple-50 px-1 py-3"><CalendarDays className="mx-auto mb-1 text-brand-600" size={20} /><strong className="block text-xl text-brand-700">{todayEntries.filter((entry) => entry.extendedProps.kind === 'event').length}</strong><span className="text-[11px] text-slate-600">ประชุมวันนี้</span></div>
          </div>
        </section>
        <section className="card p-4 sm:col-span-2 xl:col-span-1">
          <h2 className="sr-only">รายการถัดไปและเอกสารล่าสุด</h2>
          <div className="mb-3 flex rounded-xl bg-purple-50 p-1 text-xs font-bold">
            <button type="button" aria-pressed={sideTab === 'upcoming'} onClick={() => setSideTab('upcoming')} className={`flex-1 rounded-lg px-2 py-2 transition ${sideTab === 'upcoming' ? 'bg-white text-brand-900 shadow-sm' : 'text-slate-500 hover:text-brand-700'}`}>รายการถัดไป</button>
            <button type="button" aria-pressed={sideTab === 'documents'} onClick={() => setSideTab('documents')} className={`flex-1 rounded-lg px-2 py-2 transition ${sideTab === 'documents' ? 'bg-white text-brand-900 shadow-sm' : 'text-slate-500 hover:text-brand-700'}`}>เอกสารล่าสุด</button>
          </div>
          {sideTab === 'upcoming' ? upcomingEntries.length ? <div className="space-y-2">{upcomingEntries.map((entry) =>
            <button key={entry.id} type="button" onClick={() => openCalendarEntry(entry)} className="flex w-full items-start gap-3 rounded-xl border border-purple-50 p-2.5 text-left hover:bg-purple-50"><span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${entry.extendedProps.isOverdue ? 'bg-red-500' : entry.extendedProps.kind === 'task' ? 'bg-amber-500' : 'bg-brand-600'}`} /><span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-800">{entry.title}</span><span className="text-xs text-slate-500">{calendarDateLabel(new Date(entry.start), language)}</span></span></button>
          )}</div> : <p className="text-sm text-slate-500">ยังไม่มีรายการถัดไป</p>
            : recentDocumentsQuery.isLoading ? <p className="text-sm text-slate-500">กำลังโหลดเอกสาร…</p>
              : recentDocumentsQuery.isError ? <p className="text-sm text-red-600">โหลดเอกสารไม่สำเร็จ</p>
                : recentDocuments.length ? <div className="space-y-2">{recentDocuments.map((document) =>
                  <button key={document.id} type="button" onClick={() => openRecentDocument(document)} className="flex w-full items-start gap-2.5 rounded-xl border border-purple-50 p-2.5 text-left hover:bg-purple-50">
                    <span className="mt-0.5 text-brand-600">{document.kind === 'link' ? <Link2 size={18} /> : <FileText size={18} />}</span>
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-800">{document.name}</span><span className="text-xs text-slate-500">{document.parent === 'event' ? 'Meeting' : 'Task'} · {calendarDateLabel(new Date(document.addedAt), language)}</span></span>
                  </button>
                )}</div> : <p className="text-sm text-slate-500">ยังไม่มีเอกสารที่เปิดดูได้</p>}
        </section>
      </aside>
      </div>
      {(eventMutation.isError || taskMutation.isError || deleteEventMutation.isError || deleteTaskMutation.isError || deleteEventAttachmentMutation.isError || deleteTaskAttachmentMutation.isError || toggleTaskMutation.isError || acknowledgeTaskMutation.isError) && <p className="fixed bottom-4 right-4 rounded-xl bg-red-600 px-4 py-3 text-sm text-white shadow-lg">ดำเนินการไม่สำเร็จ กรุณาตรวจสอบข้อมูลและลองใหม่</p>}
      {taskSaveWarning && <div className="fixed bottom-4 right-4 max-w-md rounded-xl bg-amber-100 px-4 py-3 text-sm text-amber-950 shadow-lg" role="alert"><p>{taskSaveWarning}</p><button type="button" className="mt-2 font-semibold underline" onClick={() => setTaskSaveWarning('')}>ปิด</button></div>}

      <EventDialog
        open={eventDialog.open} event={selectedEvent} details={eventDetailsQuery.data} selectedDate={eventDialog.date}
        canEdit={canEditEvent} busy={busy || eventDetailsQuery.isLoading}
        onClose={() => setEventDialog({ open: false, event: null })}
        onSave={(draft, notifyRecipients) => eventMutation.mutateAsync({ draft, event: selectedEvent, notifyRecipients })}
        onDelete={async () => { if (selectedEvent && await confirmDeletion('ย้าย Meeting ไปถังขยะ?', `Meeting “${selectedEvent.title}” จะไม่แสดงในปฏิทิน`, 'ย้ายไปถังขยะ')) await deleteEventMutation.mutateAsync(selectedEvent) }}
        onDeleteAttachment={async (attachment) => { if (await confirmDeletion('ลบไฟล์แนบ?', `ลบ “${attachment.file_name}” ออกจาก Meeting นี้อย่างถาวร`, 'ลบไฟล์')) await deleteEventAttachmentMutation.mutateAsync(attachment) }}
      />
      <TaskDialog
        open={taskDialog.open} task={selectedTask} details={taskDetailsQuery.data} selectedDate={taskDialog.date}
        userId={user!.id} profiles={profilesQuery.data ?? []} events={eventsQuery.data ?? []}
        canEdit={canEditTask} canComplete={canCompleteTask} canAcknowledge={canAcknowledgeTask} busy={busy || taskDetailsQuery.isLoading}
        onClose={() => setTaskDialog({ open: false, task: null })}
        onSave={async (draft, notifyRecipients) => { await taskMutation.mutateAsync({ draft, task: selectedTask, notifyRecipients }) }}
        onDelete={async () => { if (selectedTask && await confirmDeletion('ย้าย Task ไปถังขยะ?', `Task “${selectedTask.title}” จะไม่แสดงในรายการงาน`, 'ย้ายไปถังขยะ')) await deleteTaskMutation.mutateAsync(selectedTask) }}
        onDeleteAttachment={async (attachment) => { if (await confirmDeletion('ลบเอกสาร?', `ลบ “${attachment.file_name}” ออกจาก Task นี้อย่างถาวร`, 'ลบไฟล์')) await deleteTaskAttachmentMutation.mutateAsync(attachment) }}
        onToggleComplete={async () => { if (selectedTask && await confirm({ title: selectedTask.status === 'completed' ? 'เปิดงานอีกครั้ง?' : 'ยืนยันว่างานเสร็จแล้ว?', message: `Task “${selectedTask.title}” จะถูกเปลี่ยนสถานะ`, confirmLabel: selectedTask.status === 'completed' ? 'เปิดงานอีกครั้ง' : 'ยืนยันงานเสร็จ' })) await toggleTaskMutation.mutateAsync(selectedTask) }}
        onAcknowledge={async () => { if (selectedTask) await acknowledgeTaskMutation.mutateAsync(selectedTask) }}
      />
    </main>
  )
}
