import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { bangkokDate } from '../lib/eventForm'

function calendarPage() {
  const today = bangkokDate()
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
    render() { return React.createElement('div', { ...this.props, 'data-testid': 'calendar-fixture' }) }
  }
  const require = createRequire(import.meta.url)
  const exports: { CalendarPage?: React.ComponentType } = {}
  const mocks: Record<string, unknown> = {
    react: React,
    '@fullcalendar/react': Calendar,
    '@tanstack/react-query': { useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryData[queryKey[0]], isError: false, isLoading: false }), useMutation: () => ({ isPending: false, isError: false, mutateAsync: async () => {} }), useQueryClient: () => ({ invalidateQueries: async () => {} }) },
    'react-router-dom': { useLocation: () => ({ search: '' }), useNavigate: () => () => {} },
    '../auth/AuthProvider': { useAuth: () => ({ user: { id: 'owner' }, profile: { role: 'user' } }) },
    '../i18n/LanguageProvider': { useLanguage: () => ({ language: 'en', text: (_: string, en: string) => en }) },
    '../components/ConfirmDialogProvider': { useConfirm: () => async () => false },
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
  return { renderer, calendar, button, changes, anchor, resize: (compact: boolean) => act(() => { media.matches = compact; listeners.forEach((listener) => listener()) }) }
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
