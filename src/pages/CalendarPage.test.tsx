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
  let language = 'en'
  let text = (_: string, en: string) => en
  let calendarRenders = 0
  const occurrenceRanges: { start: Date; end: Date }[] = []
  const confirmations: Record<string, unknown>[] = []
  const confirm = async (options: Record<string, unknown>) => { confirmations.push(options); return false }
  const anchor = new Date('2030-09-21T02:00:00Z')
  const changes: { view: string; date: Date }[] = []
  const listeners = new Set<() => void>()
  const media = { matches: false, addEventListener: (_: string, listener: () => void) => listeners.add(listener), removeEventListener: (_: string, listener: () => void) => listeners.delete(listener) }
  const meetings = [
    { id: 'today', title: 'Meeting today', start_datetime: `${today}T09:00:00+07:00`, end_datetime: `${today}T10:00:00+07:00`, all_day: false, recurrence_rule: null, owner_user_id: 'owner', affiliation: 'PEA' },
    { id: 'annual', title: 'Annual meeting', start_datetime: '2026-09-21T02:00:00Z', end_datetime: '2026-09-21T03:00:00Z', all_day: false, recurrence_rule: 'FREQ=YEARLY', recurrence_count: 6, owner_user_id: 'owner', affiliation: 'PEA' },
    { id: 'cancelled', title: 'Cancelled appointment', start_datetime: '2026-09-21T02:00:00Z', end_datetime: null, all_day: false, recurrence_rule: 'FREQ=YEARLY', owner_user_id: 'owner', affiliation: 'PEA' },
  ]
  const tasks = [
    { id: 'timed', title: 'Timed task', due_date: today, due_time: '14:30:00', status: 'pending', recurrence_series_id: null },
    { id: 'all-day', title: 'All-day task', due_date: today, due_time: null, status: 'completed', recurrence_series_id: null },
    { id: 'series', title: 'Series template', due_date: today, due_time: null, status: 'pending', recurrence_series_id: 'series-1' },
  ]
  const queryData: Record<string, unknown> = { events: meetings, tasks, 'meeting-exceptions': [{ event_id: 'cancelled', occurrence_key: '2030-09-21T02:00:00Z' }], 'mobile-push-devices': [], 'assignable-profiles': [] }
  class Calendar extends React.Component<Record<string, unknown>> {
    api = { view: { type: 'dayGridMonth' }, getDate: () => anchor, changeView: (view: string, date: Date) => { this.api.view.type = view; changes.push({ view, date }) } }
    getApi() { return this.api }
    render() { calendarRenders++; return React.createElement('div', { ...this.props, 'data-testid': 'calendar-fixture' }) }
  }
  const require = createRequire(import.meta.url)
  const exports: { CalendarPage?: React.ComponentType } = {}
  const mocks: Record<string, unknown> = {
    react: React,
    '@fullcalendar/react': Calendar,
    '@tanstack/react-query': { useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryData[queryKey[0]], isError: false, isLoading: false }), useMutation: () => ({ isPending: false, isError: false, mutateAsync: async () => {} }), useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    'react-router-dom': { useLocation: () => ({ search: '' }), useNavigate: () => () => {} },
    '../auth/AuthProvider': { useAuth: () => ({ user: { id: userId }, profile: { role: 'user' } }) },
    '../i18n/LanguageProvider': { useLanguage: () => ({ language, text }) },
    '../components/ConfirmDialogProvider': { useConfirm: () => confirm },
    '../lib/eventForm': { ...require('../lib/eventForm'), bangkokDate: () => currentDay },
    '../lib/calendarView': { ...calendarView, calendarMeetingOccurrences: (...args: Parameters<typeof calendarView.calendarMeetingOccurrences>) => { occurrenceRanges.push({ start: args[1], end: args[2] }); return calendarView.calendarMeetingOccurrences(...args) } },
    '../components/EventDialog': { EventDialog: (props: Record<string, unknown>) => React.createElement('div', { ...props, 'data-testid': 'event-dialog' }) },
    '../components/TaskDialog': { TaskDialog: (props: Record<string, unknown>) => React.createElement('task-dialog', props) },
    '../lib/supabase': { supabase: {} },
    '../lib/mobilePush': { checkMeetingMobileRecipients: async () => false, getConnectedDevices: async () => [] },
  }
  vm.runInContext(ts.transpileModule(readFileSync(new URL('./CalendarPage.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
  vm.createContext({ exports, require: (name: string) => mocks[name] || (name.endsWith('.png') ? 'fixture.png' : name.startsWith('@fullcalendar/') ? {} : require(name.startsWith('../lib/') ? `../lib/${name.split('/').at(-1)}` : name)), window: { matchMedia: () => media, innerWidth: 1200, innerHeight: 800 }, console, URLSearchParams }))
  let renderer!: ReactTestRenderer
  act(() => { renderer = create(React.createElement(exports.CalendarPage!)) })
  const calendar = () => renderer.root.findByProps({ 'data-testid': 'calendar-fixture' })
  const button = (label: string) => renderer.root.findAllByType('button').find((node) => node.children.includes(label))!
  const refresh = () => act(() => renderer.update(React.createElement(exports.CalendarPage!)))
  return {
    renderer, calendar, button, changes, anchor, queryData, meetings, tasks, occurrenceRanges, confirmations,
    renders: () => calendarRenders, refresh,
    setLanguage: (next: string) => { language = next; text = (th, en) => next === 'th' ? th : en; refresh() },
    setUser: (next: string) => { userId = next; refresh() },
    setToday: (next: string) => { currentDay = next; refresh() },
    resize: (compact: boolean) => act(() => { media.matches = compact; listeners.forEach((listener) => listener()) }),
  }
}

test('switcher changes all views, marks the selected choice, and keeps the viewed date on mobile resize', () => {
  const page = calendarPage()
  try {
    assert.equal(page.button('Month').props['aria-pressed'], true)
    for (const [label, view] of [['Day', 'timeGridDay'], ['Week', 'timeGridWeek'], ['Year', 'multiMonthYear']] as const) {
      act(() => page.button(label).props.onClick())
      assert.equal(page.changes.at(-1)?.view, view)
      assert.equal(page.button(label).props['aria-pressed'], true)
    }
    act(() => page.button('Week').props.onClick())
    page.resize(true)
    assert.equal(page.changes.at(-1)?.view, 'listWeek')
    assert.equal(page.changes.at(-1)?.date, page.anchor)
    assert.equal(page.button('Week').props['aria-pressed'], true)
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
    const search = page.renderer.root.findByProps({ placeholder: 'Search meetings or tasks' })
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
