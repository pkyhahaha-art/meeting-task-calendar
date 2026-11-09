import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import type { DatesSetArg, EventHoveringArg } from '@fullcalendar/core'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import timeGridPlugin from '@fullcalendar/timegrid'
import multiMonthPlugin from '@fullcalendar/multimonth'
import listPlugin from '@fullcalendar/list'
import luxonPlugin from '@fullcalendar/luxon3'
import thLocale from '@fullcalendar/core/locales/th'
import enGbLocale from '@fullcalendar/core/locales/en-gb'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, CalendarPlus, CheckCircle2, ChevronDown, Clock3, FileSpreadsheet, FileText, Link2, ListTodo, Search, X } from 'lucide-react'
import Swal from 'sweetalert2'

import { useAuth } from '../auth/AuthProvider'
import { normalizeAffiliationText, profileAffiliation } from '../lib/organization'
import { useConfirm } from '../components/ConfirmDialogProvider'
import { EventDialog, type EventDetails, type EventDraft } from '../components/EventDialog'
import type { DeliveryStatusRow } from '../components/NotificationDeliveryStatus'
import { TaskDialog, type TaskDetails, type TaskDraft, type TaskDeliveryStatusRow } from '../components/TaskDialog'
import { MeetingSummaryDialog } from '../components/MeetingSummaryDialog'
import { useLanguage } from '../i18n/LanguageProvider'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Database } from '../lib/database.types'
import { bangkokDate, isPastBangkokDate, meetingRecurrenceRule, meetingReminderKeysFromTemplates, meetingReminderStatus, parseGuestEmails, reminderDate } from '../lib/eventForm'
import { appUrl } from '../lib/appUrl'
import { canManageMeeting } from '../lib/meetingAccess'
import { meetingSaveId, saveMeetingWithFollowUp, type MeetingSaveAttempt } from '../lib/meetingSave'
import { calendarClickedDate, calendarDayKey, calendarEntriesByDay, calendarMeetingOccurrences, calendarViewType, formatCalendarDayHeader, readCalendarPages, type CalendarView } from '../lib/calendarView'
import {
  generateContinuousReminderDates,
  isTaskOverdue,
  normalizeExternalEmails,
  taskDueDateTime,
  taskReminderDate,
  type TaskContinuousConfig,
  type TaskReminderKey,
} from '../lib/taskForm'
import { supabase } from '../lib/supabase'
import { CalendarPeople } from '../components/MemberAvatar'
import { checkMeetingMobileRecipients, getConnectedDevices } from '../lib/mobilePush'
import {
  getStoredMeetingCompletions,
  saveStoredMeetingCompletion,
  isMeetingCompleted,
  isMeetingAppointmentPassed,
  getMeetingStatus,
  getMeetingColors,
  meetingOccurrenceKey,
  hasMeetingSummary,
} from '../lib/meetingCompletion'

type EventRow = Database['public']['Tables']['events']['Row']
type GuestRow = Database['public']['Tables']['event_guests']['Row']
type OccurrenceRow = Database['public']['Tables']['event_occurrences']['Row']
type OccurrenceGuestExclusionRow = Database['public']['Tables']['event_occurrence_guest_exclusions']['Row']
type ReminderRow = Database['public']['Tables']['reminders']['Row']
type AttachmentRow = Database['public']['Tables']['attachments']['Row']
type TaskRow = Database['public']['Tables']['tasks']['Row']
type TaskReminderRow = Database['public']['Tables']['task_reminders']['Row']
type TaskAttachmentRow = Database['public']['Tables']['task_attachments']['Row']
type TaskExternalRecipientRow = Database['public']['Tables']['task_external_recipients']['Row']
type TaskInternalRecipientRow = Database['public']['Tables']['task_internal_recipients']['Row']
type DocumentLinkRow = Database['public']['Tables']['document_links']['Row']
type ProfileRow = Database['public']['Tables']['profiles']['Row']
type CalendarTooltipItem = { kind: 'event' | 'task'; title: string; affiliation: string; date: Date; isOverdue: boolean; isCompleted?: boolean; isPendingConfirmation?: boolean }
type CalendarTooltip = { items: CalendarTooltipItem[]; x: number; y: number }
type RecentDocument = { id: string; kind: 'file' | 'link'; parent: 'event' | 'task'; parentId: string; name: string; addedAt: string }

function toIso(date: string, time: string, allDay: boolean) {
  if (allDay) return new Date(`${date}T00:00:00+07:00`).toISOString()
  return new Date(`${date}T${time}:00+07:00`).toISOString()
}

function endOfBangkokDay(date: string) {
  return new Date(`${date}T23:59:59.999+07:00`).toISOString()
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

export function CalendarPage() {
  const { user, profile } = useAuth()
  const { language, text } = useLanguage()
  const { search: locationSearch } = useLocation()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showMeetings, setShowMeetings] = useState(true)
  const [showTasks, setShowTasks] = useState(true)
  const [showCompletedTasks, setShowCompletedTasks] = useState(true)
  const [showCompletedMeetings, setShowCompletedMeetings] = useState(true)
  const [showOverdueTasks, setShowOverdueTasks] = useState(true)
  const [showPendingConfirmationMeetings, setShowPendingConfirmationMeetings] = useState(true)
  const [storedMeetingCompletions, setStoredMeetingCompletions] = useState<Set<string>>(() => getStoredMeetingCompletions())
  const [sideTab, setSideTab] = useState<'upcoming' | 'documents'>('upcoming')
  const [taskSaveWarning, setTaskSaveWarning] = useState('')
  const [eventSaveWarning, setEventSaveWarning] = useState('')
  const pendingMeetingSave = useRef<MeetingSaveAttempt>(null)
  const [eventDialog, setEventDialog] = useState<{ open: boolean; event: EventRow | null; date?: string; occurrenceStart?: string }>({ open: false, event: null })
  const [taskDialog, setTaskDialog] = useState<{ open: boolean; task: TaskRow | null; date?: string }>({ open: false, task: null })
  const [summaryDialogOpen, setSummaryDialogOpen] = useState(false)
  const consumedCalendarAction = useRef<string | null>(null)
  useEffect(() => {
    const params = new URLSearchParams(locationSearch)
    const action = params.get('action')
    if (!action) { consumedCalendarAction.current = null; return }
    if (!user || profile?.status !== 'active' || consumedCalendarAction.current === locationSearch) return
    if (!['create-task', 'create-meeting', 'meeting-summary'].includes(action)) return
    consumedCalendarAction.current = locationSearch
    setTaskDialog({ open: action === 'create-task', task: null })
    setEventDialog({ open: action === 'create-meeting', event: null })
    setSummaryDialogOpen(action === 'meeting-summary')
    params.delete('action')
    const remaining = params.toString()
    navigate(`/calendar${remaining ? `?${remaining}` : ''}`, { replace: true })
  }, [locationSearch, navigate, user, profile?.status])
  const [yearDayDialog, setYearDayDialog] = useState<{ open: boolean; date: string; entries: any[] } | null>(null)
  const [openedEventLink, setOpenedEventLink] = useState<string | null>(null)
  const [openedTaskLink, setOpenedTaskLink] = useState<string | null>(null)
  const [calendarTooltip, setCalendarTooltip] = useState<CalendarTooltip | null>(null)
  const attemptedEmailAcknowledgement = useRef<string | null>(null)
  const calendarRef = useRef<FullCalendar | null>(null)
  const calendarContainerRef = useRef<HTMLDivElement | null>(null)
  const miniCalendarRef = useRef<FullCalendar | null>(null)
  const [miniSelectedDate, setMiniSelectedDate] = useState(() => bangkokDate())
  useEffect(() => {
    const container = calendarContainerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    let frame = 0
    let lastSize = ''
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const size = `${entry.contentRect.width}:${entry.contentRect.height}`
      if (size === lastSize) return
      lastSize = size
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => calendarRef.current?.getApi().updateSize())
    })
    observer.observe(container)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [])
  const userInteractedViewRef = useRef(false)
  const [calendarView, setCalendarView] = useState<CalendarView>(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      return 'day'
    }
    return 'month'
  })
  const handleSelectView = useCallback((view: CalendarView) => {
    userInteractedViewRef.current = true
    setCalendarView(view)
  }, [])
  const [compactCalendar, setCompactCalendar] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches)
  const [calendarRange, setCalendarRange] = useState(() => {
    const today = bangkokDate()
    return { start: new Date(`${today.slice(0, 7)}-01T00:00:00+07:00`), end: new Date(`${today}T23:59:59.999+07:00`) }
  })
  const [viewPeriod, setViewPeriod] = useState(() => {
    const today = bangkokDate()
    const start = new Date(`${today.slice(0, 7)}-01T00:00:00+07:00`)
    const end = new Date(start)
    end.setMonth(end.getMonth() + 1)
    return { start, end }
  })

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const resize = () => {
      setCompactCalendar(media.matches)
      if (!userInteractedViewRef.current) {
        setCalendarView(media.matches ? 'day' : 'month')
      }
    }
    media.addEventListener('change', resize)
    return () => media.removeEventListener('change', resize)
  }, [])

  useEffect(() => {
    const api = calendarRef.current?.getApi()
    const view = calendarViewType(calendarView, compactCalendar)
    if (api && api.view.type !== view) {
      setCalendarTooltip(null)
      api.changeView(view, api.getDate())
    }
    // FullCalendar measures event columns during the view transition. Recheck
    // after React has applied the new container layout to avoid stale positions.
    if (typeof requestAnimationFrame !== 'function') return
    const frame = requestAnimationFrame(() => api?.updateSize?.())
    return () => cancelAnimationFrame(frame)
  }, [calendarView, compactCalendar])

  const updateCalendarRange = useCallback((info: DatesSetArg) => {
    const mini = miniCalendarRef.current?.getApi()
    const currentDate = calendarRef.current?.getApi().getDate() ?? info.start
    setMiniSelectedDate(calendarDayKey(currentDate))
    if (mini && (mini.getDate().getFullYear() !== currentDate.getFullYear()
      || mini.getDate().getMonth() !== currentDate.getMonth())) mini.gotoDate(currentDate)
    setCalendarRange((current) => current.start.getTime() === info.start.getTime() && current.end.getTime() === info.end.getTime()
      ? current : { start: info.start, end: info.end })
    const periodStart = info.view?.currentStart || info.start
    const periodEnd = info.view?.currentEnd || info.end
    setViewPeriod((current) => current.start.getTime() === periodStart.getTime() && current.end.getTime() === periodEnd.getTime()
      ? current : { start: periodStart, end: periodEnd })
  }, [])

  const eventsQuery = useQuery({
    queryKey: ['events'],
    queryFn: () => readCalendarPages<EventRow>((offset) => supabase.from('events').select('*', { count: 'exact' }).eq('status', 'scheduled').is('deleted_at', null).order('start_datetime').order('id').range(offset, offset + 499).returns<EventRow[]>()),
  })
  const tasksQuery = useQuery({
    queryKey: ['tasks'],
    queryFn: () => readCalendarPages<TaskRow>((offset) => supabase.from('tasks').select('*', { count: 'exact' }).is('deleted_at', null).order('due_date').order('due_time').order('id').range(offset, offset + 499).returns<TaskRow[]>()),
  })
  const connectedDevicesQuery = useQuery({
    queryKey: ['mobile-push-devices', user?.id],
    queryFn: () => (user?.id ? getConnectedDevices(user.id) : Promise.resolve([])),
    enabled: Boolean(user?.id),
  })
  const exceptionsQuery = useQuery({
    queryKey: ['meeting-exceptions'],
    queryFn: () => readCalendarPages<Pick<OccurrenceRow, 'event_id' | 'occurrence_key'>>((offset) => supabase.from('event_occurrences').select('event_id,occurrence_key', { count: 'exact' }).neq('status', 'scheduled').order('id').range(offset, offset + 499)),
  })
  const meetingCompletionsQuery = useQuery({
    queryKey: ['meeting-completions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('meeting_completions').select('*')
      if (error) {
        console.warn('Failed to load meeting completions:', error)
        return []
      }
      return data ?? []
    },
    enabled: Boolean(user?.id),
  })

  const completedMeetings = useMemo(() => {
    const keys = new Set(storedMeetingCompletions)
    if (meetingCompletionsQuery.data) {
      for (const mc of meetingCompletionsQuery.data) {
        if (mc.completed_at) {
          keys.add(meetingOccurrenceKey(mc.event_id, mc.occurrence_key))
        }
      }
    }
    return keys
  }, [storedMeetingCompletions, meetingCompletionsQuery.data])

  const toggleMeetingCompletion = useCallback((eventId: string, occurrenceStart: string) => {
    const isCurrentCompleted = isMeetingCompleted(completedMeetings, eventId, occurrenceStart)
    const updated = saveStoredMeetingCompletion(eventId, occurrenceStart, !isCurrentCompleted)
    setStoredMeetingCompletions(new Set(updated))
  }, [completedMeetings])
  const hasConnectedDevices = (connectedDevicesQuery.data?.length ?? 0) > 0
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
  const checkMobileRecipients = useCallback((emails: string[]) => checkMeetingMobileRecipients(emails, selectedEvent?.id), [selectedEvent?.id])
  const selectedEventOccurrenceStart = eventDialog.occurrenceStart
  const selectedTask = taskDialog.task
  const isActiveAdmin = profile?.role === 'admin' && profile.status === 'active'
  const editingAnotherTask = Boolean(isActiveAdmin && selectedTask && selectedTask.creator_user_id !== user?.id)
  const taskCreatorMobileQuery = useQuery({
    queryKey: ['task-creator-mobile', user?.id, selectedTask?.id],
    enabled: editingAnotherTask,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('task_creator_mobile_available', { target_task_id: selectedTask!.id })
      if (error) throw error
      return data === true
    },
  })
  const canViewEventDeliveryStatus = Boolean(selectedEvent && (selectedEvent.owner_user_id === user?.id || profile?.role === 'admin'))
  const canViewTaskDeliveryStatus = Boolean(selectedTask && (selectedTask.creator_user_id === user?.id || profile?.role === 'admin'))
  const eventDetailsQuery = useQuery({
    queryKey: ['event-details', selectedEvent?.id, selectedEventOccurrenceStart, canViewEventDeliveryStatus],
    enabled: Boolean(selectedEvent),
    refetchInterval: selectedEvent ? 3_000 : false,
    queryFn: async (): Promise<EventDetails> => {
      const eventId = selectedEvent!.id
      const selectedOccurrence = (async (): Promise<OccurrenceRow | null> => {
        if (!selectedEventOccurrenceStart) return null
        const { data, error } = await supabase.from('event_occurrences').select('*').eq('event_id', eventId).eq('start_datetime', selectedEventOccurrenceStart).returns<OccurrenceRow>().maybeSingle()
        if (error) throw error
        return data
      })()
      const occurrenceReminders = (async (): Promise<ReminderRow[]> => {
        if (!selectedEventOccurrenceStart) return []
        if (new Date(selectedEventOccurrenceStart).getTime() === new Date(selectedEvent!.start_datetime).getTime()) {
          const { data, error } = await supabase.from('reminders').select('*').eq('event_id', eventId).is('occurrence_id', null).returns<ReminderRow[]>()
          if (error) throw error
          return data
        }
        const occurrence = await selectedOccurrence
        if (!occurrence) return []
        const { data, error } = await supabase.from('reminders').select('*').eq('event_id', eventId).eq('occurrence_id', occurrence.id).returns<ReminderRow[]>()
        if (error) throw error
        return data
      })()
      const occurrenceGuests = (async (): Promise<GuestRow[]> => {
        const occurrence = await selectedOccurrence
        if (!occurrence) return []
        const { data, error } = await supabase.from('event_guests').select('*').eq('event_id', eventId).eq('occurrence_id', occurrence.id).is('revoked_at', null).returns<GuestRow[]>()
        if (error) throw error
        return data
      })()
      const occurrenceExclusions = (async (): Promise<OccurrenceGuestExclusionRow[]> => {
        const occurrence = await selectedOccurrence
        if (!occurrence) return []
        const { data, error } = await supabase.from('event_occurrence_guest_exclusions').select('*').eq('occurrence_id', occurrence.id).returns<OccurrenceGuestExclusionRow[]>()
        if (error) throw error
        return data
      })()
      const occurrenceAcknowledgements = (async () => {
        const occurrence = await selectedOccurrence
        if (!occurrence) return []
        const { data, error } = await supabase.from('event_occurrence_acknowledgements').select('email,acknowledged_at').eq('event_id', eventId).eq('occurrence_id', occurrence.id)
        if (error) throw error
        return data
      })()
      const [guests, reminders, attachments, notificationDeliveries, occurrence, addedOccurrenceGuests, exclusions, selectedReminders, scopedAcknowledgements, documentLinks, completionsResult] = await Promise.all([
        supabase.from('event_guests').select('*').eq('event_id', eventId).is('occurrence_id', null).is('revoked_at', null).returns<GuestRow[]>(),
        (() => {
          const templates = supabase.from('reminders').select('*').eq('event_id', eventId).is('occurrence_id', null)
          return (selectedEvent!.recurrence_rule ? templates : templates.eq('status', 'scheduled')).returns<ReminderRow[]>()
        })(),
        supabase.from('attachments').select('*').eq('event_id', eventId).order('uploaded_at').returns<AttachmentRow[]>(),
        canViewEventDeliveryStatus
          ? supabase.from('notification_deliveries').select('id,reminder_id,recipient_type,recipient_reference,channel,status,scheduled_at,sent_at,error_message,created_at').eq('event_id', eventId).order('created_at', { ascending: false }).returns<DeliveryStatusRow[]>()
          : Promise.resolve({ data: [] as DeliveryStatusRow[], error: null }),
        selectedOccurrence,
        occurrenceGuests,
        occurrenceExclusions,
        occurrenceReminders,
        occurrenceAcknowledgements,
        supabase.from('document_links').select('*').eq('event_id', eventId).order('created_at').returns<DocumentLinkRow[]>(),
        supabase.from('meeting_completions').select('*').eq('event_id', eventId),
      ])
      if (guests.error) throw guests.error
      if (reminders.error) throw reminders.error
      if (attachments.error) throw attachments.error
      if (notificationDeliveries.error) throw notificationDeliveries.error
      if (documentLinks.error) throw documentLinks.error
      const excludedEmails = new Set(exclusions.map((exclusion) => exclusion.email.toLowerCase()))
      const viewedStart = new Date(selectedEventOccurrenceStart ?? selectedEvent!.start_datetime).getTime()
      const guestHistory = (guest: GuestRow): Array<{ from: string | null; until: string }> =>
        Array.isArray(guest.attendance_history) ? guest.attendance_history.flatMap((range) =>
          range && typeof range === 'object' && !Array.isArray(range) && (range.from === null || typeof range.from === 'string') && typeof range.until === 'string'
            ? [{ from: range.from, until: range.until }] : []) : []
      const memberInOccurrence = (guest: GuestRow) =>
        ((!guest.self_join_from || viewedStart >= new Date(guest.self_join_from).getTime())
          && (!guest.self_join_until || viewedStart <= new Date(guest.self_join_until).getTime()))
        || guestHistory(guest).some((range) => (!range.from || viewedStart >= new Date(range.from).getTime()) && viewedStart <= new Date(range.until).getTime())
      const effectiveGuests = [
        ...guests.data.filter((guest) => !excludedEmails.has(guest.email.toLowerCase()) && memberInOccurrence(guest)),
        ...addedOccurrenceGuests,
      ]
      const occurrenceAttachments = attachments.data.filter((file) => !file.occurrence_id || file.occurrence_id === occurrence?.id)
      const attachmentViews = await Promise.all(occurrenceAttachments.map(async (file) => {
        const { data, error } = await supabase.storage.from('meeting-documents').createSignedUrl(file.storage_path, 300, { download: file.file_name })
        if (error || !data) throw error ?? new Error('ไม่สามารถเปิดไฟล์แนบได้')
        return { ...file, signedUrl: data.signedUrl }
      }))
      const keys = meetingReminderKeysFromTemplates(reminders.data.map((row) => ({
        occurrenceId: row.occurrence_id,
        offsetValue: row.offset_value,
        offsetUnit: row.offset_unit,
      })))
      const selectedReminderIds = new Set(selectedReminders.map((reminder) => reminder.id))
      const overridePayload = occurrence?.override_payload
      const occurrenceOverride = overridePayload && typeof overridePayload === 'object' && !Array.isArray(overridePayload)
        ? { description: typeof overridePayload.description === 'string' ? overridePayload.description : undefined, location: typeof overridePayload.location === 'string' ? overridePayload.location : undefined }
        : null
      const cutoffChangesAttendance = guests.data.some((guest) => !memberInOccurrence(guest))
      const hasOccurrenceChanges = Boolean(cutoffChangesAttendance || occurrenceOverride?.description !== undefined || occurrenceOverride?.location !== undefined || addedOccurrenceGuests.length || exclusions.length || occurrenceAttachments.some((file) => file.scope === 'occurrence'))
      const acknowledgementByEmail = new Map(scopedAcknowledgements.map((row) => [row.email.toLowerCase(), row.acknowledged_at]))
      const completionRows = completionsResult?.data ?? []
      const activeOccKey = selectedEventOccurrenceStart || selectedEvent!.start_datetime
      const activeCompletion = completionRows.find((c) => c.occurrence_key === activeOccKey || c.occurrence_key.startsWith(activeOccKey.slice(0, 19))) ?? completionRows[0]
      return {
        guestEmails: guests.data.map((guest) => guest.email),
        guestJoinFrom: Object.fromEntries(guests.data.filter((guest) => guest.self_join_from).map((guest) => [guest.email.toLowerCase(), guest.self_join_from!])),
        guestJoinUntil: Object.fromEntries(guests.data.filter((guest) => guest.self_join_until).map((guest) => [guest.email.toLowerCase(), guest.self_join_until!])),
        guestJoinHistory: Object.fromEntries(guests.data.map((guest) => [guest.email.toLowerCase(), guestHistory(guest)])),
        occurrenceGuestEmails: effectiveGuests.map((guest) => guest.email),
        guestAcknowledgements: Object.fromEntries(effectiveGuests.map((guest) => [guest.email.toLowerCase(), acknowledgementByEmail.get(guest.email.toLowerCase()) ?? ((guest.self_join_from || guest.self_join_until || guestHistory(guest).length) ? null : guest.acknowledged_at)])),
        reminderKeys: keys,
        attachments: attachmentViews,
        documentLinks: documentLinks.data ?? [],
        occurrenceId: occurrence?.id ?? null,
        occurrenceOverride,
        hasOccurrenceChanges,
        occurrenceReminders: selectedReminders,
        occurrenceNotificationDeliveries: notificationDeliveries.data.filter((delivery) => delivery.reminder_id && selectedReminderIds.has(delivery.reminder_id)),
        notificationDeliveries: notificationDeliveries.data.filter((delivery) => !delivery.reminder_id),
        summaryHtml: activeCompletion?.summary_html ?? '',
        isCompleted: Boolean(activeCompletion?.completed_at),
      }
    },
  })

  const taskDetailsQuery = useQuery({
    queryKey: ['task-details', selectedTask?.id, canViewTaskDeliveryStatus],
    enabled: Boolean(selectedTask),
    refetchInterval: selectedTask ? 3_000 : false,
    queryFn: async (): Promise<TaskDetails> => {
      const taskId = selectedTask!.id
      const [reminders, attachments, documentLinks, externalRecipients, internalRecipients, notificationDeliveries] = await Promise.all([
        supabase.from('task_reminders').select('*').eq('task_id', taskId).order('scheduled_at').returns<TaskReminderRow[]>(),
        supabase.from('task_attachments').select('*').eq('task_id', taskId).order('uploaded_at').returns<TaskAttachmentRow[]>(),
        supabase.from('document_links').select('*').eq('task_id', taskId).order('created_at').returns<DocumentLinkRow[]>(),
        supabase.from('task_external_recipients').select('*').eq('task_id', taskId).order('email').returns<TaskExternalRecipientRow[]>(),
        supabase.from('task_internal_recipients').select('*').eq('task_id', taskId).returns<TaskInternalRecipientRow[]>(),
        canViewTaskDeliveryStatus
          ? supabase.from('notification_deliveries').select('id,reminder_id,task_reminder_id,template_key,recipient_type,recipient_reference,channel,status,scheduled_at,sent_at,error_message,created_at').eq('task_id', taskId).order('created_at', { ascending: false }).returns<TaskDeliveryStatusRow[]>()
          : Promise.resolve({ data: [] as TaskDeliveryStatusRow[], error: null }),
      ])
      if (reminders.error) throw reminders.error
      if (attachments.error) throw attachments.error
      if (documentLinks.error) throw documentLinks.error
      if (externalRecipients.error) throw externalRecipients.error
      if (internalRecipients.error) throw internalRecipients.error
      if (notificationDeliveries.error) throw notificationDeliveries.error
      const attachmentViews = await Promise.all(attachments.data.map(async (file) => {
        const { data, error } = await supabase.storage.from('task-documents').createSignedUrl(file.storage_path, 300, { download: file.file_name })
        if (error || !data) throw error ?? new Error('ไม่สามารถเปิดเอกสารประกอบได้')
        return { ...file, signedUrl: data.signedUrl }
      }))
      const scheduledReminders = reminders.data.filter((item) => item.status === 'scheduled')
      const isContinuous = scheduledReminders.some((item) => item.reminder_key === 'continuous')
      let continuousConfig: TaskContinuousConfig = { startDaysBefore: 3, frequency: 'daily' }
      if (isContinuous && selectedTask) {
        const scheduledDates = scheduledReminders
          .filter((item) => item.reminder_key === 'continuous')
          .map((item) => new Date(item.scheduled_at))
        if (scheduledDates.length > 0) {
          const dueDateObj = new Date(`${selectedTask.due_date}T00:00:00+07:00`)
          const minDate = new Date(Math.min(...scheduledDates.map((d) => d.getTime())))
          const diffDays = Math.max(1, Math.round((dueDateObj.getTime() - minDate.getTime()) / (24 * 60 * 60 * 1000)))
          const hasWeekend = scheduledDates.some((d) => {
            const day = d.getDay()
            return day === 0 || day === 6
          })
          continuousConfig = {
            startDaysBefore: diffDays,
            frequency: hasWeekend ? 'daily' : 'weekdays',
          }
        }
      }
      return {
        reminderMode: isContinuous ? 'continuous' : 'single',
        reminderKeys: [...new Set(scheduledReminders.map((item) => item.reminder_key))] as TaskReminderKey[],
        continuousConfig,
        notifyEmail: scheduledReminders.some((item) => item.channel_email),
        notifyLine: scheduledReminders.some((item) => item.channel_line),
        attachments: attachmentViews,
        documentLinks: documentLinks.data,
        externalRecipients: externalRecipients.data.map(({ email, acknowledged_at }) => ({ email, acknowledged_at })),
        internalRecipients: internalRecipients.data.map(({ user_id, acknowledged_at }) => ({ user_id, acknowledged_at })),
        reminders: reminders.data,
        reminderNotificationDeliveries: notificationDeliveries.data.filter((delivery) => delivery.task_reminder_id || delivery.template_key === 'task_reminder'),
        notificationDeliveries: notificationDeliveries.data.filter((delivery) => !delivery.task_reminder_id && delivery.template_key !== 'task_reminder'),
      }
    },
  })

  const eventMutation = useMutation({
    onMutate: () => setEventSaveWarning(''),
    mutationFn: async ({ draft, event, notifyRecipients, scope, occurrenceStart }: { draft: EventDraft; event: EventRow | null; notifyRecipients: boolean; scope: 'series' | 'occurrence'; occurrenceStart?: string }) => {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError || !userData.user) throw new Error('เซสชันหมดอายุ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่')
      const eventUserId = userData.user.id
      if (scope === 'occurrence') {
        if (!event || !occurrenceStart) throw new Error('ไม่พบรอบนัดหมายที่เลือก')
        const { data: occurrenceId, error: occurrenceError } = await supabase.rpc('update_meeting_occurrence_details', {
          target_event_id: event.id,
          target_occurrence_start: occurrenceStart,
          target_description: draft.description.trim(),
          target_location: draft.location.trim(),
          target_guest_emails: parseGuestEmails(draft.guestEmails),
        })
        if (occurrenceError || !occurrenceId) throw occurrenceError ?? new Error('ไม่สามารถบันทึกนัดหมายรอบนี้ได้')
        for (const file of draft.files) {
          const storagePath = `${eventUserId}/${event.id}/occurrences/${occurrenceId}/${crypto.randomUUID()}-${safeFileName(file.name)}`
          const uploaded = await supabase.storage.from('meeting-documents').upload(storagePath, file, { contentType: file.type, upsert: false })
          if (uploaded.error) throw uploaded.error
          const { error } = await supabase.from('attachments').insert({ event_id: event.id, occurrence_id: occurrenceId, scope: 'occurrence', file_name: file.name, mime_type: file.type, file_size: file.size, storage_path: storagePath, uploaded_by: eventUserId })
          if (error) { await supabase.storage.from('meeting-documents').remove([storagePath]); throw error }
        }
        return { eventId: event.id, warning: '' }
      }
      if (!event && isPastBangkokDate(draft.date)) throw new Error('ไม่สามารถสร้าง Meeting ในวันที่ผ่านมาแล้ว')
      const startIso = toIso(draft.date, draft.start, draft.all_day)
      const payload = {
        title: draft.title.trim(), description: draft.description.trim(), location: draft.location.trim(), affiliation: draft.affiliation.trim(), all_day: draft.all_day,
        grc_category_key: draft.grc_category_key, committee_key: draft.committee_key,
        start_datetime: startIso, end_datetime: draft.end ? toIso(draft.date, draft.end, draft.all_day) : null,
        recurrence_rule: meetingRecurrenceRule(draft.recurrence), recurrence_until: draft.recurrence.until ? endOfBangkokDay(draft.recurrence.until) : null,
        recurrence_count: draft.recurrence.count,
      }
      const eventId = meetingSaveId(event?.id, eventUserId, pendingMeetingSave)
      const start = new Date(startIso)
      const reminders = draft.reminderKeys.map((key) => {
        const [value, unit] = key.split(':') as [string, 'minute' | 'day' | 'week' | 'month']
        const scheduledAt = reminderDate(start, key)
        return {
          offset_value: Number(value), offset_unit: unit, scheduled_at: scheduledAt.toISOString(), channel_email: draft.notifyEmail, channel_line: draft.notifyLine,
          status: meetingReminderStatus(scheduledAt)
        }
      })
      return saveMeetingWithFollowUp(eventId, async (targetEventId) => {
        const { data, error } = await supabase.rpc('save_meeting_event_v3', {
          target_event_id: targetEventId,
          target_new: !event,
          target_event: { ...payload, mobile_notifications_enabled: draft.notifyLine, email_notifications_enabled: draft.notifyEmail },
          target_guest_emails: parseGuestEmails(draft.guestEmails),
          target_reminders: reminders,
        })
        if (error || !data) throw error ?? new Error('ไม่สามารถบันทึกการประชุมได้')
        return data
      }, async (savedEventId) => {
        const validLinks = (draft.driveLinks ?? []).filter((l) => l.url.trim())
        const { error: deleteLinksError } = await supabase.from('document_links').delete().eq('event_id', savedEventId)
        if (deleteLinksError) console.warn('Could not clear existing drive links:', deleteLinksError.message)
        if (validLinks.length) {
          const { error: insertLinksError } = await supabase.from('document_links').insert(
            validLinks.map((link) => ({
              event_id: savedEventId,
              display_name: link.displayName.trim() || 'ลิงก์ Google Drive',
              url: link.url.trim(),
              provider: 'google_drive' as const,
              added_by: user!.id,
            }))
          )
          if (insertLinksError) console.warn('Could not insert drive links:', insertLinksError.message)
        }

        for (const file of draft.files) {
          const storagePath = `${eventUserId}/${savedEventId}/${crypto.randomUUID()}-${safeFileName(file.name)}`
          const uploaded = await supabase.storage.from('meeting-documents').upload(storagePath, file, { contentType: file.type, upsert: false })
          if (uploaded.error) throw new Error(`อัปโหลดไฟล์ ${file.name} ไม่สำเร็จ`)
          const { error } = await supabase.from('attachments').insert({ event_id: savedEventId, file_name: file.name, mime_type: file.type, file_size: file.size, storage_path: storagePath, uploaded_by: eventUserId })
          if (error) { await supabase.storage.from('meeting-documents').remove([storagePath]); throw new Error(`บันทึกข้อมูลไฟล์ ${file.name} ไม่สำเร็จ`) }
        }
        if (!event) {
          if (draft.notifyEmail) {
            const { error } = await supabase.rpc('queue_creation_confirmation', { target_event_id: savedEventId })
            if (error) throw new Error('ยังยืนยันการเข้าคิวอีเมลยืนยันการสร้างประชุมไม่ได้')
          }
          if (draft.notifyLine) {
            const { error } = await supabase.rpc('queue_meeting_mobile_notification', { target_event_id: savedEventId })
            if (error) throw new Error('ยังยืนยันการเข้าคิวแจ้งเตือนมือถือไม่ได้')
          }
          if (draft.sendImmediate) {
            const { error: notificationError } = await supabase.rpc('queue_meeting_initial_notifications', { target_event_id: savedEventId })
            if (notificationError) throw new Error('ยังยืนยันการเข้าคิวคำเชิญผู้เข้าร่วมไม่ได้')
          }
        } else {
          if (notifyRecipients) {
            const { error } = await supabase.from('events').update({ notification_requested_at: new Date().toISOString() }).eq('id', savedEventId)
            if (error) throw new Error('ยังยืนยันการขอส่งแจ้งเตือนการแก้ไขประชุมไม่ได้')
          }
          if (notifyRecipients && draft.notifyLine) {
            const { error } = await supabase.rpc('queue_meeting_mobile_notification', { target_event_id: savedEventId, target_initial: false })
            if (error) throw new Error('ยังยืนยันการเข้าคิวแจ้งเตือนมือถือจากการแก้ไขประชุมไม่ได้')
          }
        }
      })
    },
    onSuccess: async ({ warning }) => {
      setEventSaveWarning(warning)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['events'] }), queryClient.invalidateQueries({ queryKey: ['calendar-avatar-roster'] }), queryClient.invalidateQueries({ queryKey: ['event-details'] }), queryClient.invalidateQueries({ queryKey: ['meeting-exceptions'] }), queryClient.invalidateQueries({ queryKey: ['recent-documents'] }), queryClient.invalidateQueries({ queryKey: ['event-creation-stats'] }), queryClient.invalidateQueries({ queryKey: ['admin-calendar-items'] })])
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
      const shouldNotifyExternalRecipients = Boolean(externalEmails.length && notifyRecipients && (!task || task.status === 'pending'))
      let externalAccessToken = ''
      if (shouldNotifyExternalRecipients) {
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
        // Task editing does not expose recurrence controls. Keep a legacy
        // series rule intact instead of triggering its cancellation cleanup.
        recurrence_rule: task?.recurrence_rule ?? null,
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

        if (draft.reminderMode === 'continuous') {
          const continuousDates = generateContinuousReminderDates(draft.dueDate, draft.dueTime, draft.continuousConfig)
          if (continuousDates.length) {
            const reminders = continuousDates.map((date) => ({
              task_id: taskId!,
              reminder_key: 'continuous' as const,
              scheduled_at: date.toISOString(),
              channel_email: draft.notifyEmail,
              channel_line: hasInternal && draft.notifyLine,
              status: meetingReminderStatus(date),
            }))
            const { error } = await supabase.from('task_reminders').insert(reminders)
            if (error) throw error
          }
        } else if (draft.reminderKeys.length) {
          const due = taskDueDateTime(draft.dueDate, draft.dueTime)
          const reminders = draft.reminderKeys.map((key) => {
            const scheduledAt = taskReminderDate(due, key)
            return {
              task_id: taskId!,
              reminder_key: key,
              scheduled_at: scheduledAt.toISOString(),
              channel_email: draft.notifyEmail,
              channel_line: hasInternal && draft.notifyLine,
              status: meetingReminderStatus(scheduledAt),
            }
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
        if (!task && draft.notifyEmail) {
          const { error } = await supabase.rpc('queue_creation_confirmation', { target_task_id: taskId })
          if (error) throw error
        }
        if (!task && draft.notifyLine) {
          const { error } = await supabase.rpc('queue_task_creation_mobile_confirmation', { target_task_id: taskId })
          if (error) throw error
        }
        if (notifyRecipients && (hasInternal || (task && draft.notifyLine)) && (!task || task.status === 'pending')) {
          const requestedAt = new Date().toISOString()
          const { error } = await supabase.from('tasks').update({ notification_requested_at: requestedAt }).eq('id', taskId)
          if (error) throw error
          if (task && draft.notifyLine) {
            const { error } = await supabase.rpc('queue_task_update_mobile_notifications', { target_task_id: taskId, target_requested_at: requestedAt })
            if (error) throw error
          }
        }
        let warning = ''
        if (shouldNotifyExternalRecipients) {
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
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['tasks'] }), queryClient.invalidateQueries({ queryKey: ['task-details'] }), queryClient.invalidateQueries({ queryKey: ['recent-documents'] }), queryClient.invalidateQueries({ queryKey: ['event-creation-stats'] }), queryClient.invalidateQueries({ queryKey: ['admin-calendar-items'] })])
    },
  })

  const deleteEventMutation = useMutation({
    mutationFn: async (event: EventRow) => { const { error } = await supabase.from('events').update({ deleted_at: new Date().toISOString() }).eq('id', event.id); if (error) throw error },
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['events'] }), queryClient.invalidateQueries({ queryKey: ['calendar-avatar-roster'] }), queryClient.invalidateQueries({ queryKey: ['event-creation-stats'] })]); setEventDialog({ open: false, event: null }) },
  })
  const joinMeetingMutation = useMutation({
    mutationFn: async (scope: 'occurrence' | 'series') => {
      if (!selectedEvent || !user) throw new Error('ไม่พบการประชุมหรือบัญชีผู้ใช้')
      const { data, error } = await supabase.rpc('join_meeting_as_attendee', {
        target_event_id: selectedEvent.id,
        target_occurrence_start: selectedEventOccurrenceStart ?? selectedEvent.start_datetime,
        target_scope: scope,
      })
      if (error) throw error
      return data === true
    },
    onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['event-details', selectedEvent?.id] }), queryClient.invalidateQueries({ queryKey: ['calendar-avatar-roster'] })]) },
  })
  const changeAttendanceMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEvent || !user || !selectedEventOccurrenceStart) throw new Error('ไม่พบนัดหมายที่เลือก')
      const { data, error } = await supabase.rpc('change_meeting_attendance_to_occurrence', {
        target_event_id: selectedEvent.id, target_occurrence_start: selectedEventOccurrenceStart,
      })
      if (error) throw error
      return data === true
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['event-details', selectedEvent?.id] }) },
  })
  const appointmentMutation = useMutation({
    mutationFn: async ({ draft, date }: { draft?: EventDraft; date?: string }) => {
      if (!selectedEvent || !selectedEventOccurrenceStart) throw new Error('ไม่พบนัดที่เลือก')
      if (!draft || !date) {
        const { error } = await supabase.rpc('cancel_meeting_occurrence', { target_event_id: selectedEvent.id, target_occurrence_start: selectedEventOccurrenceStart })
        if (error) throw error
        return
      }
      const files: File[] = [...draft.files]
      for (const attachment of eventDetailsQuery.data?.attachments ?? []) {
        const { data, error } = await supabase.storage.from('meeting-documents').download(attachment.storage_path)
        if (error || !data) throw error ?? new Error('เปิดไฟล์แนบไม่ได้')
        files.push(new File([data], attachment.file_name, { type: attachment.mime_type }))
      }
      const { data: newId, error } = await supabase.rpc('detach_meeting_occurrence', {
        target_event_id: selectedEvent.id, target_occurrence_start: selectedEventOccurrenceStart,
        target_new_start: toIso(date, draft.start, draft.all_day), target_description: draft.description,
        target_location: draft.location, target_guest_emails: parseGuestEmails(draft.guestEmails),
      })
      if (error || !newId) throw error ?? new Error('ย้ายนัดไม่ได้')
      try {
        for (const file of files) {
          const storagePath = `${user!.id}/${newId}/${crypto.randomUUID()}-${safeFileName(file.name)}`
          const uploaded = await supabase.storage.from('meeting-documents').upload(storagePath, file, { contentType: file.type })
          if (uploaded.error) throw uploaded.error
          const saved = await supabase.from('attachments').insert({ event_id: newId, file_name: file.name, mime_type: file.type, file_size: file.size, storage_path: storagePath, uploaded_by: user!.id })
          if (saved.error) { await supabase.storage.from('meeting-documents').remove([storagePath]); throw saved.error }
        }
      } catch {
        await Swal.fire({ icon: 'warning', title: 'ย้ายนัดแล้ว แต่คัดลอกไฟล์แนบไม่ครบ', text: 'กรุณาเปิดประชุมใหม่แล้วเพิ่มไฟล์แนบที่ขาด' })
      }
    },
    onSuccess: async () => {
      await Promise.all(['calendar-avatar-roster', 'events', 'event-details', 'meeting-exceptions', 'recent-documents', 'event-creation-stats'].map((key) => queryClient.invalidateQueries({ queryKey: [key] })))
      setEventDialog({ open: false, event: null })
    },
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
  const retryNotificationMutation = useMutation({
    mutationFn: async (deliveryId: string) => {
      const { error } = await supabase.rpc('retry_notification_delivery', { target_delivery_id: deliveryId })
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['event-details'] }),
        queryClient.invalidateQueries({ queryKey: ['task-details'] }),
      ])
    },
  })
  const saveMeetingCompletionMutation = useMutation({
    mutationFn: async ({ eventId, occurrenceStart, summaryHtml, completed }: {
      eventId: string
      occurrenceStart: string
      summaryHtml: string
      completed: boolean
    }) => {
      const { data, error } = await supabase.rpc('save_meeting_completion', {
        target_event_id: eventId,
        target_occurrence_start: occurrenceStart,
        target_summary_html: summaryHtml,
        target_completed: completed,
      })
      if (error) throw error
      return data
    },
    onSuccess: (_, variables) => {
      setStoredMeetingCompletions(saveStoredMeetingCompletion(variables.eventId, variables.occurrenceStart, variables.completed))
      queryClient.invalidateQueries({ queryKey: ['meeting-completions'] })
      queryClient.invalidateQueries({ queryKey: ['event-details', variables.eventId] })
    },
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
    }).catch(() => { })
  }, [acknowledgeFromEmail, linkedTaskId, navigate, selectedTask, taskDetailsQuery.data, user, acknowledgeTaskMutation])

  const normalizedSearch = search.trim().toLowerCase()
  const eventRows = useMemo(() => (eventsQuery.data ?? []).filter((event) => `${event.title} ${event.location} ${event.affiliation} ${event.description}`.toLowerCase().includes(normalizedSearch)), [eventsQuery.data, normalizedSearch])
  const taskRows = useMemo(() => (tasksQuery.data ?? []).filter((task) => (showCompletedTasks || task.status !== 'completed') && `${task.title} ${task.affiliation} ${task.description}`.toLowerCase().includes(normalizedSearch)), [normalizedSearch, showCompletedTasks, tasksQuery.data])
  const cancelledAppointments = useMemo(() => new Set((exceptionsQuery.data ?? []).map((exception) => `${exception.event_id}:${new Date(exception.occurrence_key).getTime()}`)), [exceptionsQuery.data])
  const today = bangkokDate()
  const now = useMemo(() => new Date(`${today}T00:00:00+07:00`), [today])
  const entriesForRange = useCallback((rangeStart: Date, rangeEnd: Date) => {
    return [
      ...(showMeetings ? eventRows.flatMap((event) => calendarMeetingOccurrences(event, rangeStart, rangeEnd).filter((occurrence) => !cancelledAppointments.has(`${event.id}:${new Date(occurrence.start).getTime()}`)).flatMap((occurrence) => {
        const isCompleted = isMeetingCompleted(completedMeetings, event.id, occurrence.start)
        const isPast = isPastBangkokDate(calendarDayKey(occurrence.start), now)
        const isPendingConfirmation = isPast && !isCompleted
        if (isCompleted && !showCompletedMeetings) return []
        if (isPendingConfirmation && !showPendingConfirmationMeetings) return []
        const meetingStatus = getMeetingStatus(isCompleted, occurrence.start, now)
        const colors = getMeetingColors(meetingStatus, event.owner_user_id === user?.id)
        return [{
          id: `event-${occurrence.key}`,
          title: event.title,
          start: event.all_day ? calendarDayKey(occurrence.start) : occurrence.start,
          end: occurrence.end ? event.all_day ? calendarDayKey(occurrence.end) : occurrence.end : undefined,
          allDay: event.all_day,
          backgroundColor: colors.backgroundColor,
          borderColor: colors.borderColor,
          textColor: colors.textColor,
          extendedProps: {
            kind: 'event',
            row: event,
            isOverdue: isPendingConfirmation,
            isPendingConfirmation,
            isCompleted,
            occurrenceStart: occurrence.start,
          },
        }]
      })) : []),
      ...(showTasks ? taskRows.flatMap((task) => {
        if (task.recurrence_series_id) return []
        if (task.status === 'completed' && !showCompletedTasks) return []
        const isOverdue = isTaskOverdue(task.status, task.due_date, now)
        if (isOverdue && !showOverdueTasks) return []
        return [{
          id: `task-${task.id}`,
          title: task.title,
          start: task.due_time ? `${task.due_date}T${task.due_time.slice(0, 5)}:00+07:00` : task.due_date,
          allDay: !task.due_time,
          backgroundColor: isOverdue ? '#fee2e2' : task.status === 'completed' ? '#dcf8e9' : '#fff0ce',
          borderColor: isOverdue ? '#fecdd3' : task.status === 'completed' ? '#bbf7d0' : '#fde68a',
          textColor: isOverdue ? '#991b1b' : task.status === 'completed' ? '#166534' : '#92400e',
          extendedProps: {
            kind: 'task',
            row: task,
            isOverdue,
            isCompleted: task.status === 'completed',
            isPendingConfirmation: false,
          },
        }]
      }) : []),
    ]
  }, [eventRows, taskRows, cancelledAppointments, showMeetings, showTasks, showCompletedTasks, showCompletedMeetings, showOverdueTasks, showPendingConfirmationMeetings, completedMeetings, user?.id, today])
  const calendarEntries = useMemo(() => entriesForRange(calendarRange.start, calendarRange.end), [entriesForRange, calendarRange])
  const entriesByDay = useMemo(() => calendarEntriesByDay(calendarEntries), [calendarEntries])
  const summaryEntries = useMemo(() => {
    const summaryStart = new Date(`${today}T00:00:00+07:00`); summaryStart.setUTCFullYear(summaryStart.getUTCFullYear() - 1)
    const summaryEnd = new Date(`${today}T23:59:59.999+07:00`); summaryEnd.setUTCFullYear(summaryEnd.getUTCFullYear() + 1)
    return entriesForRange(summaryStart, summaryEnd)
  }, [entriesForRange, today])
  const todayEntries = useMemo(() => summaryEntries.filter((entry) => calendarDayKey(entry.start) === today), [summaryEntries, today])
  const selectedDayEntries = useMemo(() => summaryEntries.filter((entry) => calendarDayKey(entry.start) === miniSelectedDate)
    .sort((first, second) => new Date(first.start).getTime() - new Date(second.start).getTime()), [summaryEntries, miniSelectedDate])
  const selectedDayHeading = useMemo(() => {
    try {
      const date = new Date(`${miniSelectedDate}T00:00:00+07:00`)
      return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Bangkok',
      }).format(date)
    } catch {
      return miniSelectedDate
    }
  }, [miniSelectedDate, language])
  const upcomingEntries = useMemo(() => summaryEntries.filter((entry) => calendarDayKey(entry.start) >= today)
    .sort((first, second) => new Date(first.start).getTime() - new Date(second.start).getTime()).slice(0, 3), [summaryEntries, today])
  const recentDocuments = (recentDocumentsQuery.data ?? []).filter((document) => document.parent === 'event'
    ? eventsQuery.data?.some((event) => event.id === document.parentId)
    : tasksQuery.data?.some((task) => task.id === document.parentId)).slice(0, 3)
  const viewPeriodKeys = useMemo(() => {
    const startKey = calendarDayKey(viewPeriod.start)
    const endKey = calendarDayKey(new Date(Math.max(viewPeriod.start.getTime(), viewPeriod.end.getTime() - 1)))
    return { startKey, endKey }
  }, [viewPeriod])

  const overdueCount = useMemo(() => {
    return (tasksQuery.data ?? []).filter((task) => {
      if (task.recurrence_series_id) return false
      if (!isTaskOverdue(task.status, task.due_date, now)) return false
      return task.due_date >= viewPeriodKeys.startKey && task.due_date <= viewPeriodKeys.endKey
    }).length
  }, [tasksQuery.data, viewPeriodKeys, now])

  const pendingCount = useMemo(() => {
    return (tasksQuery.data ?? []).filter((task) => {
      if (task.recurrence_series_id) return false
      if (task.status !== 'pending') return false
      if (isTaskOverdue(task.status, task.due_date, now)) return false
      return task.due_date >= viewPeriodKeys.startKey && task.due_date <= viewPeriodKeys.endKey
    }).length
  }, [tasksQuery.data, viewPeriodKeys, now])

  const completedCount = useMemo(() => {
    const completedTasks = (tasksQuery.data ?? []).filter((task) => {
      if (task.recurrence_series_id) return false
      if (task.status !== 'completed') return false
      return task.due_date >= viewPeriodKeys.startKey && task.due_date <= viewPeriodKeys.endKey
    }).length
    const completedMeetingsCount = calendarEntries.filter((entry) => {
      if (entry.extendedProps.kind !== 'event') return false
      if (!(entry.extendedProps as { isCompleted?: boolean }).isCompleted) return false
      const dayKey = calendarDayKey(entry.start)
      return dayKey >= viewPeriodKeys.startKey && dayKey <= viewPeriodKeys.endKey
    }).length
    return completedTasks + completedMeetingsCount
  }, [tasksQuery.data, calendarEntries, viewPeriodKeys])

  const pendingConfirmationMeetingsCount = useMemo(() => {
    return calendarEntries.filter((entry) => {
      if (entry.extendedProps.kind !== 'event') return false
      if (!(entry.extendedProps as { isPendingConfirmation?: boolean }).isPendingConfirmation) return false
      const dayKey = calendarDayKey(entry.start)
      return dayKey >= viewPeriodKeys.startKey && dayKey <= viewPeriodKeys.endKey
    }).length
  }, [calendarEntries, viewPeriodKeys])
  const entryDotClass = useCallback((entry: (typeof calendarEntries)[number]) => {
    if (entry.extendedProps.kind === 'task') {
      return (entry.extendedProps.row as TaskRow).status === 'completed'
        ? 'semantic-dot semantic-completed'
        : entry.extendedProps.isOverdue
          ? 'semantic-dot semantic-overdue'
          : 'semantic-dot semantic-task'
    }
    return (entry.extendedProps as { isCompleted?: boolean }).isCompleted
      ? 'semantic-dot semantic-completed'
      : (entry.extendedProps as { isPendingConfirmation?: boolean }).isPendingConfirmation
        ? 'semantic-dot semantic-pending'
        : 'semantic-dot semantic-meeting'
  }, [])
  const openCalendarEntry = useCallback((entry: (typeof calendarEntries)[number]) => {
    if (entry.extendedProps.kind === 'task') setTaskDialog({ open: true, task: entry.extendedProps.row as TaskRow })
    else setEventDialog({ open: true, event: entry.extendedProps.row as EventRow, occurrenceStart: (entry.extendedProps as { occurrenceStart?: string }).occurrenceStart })
  }, [])
  const openRecentDocument = (document: RecentDocument) => {
    if (document.parent === 'task') {
      const task = tasksQuery.data?.find((item) => item.id === document.parentId)
      if (task) setTaskDialog({ open: true, task })
    } else {
      const event = eventsQuery.data?.find((item) => item.id === document.parentId)
      if (event) setEventDialog({ open: true, event })
    }
  }
  const setCalendarTooltipAt = useCallback((items: CalendarTooltipItem[], clientX: number, clientY: number) => {
    const tooltipWidth = 288
    const estimatedHeight = Math.min(window.innerHeight * 0.7, 40 + items.length * 105)

    let x = clientX + 16
    if (x + tooltipWidth > window.innerWidth - 16) {
      x = clientX - tooltipWidth - 16
    }
    x = Math.max(16, Math.min(x, window.innerWidth - tooltipWidth - 16))

    let y = clientY + 16
    if (y + estimatedHeight > window.innerHeight - 16) {
      y = clientY - estimatedHeight - 16
    }
    y = Math.max(16, Math.min(y, window.innerHeight - estimatedHeight - 16))

    setCalendarTooltip({
      items,
      x,
      y,
    })
  }, [])
  const showCalendarTooltip = useCallback((info: EventHoveringArg) => {
    const isTask = info.event.extendedProps.kind === 'task'
    const row = info.event.extendedProps.row as EventRow | TaskRow
    if (!info.event.start) return
    setCalendarTooltipAt([{
      kind: isTask ? 'task' : 'event',
      title: info.event.title,
      affiliation: normalizeAffiliationText(row.affiliation) || '-',
      date: info.event.start,
      isOverdue: Boolean(info.event.extendedProps.isOverdue),
      isCompleted: Boolean(info.event.extendedProps.isCompleted),
      isPendingConfirmation: Boolean(info.event.extendedProps.isPendingConfirmation),
    }], info.jsEvent.clientX, info.jsEvent.clientY)
  }, [setCalendarTooltipAt])
  const canEditEvent = canManageMeeting(selectedEvent?.owner_user_id, user?.id, isActiveAdmin)
  const canEditTask = !selectedTask || selectedTask.creator_user_id === user?.id || isActiveAdmin
  const canDeleteEvent = canManageMeeting(selectedEvent?.owner_user_id, user?.id)
  const canDeleteTask = !selectedTask || selectedTask.creator_user_id === user?.id
  const canCompleteTask = Boolean(selectedTask && selectedTask.creator_user_id === user?.id)
  const canAcknowledgeTask = Boolean(selectedTask && selectedTask.creator_user_id !== user?.id && selectedTask.status === 'pending' && taskDetailsQuery.data?.internalRecipients.some((recipient) => recipient.user_id === user?.id && !recipient.acknowledged_at))
  const busy = eventMutation.isPending || taskMutation.isPending || deleteEventMutation.isPending || deleteTaskMutation.isPending || deleteEventAttachmentMutation.isPending || deleteTaskAttachmentMutation.isPending || toggleTaskMutation.isPending || acknowledgeTaskMutation.isPending
  const warnPastCreation = useCallback(async (date: string) => {
    if (!isPastBangkokDate(date)) return false
    await confirm({ title: text('ไม่สามารถสร้างรายการย้อนหลัง', 'Cannot create an item in the past'), message: text(`ไม่สามารถสร้าง Meeting หรือ Task ก่อนวันที่ ${bangkokDate()} ได้`, `Meetings and Tasks cannot be created before ${bangkokDate()}.`), confirmLabel: text('รับทราบ', 'OK'), tone: 'danger' })
    return true
  }, [confirm, text])

  // Keep calendar options stable while tooltips, dialogs, or sidebar tabs change.
  const calendar = useMemo(() => (
    <FullCalendar
      ref={calendarRef}
      plugins={[dayGridPlugin, interactionPlugin, timeGridPlugin, multiMonthPlugin, listPlugin, luxonPlugin]}
      locale={language === 'th' ? thLocale : enGbLocale}
      timeZone="Asia/Bangkok"
      initialView={calendarViewType(calendarView, compactCalendar)}
      slotEventOverlap={calendarView !== 'week' && calendarView !== 'day'}
      {...(calendarView === 'week' ? { eventMaxStack: 2 } : {}) /* Omit the option: FullCalendar coerces explicit undefined to NaN. */}
      datesSet={updateCalendarRange}
      firstDay={1}
      height={compactCalendar && (calendarView === 'year' || calendarView === 'week') ? 'auto' : '100%'}
      multiMonthMaxColumns={3}
      multiMonthMinWidth={230}
      views={{
        multiMonthYear: {
          dayMaxEvents: false,
        },
        multiMonth: {
          dayMaxEvents: false,
        },
      }}
      dayHeaderContent={(info) => formatCalendarDayHeader(info.date, info.view?.type, language)}
      slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
      eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
      scrollTime="08:00:00"
      nowIndicator
      expandRows
      fixedWeekCount={false}
      selectable
      dateClick={(info) => {
        const date = calendarClickedDate(info.dateStr)
        setMiniSelectedDate(date)
        if (calendarView === 'year') {
          const dayEntries = entriesByDay.get(date) ?? []
          if (dayEntries.length === 1) {
            openCalendarEntry(dayEntries[0])
            return
          }
          if (dayEntries.length > 1) {
            setYearDayDialog({ open: true, date, entries: dayEntries })
            return
          }
        }
        void warnPastCreation(date).then((isPast) => {
          if (!isPast) setEventDialog({ open: true, event: null, date })
        })
      }}
      dayCellContent={(info) => {
        const items = (entriesByDay.get(calendarDayKey(info.date)) ?? []).map((entry) => {
          const row = entry.extendedProps.row as EventRow | TaskRow
          return {
            kind: entry.extendedProps.kind as CalendarTooltipItem['kind'],
            title: entry.title,
            affiliation: normalizeAffiliationText(row.affiliation) || '-',
            date: info.date,
            isOverdue: Boolean(entry.extendedProps.isOverdue),
            isCompleted: Boolean(entry.extendedProps.isCompleted),
            isPendingConfirmation: Boolean(entry.extendedProps.isPendingConfirmation),
          }
        })
        if (info.view?.type?.startsWith('multiMonth')) {
          if (!items.length) {
            return (
              <span
                onMouseEnter={() => setCalendarTooltip(null)}
                onMouseLeave={() => setCalendarTooltip(null)}
              >
                {info.dayNumberText}
              </span>
            )
          }

          const hasMeeting = items.some((item) => item.kind === 'event')
          const hasTask = items.some((item) => item.kind === 'task')
          const hasOverdue = items.some((item) => item.isOverdue)
          const hasPending = items.some((item) => item.isPendingConfirmation)
          const isAllCompleted = items.length > 0 && items.every((item) => item.isCompleted)

          let circleClass = ''
          if (hasOverdue) circleClass = 'circle-status-overdue'
          else if (hasPending) circleClass = 'circle-status-pending'
          else if (isAllCompleted) circleClass = 'circle-status-completed'
          else if (hasMeeting && hasTask) circleClass = 'circle-status-mixed'
          else if (hasMeeting) circleClass = 'circle-status-meeting'
          else if (hasTask) circleClass = 'circle-status-task'

          return (
            <span
              className={`calendar-year-circle ${circleClass} cursor-help`}
              onMouseEnter={(event) => setCalendarTooltipAt(items, event.clientX, event.clientY)}
              onMouseLeave={() => setCalendarTooltip(null)}
              onClick={(event) => {
                event.stopPropagation()
                setCalendarTooltip(null)
                const dateKey = calendarDayKey(info.date)
                setMiniSelectedDate(dateKey)
                const dayEntries = entriesByDay.get(dateKey) ?? []
                if (dayEntries.length === 1) {
                  openCalendarEntry(dayEntries[0])
                  return
                }
                if (dayEntries.length > 1) {
                  setYearDayDialog({ open: true, date: dateKey, entries: dayEntries })
                  return
                }
                void warnPastCreation(dateKey).then((isPast) => {
                  if (!isPast) setEventDialog({ open: true, event: null, date: dateKey })
                })
              }}
            >
              <span className="calendar-year-number">{info.dayNumberText}</span>
              {items.length > 1 && (
                <span
                  className={`calendar-micro-badge ${hasOverdue ? 'badge-overdue' : hasMeeting && hasTask ? 'badge-mixed' : hasMeeting ? 'badge-meeting' : 'badge-task'}`}
                  aria-hidden="true"
                >
                  {items.length > 9 ? '9+' : items.length}
                </span>
              )}
            </span>
          )
        }
        return <span className={items.length ? 'cursor-help' : undefined} onMouseEnter={(event) => { if (items.length) setCalendarTooltipAt(items, event.clientX, event.clientY) }} onMouseLeave={() => setCalendarTooltip(null)}>{info.dayNumberText}</span>
      }}
      eventClick={(info) => {
        setCalendarTooltip(null)
        if (info.event.extendedProps.kind === 'task') setTaskDialog({ open: true, task: info.event.extendedProps.row as TaskRow })
        else setEventDialog({ open: true, event: info.event.extendedProps.row as EventRow, occurrenceStart: info.event.extendedProps.occurrenceStart as string | undefined })
      }}
      eventMouseEnter={showCalendarTooltip}
      eventMouseLeave={() => setCalendarTooltip(null)}
      eventClassNames={(info) => {
        if (info.event.extendedProps.kind === 'task') {
          return (info.event.extendedProps.row as TaskRow).status === 'completed'
            ? 'calendar-task-completed'
            : info.event.extendedProps.isOverdue
              ? 'calendar-overdue'
              : 'calendar-task'
        }
        return info.event.extendedProps.isCompleted
          ? 'calendar-meeting-completed'
          : info.event.extendedProps.isPendingConfirmation
            ? 'calendar-pending'
            : 'calendar-meeting'
      }}
      eventContent={(info) => {
        if (info.view.type.startsWith('multiMonth')) {
          return null
        }
        const isTask = info.event.extendedProps.kind === 'task'
        const task = isTask ? info.event.extendedProps.row as TaskRow : null
        const isCompleted = isTask ? task?.status === 'completed' : Boolean(info.event.extendedProps.isCompleted)
        const isPendingConfirmation = Boolean(info.event.extendedProps.isPendingConfirmation)
        const isOverdue = Boolean(info.event.extendedProps.isOverdue)
        const Icon = isCompleted ? CheckCircle2 : (isPendingConfirmation || isOverdue) ? Clock3 : isTask ? ListTodo : CalendarDays
        const title = `${isCompleted ? text('เสร็จสิ้น: ', 'Completed: ') : ''}${info.event.title}`
        const people = <CalendarPeople ownerId={task ? task.creator_user_id : (info.event.extendedProps.row as EventRow).owner_user_id} eventId={isTask ? undefined : (info.event.extendedProps.row as EventRow).id} start={info.event.extendedProps.occurrenceStart as string | undefined ?? info.event.start?.toISOString()} profiles={profilesQuery.data ?? []} creatorName={task ? task.creator_name : (info.event.extendedProps.row as EventRow).creator_name} calendarOwnerEmail={task ? null : (info.event.extendedProps.row as EventRow).calendar_owner_email} max={2} />
        if (info.view.type === 'timeGridWeek' && !info.event.allDay) return <div className="calendar-entry-content min-w-0 px-1"><span className="flex min-w-0 items-center gap-1"><Icon size={12} className="shrink-0 calendar-entry-icon" aria-hidden="true" /><span className="truncate font-medium tabular-nums text-[10.5px]">{info.timeText.match(/^\d{1,2}:\d{2}/)?.[0] ?? info.timeText}</span></span><div className="fc-event-title text-[10.5px]">{title}</div>{people}</div>
        if (info.view.type === 'timeGridDay' && !info.event.allDay) {
          return (
            <div className="calendar-entry-content min-w-0 px-1 py-0.5">
              <div className="flex min-w-0 items-center justify-between gap-1 mb-0.5">
                <span className="flex min-w-0 items-center gap-1">
                  <Icon size={12} className="shrink-0 calendar-entry-icon" aria-hidden="true" />
                  <span className="truncate font-semibold tabular-nums text-[10.5px]">{info.timeText}</span>
                </span>
                {people}
              </div>
              <div className="fc-event-title font-medium leading-snug text-[10.5px]">{title}</div>
            </div>
          )
        }
        return (
          <div className="calendar-entry-content flex min-w-0 w-full items-center justify-between gap-1 px-0.5">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
              <Icon size={11} className="shrink-0 calendar-entry-icon" aria-hidden="true" />
              {info.view.type.startsWith('timeGrid') && !info.event.allDay && <span className="block truncate font-semibold tabular-nums shrink-0 text-[10.5px]">{info.timeText}</span>}
              <span className="fc-event-title truncate text-[10px] sm:text-[10.5px]">{title}</span>
            </div>
            {people}
          </div>
        )
      }}
      events={calendarEntries}
      headerToolbar={{ left: 'title prev,next today', center: '', right: '' }}
      dayMaxEvents={calendarView === 'year' ? false : 1}
      moreLinkContent={(info) => info?.view?.type?.startsWith('multiMonth') ? `+${info.num}` : text(`+${info.num} เพิ่มเติม`, `+${info.num} more`)}
    />
  ), [calendarEntries, entriesByDay, calendarView, compactCalendar, language, text, updateCalendarRange, warnPastCreation, setCalendarTooltipAt, showCalendarTooltip, profilesQuery.data, openCalendarEntry])

  const calendarControls = (
    <div className="mb-4 grid gap-3 lg:mb-0 lg:gap-3">
      <div className="relative w-full max-w-md lg:max-w-none">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input className="field-input pl-10 lg:px-3 lg:py-1.5 lg:pl-9 lg:text-sm" placeholder={text('ค้นหา Meeting หรือ Task', 'Search meetings or tasks')} value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      <div className="calendar-filter-options flex flex-col gap-2.5" aria-label={text('ตัวกรองรายการในปฏิทิน', 'Calendar filters')}>
        {/* กลุ่มที่ 1: ประเภทรายการ */}
        <div className="space-y-1">
          <span className="block text-[11px] font-extrabold uppercase tracking-wider text-black">{text('ประเภทรายการ', 'Item type')}</span>
          <div className="flex flex-wrap justify-start gap-1.5 text-xs font-bold lg:flex-col lg:items-stretch lg:gap-1.5">
            <label className={`calendar-filter-option flex min-h-9 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 transition lg:min-h-9 lg:gap-2 lg:px-2.5 lg:py-1 lg:text-xs ${showMeetings ? 'border-2 border-black bg-[#FFE15D] text-black font-extrabold shadow-[2px_2px_0px_#000000]' : 'border-2 border-black bg-white text-black/60 shadow-[2px_2px_0px_#000000] hover:bg-[#FFFDF7]'}`}>
              <input type="checkbox" className="h-4 w-4 shrink-0 accent-black lg:h-3.5 lg:w-3.5" checked={showMeetings} onChange={(event) => setShowMeetings(event.target.checked)} />
              <CalendarDays size={16} className="shrink-0 text-black" aria-hidden="true" />
              <span>{text('แสดง Meeting', 'Show meetings')}</span>
            </label>
            <label className={`calendar-filter-option flex min-h-9 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 transition lg:min-h-9 lg:gap-2 lg:px-2.5 lg:py-1 lg:text-xs ${showTasks ? 'border-2 border-black bg-[#4D77FF] text-white font-extrabold shadow-[2px_2px_0px_#000000]' : 'border-2 border-black bg-white text-black/60 shadow-[2px_2px_0px_#000000] hover:bg-[#FFFDF7]'}`}>
              <input type="checkbox" className="h-4 w-4 shrink-0 accent-black lg:h-3.5 lg:w-3.5" checked={showTasks} onChange={(event) => setShowTasks(event.target.checked)} />
              <ListTodo size={16} className={`shrink-0 ${showTasks ? 'text-white' : 'text-black'}`} aria-hidden="true" />
              <span>{text('แสดง Task', 'Show tasks')}</span>
            </label>
          </div>
        </div>

        {/* กลุ่มที่ 2: สถานะ */}
        <div className="space-y-1">
          <span className="block text-[11px] font-extrabold uppercase tracking-wider text-black">{text('สถานะ', 'Status')}</span>
          <div className="flex flex-wrap justify-start gap-1.5 text-xs font-bold lg:flex-col lg:items-stretch lg:gap-1.5">
            <label className={`calendar-filter-option flex min-h-9 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 transition lg:min-h-9 lg:gap-2 lg:px-2.5 lg:py-1 lg:text-xs ${showCompletedTasks ? 'border-2 border-black bg-[#52D17C] text-black font-extrabold shadow-[2px_2px_0px_#000000]' : 'border-2 border-black bg-white text-black/60 shadow-[2px_2px_0px_#000000] hover:bg-[#FFFDF7]'}`}>
              <input type="checkbox" className="h-4 w-4 shrink-0 accent-black lg:h-3.5 lg:w-3.5" checked={showCompletedTasks} onChange={(event) => setShowCompletedTasks(event.target.checked)} />
              <CheckCircle2 size={16} className="shrink-0 text-black" aria-hidden="true" />
              <span>{text('แสดง Task ที่เสร็จแล้ว', 'Show completed tasks')}</span>
            </label>
            <label className={`calendar-filter-option flex min-h-9 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-1.5 transition lg:min-h-9 lg:gap-2 lg:px-2.5 lg:py-1 lg:text-xs ${showCompletedMeetings ? 'border-2 border-black bg-[#52D17C] text-black font-extrabold shadow-[2px_2px_0px_#000000]' : 'border-2 border-black bg-white text-black/60 shadow-[2px_2px_0px_#000000] hover:bg-[#FFFDF7]'}`}>
              <input type="checkbox" className="h-4 w-4 shrink-0 accent-black lg:h-3.5 lg:w-3.5" checked={showCompletedMeetings} onChange={(event) => setShowCompletedMeetings(event.target.checked)} />
              <CheckCircle2 size={16} className="shrink-0 text-black" aria-hidden="true" />
              <span>{text('แสดง Meeting ที่เสร็จสิ้นแล้ว', 'Show completed meetings')}</span>
            </label>
            <label className={`calendar-filter-option flex min-h-9 max-w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 transition lg:whitespace-normal lg:min-h-9 lg:gap-2 lg:px-2.5 lg:py-1 lg:text-xs ${showOverdueTasks ? 'border-2 border-black bg-[#FF6B6B] text-white font-extrabold shadow-[2px_2px_0px_#000000]' : 'border-2 border-black bg-white text-black/60 shadow-[2px_2px_0px_#000000] hover:bg-[#FFFDF7]'}`}>
              <input type="checkbox" className="h-4 w-4 shrink-0 accent-black lg:h-3.5 lg:w-3.5" checked={showOverdueTasks} onChange={(event) => setShowOverdueTasks(event.target.checked)} />
              <Clock3 size={16} className={`shrink-0 ${showOverdueTasks ? 'text-white' : 'text-black'}`} aria-hidden="true" />
              <span>{text('แสดง Task เกินกำหนด', 'Show overdue tasks')}</span>
            </label>
            <label className={`calendar-filter-option flex min-h-9 max-w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 transition lg:whitespace-normal lg:min-h-9 lg:gap-2 lg:px-2.5 lg:py-1 lg:text-xs ${showPendingConfirmationMeetings ? 'border-2 border-black bg-[#FFA41B] text-black font-extrabold shadow-[2px_2px_0px_#000000]' : 'border-2 border-black bg-white text-black/60 shadow-[2px_2px_0px_#000000] hover:bg-[#FFFDF7]'}`}>
              <input type="checkbox" className="h-4 w-4 shrink-0 accent-black lg:h-3.5 lg:w-3.5" checked={showPendingConfirmationMeetings} onChange={(event) => setShowPendingConfirmationMeetings(event.target.checked)} />
              <Clock3 size={16} className="shrink-0 text-black" aria-hidden="true" />
              <span>{text('แสดง Meeting รอยืนยันเสร็จสิ้น', 'Show meetings pending confirmation')}</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  )

  const calendarViewOptions = [
    { value: 'day', label: text('วัน', 'Day') },
    { value: 'week', label: text('สัปดาห์', 'Week') },
    { value: 'month', label: text('เดือน', 'Month') },
    { value: 'year', label: text('ปี', 'Year') },
  ] as const

  return (
    <main className="calendar-page-main mx-auto w-full p-2 sm:p-2.5 lg:flex lg:flex-col lg:p-2">
      <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[270px_minmax(0,1fr)] lg:gap-0">
        <div className="calendar-primary-column min-w-0 lg:order-2 lg:flex lg:min-h-0 lg:flex-col">
          {/* Row 1: The 4 Status Cards across the top (matching reference mockup) */}
          <section className="calendar-status-header" aria-label={text('สถานะงานและการประชุม', 'Task and meeting status')}>
            <span className="calendar-status-title sr-only">{text('สถานะงานและการประชุม', 'Task and meeting status')}</span>

            <span className="semantic-pending status-card-pending" title={text('งานที่ยังไม่เสร็จในช่วงเวลาที่เลือก', 'Pending tasks in the selected period')}>
              <span className="flex items-center gap-1.5 min-w-0">
                <Clock3 size={16} className="shrink-0" aria-hidden="true" />
                <span className="flex flex-wrap items-baseline gap-x-1 min-w-0 font-extrabold leading-tight">
                  <span>{text('รอดำเนินการ', 'Pending')}</span>
                  <span className="text-[10px] font-bold opacity-85 whitespace-nowrap">(Task)</span>
                </span>
              </span>
              <strong>{pendingCount}</strong>
            </span>

            <span className="semantic-completed status-card-completed" title={text('งานและการประชุมที่เสร็จสิ้นในช่วงเวลาที่เลือก', 'Completed tasks and meetings in the selected period')}>
              <span className="flex items-center gap-1.5 min-w-0">
                <CheckCircle2 size={16} className="shrink-0" aria-hidden="true" />
                <span className="flex flex-wrap items-baseline gap-x-1 min-w-0 font-extrabold leading-tight">
                  <span>{text('เสร็จแล้ว', 'Completed')}</span>
                  <span className="text-[10px] font-bold opacity-85 whitespace-nowrap">({text('Task และ Meeting', 'Task & Meeting')})</span>
                </span>
              </span>
              <strong>{completedCount}</strong>
            </span>

            <span className="semantic-overdue status-card-overdue" title={text('งานที่เกินกำหนดส่งในช่วงเวลาที่เลือก', 'Overdue tasks in the selected period')}>
              <span className="flex items-center gap-1.5 min-w-0">
                <Clock3 size={16} className="shrink-0" aria-hidden="true" />
                <span className="flex flex-wrap items-baseline gap-x-1 min-w-0 font-extrabold leading-tight">
                  <span>{text('เกินกำหนด', 'Overdue')}</span>
                  <span className="text-[10px] font-bold opacity-85 whitespace-nowrap">(Task)</span>
                </span>
              </span>
              <strong>{overdueCount}</strong>
            </span>

            <span className="semantic-pending status-card-pending-confirmation" title={text('ประชุมในช่วงเวลาที่เลือกที่ผ่านเวลาแล้วแต่ยังไม่ยืนยันเสร็จสิ้น', 'Past meetings pending confirmation in the selected period')}>
              <span className="flex items-center gap-1.5 min-w-0">
                <Clock3 size={16} className="shrink-0" aria-hidden="true" />
                <span className="flex flex-wrap items-baseline gap-x-1 min-w-0 font-extrabold leading-tight">
                  <span>{text('ประชุมรอยืนยัน', 'Meetings pending confirmation')}</span>
                  <span className="text-[10px] font-bold opacity-85 whitespace-nowrap">(Meeting)</span>
                </span>
              </span>
              <strong>{pendingConfirmationMeetingsCount}</strong>
            </span>
          </section>

          {/* Row 2: Controls Toolbar (Segmented View Switcher on left, Action Buttons on right) */}
          <div className="calendar-page-header mb-2 flex items-center justify-between gap-3 lg:mb-2 lg:shrink-0">
            <div className="calendar-view-segmented inline-flex items-center gap-1 rounded-md bg-white p-1 border-2 border-black shadow-[2px_2px_0px_#000000]">
              <select
                aria-label={text('มุมมองปฏิทิน', 'Calendar view')}
                value={calendarView}
                onChange={(event) => handleSelectView(event.target.value as CalendarView)}
                className="sr-only"
              >
                {calendarViewOptions.map((view) => <option key={view.value} value={view.value}>{view.label}</option>)}
              </select>
              {calendarViewOptions.map((view) => {
                const isActive = calendarView === view.value
                return (
                  <button
                    key={view.value}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => handleSelectView(view.value as CalendarView)}
                    className={`min-h-8 rounded-md px-3 py-1 text-xs font-bold transition border-2 ${isActive ? 'bg-[#FFE15D] text-black border-black shadow-[2px_2px_0px_#000000]' : 'border-transparent text-black hover:bg-[#FFFBEA] hover:border-black'}`}
                  >
                    {view.label}
                  </button>
                )
              })}
            </div>

            <div className="hidden items-center gap-2 shrink-0 lg:flex">
              <button
                type="button"
                className="btn-secondary semantic-summary-action inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border-2 border-black bg-white px-3.5 py-1.5 text-xs font-bold text-black shadow-[2px_2px_0px_#000000] transition hover:bg-[#FFE15D]"
                onClick={() => setSummaryDialogOpen(true)}
              >
                <FileSpreadsheet size={15} className="text-black" />{text('สรุปการประชุม', 'Meeting summary')}
              </button>
              <button
                className="btn-secondary semantic-task-action inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border-2 border-black bg-[#EEF3FF] px-3.5 py-1.5 text-xs font-bold text-black shadow-[2px_2px_0px_#000000] transition hover:bg-[#DCE7FE]"
                onClick={() => setTaskDialog({ open: true, task: null })}
              >
                <ListTodo size={15} className="text-black" />{text('เพิ่ม Task', 'Add task')}
              </button>
              <button
                className="btn-primary inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border-2 border-black bg-[#FFE15D] px-3.5 py-1.5 text-xs font-bold text-black shadow-[2px_2px_0px_#000000] transition hover:bg-[#FED035]"
                onClick={() => setEventDialog({ open: true, event: null })}
              >
                <CalendarPlus size={15} />{text('เพิ่ม Meeting', 'Add meeting')}
              </button>
            </div>
          </div>
          <div className="min-w-0 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
            <div className="lg:hidden mb-2">
              <details className="group rounded-xl border border-[#DBD2E5] bg-white p-2.5 shadow-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-bold text-[#6B5287] select-none">
                  <span className="flex items-center gap-1.5">
                    <Search size={14} className="text-[#75638F]" />
                    <span>{text('ค้นหาและตัวกรอง', 'Search & filters')}</span>
                    {Boolean(search || !showMeetings || !showTasks || showCompletedTasks || showCompletedMeetings || showOverdueTasks || showPendingConfirmationMeetings) && (
                      <span className="h-2 w-2 rounded-full bg-brand-500" />
                    )}
                  </span>
                  <ChevronDown size={15} className="transition-transform group-open:rotate-180 text-slate-400" />
                </summary>
                <div className="mt-2.5 pt-2.5 border-t border-slate-100">
                  {calendarControls}
                </div>
              </details>
            </div>
            {(eventsQuery.isError || tasksQuery.isError || profilesQuery.isError || exceptionsQuery.isError) && <p className="mb-2 rounded-md bg-red-50 p-2.5 text-xs text-red-700">{text('โหลดข้อมูลไม่สำเร็จ กรุณาตรวจสอบว่าได้รัน migration ล่าสุดแล้ว', 'Could not load data. Check that the latest migrations have been applied.')}</p>}
            <div ref={calendarContainerRef} className={`calendar-fill calendar-fill-${calendarView} relative lg:min-h-0 lg:flex-1`}>
              {calendar}
              {calendarTooltip && <div role="tooltip" className="pointer-events-none fixed z-50 max-h-[70vh] w-72 overflow-y-auto rounded-md border border-slate-200 bg-white p-3 shadow-xl" style={{ left: calendarTooltip.x, top: calendarTooltip.y }}>
                {calendarTooltip.items.map((item, index) => <section key={`${item.kind}-${item.title}-${index}`} className={index ? 'mt-3 border-t border-slate-100 pt-3' : undefined}>
                  <p className={`mb-2 text-xs font-bold ${item.kind === 'task' ? 'semantic-ink semantic-task' : 'semantic-ink semantic-meeting'}`}>{item.kind === 'task' ? text('งาน', 'Task') : text('การประชุม', 'Meeting')}</p>
                  <dl className="space-y-1.5 text-sm text-slate-700">
                    <div><dt className="inline font-semibold text-slate-500">{text('ชื่อ: ', 'Title: ')}</dt><dd className="inline break-words">{item.title}</dd></div>
                    <div><dt className="inline font-semibold text-slate-500">{text('หน่วยงาน: ', 'Department: ')}</dt><dd className="inline break-words">{item.affiliation}</dd></div>
                    <div><dt className="inline font-semibold text-slate-500">{item.kind === 'task' ? text('วันครบกำหนด: ', 'Due date: ') : text('วันนัดหมาย: ', 'Meeting date: ')}</dt><dd className="inline">{calendarDateLabel(item.date, language)}</dd></div>
                    {item.kind === 'task' ? (
                      item.isCompleted ? (
                        <p className="pt-1 font-semibold text-emerald-600">{text('เสร็จสิ้นแล้ว', 'Completed')}</p>
                      ) : item.isOverdue ? (
                        <p className="pt-1 font-semibold text-red-600">{text('เกินวันครบกำหนดแล้ว', 'Past the due date')}</p>
                      ) : null
                    ) : (
                      item.isCompleted ? (
                        <p className="pt-1 font-semibold text-emerald-600">{text('เสร็จสิ้นการประชุมแล้ว', 'Meeting completed')}</p>
                      ) : item.isPendingConfirmation ? (
                        <p className="pt-1 font-semibold text-amber-700">{text('เลยวันนัดหมายแล้ว (รอยืนยันเสร็จสิ้น)', 'Past meeting date (pending confirmation)')}</p>
                      ) : null
                    )}
                  </dl>
                </section>)}
              </div>}
            </div>
          </div>
        </div>
        <aside className="calendar-sidebar grid content-start gap-3 sm:grid-cols-2 lg:order-1 lg:flex lg:min-h-0 lg:flex-col lg:gap-3 lg:overflow-y-auto lg:border-r-[3px] lg:border-black lg:bg-[#FFFDF7] lg:p-1" aria-label={text('สรุปปฏิทิน', 'Calendar summary')}>
          <section className="mini-calendar-card card hidden p-3.5 sm:col-span-2 lg:block lg:col-span-1 lg:shrink-0 bg-white border-[3px] border-black rounded-lg shadow-[4px_4px_0px_#000000]" aria-label={text('เลือกวันที่ในปฏิทิน', 'Choose a calendar date')}>
            <FullCalendar ref={miniCalendarRef} plugins={[dayGridPlugin, interactionPlugin, luxonPlugin]} initialView="dayGridMonth"
              locale={language === 'th' ? thLocale : enGbLocale} timeZone="Asia/Bangkok" firstDay={1} height="auto"
              dayHeaderContent={(info) => formatCalendarDayHeader(info.date, info.view?.type, language)}
              headerToolbar={{ left: 'title', center: '', right: 'prev,next' }} fixedWeekCount={false} showNonCurrentDates
              dayCellClassNames={(info) => calendarDayKey(info.date) === miniSelectedDate ? ['mini-calendar-selected'] : []}
              dayCellContent={(info) => <button type="button" className="mini-calendar-date" aria-label={calendarDateLabel(info.date, language)}
                aria-pressed={calendarDayKey(info.date) === miniSelectedDate} onClick={(event) => {
                  event.stopPropagation()
                  const day = calendarDayKey(info.date)
                  setMiniSelectedDate(day)
                  calendarRef.current?.getApi().gotoDate(day)
                }}>{info.dayNumberText}</button>} />
          </section>
          <section className="calendar-filter-panel hidden lg:block rounded-lg border-[3px] border-black bg-white p-3 shadow-[4px_4px_0px_#000000]">{calendarControls}</section>
          <section className="card p-3.5 lg:shrink-0 rounded-lg border-[3px] border-black bg-white shadow-[4px_4px_0px_#000000]" aria-label={text('รายการของวันที่', 'Schedule for date')}>
            <div className="mb-2.5 flex items-center justify-between">
              <div>
                <h2 className="font-extrabold text-black text-xs leading-tight">{text('รายการของวันที่', 'Schedule for')}</h2>
                <p className="text-[11px] font-bold text-black/70 mt-0.5">{selectedDayHeading}</p>
              </div>
              <span className="rounded-md bg-[#FFE15D] px-2.5 py-0.5 text-xs font-bold text-black shrink-0 border-2 border-black shadow-[1px_1px_0px_#000000]">
                {selectedDayEntries.length} {text('รายการ', 'items')}
              </span>
            </div>
            {selectedDayEntries.length ? (
              <div className="calendar-sidebar-scroll-box max-h-[170px] overflow-y-auto space-y-1.5 pr-0.5">
                {selectedDayEntries.map((entry) => {
                  const isTask = entry.extendedProps.kind === 'task'
                  const task = isTask ? entry.extendedProps.row as TaskRow : null
                  const event = !isTask ? entry.extendedProps.row as EventRow : null
                  const isCompleted = isTask ? task?.status === 'completed' : Boolean(entry.extendedProps.isCompleted)
                  const isOverdue = Boolean(entry.extendedProps.isOverdue)
                  const isPendingConfirmation = !isTask && Boolean(entry.extendedProps.isPendingConfirmation)
                  const barColor = isCompleted ? 'bg-[#52D17C]' : isOverdue ? 'bg-[#FF6B6B]' : isPendingConfirmation ? 'bg-[#FFA41B]' : isTask ? 'bg-[#4D77FF]' : 'bg-[#FFE15D]'
                  const badgeClass = isCompleted
                    ? 'bg-[#52D17C] text-black border-2 border-black font-extrabold shadow-[1px_1px_0px_#000000]'
                    : isOverdue
                      ? 'bg-[#FF6B6B] text-white border-2 border-black font-extrabold shadow-[1px_1px_0px_#000000]'
                      : isPendingConfirmation
                        ? 'bg-[#FFA41B] text-black border-2 border-black font-extrabold shadow-[1px_1px_0px_#000000]'
                        : isTask
                          ? 'bg-[#4D77FF] text-white border-2 border-black font-extrabold shadow-[1px_1px_0px_#000000]'
                          : 'bg-[#FFE15D] text-black border-2 border-black font-extrabold shadow-[1px_1px_0px_#000000]'
                  const badgeLabel = isCompleted
                    ? (isTask ? text('งาน (เสร็จแล้ว)', 'Task (Done)') : text('ประชุม (เสร็จแล้ว)', 'Meeting (Done)'))
                    : isOverdue
                      ? text('งาน (เกินกำหนด)', 'Task (Overdue)')
                      : isPendingConfirmation
                        ? text('ประชุม (รอยืนยัน)', 'Meeting (Pending)')
                        : (isTask ? text('งาน', 'Task') : text('ประชุม', 'Meeting'))

                  let timeStr = text('ทั้งวัน', 'All day')
                  if (!entry.allDay && entry.start) {
                    const timeMatch = new Date(entry.start).toLocaleTimeString(language === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' })
                    if (timeMatch) timeStr = timeMatch
                  }
                  const loc = !isTask && event?.location ? event.location : (normalizeAffiliationText(event?.affiliation) || normalizeAffiliationText(task?.affiliation) || '')

                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => openCalendarEntry(entry)}
                      className="group flex w-full min-w-0 items-start gap-2.5 rounded-md border-2 border-black bg-white p-2.5 text-left shadow-[2px_2px_0px_#000000] hover:bg-[#FFFBEA] transition"
                    >
                      <span className={`mt-0.5 h-7 w-1.5 shrink-0 rounded-sm border border-black ${barColor}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-bold tabular-nums text-[11px] text-black">{timeStr}</span>
                          <span className={`rounded-sm px-1.5 py-0.2 text-[9px] font-bold border ${badgeClass}`}>{badgeLabel}</span>
                        </div>
                        <span className="block truncate text-xs font-bold text-black group-hover:underline transition">{entry.title}</span>
                        {loc && <span className="block text-[10px] text-black/70 font-semibold leading-snug [overflow-wrap:anywhere]">{loc}</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="rounded-md border-2 border-dashed border-black bg-[#FFFBEA] p-2.5 text-center text-xs font-bold text-black/70">
                {text('วันนี้ยังไม่มีรายการในปฏิทิน', 'No calendar items today.')}
              </p>
            )}
          </section>
          <section className="card p-3.5 sm:col-span-2 lg:col-span-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto rounded-lg border-[3px] border-black bg-white shadow-[4px_4px_0px_#000000]">
            <h2 className="sr-only">{text('รายการถัดไปและเอกสารล่าสุด', 'Upcoming items and recent documents')}</h2>
            <div className="mb-2 flex rounded-md bg-[#FFFDF7] p-1 text-xs font-bold border-2 border-black shadow-[2px_2px_0px_#000000]">
              <button type="button" aria-pressed={sideTab === 'upcoming'} onClick={() => setSideTab('upcoming')} className={`flex-1 rounded-md px-2 py-1.5 transition border-2 ${sideTab === 'upcoming' ? 'bg-[#FFE15D] text-black border-black shadow-[2px_2px_0px_#000000] font-extrabold' : 'border-transparent text-black hover:bg-white'}`}>{text('รายการถัดไป', 'Upcoming')}</button>
              <button type="button" aria-pressed={sideTab === 'documents'} onClick={() => setSideTab('documents')} className={`flex-1 rounded-md px-2 py-1.5 transition border-2 ${sideTab === 'documents' ? 'bg-[#FFE15D] text-black border-black shadow-[2px_2px_0px_#000000] font-extrabold' : 'border-transparent text-black hover:bg-white'}`}>{text('เอกสารล่าสุด', 'Recent documents')}</button>
            </div>
            <div className="calendar-sidebar-scroll-box max-h-[180px] lg:max-h-[220px] overflow-y-auto pr-0.5">
              {sideTab === 'upcoming' ? (
                upcomingEntries.length ? (
                  <div className="space-y-1.5">
                    {upcomingEntries.map((entry) => (
                      <button key={entry.id} type="button" onClick={() => openCalendarEntry(entry)} className="flex w-full items-start gap-2.5 rounded-md border-2 border-black bg-white p-2.5 text-left hover:bg-[#FFFBEA] transition shadow-[2px_2px_0px_#000000]">
                        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-sm border border-black ${entryDotClass(entry)}`} />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-bold text-black">{entry.title}</span>
                          <span className="text-[11px] font-semibold text-black/70">{calendarDateLabel(new Date(entry.start), language)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs font-bold text-black/60 p-2 text-center">{text('ยังไม่มีรายการถัดไป', 'No upcoming items.')}</p>
                )
              ) : recentDocumentsQuery.isLoading ? (
                <p className="text-xs font-bold text-black/60 p-2">{text('กำลังโหลดเอกสาร…', 'Loading documents…')}</p>
              ) : recentDocumentsQuery.isError ? (
                <p className="text-xs font-bold text-red-600 p-2">{text('โหลดเอกสารไม่สำเร็จ', 'Could not load documents.')}</p>
              ) : recentDocuments.length ? (
                <div className="space-y-1.5">
                  {recentDocuments.map((document) => (
                    <button key={document.id} type="button" onClick={() => openRecentDocument(document)} className="flex w-full items-start gap-2.5 rounded-md border-2 border-black bg-white p-2.5 text-left hover:bg-[#FFFBEA] transition shadow-[2px_2px_0px_#000000]">
                      <span className="mt-0.5 text-black">{document.kind === 'link' ? <Link2 size={15} /> : <FileText size={15} />}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-slate-800">{document.name}</span>
                        <span className="text-[11px] text-slate-500">{document.parent === 'event' ? text('การประชุม', 'Meeting') : text('งาน', 'Task')} · {calendarDateLabel(new Date(document.addedAt), language)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 p-2">{text('ยังไม่มีเอกสารที่เปิดดูได้', 'No documents are available to open.')}</p>
              )}
            </div>
          </section>
        </aside>
      </div>
      {(eventMutation.isError || taskMutation.isError || deleteEventMutation.isError || deleteTaskMutation.isError || deleteEventAttachmentMutation.isError || deleteTaskAttachmentMutation.isError || toggleTaskMutation.isError || acknowledgeTaskMutation.isError || retryNotificationMutation.isError) && <p role="alert" className="ui-toast fixed bottom-4 right-4 rounded-md bg-red-600 px-4 py-3 text-sm text-white shadow-lg">{text('ดำเนินการไม่สำเร็จ กรุณาตรวจสอบข้อมูลและลองใหม่', 'The action could not be completed. Check the details and try again.')}</p>}
      {taskSaveWarning && <div className="ui-toast fixed bottom-4 right-4 max-w-md rounded-md bg-amber-100 px-4 py-3 text-sm text-amber-950 shadow-lg" role="alert"><p>{taskSaveWarning}</p><button type="button" className="mt-2 font-semibold underline" onClick={() => setTaskSaveWarning('')}>{text('ปิด', 'Close')}</button></div>}
      {eventSaveWarning && <div className="ui-toast fixed bottom-4 right-4 max-w-md rounded-md bg-amber-100 px-4 py-3 text-sm text-amber-950 shadow-lg" role="alert"><p>{eventSaveWarning}</p><button type="button" className="mt-2 font-semibold underline" onClick={() => setEventSaveWarning('')}>{text('ปิด', 'Close')}</button></div>}

      {yearDayDialog && (
        <div className="ui-dialog-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="year-day-dialog-title">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs" onClick={() => setYearDayDialog(null)} />
          <section className="ui-dialog-panel relative z-10 w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl border border-slate-100">
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 id="year-day-dialog-title" className="text-base font-bold text-[#29233A]">
                  {calendarDateLabel(new Date(`${yearDayDialog.date}T00:00:00+07:00`), language)}
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {text(`มี ${yearDayDialog.entries.length} รายการ (กดเลือกรายการเพื่อจัดการหรือแก้ไข)`, `${yearDayDialog.entries.length} items (click to view or edit)`)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setYearDayDialog(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
                aria-label={text('ปิด', 'Close')}
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {yearDayDialog.entries.map((entry) => {
                const isTask = entry.extendedProps.kind === 'task'
                const task = isTask ? entry.extendedProps.row as TaskRow : null
                const event = !isTask ? entry.extendedProps.row as EventRow : null
                const isCompleted = isTask ? task?.status === 'completed' : Boolean(entry.extendedProps.isCompleted)
                const isOverdue = Boolean(entry.extendedProps.isOverdue)
                const isPendingConfirmation = !isTask && Boolean(entry.extendedProps.isPendingConfirmation)
                const Icon = isCompleted ? CheckCircle2 : (isOverdue || isPendingConfirmation) ? Clock3 : isTask ? ListTodo : CalendarDays
                const barColor = isCompleted ? 'bg-[#52D17C]' : isOverdue ? 'bg-[#FF6B6B]' : isPendingConfirmation ? 'bg-[#FFA41B]' : isTask ? 'bg-[#4D77FF]' : 'bg-[#FFE15D]'
                const badgeClass = isCompleted
                  ? 'bg-[#52D17C] text-black border-2 border-black font-extrabold shadow-[1px_1px_0px_#000000]'
                  : isOverdue
                    ? 'bg-[#FF6B6B] text-white border-2 border-black font-extrabold shadow-[1px_1px_0px_#000000]'
                    : isPendingConfirmation
                      ? 'bg-[#FFA41B] text-black border-2 border-black font-extrabold shadow-[1px_1px_0px_#000000]'
                      : isTask
                        ? 'bg-[#4D77FF] text-white border-2 border-black font-extrabold shadow-[1px_1px_0px_#000000]'
                        : 'bg-[#FFE15D] text-black border-2 border-black font-extrabold shadow-[1px_1px_0px_#000000]'
                const badgeLabel = isCompleted
                  ? (isTask ? text('งาน (เสร็จแล้ว)', 'Task (Done)') : text('ประชุม (เสร็จแล้ว)', 'Meeting (Done)'))
                  : isOverdue
                    ? text('งาน (เกินกำหนด)', 'Task (Overdue)')
                    : isPendingConfirmation
                      ? text('ประชุม (รอยืนยัน)', 'Meeting (Pending)')
                      : (isTask ? text('งาน', 'Task') : text('ประชุม', 'Meeting'))

                let timeStr = text('ทั้งวัน', 'All day')
                if (!entry.allDay && entry.start) {
                  const timeMatch = new Date(entry.start).toLocaleTimeString(language === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' })
                  if (timeMatch) timeStr = timeMatch
                }
                const loc = !isTask && event?.location ? event.location : (normalizeAffiliationText(event?.affiliation) || normalizeAffiliationText(task?.affiliation) || '')

                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      setYearDayDialog(null)
                      openCalendarEntry(entry)
                    }}
                    className="group flex w-full items-start gap-3 rounded-md border-2 border-black bg-white p-3 text-left shadow-[2px_2px_0px_#000000] hover:bg-[#FFFBEA] transition"
                  >
                    <span className={`mt-0.5 h-8 w-1.5 shrink-0 rounded-sm border border-black ${barColor}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold tabular-nums text-xs text-black flex items-center gap-1">
                          <Icon size={13} className="shrink-0 text-black" />
                          {timeStr}
                        </span>
                        <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold border ${badgeClass}`}>{badgeLabel}</span>
                      </div>
                      <span className="mt-1 block truncate text-sm font-bold text-black group-hover:underline">{entry.title}</span>
                      {loc && <span className="block text-xs text-black/70 font-semibold leading-snug [overflow-wrap:anywhere]">{loc}</span>}
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const d = yearDayDialog.date
                    setYearDayDialog(null)
                    void warnPastCreation(d).then((isPast) => {
                      if (!isPast) setEventDialog({ open: true, event: null, date: d })
                    })
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#75638F] hover:underline"
                >
                  <CalendarPlus size={14} />
                  {text('+ เพิ่มประชุม', '+ Add meeting')}
                </button>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  onClick={() => {
                    const d = yearDayDialog.date
                    setYearDayDialog(null)
                    setTaskDialog({ open: true, task: null, date: d })
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:underline"
                >
                  <ListTodo size={14} />
                  {text('+ เพิ่ม Task', '+ Add task')}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setYearDayDialog(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                {text('ปิด', 'Close')}
              </button>
            </div>
          </section>
        </div>
      )}

      <EventDialog
        defaultAffiliation={profileAffiliation(profile)}
        profiles={profilesQuery.data ?? []} profilesAvailable={Boolean(profilesQuery.data)} currentUserEmail={user?.email} currentUserId={user?.id} onJoin={(scope) => joinMeetingMutation.mutateAsync(scope)}
        onChangeToOccurrence={() => changeAttendanceMutation.mutateAsync()}
        onCheckJoinTime={async () => { const { data, error } = await supabase.rpc('meeting_join_server_time'); if (error || !data) throw error ?? new Error('Server time unavailable'); return new Date(data).getTime() }}
        open={eventDialog.open} event={selectedEvent} details={eventDetailsQuery.data} selectedDate={eventDialog.date} occurrenceStart={eventDialog.occurrenceStart}
        isOccurrenceCompleted={selectedEvent && (selectedEventOccurrenceStart || selectedEvent.start_datetime) ? isMeetingCompleted(completedMeetings, selectedEvent.id, selectedEventOccurrenceStart || selectedEvent.start_datetime) : false}
        initialSummaryHtml={
          selectedEvent && (selectedEventOccurrenceStart || selectedEvent.start_datetime)
            ? (eventDetailsQuery.data?.summaryHtml ??
               meetingCompletionsQuery.data?.find((mc) =>
                 mc.event_id === selectedEvent.id &&
                 (mc.occurrence_key === (selectedEventOccurrenceStart || selectedEvent.start_datetime) ||
                  mc.occurrence_key.startsWith((selectedEventOccurrenceStart || selectedEvent.start_datetime).slice(0, 19)))
               )?.summary_html ?? '')
            : ''
        }
        onSaveSummary={selectedEvent && (selectedEventOccurrenceStart || selectedEvent.start_datetime) ? async (summaryHtml) => {
          const occStart = selectedEventOccurrenceStart || selectedEvent.start_datetime
          const isDone = isMeetingCompleted(completedMeetings, selectedEvent.id, occStart)
          try {
            await saveMeetingCompletionMutation.mutateAsync({
              eventId: selectedEvent.id,
              occurrenceStart: occStart,
              summaryHtml: summaryHtml || '',
              completed: isDone,
            })
            await Swal.fire({
              icon: 'success',
              customClass: { popup: 'semantic-meeting-dialog' },
              title: text('สำเร็จ', 'Success'),
              text: text('บันทึกสรุปการประชุมเรียบร้อยแล้ว', 'Meeting summary saved.'),
              timer: 1500,
              showConfirmButton: false,
            })
          } catch (err) {
            console.error('Failed to save meeting summary:', err)
            await Swal.fire({
              icon: 'error',
              customClass: { popup: 'semantic-meeting-dialog' },
              title: text('เกิดข้อผิดพลาด', 'Error'),
              text: text('ไม่สามารถบันทึกสรุปการประชุมได้ กรุณาลองใหม่', 'Could not save meeting summary. Please try again.'),
            })
          }
        } : undefined}
        onToggleCompleteMeeting={selectedEvent && (selectedEventOccurrenceStart || selectedEvent.start_datetime) ? async (summaryHtml) => {
          const occStart = selectedEventOccurrenceStart || selectedEvent.start_datetime
          const isDone = isMeetingCompleted(completedMeetings, selectedEvent.id, occStart)
          if (!isDone && !isMeetingAppointmentPassed(selectedEvent, occStart)) {
            await Swal.fire({
              icon: 'warning',
              customClass: { popup: 'semantic-meeting-dialog' },
              title: text('ไม่สามารถกดเสร็จสิ้นการประชุมที่ยังไม่ถึงเวลานัดหมายได้', 'Cannot complete a meeting before its scheduled appointment time.'),
              text: text('การประชุมจะสามารถกดยืนยันเสร็จสิ้นได้เมื่อถึงเวลานัดหมาย', 'You can mark the meeting complete once its scheduled appointment time arrives.'),
            })
            return
          }
          if (!isDone && !hasMeetingSummary(summaryHtml || '')) {
            await Swal.fire({
              icon: 'warning',
              customClass: { popup: 'semantic-meeting-dialog' },
              title: text('กรุณากรอกสรุปการประชุม', 'Meeting summary required'),
              text: text('ระบบบังคับให้กรอกสรุปการประชุมก่อนกดเสร็จสิ้นการประชุม', 'You must enter a meeting summary before marking as complete.'),
            })
            return
          }
          const isRecurring = Boolean(selectedEvent.recurrence_rule)
          const confirmed = await confirm({
            title: isDone
              ? text('เปิดการประชุมอีกครั้ง?', 'Reopen meeting?')
              : isRecurring
                ? text('ยืนยันเสร็จสิ้นการประชุม (เฉพาะนัดนี้)?', 'Confirm meeting is complete (this occurrence only)?')
                : text('ยืนยันว่าการประชุมเสร็จสิ้นแล้ว?', 'Confirm meeting is complete?'),
            message: isDone
              ? (isRecurring
                ? text(`การประชุม “${selectedEvent.title}” จะกลับมาเป็นสถานะปกติ/รอยืนยัน เฉพาะนัดนี้`, `Meeting “${selectedEvent.title}” will return to its previous status for this occurrence only.`)
                : text(`การประชุม “${selectedEvent.title}” จะกลับมาเป็นสถานะปกติ/รอยืนยัน`, `Meeting “${selectedEvent.title}” will return to its previous status.`))
              : (isRecurring
                ? text(`การประชุม “${selectedEvent.title}” จะถูกบันทึกเสร็จสิ้นเฉพาะนัดนี้ โดยไม่กระทบนัดวันอื่นในอนาคต`, `Meeting “${selectedEvent.title}” will be marked complete for this occurrence only without affecting other dates in the series.`)
                : text(`การประชุม “${selectedEvent.title}” จะถูกเปลี่ยนเป็นเสร็จสิ้น (สีเขียว)`, `Meeting “${selectedEvent.title}” will be marked as complete (green).`)),
            confirmLabel: isDone ? text('เปิดการประชุมอีกครั้ง', 'Reopen') : text('ยืนยันเสร็จสิ้น', 'Confirm complete'),
          })
          if (confirmed) {
            try {
              await saveMeetingCompletionMutation.mutateAsync({
                eventId: selectedEvent.id,
                occurrenceStart: occStart,
                summaryHtml: summaryHtml || '',
                completed: !isDone,
              })
            } catch (err) {
              console.error('Failed to save meeting completion to database:', err)
              toggleMeetingCompletion(selectedEvent.id, occStart)
            }
            await Swal.fire({
              icon: 'success',
              customClass: { popup: 'semantic-meeting-dialog' },
              title: text('สำเร็จ', 'Success'),
              text: isDone ? text('เปิดการประชุมอีกครั้งแล้ว', 'Meeting reopened.') : text('บันทึกเสร็จสิ้นการประชุมและสรุปผลแล้ว', 'Meeting marked as complete with summary saved.'),
              timer: 1500,
              showConfirmButton: false,
            })
            setEventDialog({ open: false, event: null })
          }
        } : undefined}
        canEdit={canEditEvent} canDelete={canDeleteEvent} canViewDeliveryStatus={canViewEventDeliveryStatus} hasConnectedDevices={hasConnectedDevices && (!selectedEvent || selectedEvent.owner_user_id === user?.id)} checkMobileRecipients={checkMobileRecipients} busy={busy || eventDetailsQuery.isLoading || appointmentMutation.isPending}
        onClose={() => { pendingMeetingSave.current = null; setEventDialog({ open: false, event: null }) }}
        onSave={(draft, notifyRecipients, scope) => eventMutation.mutateAsync({ draft, event: selectedEvent, notifyRecipients, scope, occurrenceStart: selectedEventOccurrenceStart })}
        onDelete={async (scope) => {
          if (!selectedEvent) return
          if (scope === 'occurrence') {
            if (await confirmDeletion('ลบเฉพาะนัดนี้?', 'นัดในวันอื่นของชุดทำซ้ำยังคงอยู่', 'ลบเฉพาะนัดนี้')) await appointmentMutation.mutateAsync({})
          } else if (await confirmDeletion('ย้าย Meeting ไปถังขยะ?', `Meeting “${selectedEvent.title}” จะไม่แสดงในปฏิทิน`, 'ย้ายไปถังขยะ')) await deleteEventMutation.mutateAsync(selectedEvent)
        }}
        onMoveOccurrence={!canDeleteEvent ? undefined : async (draft, date) => {
          if (await confirm({ title: 'ย้ายนัดนี้?', message: `ยกเลิกเฉพาะนัดเดิม แล้วสร้างประชุมวันที่ ${date} แบบไม่ทำซ้ำ`, confirmLabel: 'ย้ายนัด' })) await appointmentMutation.mutateAsync({ draft, date })
        }}
        onDeleteAttachment={async (attachment) => { if (await confirmDeletion('ลบไฟล์แนบ?', `ลบ “${attachment.file_name}” ออกจาก Meeting นี้อย่างถาวร`, 'ลบไฟล์')) await deleteEventAttachmentMutation.mutateAsync(attachment) }}
        onRetryNotification={(deliveryId) => retryNotificationMutation.mutateAsync(deliveryId)}
      />
      <TaskDialog
        defaultAffiliation={profileAffiliation(profile)}
        open={taskDialog.open} task={selectedTask} details={taskDetailsQuery.data} selectedDate={taskDialog.date}
        userId={user!.id} profiles={profilesQuery.data ?? []} events={eventsQuery.data ?? []}
        canEdit={canEditTask} canDelete={canDeleteTask} canComplete={canCompleteTask} canAcknowledge={canAcknowledgeTask} canViewDeliveryStatus={canViewTaskDeliveryStatus}
        hasConnectedDevices={editingAnotherTask ? taskCreatorMobileQuery.data === true : hasConnectedDevices} mobileConnectionError={editingAnotherTask && taskCreatorMobileQuery.isError} busy={busy || taskDetailsQuery.isLoading || (editingAnotherTask && taskCreatorMobileQuery.isLoading)}
        onClose={() => setTaskDialog({ open: false, task: null })}
        onSave={async (draft, notifyRecipients) => { await taskMutation.mutateAsync({ draft, task: selectedTask, notifyRecipients }) }}
        onDelete={async () => { if (selectedTask && await confirmDeletion('ย้าย Task ไปถังขยะ?', `Task “${selectedTask.title}” จะไม่แสดงในรายการงาน`, 'ย้ายไปถังขยะ')) await deleteTaskMutation.mutateAsync(selectedTask) }}
        onDeleteAttachment={async (attachment) => { if (await confirmDeletion('ลบเอกสาร?', `ลบ “${attachment.file_name}” ออกจาก Task นี้อย่างถาวร`, 'ลบไฟล์')) await deleteTaskAttachmentMutation.mutateAsync(attachment) }}
        onToggleComplete={async () => { if (selectedTask && await confirm({ title: selectedTask.status === 'completed' ? 'เปิดงานอีกครั้ง?' : 'ยืนยันว่างานเสร็จแล้ว?', message: `Task “${selectedTask.title}” จะถูกเปลี่ยนสถานะ`, confirmLabel: selectedTask.status === 'completed' ? 'เปิดงานอีกครั้ง' : 'ยืนยันงานเสร็จ' })) await toggleTaskMutation.mutateAsync(selectedTask) }}
        onAcknowledge={async () => { if (selectedTask) await acknowledgeTaskMutation.mutateAsync(selectedTask) }}
        onRetryNotification={(deliveryId) => retryNotificationMutation.mutateAsync(deliveryId)}
      />
      <MeetingSummaryDialog
        open={summaryDialogOpen}
        onClose={() => setSummaryDialogOpen(false)}
        events={eventsQuery.data ?? []}
        cancelledAppointments={cancelledAppointments}
        meetingCompletions={meetingCompletionsQuery.data ?? []}
      />
    </main>
  )
}
