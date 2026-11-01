import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { bangkokDate } from '../lib/eventForm'
import * as calendarView from '../lib/calendarView'

function calendarPage() {
  const today = bangkokDate()
  let currentDay = today
  let userId = 'owner'
  let role = 'user'
  let status = 'active'
  let routeSearch = ''
  const queries = new Map<string, { queryKey: string[]; enabled?: boolean; queryFn: () => Promise<unknown> }>()
  const queryErrors = new Set<string>()
  const mutations: Record<string, unknown>[] = []
  const rpcCalls: { name: string; args: unknown }[] = []
  const mutationOptions: { mutationFn?: (args: Record<string, unknown>) => Promise<unknown> }[] = []
  const writes: { table: string; values: unknown }[] = []
  let language = 'en'
  let text = (_: string, en: string) => en
  let calendarRenders = 0
  const occurrenceRanges: { start: Date; end: Date }[] = []
  const confirmations: Record<string, unknown>[] = []
  const confirm = async (options: Record<string, unknown>) => { confirmations.push(options); return false }
  const anchor = new Date('2030-09-21T02:00:00Z')
  let activeDate = anchor
  const navigation: { mini: boolean; date: string | Date }[] = []
  const changes: { view: string; date: Date }[] = []
  const listeners = new Set<() => void>()
  const media = { matches: false, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) }
  const meetings = [
    { id: 'today', title: 'Meeting today', start_datetime: `${today}T09:00:00+07:00`, end_datetime: `${today}T10:00:00+07:00`, all_day: false, recurrence_rule: null, owner_user_id: 'owner', affiliation: 'PEA' },
    { id: 'annual', title: 'Annual meeting', start_datetime: '2026-09-21T02:00:00Z', end_datetime: '2026-09-21T03:00:00Z', all_day: false, recurrence_rule: 'FREQ=YEARLY', recurrence_count: 6, owner_user_id: 'owner', affiliation: 'PEA' },
    { id: 'cancelled', title: 'Cancelled appointment', start_datetime: '2026-09-21T02:00:00Z', end_datetime: null, all_day: false, recurrence_rule: 'FREQ=YEARLY', owner_user_id: 'owner', affiliation: 'PEA' },
  ]
  const tasks = [
    { id: 'timed', title: 'Timed task', due_date: today, due_time: '14:30:00', status: 'pending', creator_user_id: 'owner', recurrence_series_id: null },
    { id: 'all-day', title: 'All-day task', due_date: today, due_time: null, status: 'completed', creator_user_id: 'owner', recurrence_series_id: null },
    { id: 'series', title: 'Series template', due_date: today, due_time: null, status: 'pending', creator_user_id: 'owner', recurrence_series_id: 'series-1' },
  ]
  const queryData: Record<string, unknown> = { events: meetings, tasks, 'meeting-exceptions': [{ event_id: 'cancelled', occurrence_key: '2030-09-21T02:00:00Z' }], 'mobile-push-devices': [], 'assignable-profiles': [] }
  class Calendar extends React.Component<Record<string, unknown>> {
    api = { view: { type: 'dayGridMonth' }, getDate: () => 'events' in this.props ? activeDate : anchor, gotoDate: (date: string | Date) => { navigation.push({ mini: !('events' in this.props), date }); if ('events' in this.props) activeDate = new Date(date) }, changeView: (view: string, date: Date) => { this.api.view.type = view; changes.push({ view, date }) } }
    getApi() { return this.api }
    render() { const main = 'events' in this.props; if (main) calendarRenders++; return React.createElement('div', { ...this.props, 'data-testid': main ? 'calendar-fixture' : 'mini-calendar-fixture' }) }
  }
  const require = createRequire(import.meta.url)
  const exports: { CalendarPage?: React.ComponentType } = {}
  const mocks: Record<string, unknown> = {
    react: React,
    '@fullcalendar/react': Calendar,
    '@tanstack/react-query': { useQuery: (options: { queryKey: string[]; enabled?: boolean; queryFn: () => Promise<unknown> }) => { queries.set(options.queryKey[0], options); return { data: queryData[options.queryKey[0]], isError: queryErrors.has(options.queryKey[0]), isLoading: false } }, useMutation: (options: { mutationFn?: (args: Record<string, unknown>) => Promise<unknown> }) => { mutationOptions.push(options); return { isPending: false, isError: false, mutateAsync: async (args: Record<string, unknown>) => { mutations.push(args) } } }, useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    'react-router-dom': { useLocation: () => ({ search: routeSearch }), useNavigate: () => () => {}, useOutletContext: () => ({}) },
    '../auth/AuthProvider': { useAuth: () => ({ user: { id: userId }, profile: { role, status } }) },
    '../i18n/LanguageProvider': { useLanguage: () => ({ language, text }) },
    '../components/ConfirmDialogProvider': { useConfirm: () => confirm },
    '../lib/eventForm': { ...require('../lib/eventForm'), bangkokDate: () => currentDay },
    '../lib/calendarView': { ...calendarView, calendarMeetingOccurrences: (...args: Parameters<typeof calendarView.calendarMeetingOccurrences>) => { occurrenceRanges.push({ start: args[1], end: args[2] }); return calendarView.calendarMeetingOccurrences(...args) } },
    '../components/EventDialog': { EventDialog: (props: Record<string, unknown>) => React.createElement('div', { ...props, 'data-testid': 'event-dialog' }) },
    '../components/TaskDialog': { TaskDialog: (props: Record<string, unknown>) => React.createElement('task-dialog', props) },
    '../components/MemberAvatar': { CalendarPeople: () => null },
    '../lib/supabase': { supabase: { rpc: async (name: string, args: unknown) => { rpcCalls.push({ name, args }); return { data: true, error: null } }, from: (table: string) => ({ update: (values: unknown) => { writes.push({ table, values }); return { eq: async () => ({ error: null }) } }, delete: () => ({ eq: async () => ({ error: null }) }), insert: async () => ({ error: null }) }) } },
    '../lib/mobilePush': { checkMeetingMobileRecipients: async () => false, getConnectedDevices: async () => [] },
  }
  vm.runInContext(ts.transpileModule(readFileSync(new URL('./CalendarPage.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
  vm.createContext({ exports, require: (name: string) => mocks[name] || (name.endsWith('.png') ? 'fixture.png' : name.startsWith('@fullcalendar/') ? {} : require(name.startsWith('../lib/') ? `../lib/${name.split('/').at(-1)}` : name)), window: { matchMedia: () => media, innerWidth: 1200, innerHeight: 800 }, console, URLSearchParams }))
  let renderer!: ReactTestRenderer
  act(() => { renderer = create(React.createElement(exports.CalendarPage!)) })
  const calendar = () => renderer.root.findByProps({ 'data-testid': 'calendar-fixture' })
  const button = (label: string) => renderer.root.findAllByType('button').find((node) => node.children.includes(label))!
  const viewSelect = () => renderer.root.findByProps({ 'aria-label': 'Calendar view' })
  const refresh = () => act(() => renderer.update(React.createElement(exports.CalendarPage!)))
  return {
    renderer, calendar, button, viewSelect, changes, anchor, navigation, queryData, queries, queryErrors, mutations, rpcCalls, mutationOptions, writes, meetings, tasks, occurrenceRanges, confirmations,
    setActiveDate: (date: Date) => { activeDate = date },
    renders: () => calendarRenders, refresh,
    setLanguage: (next: string) => { language = next; text = (th, en) => next === 'th' ? th : en; refresh() },
    setUser: (next: string) => { userId = next; refresh() },
    setRole: (next: string, nextStatus = 'active') => { role = next; status = nextStatus; refresh() },
    setRoute: (next: string) => { routeSearch = next; refresh() },
    setToday: (next: string) => { currentDay = next; refresh() },
    resize: (compact: boolean) => act(() => { media.matches = compact; listeners.forEach((listener) => listener()) }),
  }
}

test('mini calendar navigates the main calendar and follows its current date across years', () => {
  const page = calendarPage()
  try {
    const mini = () => page.renderer.root.findByProps({ 'data-testid': 'mini-calendar-fixture' })
    const target = new Date('2031-01-15T04:00:00Z')
    const control = mini().props.dayCellContent({ date: target, dayNumberText: '15' })
    assert.equal(control.type, 'button')
    act(() => control.props.onClick({ stopPropagation() {} }))
    assert.deepEqual(page.navigation.at(-1), { mini: false, date: '2031-01-15' })
    assert.equal(mini().props.dayCellClassNames({ date: target })[0], 'mini-calendar-selected')
    const next = new Date('2032-02-17T04:00:00Z')
    page.setActiveDate(next)
    act(() => page.calendar().props.datesSet({ start: next, end: new Date('2032-03-01T00:00:00Z') }))
    assert.equal(page.navigation.at(-1)?.mini, true)
    assert.equal(mini().props.dayCellClassNames({ date: next })[0], 'mini-calendar-selected')
  } finally { act(() => page.renderer.unmount()) }
})

test('active Admin can edit another creator’s records without gaining completion or ordinary deletion controls', async () => {
  const page = calendarPage()
  try {
    page.setUser('admin')
    page.setRole('admin')
    page.setRoute('?event=today')
    const meeting = page.renderer.root.findByProps({ 'data-testid': 'event-dialog' })
    assert.equal(meeting.props.canEdit, true)
    assert.equal(meeting.props.canDelete, false)
    assert.equal(meeting.props.onMoveOccurrence, undefined)
    assert.equal(meeting.props.event.owner_user_id, 'owner')
    await act(async () => meeting.props.onSave({ title: 'Admin edit' }, false, 'series'))
    assert.equal(page.mutations.at(-1)?.event, page.meetings[0])
    assert.equal(page.mutations.at(-1)?.notifyRecipients, false)
    page.setRoute('?task=timed')
    const task = page.renderer.root.findByType('task-dialog' as React.ElementType)
    assert.equal(task.props.canEdit, true)
    assert.equal(task.props.canDelete, false)
    assert.equal(task.props.canComplete, false)
    assert.equal(task.props.userId, 'admin')
    assert.equal(task.props.task.creator_user_id, 'owner')
    assert.equal(page.queries.get('task-creator-mobile')?.enabled, true)
    await page.queries.get('task-creator-mobile')!.queryFn()
    assert.equal(page.rpcCalls.at(-1)?.name, 'task_creator_mobile_available')
    assert.equal((page.rpcCalls.at(-1)?.args as { target_task_id: string }).target_task_id, 'timed')
    page.queryData['task-creator-mobile'] = true
    page.refresh()
    assert.equal(task.props.hasConnectedDevices, true)
    page.queryErrors.add('task-creator-mobile')
    page.refresh()
    assert.equal(task.props.mobileConnectionError, true)
    page.setRole('admin', 'disabled')
    assert.equal(task.props.canEdit, false)
    assert.equal(meeting.props.canEdit, false)
    assert.equal(page.queries.get('task-creator-mobile')?.enabled, false)
    page.setRole('user')
    assert.equal(task.props.canEdit, false)
  } finally { act(() => page.renderer.unmount()) }
})

test('editing a legacy recurring task preserves its rule because the form has no recurrence controls', async () => {
  const page = calendarPage()
  try {
    const task = { id: 'legacy-root', title: 'Old series', creator_user_id: 'owner', recurrence_rule: 'FREQ=WEEKLY;INTERVAL=2', due_date: '2026-10-20', due_time: null, status: 'pending' }
    const mutation = page.mutationOptions[1]
    assert.ok(mutation?.mutationFn)
    await mutation.mutationFn!({
      task,
      notifyRecipients: false,
      draft: { title: 'Updated details', description: '', affiliation: '', dueDate: '2026-10-20', dueTime: '', internalUserIds: [], externalEmails: [], linkedEventId: '', reminderMode: 'single', reminderKeys: [], driveLinks: [], files: [], notifyEmail: false, notifyLine: false },
    })
    const saved = page.writes.find((write) => write.table === 'tasks' && (write.values as { title?: string }).title === 'Updated details')
    assert.equal((saved?.values as { recurrence_rule: string }).recurrence_rule, 'FREQ=WEEKLY;INTERVAL=2')
  } finally { act(() => page.renderer.unmount()) }
})

test('switcher changes all views, marks the selected choice, and keeps the viewed date on mobile resize', () => {
  const page = calendarPage()
  try {
    assert.equal(page.viewSelect().props.value, 'month')
    assert.equal(page.calendar().props.slotEventOverlap, true)
    assert.equal(page.calendar().props.eventMaxStack, undefined)
    for (const [value, view] of [['day', 'timeGridDay'], ['week', 'timeGridWeek'], ['year', 'multiMonthYear']] as const) {
      act(() => page.viewSelect().props.onChange({ target: { value } }))
      assert.equal(page.changes.at(-1)?.view, view)
      assert.equal(page.viewSelect().props.value, value)
      assert.equal(page.calendar().props.slotEventOverlap, value !== 'week' && value !== 'day')
      assert.equal(page.calendar().props.eventMaxStack, value === 'week' ? 2 : undefined)
    }
    act(() => page.viewSelect().props.onChange({ target: { value: 'week' } }))
    page.resize(true)
    assert.equal(page.changes.at(-1)?.view, 'listWeek')
    assert.equal(page.changes.at(-1)?.date, page.anchor)
    assert.equal(page.viewSelect().props.value, 'week')
    page.resize(false)
    assert.equal(page.changes.at(-1)?.view, 'timeGridWeek')
  } finally { act(() => page.renderer.unmount()) }
})

test('viewed years expand the correct appointments, respect cancellations, and keep today summary', () => {
  const page = calendarPage()
  try {
    act(() => page.calendar().props.datesSet({ start: new Date('2030-01-01T00:00:00+07:00'), end: new Date('2031-01-01T00:00:00+07:00') }))
    const entries = page.calendar().props.events as { title: string; start: string; allDay: boolean }[]
    assert.equal(entries.find((entry) => entry.title === 'Annual meeting')?.start, '2030-09-21T02:00:00.000Z')
    assert.equal(entries.some((entry) => entry.title === 'Cancelled appointment'), false)
    assert.ok(page.renderer.root.findAllByType('button').some((node) => node.findAllByType('span').some((span) => span.children.includes('Meeting today'))))
    assert.equal(entries.find((entry) => entry.title === 'Timed task')?.start, `${bangkokDate()}T14:30:00+07:00`)
    assert.equal(entries.find((entry) => entry.title === 'All-day task')?.allDay, true)
    assert.equal(entries.some((entry) => entry.title === 'Series template'), false)
    assert.equal(page.calendar().props.timeZone, 'Asia/Bangkok')
  } finally { act(() => page.renderer.unmount()) }
})

test('clicking a timed slot opens the existing form with only the selected date', async () => {
  const page = calendarPage()
  try {
    await act(async () => { page.calendar().props.dateClick({ dateStr: '2099-10-09T14:30:00+07:00' }) })
    const dialog = page.renderer.root.findByProps({ 'data-testid': 'event-dialog' })
    assert.equal(dialog.props.open, true)
    assert.equal(dialog.props.selectedDate, '2099-10-09')
  } finally { act(() => page.renderer.unmount()) }
})

test('tooltips, sidebar tabs and dialog open/close do not redraw the calendar', () => {
  const page = calendarPage()
  try {
    const before = page.renders()
    const day = page.calendar().props.dayCellContent({ date: new Date(`${bangkokDate()}T00:00:00+07:00`), dayNumberText: '9' })
    act(() => day.props.onMouseEnter({ clientX: 100, clientY: 100 }))
    assert.equal(page.renderer.root.findByProps({ role: 'tooltip' }).findAllByType('section').length, 3)
    act(() => day.props.onMouseLeave())
    act(() => page.button('Recent documents').props.onClick())
    act(() => page.button('Upcoming').props.onClick())
    act(() => page.button('Add meeting').props.onClick())
    act(() => page.renderer.root.findByProps({ 'data-testid': 'event-dialog' }).props.onClose())
    act(() => page.button('Add task').props.onClick())
    act(() => page.renderer.root.findByType('task-dialog' as React.ElementType).props.onClose())
    assert.equal(page.renders(), before)
  } finally { act(() => page.renderer.unmount()) }
})

test('range changes expand only the viewed meetings and keep today and upcoming summaries', () => {
  const page = calendarPage()
  try {
    const before = page.occurrenceRanges.length
    const start = new Date('2030-01-01T00:00:00+07:00')
    const end = new Date('2031-01-01T00:00:00+07:00')
    act(() => page.calendar().props.datesSet({ start, end }))
    assert.equal(page.occurrenceRanges.length - before, page.meetings.length)
    assert.ok(page.occurrenceRanges.slice(before).every((range) => range.start === start && range.end === end))
    const renders = page.renders()
    act(() => page.calendar().props.datesSet({ start: new Date(start), end: new Date(end) }))
    assert.equal(page.renders(), renders)
    const day = page.calendar().props.dayCellContent({ date: new Date('2030-09-21T00:00:00+07:00'), dayNumberText: '21' })
    act(() => day.props.onMouseEnter({ clientX: 100, clientY: 100 }))
    const tooltip = page.renderer.root.findByProps({ role: 'tooltip' })
    assert.equal(tooltip.findAllByType('section').length, 1)
    assert.ok(tooltip.findAllByType('dd').some((node) => node.children.includes('Annual meeting')))
    assert.ok(page.renderer.root.findAllByType('span').some((node) => node.children.includes('Meeting today')))
    act(() => day.props.onMouseLeave())
    page.queryData['meeting-exceptions'] = [
      { event_id: 'cancelled', occurrence_key: '2030-09-21T02:00:00Z' },
      { event_id: 'annual', occurrence_key: '2030-09-21T02:00:00Z' },
    ]
    page.refresh()
    assert.equal(page.calendar().props.events.some((entry: { title: string }) => entry.title === 'Annual meeting'), false)
    const cancelledDay = page.calendar().props.dayCellContent({ date: new Date('2030-09-21T00:00:00+07:00'), dayNumberText: '21' })
    assert.equal(cancelledDay.props.className, undefined)
  } finally { act(() => page.renderer.unmount()) }
})

test('query refresh replaces edited, added and deleted records in events, day tooltips and summary', () => {
  const page = calendarPage()
  try {
    const before = page.renders()
    page.queryData.events = [{ ...page.meetings[0], title: 'Edited meeting' }, { ...page.meetings[0], id: 'new', title: 'New meeting' }]
    page.queryData.tasks = []
    page.refresh()
    assert.equal(page.renders(), before + 1)
    const entries = page.calendar().props.events as { title: string }[]
    assert.deepEqual(Array.from(entries, (entry) => entry.title), ['Edited meeting', 'New meeting'])
    const day = page.calendar().props.dayCellContent({ date: new Date(`${bangkokDate()}T00:00:00+07:00`), dayNumberText: '9' })
    act(() => day.props.onMouseEnter({ clientX: 100, clientY: 100 }))
    assert.equal(page.renderer.root.findByProps({ role: 'tooltip' }).findAllByType('section').length, 2)
    assert.ok(page.renderer.root.findAllByType('span').some((node) => node.children.includes('Edited meeting')))
    act(() => day.props.onMouseLeave())
    page.queryData.events = []
    page.refresh()
    assert.equal(page.calendar().props.events.length, 0)
    const empty = page.calendar().props.dayCellContent({ date: new Date(`${bangkokDate()}T00:00:00+07:00`), dayNumberText: '9' })
    act(() => empty.props.onMouseEnter({ clientX: 100, clientY: 100 }))
    assert.equal(empty.props.className, undefined)
    assert.equal(page.renderer.root.findAllByProps({ role: 'tooltip' }).length, 0)
    assert.ok(page.renderer.root.findAllByType('p').some((node) => node.children.includes('No calendar items today.')))
  } finally { act(() => page.renderer.unmount()) }
})

test('search, filters, account, locale and date changes still refresh calendar options and controls', async () => {
  const page = calendarPage()
  try {
    const search = page.renderer.root.findAllByProps({ placeholder: 'Search meetings or tasks' })[0]
    act(() => search.props.onChange({ target: { value: 'Timed task' } }))
    assert.deepEqual(Array.from(page.calendar().props.events, (entry: { title: string }) => entry.title), ['Timed task'])
    act(() => search.props.onChange({ target: { value: '' } }))
    const meetingsFilter = page.renderer.root.findAllByType('input').filter((node) => node.props.type === 'checkbox')[0]
    act(() => meetingsFilter.props.onChange({ target: { checked: false } }))
    assert.ok(page.calendar().props.events.every((entry: { extendedProps: { kind: string } }) => entry.extendedProps.kind === 'task'))
    act(() => meetingsFilter.props.onChange({ target: { checked: true } }))
    page.setUser('another-account')
    assert.equal(page.calendar().props.events.find((entry: { title: string }) => entry.title === 'Meeting today').backgroundColor, '#f1e7fa')
    act(() => page.calendar().props.eventClick({ event: { extendedProps: { kind: 'event', row: page.meetings[0], occurrenceStart: page.meetings[0].start_datetime } } }))
    const dialog = page.renderer.root.findByProps({ 'data-testid': 'event-dialog' })
    assert.equal(dialog.props.canEdit, false)
    assert.equal(dialog.props.occurrenceStart, page.meetings[0].start_datetime)
    page.setLanguage('th')
    assert.equal(page.calendar().props.moreLinkContent({ num: 2 }), '+2 เพิ่มเติม')
    await act(async () => { page.calendar().props.dateClick({ dateStr: '2020-10-09' }) })
    assert.equal(page.confirmations.at(-1)?.title, 'ไม่สามารถสร้างรายการย้อนหลัง')
    const tomorrow = new Date(`${bangkokDate()}T00:00:00+07:00`)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
    page.setToday(calendarView.calendarDayKey(tomorrow))
    assert.equal(page.calendar().props.events.find((entry: { title: string }) => entry.title === 'Meeting today').extendedProps.isOverdue, true)
    assert.equal(page.calendar().props.events.find((entry: { title: string }) => entry.title === 'Timed task').extendedProps.isOverdue, true)
  } finally { act(() => page.renderer.unmount()) }
})


test('status cards update interactively based on the viewed calendar period and show overdue count', () => {
  const page = calendarPage()
  try {
    const statusHeader = page.renderer.root.findByProps({ className: 'calendar-status-header' })
    const strongs = statusHeader.findAllByType('strong')
    // Initial month (contains today): Timed task is pending (1), All-day task is completed (1), Overdue count is 0
    assert.equal(strongs[0].children[0], '1')
    assert.equal(strongs[1].children[0], '1')
    assert.equal(strongs[2].children[0], '0')

    // Navigate to a month in 2030 with no tasks (2030-05-01 to 2030-06-01)
    const futureStart = new Date('2030-05-01T00:00:00+07:00')
    const futureEnd = new Date('2030-06-01T00:00:00+07:00')
    act(() => page.calendar().props.datesSet({ start: futureStart, end: futureEnd, view: { currentStart: futureStart, currentEnd: futureEnd } }))

    const updatedStrongs = statusHeader.findAllByType('strong')
    // In May 2030: 0 pending, 0 completed, 0 overdue
    assert.equal(updatedStrongs[0].children[0], '0')
    assert.equal(updatedStrongs[1].children[0], '0')
    assert.equal(updatedStrongs[2].children[0], '0')
  } finally { act(() => page.renderer.unmount()) }
})
