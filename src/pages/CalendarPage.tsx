import { useEffect, useMemo, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import thLocale from '@fullcalendar/core/locales/th'
import enGbLocale from '@fullcalendar/core/locales/en-gb'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarDays, CalendarPlus, ListTodo, Search } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { useConfirm } from '../components/ConfirmDialogProvider'
import { EventDialog, type EventDetails, type EventDraft } from '../components/EventDialog'
import { TaskDialog, type TaskDetails, type TaskDraft } from '../components/TaskDialog'
import { useLanguage } from '../i18n/LanguageProvider'
import { useLocation } from 'react-router-dom'
import type { Database } from '../lib/database.types'
import { parseGuestEmails, recurrenceRule, reminderDate, type ReminderKey } from '../lib/eventForm'
import { appUrl } from '../lib/appUrl'
import { expandEvent } from '../lib/recurrence'
import { taskDueDateTime, taskReminderDate, type TaskReminderKey } from '../lib/taskForm'
import { supabase } from '../lib/supabase'

type EventRow = Database['public']['Tables']['events']['Row']
type GuestRow = Database['public']['Tables']['event_guests']['Row']
type ReminderRow = Database['public']['Tables']['reminders']['Row']
type AttachmentRow = Database['public']['Tables']['attachments']['Row']
type TaskRow = Database['public']['Tables']['tasks']['Row']
type TaskReminderRow = Database['public']['Tables']['task_reminders']['Row']
type TaskAttachmentRow = Database['public']['Tables']['task_attachments']['Row']
type DocumentLinkRow = Database['public']['Tables']['document_links']['Row']
type ProfileRow = Database['public']['Tables']['profiles']['Row']

function toIso(value: string, allDay: boolean) {
  if (allDay) return new Date(`${value}T00:00:00+07:00`).toISOString()
  return new Date(`${value}:00+07:00`).toISOString()
}

function reminderKey(row: ReminderRow): ReminderKey | null {
  const key = `${row.offset_value}:${row.offset_unit}`
  return ['1:month', '1:week', '3:day', '1:day'].includes(key) ? key as ReminderKey : null
}

function safeFileName(name: string) {
  return name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'attachment'
}

export function CalendarPage() {
  const { user, profile } = useAuth()
  const { language } = useLanguage()
  const { search: locationSearch } = useLocation()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showTasks, setShowTasks] = useState(true)
  const [showCompletedTasks, setShowCompletedTasks] = useState(false)
  const [eventDialog, setEventDialog] = useState<{ open: boolean; event: EventRow | null; date?: string }>({ open: false, event: null })
  const [taskDialog, setTaskDialog] = useState<{ open: boolean; task: TaskRow | null; date?: string }>({ open: false, task: null })
  const [openedTaskLink, setOpenedTaskLink] = useState<string | null>(null)

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
  const linkedTaskId = useMemo(() => new URLSearchParams(locationSearch).get('task'), [locationSearch])

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

  const selectedEvent = eventDialog.event
  const eventDetailsQuery = useQuery({
    queryKey: ['event-details', selectedEvent?.id],
    enabled: Boolean(selectedEvent),
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
      const keys = reminders.data.map(reminderKey).filter((key): key is ReminderKey => Boolean(key))
      return { guestEmails: guests.data.map((guest) => guest.email), reminderKeys: keys, notifyEmail: reminders.data.some((item) => item.channel_email), notifyLine: reminders.data.some((item) => item.channel_line), attachments: attachments.data }
    },
  })

  const selectedTask = taskDialog.task
  const taskDetailsQuery = useQuery({
    queryKey: ['task-details', selectedTask?.id],
    enabled: Boolean(selectedTask),
    queryFn: async (): Promise<TaskDetails> => {
      const taskId = selectedTask!.id
      const [reminders, attachments, documentLinks] = await Promise.all([
        supabase.from('task_reminders').select('*').eq('task_id', taskId).eq('status', 'scheduled').returns<TaskReminderRow[]>(),
        supabase.from('task_attachments').select('*').eq('task_id', taskId).order('uploaded_at').returns<TaskAttachmentRow[]>(),
        supabase.from('document_links').select('*').eq('task_id', taskId).order('created_at').returns<DocumentLinkRow[]>(),
      ])
      if (reminders.error) throw reminders.error
      if (attachments.error) throw attachments.error
      if (documentLinks.error) throw documentLinks.error
      const attachmentViews = await Promise.all(attachments.data.map(async (file) => {
        const { data, error } = await supabase.storage.from('task-documents').createSignedUrl(file.storage_path, 300)
        if (error || !data) throw error ?? new Error('ไม่สามารถเปิดเอกสารประกอบได้')
        return { ...file, signedUrl: data.signedUrl }
      }))
      return {
        reminderKeys: [...new Set(reminders.data.map((item) => item.reminder_key))] as TaskReminderKey[],
        notifyEmail: reminders.data.some((item) => item.channel_email),
        notifyLine: reminders.data.some((item) => item.channel_line),
        attachments: attachmentViews,
        documentLinks: documentLinks.data,
      }
    },
  })

  const eventMutation = useMutation({
    mutationFn: async ({ draft, event }: { draft: EventDraft; event: EventRow | null }) => {
      const { data: sessionData, error: sessionError } = await supabase.auth.refreshSession()
      if (sessionError || !sessionData.session) throw new Error('เซสชันหมดอายุ กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่')
      const eventUserId = sessionData.session.user.id
      const startIso = toIso(draft.start, draft.all_day)
      const payload = { title: draft.title.trim(), description: draft.description.trim(), location: draft.location.trim(), all_day: draft.all_day, start_datetime: startIso, end_datetime: draft.end ? toIso(draft.end, draft.all_day) : null, recurrence_rule: recurrenceRule(draft.recurrence) }
      let eventId = event?.id
      if (eventId) {
        const { error } = await supabase.from('events').update(payload).eq('id', eventId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('events').insert({ ...payload, owner_user_id: eventUserId }).select('*').single<EventRow>()
        if (error) throw error
        eventId = data.id
      }
      const [deletedGuests, deletedReminders] = await Promise.all([
        supabase.from('event_guests').delete().eq('event_id', eventId),
        supabase.from('reminders').delete().eq('event_id', eventId),
      ])
      if (deletedGuests.error) throw deletedGuests.error
      if (deletedReminders.error) throw deletedReminders.error
      const emails = parseGuestEmails(draft.guestEmails)
      if (emails.length) {
        const { error } = await supabase.from('event_guests').insert(emails.map((email) => ({ event_id: eventId!, email })))
        if (error) throw error
      }
      if (draft.reminderKeys.length) {
        const start = new Date(startIso)
        const reminders = draft.reminderKeys.map((key) => {
          const [value, unit] = key.split(':') as [string, 'day' | 'week' | 'month']
          return { event_id: eventId!, offset_value: Number(value), offset_unit: unit, scheduled_at: reminderDate(start, key).toISOString(), channel_email: draft.notifyEmail, channel_line: draft.notifyLine }
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
    },
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['events'] }), queryClient.invalidateQueries({ queryKey: ['event-details'] })])
      setEventDialog({ open: false, event: null })
    },
  })

  const taskMutation = useMutation({
    mutationFn: async ({ draft, task }: { draft: TaskDraft; task: TaskRow | null }) => {
      const external = draft.assigneeKind === 'external'
      let externalAccessToken = ''
      if (external) {
        const { data, error } = await supabase.auth.refreshSession()
        if (error || !data.session) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง')
        externalAccessToken = data.session.access_token
      }
      const assigneeUserId = draft.assigneeKind === 'self' ? user!.id : draft.assigneeUserId
      const payload = {
        title: draft.title.trim(),
        description: draft.description.trim(),
        due_date: draft.dueDate,
        due_time: draft.dueTime || null,
        assignee_type: external ? 'external' as const : 'internal' as const,
        assignee_user_id: external ? null : assigneeUserId,
        external_assignee_email: external ? draft.externalEmail.trim().toLowerCase() : null,
        linked_event_id: draft.linkedEventId || null,
        recurrence_rule: recurrenceRule(draft.recurrence),
      }
      let taskId = task?.id
      if (taskId) {
        const { error } = await supabase.from('tasks').update(payload).eq('id', taskId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('tasks').insert({ ...payload, creator_user_id: user!.id }).select('*').single<TaskRow>()
        if (error) throw error
        taskId = data.id
      }

      const [deletedReminders, deletedLinks] = await Promise.all([
        supabase.from('task_reminders').delete().eq('task_id', taskId),
        supabase.from('document_links').delete().eq('task_id', taskId),
      ])
      if (deletedReminders.error) throw deletedReminders.error
      if (deletedLinks.error) throw deletedLinks.error

      if (draft.reminderKeys.length) {
        const due = taskDueDateTime(draft.dueDate, draft.dueTime)
        const reminders = draft.reminderKeys.map((key) => ({
          task_id: taskId!, reminder_key: key, scheduled_at: taskReminderDate(due, key).toISOString(),
          channel_email: draft.notifyEmail, channel_line: external ? false : draft.notifyLine,
        }))
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
      if (external) {
        const { error } = await supabase.functions.invoke('external-task', {
          body: { action: 'issue', taskId, publicUrl: appUrl('/external-task') },
          headers: { Authorization: `Bearer ${externalAccessToken}` },
        })
        if (error) {
          const context = (error as { context?: { json?: () => Promise<unknown> } }).context
          const details = context && typeof context.json === 'function'
            ? await context.json().catch(() => null) as { error?: string } | null
            : null
          throw new Error(details?.error || error.message)
        }
      }
    },
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['tasks'] }), queryClient.invalidateQueries({ queryKey: ['task-details'] })])
      setTaskDialog({ open: false, task: null })
    },
  })
  const uploadTaskAttachmentsMutation = useMutation({
    mutationFn: async ({ task, files }: { task: TaskRow; files: File[] }) => {
      for (const file of files) {
        const storagePath = `${user!.id}/${task.id}/${crypto.randomUUID()}-${safeFileName(file.name)}`
        const uploaded = await supabase.storage.from('task-documents').upload(storagePath, file, { contentType: file.type, upsert: false })
        if (uploaded.error) throw uploaded.error
        const { error } = await supabase.from('task_attachments').insert({ task_id: task.id, file_name: file.name, mime_type: file.type, file_size: file.size, storage_path: storagePath, uploaded_by: user!.id })
        if (error) { await supabase.storage.from('task-documents').remove([storagePath]); throw error }
      }
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['task-details'] }) },
  })

  const deleteEventMutation = useMutation({
    mutationFn: async (event: EventRow) => { const { error } = await supabase.from('events').update({ deleted_at: new Date().toISOString() }).eq('id', event.id); if (error) throw error },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['events'] }); setEventDialog({ open: false, event: null }) },
  })
  const deleteTaskMutation = useMutation({
    mutationFn: async (task: TaskRow) => { const { error } = await supabase.from('tasks').update({ deleted_at: new Date().toISOString(), status: 'cancelled' }).eq('id', task.id); if (error) throw error },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['tasks'] }); setTaskDialog({ open: false, task: null }) },
  })
  const toggleTaskMutation = useMutation({
    mutationFn: async (task: TaskRow) => { const { error } = await supabase.from('tasks').update({ status: task.status === 'completed' ? 'pending' : 'completed' }).eq('id', task.id); if (error) throw error },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['tasks'] }); setTaskDialog({ open: false, task: null }) },
  })

  const normalizedSearch = search.trim().toLowerCase()
  const eventRows = useMemo(() => (eventsQuery.data ?? []).filter((event) => `${event.title} ${event.location} ${event.description}`.toLowerCase().includes(normalizedSearch)), [eventsQuery.data, normalizedSearch])
  const taskRows = useMemo(() => (tasksQuery.data ?? []).filter((task) => (showCompletedTasks || task.status !== 'completed') && `${task.title} ${task.description}`.toLowerCase().includes(normalizedSearch)), [normalizedSearch, showCompletedTasks, tasksQuery.data])
  const occurrenceStart = new Date(); occurrenceStart.setFullYear(occurrenceStart.getFullYear() - 1)
  const occurrenceEnd = new Date(); occurrenceEnd.setFullYear(occurrenceEnd.getFullYear() + 1)
  const calendarEntries = [
    ...eventRows.flatMap((event) => expandEvent(event, occurrenceStart, occurrenceEnd).map((occurrence) => ({ id: `event-${occurrence.key}`, title: event.title, start: occurrence.start, end: occurrence.end || undefined, allDay: event.all_day, backgroundColor: event.owner_user_id === user?.id ? '#0f696c' : '#64748b', borderColor: 'transparent', extendedProps: { kind: 'event', row: event } }))),
    ...(showTasks ? taskRows.map((task) => ({ id: `task-${task.id}`, title: task.title, start: task.due_time ? `${task.due_date}T${task.due_time.slice(0, 5)}:00+07:00` : task.due_date, allDay: !task.due_time, backgroundColor: task.status === 'completed' ? '#94a3b8' : '#d97706', borderColor: 'transparent', textColor: '#ffffff', extendedProps: { kind: 'task', row: task } })) : []),
  ]
  const canEditEvent = !selectedEvent || selectedEvent.owner_user_id === user?.id || profile?.role === 'admin'
  const canEditTask = !selectedTask || selectedTask.creator_user_id === user?.id || profile?.role === 'admin'
  const canCompleteTask = Boolean(selectedTask && (selectedTask.creator_user_id === user?.id || selectedTask.assignee_user_id === user?.id || profile?.role === 'admin'))
  const canUploadTask = Boolean(selectedTask && (selectedTask.creator_user_id === user?.id || selectedTask.assignee_user_id === user?.id || profile?.role === 'admin'))
  const busy = eventMutation.isPending || taskMutation.isPending || uploadTaskAttachmentsMutation.isPending || deleteEventMutation.isPending || deleteTaskMutation.isPending || toggleTaskMutation.isPending

  return (
    <main className="mx-auto max-w-[1600px] p-4 sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-2xl font-bold text-slate-900">ปฏิทิน Meeting & Task</h1><p className="mt-1 text-sm text-slate-500">Meeting ทุกคนดูได้ ส่วน Task เห็นเฉพาะผู้สร้าง ผู้รับมอบหมาย และ Admin</p></div>
        <div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={() => setTaskDialog({ open: true, task: null })}><ListTodo size={18} />เพิ่ม Task</button><button className="btn-primary" onClick={() => setEventDialog({ open: true, event: null })}><CalendarPlus size={18} />เพิ่ม Meeting</button></div>
      </div>
      <div className="card p-3 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-sm flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} /><input className="field-input pl-10" placeholder="ค้นหา Meeting หรือ Task" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <div className="flex flex-wrap gap-4 text-sm text-slate-600"><label className="flex items-center gap-2"><input type="checkbox" checked={showTasks} onChange={(event) => setShowTasks(event.target.checked)} />แสดง Task</label><label className="flex items-center gap-2"><input type="checkbox" checked={showCompletedTasks} onChange={(event) => setShowCompletedTasks(event.target.checked)} />แสดง Task ที่เสร็จแล้ว</label></div>
        </div>
        {(eventsQuery.isError || tasksQuery.isError || profilesQuery.isError) && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">โหลดข้อมูลไม่สำเร็จ กรุณาตรวจสอบว่าได้รัน migration ล่าสุดแล้ว</p>}
        <FullCalendar
          plugins={[dayGridPlugin, interactionPlugin]}
          locale={language === 'th' ? thLocale : enGbLocale}
          initialView="dayGridMonth"
          firstDay={1}
          height="auto"
          selectable
          dateClick={(info) => setEventDialog({ open: true, event: null, date: info.dateStr })}
          eventClick={(info) => {
            if (info.event.extendedProps.kind === 'task') setTaskDialog({ open: true, task: info.event.extendedProps.row as TaskRow })
            else setEventDialog({ open: true, event: info.event.extendedProps.row as EventRow })
          }}
          eventContent={(info) => {
            const isTask = info.event.extendedProps.kind === 'task'
            const task = isTask ? info.event.extendedProps.row as TaskRow : null
            const Icon = isTask ? ListTodo : CalendarDays
            return <div className="flex min-w-0 items-center gap-1 px-1"><Icon size={14} aria-hidden="true" /><div className="fc-event-title truncate">{task?.status === 'completed' ? 'เสร็จแล้ว: ' : ''}{info.event.title}</div></div>
          }}
          events={calendarEntries}
          headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
          dayMaxEvents
        />
      </div>
      {(eventMutation.isError || taskMutation.isError || deleteEventMutation.isError || deleteTaskMutation.isError || toggleTaskMutation.isError) && <p className="fixed bottom-4 right-4 rounded-xl bg-red-600 px-4 py-3 text-sm text-white shadow-lg">ดำเนินการไม่สำเร็จ กรุณาตรวจสอบข้อมูลและลองใหม่</p>}

      <EventDialog
        open={eventDialog.open} event={selectedEvent} details={eventDetailsQuery.data} selectedDate={eventDialog.date}
        canEdit={canEditEvent} busy={busy || eventDetailsQuery.isLoading}
        onClose={() => setEventDialog({ open: false, event: null })}
        onSave={(draft) => eventMutation.mutateAsync({ draft, event: selectedEvent })}
        onDelete={async () => { if (selectedEvent && await confirm({ title: 'ย้าย Meeting ไปถังขยะ?', message: `Meeting “${selectedEvent.title}” จะไม่แสดงในปฏิทิน`, confirmLabel: 'ย้ายไปถังขยะ', tone: 'danger' })) await deleteEventMutation.mutateAsync(selectedEvent) }}
      />
      <TaskDialog
        open={taskDialog.open} task={selectedTask} details={taskDetailsQuery.data} selectedDate={taskDialog.date}
        userId={user!.id} profiles={profilesQuery.data ?? []} events={eventsQuery.data ?? []}
        canEdit={canEditTask} canUpload={canUploadTask} canComplete={canCompleteTask} busy={busy || taskDetailsQuery.isLoading}
        onClose={() => setTaskDialog({ open: false, task: null })}
        onSave={(draft) => taskMutation.mutateAsync({ draft, task: selectedTask })}
        onDelete={async () => { if (selectedTask && await confirm({ title: 'ย้าย Task ไปถังขยะ?', message: `Task “${selectedTask.title}” จะไม่แสดงในรายการงาน`, confirmLabel: 'ย้ายไปถังขยะ', tone: 'danger' })) await deleteTaskMutation.mutateAsync(selectedTask) }}
        onToggleComplete={async () => { if (selectedTask && await confirm({ title: selectedTask.status === 'completed' ? 'เปิดงานอีกครั้ง?' : 'ยืนยันว่างานเสร็จแล้ว?', message: `Task “${selectedTask.title}” จะถูกเปลี่ยนสถานะ`, confirmLabel: selectedTask.status === 'completed' ? 'เปิดงานอีกครั้ง' : 'ยืนยันงานเสร็จ' })) await toggleTaskMutation.mutateAsync(selectedTask) }}
        onUploadFiles={async (files) => { if (selectedTask) await uploadTaskAttachmentsMutation.mutateAsync({ task: selectedTask, files }) }}
      />
    </main>
  )
}
