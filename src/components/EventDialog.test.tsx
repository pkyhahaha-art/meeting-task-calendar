import assert from 'node:assert/strict'
import test from 'node:test'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import Swal from 'sweetalert2'
import { LanguageProvider } from '../i18n/LanguageProvider'
import type { Database } from '../lib/database.types'
import { EventDialog, type EventDetails, type EventDraft } from './EventDialog'
import { SaveActionMenu } from './SaveActionMenu'

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'en' } })

const event = {
  id: 'saved-meeting', title: 'Saved meeting', description: '', location: '', affiliation: '',
  start_datetime: '2030-10-03T02:00:00.000Z', end_datetime: null, all_day: false,
  recurrence_rule: null, recurrence_until: null, recurrence_count: null,
  email_notifications_enabled: true, mobile_notifications_enabled: true,
} as Database['public']['Tables']['events']['Row']
const details: EventDetails = {
  guestEmails: [], occurrenceGuestEmails: [], guestAcknowledgements: {}, reminderKeys: [],
  // There may be no scheduled reminders after delivery or when only a confirmation was chosen.
  attachments: [], occurrenceId: null,
  occurrenceOverride: null, hasOccurrenceChanges: false, notificationDeliveries: [],
  occurrenceReminders: [], occurrenceNotificationDeliveries: [],
}
const noop = async () => {}

test('new meetings require both classifications before creation', async () => {
  let renderer!: ReactTestRenderer
  const saved: boolean[] = []
  const originalFire = Swal.fire
  Swal.fire = (async () => ({ isConfirmed: true })) as typeof Swal.fire
  try {
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={null} selectedDate="2030-10-03" canEdit canViewDeliveryStatus={false} busy={false}
      onClose={() => {}} onSave={async (_draft, notify) => { saved.push(notify) }} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    act(() => renderer.root.findByProps({ id: 'title' }).props.onChange({ target: { value: 'New meeting' } }))
    const category = () => renderer.root.findByProps({ id: 'event-grc-category' })
    const committee = () => renderer.root.findByProps({ id: 'event-committee' })
    assert.equal(category().props['aria-required'], true)
    assert.equal(committee().props['aria-required'], true)
    const submit = async () => { await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault: () => {} }); await new Promise(resolve => setImmediate(resolve)) }) }
    await submit()
    assert.deepEqual(saved, [])
    assert.ok(JSON.stringify(renderer.toJSON()).includes('Choose a GRC category and a committee / team.'))
    act(() => category().props.onChange({ target: { value: 'S001' } }))
    await submit()
    assert.ok(JSON.stringify(renderer.toJSON()).includes('Choose a committee / team.'))
    act(() => { category().props.onChange({ target: { value: '' } }); committee().props.onChange({ target: { value: 'C001' } }) })
    await submit()
    assert.ok(JSON.stringify(renderer.toJSON()).includes('Choose a GRC category.'))
    act(() => category().props.onChange({ target: { value: 'S001' } }))
    await submit()
    assert.deepEqual(saved, [true])
  } finally { Swal.fire = originalFire; if (renderer) act(() => renderer.unmount()) }
})

test('editing a legacy meeting does not require classification', async () => {
  let renderer!: ReactTestRenderer
  let saved = false
  try {
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={event} details={details} canEdit canViewDeliveryStatus={false} busy={false}
      onClose={() => {}} onSave={async () => { saved = true }} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    assert.equal(renderer.root.findByProps({ id: 'event-grc-category' }).props['aria-required'], false)
    assert.equal(renderer.root.findByProps({ id: 'event-committee' }).props['aria-required'], false)
    await act(async () => { await renderer.root.findByType(SaveActionMenu).props.onSave(false) })
    assert.equal(saved, true)
  } finally { if (renderer) act(() => renderer.unmount()) }
})

test('GRC and committee selections preserve keys when saving a meeting', async () => {
  let renderer!: ReactTestRenderer
  let saved: EventDraft | undefined
  try {
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={{ ...event, grc_category_key: null, committee_key: null }} details={details} canEdit canViewDeliveryStatus={false} busy={false}
      onClose={() => {}} onSave={async draft => { saved = draft }} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    const grc = renderer.root.findByProps({ id: 'event-grc-category' })
    const committee = renderer.root.findByProps({ id: 'event-committee' })
    assert.equal(grc.props.value, '')
    assert.equal(committee.props.value, '')
    assert.deepEqual(grc.findAllByType('option').map(option => option.props.value), ['', 'S001', 'S002', 'S003', 'S004', 'S005', 'S099'])
    assert.deepEqual(committee.findAllByType('option').map(option => option.props.value), ['', 'C001', 'C002', 'C003', 'C004', 'C005', 'C006', 'C007', 'C099'])
    act(() => grc.props.onChange({ target: { value: 'S003' } }))
    act(() => committee.props.onChange({ target: { value: 'C007' } }))
    await act(async () => { await renderer.root.findByType(SaveActionMenu).props.onSave(false) })
    assert.equal(saved?.grc_category_key, 'S003')
    assert.equal(saved?.committee_key, 'C007')
  } finally { if (renderer) act(() => renderer.unmount()) }
})

test('meeting classification remains visible but cannot be changed for a single occurrence', () => {
  let renderer!: ReactTestRenderer
  try {
    const recurring = { ...event, recurrence_rule: 'FREQ=WEEKLY', grc_category_key: 'S002', committee_key: 'C006' }
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={recurring} details={{ ...details, occurrenceId: 'occurrence-1', hasOccurrenceChanges: true }} occurrenceStart={event.start_datetime} canEdit canViewDeliveryStatus={false} busy={false}
      onClose={() => {}} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    assert.equal(renderer.root.findByProps({ id: 'event-grc-category' }).props.value, 'S002')
    assert.equal(renderer.root.findByProps({ id: 'event-grc-category' }).props.disabled, true)
    assert.equal(renderer.root.findByProps({ id: 'event-committee' }).props.value, 'C006')
    assert.equal(renderer.root.findByProps({ id: 'event-committee' }).props.disabled, true)
  } finally { if (renderer) act(() => renderer.unmount()) }
})

test('successful attendance confirmation closes the form; cancellation and failure keep it open', async () => {
  const fire = Swal.fire, update = Swal.update, validation = Swal.showValidationMessage
  Swal.update = (() => {}) as typeof Swal.update
  Swal.showValidationMessage = (() => {}) as typeof Swal.showValidationMessage
  try {
    for (const scenario of ['single', 'occurrence', 'series', 'cancel', 'failure'] as const) {
      let renderer!: ReactTestRenderer
      let closed = 0, selected = '', step = 0
      Swal.fire = (async (options: { preConfirm?: (scope: string) => Promise<unknown> }) => {
        step++
        if (step > 1) return { isConfirmed: false }
        if (scenario === 'cancel') return { isConfirmed: false }
        const value = await options.preConfirm!(scenario === 'series' ? 'series' : 'occurrence')
        return value === false ? { isConfirmed: false } : { isConfirmed: true, value }
      }) as typeof Swal.fire
      try {
        const recurring = scenario !== 'single'
        act(() => { renderer = create(<LanguageProvider><EventDialog open event={{ ...event, owner_user_id: 'owner', recurrence_rule: recurring ? 'FREQ=WEEKLY' : null }} details={details}
          currentUserId="member" currentUserEmail="member@gmail.com" occurrenceStart={recurring ? event.start_datetime : undefined}
          onCheckJoinTime={async () => Date.parse('2029-01-01T00:00:00Z')} onJoin={async scope => { selected = scope; if (scenario === 'failure') throw new Error('failed'); return true }}
          canEdit={false} canViewDeliveryStatus={false} busy={false} onClose={() => { closed++ }} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
        await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes('Join this meeting'))!.props.onClick(); await new Promise(resolve => setImmediate(resolve)) })
        assert.equal(closed, scenario === 'cancel' || scenario === 'failure' ? 0 : 1, scenario)
        if (scenario === 'series') assert.equal(selected, 'series')
        if (scenario === 'single' || scenario === 'occurrence') assert.equal(selected, 'occurrence')
      } finally { if (renderer) act(() => renderer.unmount()) }
    }
  } finally { Swal.fire = fire; Swal.update = update; Swal.showValidationMessage = validation }
})

test('employee attendees do not appear in external fields; editing external email preserves the employee', async () => {
  let renderer!: ReactTestRenderer
  let saved: EventDraft | undefined
  const employee = { id: 'employee', full_name: 'Employee', email: 'employee@gmail.com', status: 'active' } as Database['public']['Tables']['profiles']['Row']
  const attendees = { ...details, guestEmails: ['employee@gmail.com', 'outside@gmail.com'], occurrenceGuestEmails: ['employee@gmail.com', 'outside@gmail.com'] }
  try {
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={event} details={attendees} profiles={[employee]} canEdit canViewDeliveryStatus={false} busy={false}
      onClose={() => {}} onSave={async draft => { saved = draft }} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    const external = renderer.root.findAllByType('input').filter(input => input.props.type === 'email')
    assert.deepEqual(external.map(input => input.props.value), ['outside@gmail.com'])
    act(() => external[0].props.onChange({ target: { value: 'changed@gmail.com' } }))
    await act(async () => { await renderer.root.findByType(SaveActionMenu).props.onSave(false) })
    assert.ok(saved?.guestEmails.includes('employee@gmail.com'))
    assert.ok(saved?.guestEmails.includes('changed@gmail.com'))
    act(() => renderer.root.findAllByProps({ role: 'tab' }).find(node => node.children.includes('Employees'))!.props.onClick())
    assert.equal(renderer.root.findAllByProps({ role: 'tabpanel' })[0].findByType('input').props.checked, true)
  } finally { if (renderer) act(() => renderer.unmount()) }
})

test('an invited member pressing join sees the invitation message without another join request', async () => {
  const originalFire = Swal.fire
  let shown = '', calls = 0
  let renderer!: ReactTestRenderer
  Swal.fire = (async (options: { title?: string; showCancelButton?: boolean; confirmButtonText?: string }) => { shown = options.title ?? ''; assert.equal(options.showCancelButton, false); assert.equal(options.confirmButtonText, 'Close'); return { isConfirmed: true } }) as typeof Swal.fire
  try {
    const invited = { ...details, guestEmails: ['member@gmail.com'], occurrenceGuestEmails: ['member@gmail.com'] }
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={{ ...event, owner_user_id: 'owner' }} details={invited} currentUserEmail="member@gmail.com"
      currentUserId="member" onCheckJoinTime={async () => Date.parse('2029-01-01T00:00:00Z')} onJoin={async () => { calls++; return true }}
      canEdit={false} canViewDeliveryStatus={false} busy={false} onClose={() => {}} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes('Join this meeting'))!.props.onClick(); await new Promise(resolve => setImmediate(resolve)) })
    assert.equal(shown, 'You have already been invited to this meeting.')
    assert.equal(calls, 0)
  } finally { Swal.fire = originalFire; if (renderer) act(() => renderer.unmount()) }
})

test('an occurrence attendee can expand to the series directly from the invitation notice', async () => {
  const fire = Swal.fire, update = Swal.update
  let scope = '', closed = 0
  let renderer!: ReactTestRenderer
  let step = 0
  Swal.update = (() => {}) as typeof Swal.update
  Swal.fire = (async (options: { confirmButtonText?: string; text?: string; preConfirm?: () => Promise<unknown> }) => {
    step++
    if (step === 1) { assert.equal(options.confirmButtonText, 'The whole series'); assert.match(options.text!, /future occurrences/); const value = await options.preConfirm!(); return { isConfirmed: true, value } }
    return { isConfirmed: false }
  }) as typeof Swal.fire
  try {
    const invited = { ...details, occurrenceGuestEmails: ['member@gmail.com'] }
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={{ ...event, owner_user_id: 'owner', recurrence_rule: 'FREQ=WEEKLY;BYDAY=WE' }} details={invited}
      occurrenceStart={event.start_datetime} currentUserEmail="member@gmail.com" currentUserId="member" onCheckJoinTime={async () => Date.parse('2029-01-01T00:00:00Z')}
      onJoin={async selected => { scope = selected; return true }} canEdit={false} canViewDeliveryStatus={false} busy={false}
      onClose={() => { closed++ }} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes('Join this meeting'))!.props.onClick(); await new Promise(resolve => setImmediate(resolve)) })
    assert.equal(scope, 'series')
    assert.equal(closed, 1)
  } finally { Swal.fire = fire; Swal.update = update; if (renderer) act(() => renderer.unmount()) }
})

test('a series attendee can switch to this occurrence with clear consequences', async () => {
  const fire = Swal.fire, update = Swal.update
  let calls = 0, normalJoins = 0, step = 0, closed = 0
  let renderer!: ReactTestRenderer
  Swal.update = (() => {}) as typeof Swal.update
  Swal.fire = (async (options: { confirmButtonText?: string; text?: string; preConfirm?: () => Promise<unknown> }) => {
    step++
    if (step === 1) { assert.equal(options.confirmButtonText, 'Only this occurrence'); assert.match(options.text!, /other future occurrences will be cancelled/); const value = await options.preConfirm!(); return { isConfirmed: true, value } }
    return { isConfirmed: false }
  }) as typeof Swal.fire
  try {
    const invited = { ...details, guestEmails: ['member@gmail.com'], occurrenceGuestEmails: ['member@gmail.com'] }
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={{ ...event, owner_user_id: 'owner', recurrence_rule: 'FREQ=WEEKLY;BYDAY=WE' }} details={invited}
      occurrenceStart={event.start_datetime} currentUserEmail="member@gmail.com" currentUserId="member" onCheckJoinTime={async () => Date.parse('2029-01-01T00:00:00Z')}
      onJoin={async () => { normalJoins++; return true }} onChangeToOccurrence={async () => { calls++; return true }} canEdit={false} canViewDeliveryStatus={false} busy={false}
      onClose={() => { closed++ }} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes('Join this meeting'))!.props.onClick(); await new Promise(resolve => setImmediate(resolve)) })
    assert.equal(calls, 1)
    assert.equal(normalJoins, 0)
    assert.equal(closed, 1)
  } finally { Swal.fire = fire; Swal.update = update; if (renderer) act(() => renderer.unmount()) }
})

test('cancelling a series-to-occurrence switch never changes attendance', async () => {
  const fire = Swal.fire
  let calls = 0
  let renderer!: ReactTestRenderer
  Swal.fire = (async () => ({ isConfirmed: false })) as typeof Swal.fire
  try {
    const invited = { ...details, guestEmails: ['member@gmail.com'], occurrenceGuestEmails: ['member@gmail.com'] }
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={{ ...event, owner_user_id: 'owner', recurrence_rule: 'FREQ=WEEKLY;BYDAY=WE' }} details={invited}
      occurrenceStart={event.start_datetime} currentUserEmail="member@gmail.com" currentUserId="member" onCheckJoinTime={async () => Date.parse('2029-01-01T00:00:00Z')}
      onJoin={async () => { calls++; return true }} onChangeToOccurrence={async () => { calls++; return true }} canEdit={false} canViewDeliveryStatus={false} busy={false}
      onClose={() => {}} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes('Join this meeting'))!.props.onClick(); await new Promise(resolve => setImmediate(resolve)) })
    assert.equal(calls, 0)
  } finally { Swal.fire = fire; if (renderer) act(() => renderer.unmount()) }
})

test('a failed scope change keeps the confirmation open and shows the server error', async () => {
  const fire = Swal.fire, update = Swal.update, validation = Swal.showValidationMessage
  let error = '', calls = 0, step = 0
  let renderer!: ReactTestRenderer
  Swal.update = (() => {}) as typeof Swal.update
  Swal.showValidationMessage = ((message: string) => { error = message }) as typeof Swal.showValidationMessage
  Swal.fire = (async (options: { preConfirm?: () => Promise<unknown> }) => {
    step++
    assert.equal(await options.preConfirm!(), false)
    return { isConfirmed: false }
  }) as typeof Swal.fire
  try {
    const invited = { ...details, guestEmails: ['member@gmail.com'], occurrenceGuestEmails: ['member@gmail.com'] }
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={{ ...event, owner_user_id: 'owner', recurrence_rule: 'FREQ=WEEKLY;BYDAY=WE' }} details={invited}
      occurrenceStart={event.start_datetime} currentUserEmail="member@gmail.com" currentUserId="member" onCheckJoinTime={async () => Date.parse('2029-01-01T00:00:00Z')}
      onJoin={async () => true} onChangeToOccurrence={async () => { calls++; throw { message: 'network failure' } }} canEdit={false} canViewDeliveryStatus={false} busy={false}
      onClose={() => {}} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes('Join this meeting'))!.props.onClick(); await new Promise(resolve => setImmediate(resolve)) })
    assert.equal(calls, 1)
    assert.equal(step, 1)
    assert.equal(error, 'network failure')
  } finally { Swal.fire = fire; Swal.update = update; Swal.showValidationMessage = validation; if (renderer) act(() => renderer.unmount()) }
})

test('a stopped series is shown as occurrence-only at its inclusive final date', async () => {
  const fire = Swal.fire
  let label = ''
  let renderer!: ReactTestRenderer
  Swal.fire = (async (options: { confirmButtonText?: string }) => { label = options.confirmButtonText ?? ''; return { isConfirmed: false } }) as typeof Swal.fire
  try {
    const invited = { ...details, guestEmails: ['member@gmail.com'], guestJoinUntil: { 'member@gmail.com': event.start_datetime }, occurrenceGuestEmails: ['member@gmail.com'] }
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={{ ...event, owner_user_id: 'owner', recurrence_rule: 'FREQ=WEEKLY;BYDAY=WE' }} details={invited}
      occurrenceStart={event.start_datetime} currentUserEmail="member@gmail.com" currentUserId="member" onCheckJoinTime={async () => Date.parse('2029-01-01T00:00:00Z')}
      onJoin={async () => true} canEdit={false} canViewDeliveryStatus={false} busy={false} onClose={() => {}} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes('Join this meeting'))!.props.onClick(); await new Promise(resolve => setImmediate(resolve)) })
    assert.equal(label, 'The whole series')
  } finally { Swal.fire = fire; if (renderer) act(() => renderer.unmount()) }
})

test('a prior attendance interval still displays series membership after rejoining later', async () => {
  const fire = Swal.fire
  let label = ''
  let renderer!: ReactTestRenderer
  Swal.fire = (async (options: { confirmButtonText?: string }) => { label = options.confirmButtonText ?? ''; return { isConfirmed: false } }) as typeof Swal.fire
  try {
    const invited = { ...details, guestEmails: ['member@gmail.com'], guestJoinFrom: { 'member@gmail.com': '2030-10-21T02:00:00Z' },
      guestJoinHistory: { 'member@gmail.com': [{ from: '2030-10-01T02:00:00Z', until: '2030-10-14T02:00:00Z' }] }, occurrenceGuestEmails: ['member@gmail.com'] }
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={{ ...event, owner_user_id: 'owner', recurrence_rule: 'FREQ=WEEKLY;BYDAY=WE' }} details={invited}
      occurrenceStart="2030-10-07T02:00:00Z" currentUserEmail="member@gmail.com" currentUserId="member" onCheckJoinTime={async () => Date.parse('2029-01-01T00:00:00Z')}
      onJoin={async () => true} onChangeToOccurrence={async () => true} canEdit={false} canViewDeliveryStatus={false} busy={false} onClose={() => {}} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes('Join this meeting'))!.props.onClick(); await new Promise(resolve => setImmediate(resolve)) })
    assert.equal(label, 'Only this occurrence')
  } finally { Swal.fire = fire; if (renderer) act(() => renderer.unmount()) }
})

test('external fields wait until employee profiles are available', () => {
  let renderer!: ReactTestRenderer
  try {
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={event} details={{ ...details, guestEmails: ['member@gmail.com'] }} profilesAvailable={false}
      canEdit canViewDeliveryStatus={false} busy={false} onClose={() => {}} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    assert.equal(renderer.root.findAllByType('input').filter(input => input.props.type === 'email').length, 0)
    assert.ok(renderer.root.findAllByProps({ role: 'status' }).some(node => node.children.join('').includes('Employee list')))
  } finally { if (renderer) act(() => renderer.unmount()) }
})

test('refreshed attendance checks the current occurrence immediately and keeps organizer edits', () => {
  const employee = { id: 'member', full_name: 'Member', email: 'member@gmail.com', status: 'active' } as Database['public']['Tables']['profiles']['Row']
  const saved = { ...event, owner_user_id: 'owner', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO' }
  let renderer!: ReactTestRenderer
  const view = (canEdit: boolean, current: EventDetails) => <LanguageProvider><EventDialog open event={saved} details={current}
    occurrenceStart="2030-10-07T02:00:00Z" profiles={[employee]} currentUserId={canEdit ? 'owner' : 'member'} canEdit={canEdit}
    canViewDeliveryStatus={false} busy={false} onClose={() => {}} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>
  const openEmployees = () => act(() => renderer.root.findAllByProps({ role: 'tab' }).find(node => node.children.includes('Employees'))!.props.onClick())
  const memberCheckbox = () => renderer.root.findAllByProps({ role: 'tabpanel' }).find(node => node.findAllByType('input').some(input => input.props.type === 'checkbox'))!.findByType('input')
  try {
    act(() => { renderer = create(view(false, details)) })
    openEmployees()
    assert.equal(memberCheckbox().props.checked, false)
    const joined = { ...details, occurrenceGuestEmails: [employee.email] }
    act(() => renderer.update(view(false, joined)))
    assert.equal(memberCheckbox().props.checked, true)
    act(() => renderer.update(view(false, details)))
    assert.equal(memberCheckbox().props.checked, false)
    act(() => renderer.update(view(true, details)))
    act(() => renderer.root.findByProps({ id: 'title' }).props.onChange({ target: { value: 'Unsaved title' } }))
    act(() => memberCheckbox().props.onChange({ target: { checked: true } }))
    act(() => renderer.update(view(true, { ...details, guestEmails: ['other@gmail.com'], occurrenceGuestEmails: ['other@gmail.com'] })))
    assert.equal(memberCheckbox().props.checked, true)
    assert.equal(renderer.root.findByProps({ id: 'title' }).props.value, 'Unsaved title')
    act(() => renderer.unmount())
    act(() => { renderer = create(view(true, { ...details, occurrenceId: 'earlier-occurrence', guestEmails: [employee.email],
      guestJoinFrom: { [employee.email]: '2030-10-14T02:00:00Z' }, hasOccurrenceChanges: true })) })
    openEmployees()
    assert.equal(memberCheckbox().props.checked, false)
  } finally { if (renderer) act(() => renderer.unmount()) }
})

test('join uses one native radio scope and the PEA pending presentation', async () => {
  const originalFire = Swal.fire, originalUpdate = Swal.update, originalValidation = Swal.showValidationMessage
  const submissions: string[] = []
  const pending: string[] = []
  let configured: { input?: string; inputOptions?: Record<string, string>; customClass?: { popup?: string }; preConfirm: (value: string) => Promise<unknown> } | undefined
  let renderer!: ReactTestRenderer
  Swal.update = ((options: { footer?: string }) => { if (options.footer) pending.push(options.footer) }) as typeof Swal.update
  Swal.showValidationMessage = (() => {}) as typeof Swal.showValidationMessage
  Swal.fire = (async (options: unknown) => { configured = options as typeof configured; return { isConfirmed: false } }) as typeof Swal.fire
  try {
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={{ ...event, owner_user_id: 'owner', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO' }} details={details}
      currentUserId="member" onCheckJoinTime={async () => Date.parse('2029-01-01T00:00:00Z')} onJoin={async scope => { submissions.push(scope); return true }} canEdit={false}
      canViewDeliveryStatus={false} busy={false} onClose={() => {}} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes('Join this meeting'))!.props.onClick(); await new Promise(resolve => setImmediate(resolve)) })
    assert.equal(configured?.input, 'radio')
    assert.deepEqual(Object.keys(configured!.inputOptions!), ['occurrence', 'series'])
    assert.equal(configured?.customClass?.popup, 'pea-join-dialog')
    await configured!.preConfirm('occurrence,series')
    assert.deepEqual(submissions, [])
    await configured!.preConfirm('series')
    assert.deepEqual(submissions, ['series'])
    assert.match(pending[0], /Pending/)
    assert.match(pending[0], /pea-pending-clock/)
    assert.doesNotMatch(pending[0], /<img|pea-typing-mascot-v2\.png/)
    assert.doesNotMatch(pending[0], /มาสคอต PEA|PEA is confirming/)
  } finally { Swal.fire = originalFire; Swal.update = originalUpdate; Swal.showValidationMessage = originalValidation; if (renderer) act(() => renderer.unmount()) }
})

test('a past meeting displays the requested Thai message without joining', async () => {
  const originalFire = Swal.fire
  const originalGetItem = localStorage.getItem
  let shown = ''
  let joins = 0
  let renderer!: ReactTestRenderer
  localStorage.getItem = () => 'th'
  Swal.fire = (async (options: { text?: string }) => { shown = options.text ?? ''; return { isConfirmed: false } }) as typeof Swal.fire
  try {
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={{ ...event, owner_user_id: 'owner', start_datetime: '2000-01-01T00:00:00Z' }} details={details}
      currentUserId="member" onCheckJoinTime={async () => Date.now()} onJoin={async () => { joins++; return true }} canEdit={false} canViewDeliveryStatus={false} busy={false}
      onClose={() => {}} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    await act(async () => { renderer.root.findAllByType('button').find((button) => button.children.includes('เข้าร่วมประชุมนี้'))!.props.onClick(); await new Promise(resolve => setImmediate(resolve)) })
    assert.equal(shown, 'ไม่สามารถเข้าร่วมการประชุมได้ เนื่องจากเลยเวลานัดหมายแล้ว')
    assert.equal(joins, 0)
  } finally { localStorage.getItem = originalGetItem; Swal.fire = originalFire; if (renderer) act(() => renderer.unmount()) }
})

test('join checks the selected appointment start and reports an expired meeting immediately', async () => {
  const originalFire = Swal.fire
  const originalNow = Date.now
  const alerts: Array<{ text?: string; input?: string }> = []
  let joins = 0
  let renderer!: ReactTestRenderer
  Date.now = () => Date.parse('2030-10-07T02:00:00Z')
  Swal.fire = (async (options: unknown) => { alerts.push(options as { text?: string }); return { isConfirmed: false } }) as typeof Swal.fire
  const recurring = { ...event, owner_user_id: 'owner', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO' }
  const view = (occurrenceStart: string) => <LanguageProvider><EventDialog open event={recurring} details={details} occurrenceStart={occurrenceStart}
    currentUserId="member" onCheckJoinTime={async () => Date.now()} onJoin={async () => { joins++; return true }} canEdit={false} canViewDeliveryStatus={false} busy={false}
    onClose={() => {}} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>
  const clickJoin = async () => { await act(async () => { renderer.root.findAllByType('button').find((button) => button.children.includes('Join this meeting'))!.props.onClick(); await new Promise(resolve => setImmediate(resolve)) }) }
  try {
    act(() => { renderer = create(view('2030-10-07T02:00:00Z')) })
    await clickJoin()
    assert.match(alerts[0].text!, /scheduled start time has passed/)
    assert.equal(joins, 0)
    act(() => renderer.update(view('2030-10-14T02:00:00Z')))
    await clickJoin()
    assert.equal(alerts[1].input, 'radio')
    assert.equal(joins, 0)
  } finally { Swal.fire = originalFire; Date.now = originalNow; if (renderer) act(() => renderer.unmount()) }
})

test('server rejection after the meeting starts shows the expired explanation during confirmation', async () => {
  const originalFire = Swal.fire, originalUpdate = Swal.update, originalValidation = Swal.showValidationMessage, originalNow = Date.now
  let now = Date.parse('2030-10-07T01:59:59Z')
  let validation = ''
  let renderer!: ReactTestRenderer
  Date.now = () => now
  Swal.update = (() => {}) as typeof Swal.update
  Swal.showValidationMessage = ((message: string) => { validation = message }) as typeof Swal.showValidationMessage
  Swal.fire = (async (options: { preConfirm: (scope: string) => Promise<unknown> }) => {
    now += 1000
    await options.preConfirm('occurrence')
    return { isConfirmed: false }
  }) as typeof Swal.fire
  try {
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={{ ...event, owner_user_id: 'owner', start_datetime: '2030-10-07T02:00:00Z' }} details={details}
      currentUserId="member" onCheckJoinTime={async () => now} onJoin={async () => { throw { message: 'meeting_join_start_passed' } }} canEdit={false} canViewDeliveryStatus={false} busy={false}
      onClose={() => {}} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    await act(async () => { renderer.root.findAllByType('button').find((button) => button.children.includes('Join this meeting'))!.props.onClick(); await new Promise(resolve => setImmediate(resolve)) })
    assert.match(validation, /scheduled start time has passed/)
  } finally { Swal.fire = originalFire; Swal.update = originalUpdate; Swal.showValidationMessage = originalValidation; Date.now = originalNow; if (renderer) act(() => renderer.unmount()) }
})

test('a server-confirmed expired meeting is reported even when the device clock is behind', async () => {
  const originalFire = Swal.fire, originalUpdate = Swal.update, originalValidation = Swal.showValidationMessage, originalNow = Date.now
  let validation = ''
  let renderer!: ReactTestRenderer
  Date.now = () => Date.parse('2030-10-07T01:00:00Z')
  Swal.update = (() => {}) as typeof Swal.update
  Swal.showValidationMessage = ((message: string) => { validation = message }) as typeof Swal.showValidationMessage
  Swal.fire = (async (options: { preConfirm: (scope: string) => Promise<unknown> }) => { await options.preConfirm('occurrence'); return { isConfirmed: false } }) as typeof Swal.fire
  try {
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={{ ...event, owner_user_id: 'owner', start_datetime: '2030-10-07T02:00:00Z' }} details={details}
      currentUserId="member" onCheckJoinTime={async () => Date.now()} onJoin={async () => { throw { message: 'meeting_join_start_passed' } }} canEdit={false} canViewDeliveryStatus={false} busy={false}
      onClose={() => {}} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    await act(async () => { renderer.root.findAllByType('button').find((button) => button.children.includes('Join this meeting'))!.props.onClick(); await new Promise(resolve => setImmediate(resolve)) })
    assert.match(validation, /scheduled start time has passed/)
  } finally { Swal.fire = originalFire; Swal.update = originalUpdate; Swal.showValidationMessage = originalValidation; Date.now = originalNow; if (renderer) act(() => renderer.unmount()) }
})

test('a fast device clock does not prevent joining a future meeting on server time', async () => {
  const originalFire = Swal.fire, originalNow = Date.now
  let options: { input?: string; text?: string } = {}
  let renderer!: ReactTestRenderer
  Date.now = () => Date.parse('2030-10-08T00:00:00Z')
  Swal.fire = (async (value: unknown) => { options = value as typeof options; return { isConfirmed: false } }) as typeof Swal.fire
  try {
    act(() => { renderer = create(<LanguageProvider><EventDialog open event={{ ...event, owner_user_id: 'owner', start_datetime: '2030-10-07T02:00:00Z' }} details={details}
      currentUserId="member" onCheckJoinTime={async () => Date.parse('2030-10-07T01:00:00Z')} onJoin={async () => true} canEdit={false} canViewDeliveryStatus={false} busy={false}
      onClose={() => {}} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
    await act(async () => { renderer.root.findAllByType('button').find((button) => button.children.includes('Join this meeting'))!.props.onClick(); await new Promise(resolve => setImmediate(resolve)) })
    assert.match(options.text!, /Confirm attendance/)
  } finally { Swal.fire = originalFire; Date.now = originalNow; if (renderer) act(() => renderer.unmount()) }
})
function dialog(connected: boolean, onSave: (draft: EventDraft) => Promise<void | { warning: string }> = noop, open = true, savedEvent: typeof event | null = event, checkMobileRecipients?: (emails: string[]) => Promise<boolean>, canDelete = true) {
  return <LanguageProvider><EventDialog open={open} event={savedEvent} details={details}
    hasConnectedDevices={connected} checkMobileRecipients={checkMobileRecipients} canEdit canDelete={canDelete} canViewDeliveryStatus={false} busy={false}
    onClose={() => {}} onSave={onSave} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>
}

test('Admin editing enables meeting fields and quiet save while deletion remains in the Admin workflow', async () => {
  let renderer!: ReactTestRenderer
  let saved: EventDraft | undefined
  const original = { ...event, owner_user_id: 'original-creator', creator_name: 'Original creator' }
  try {
    act(() => { renderer = create(dialog(true, async draft => { saved = draft }, true, original, undefined, false)) })
    assert.ok(renderer.root.findAllByType('fieldset').every(node => !node.props.disabled))
    assert.equal(renderer.root.findAllByType('button').some(node => node.children.includes('Delete')), false)
    const title = renderer.root.findByProps({ id: 'title' })
    act(() => title.props.onChange({ target: { value: 'Admin updated title' } }))
    await act(async () => renderer.root.findByType(SaveActionMenu).props.onSave(false))
    assert.equal(saved?.title, 'Admin updated title')
    assert.equal(original.owner_user_id, 'original-creator')
    assert.equal(original.creator_name, 'Original creator')
    assert.equal(saved?.notifyLine, true)
  } finally { if (renderer) act(() => renderer.unmount()) }
})
function checkbox(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('label').find((node) => node.findAll((child) =>
    child.children.some((text) => typeof text === 'string' && text.includes(label))).length > 0)!.findByType('input')
}

test('reopening a saved meeting retains both channels after its scheduled reminders are gone', () => {
  let renderer!: ReactTestRenderer
  act(() => { renderer = create(dialog(true)) })
  assert.equal(checkbox(renderer, 'Gmail / Email').props.checked, true)
  assert.equal(checkbox(renderer, 'Mobile notification').props.checked, true)
  act(() => renderer.unmount())
})

test('employee attendee tab shows affiliation and selecting an employee preserves the guest email contract', async () => {
  let renderer!: ReactTestRenderer
  let saved: EventDraft | undefined
  const employee = { id: 'employee-1', full_name: 'PEA Employee', email: 'employee@gmail.com', organization_unit: 'กบง.', department: 'ผสอ.', status: 'active' } as Database['public']['Tables']['profiles']['Row']
  act(() => { renderer = create(<LanguageProvider><EventDialog open event={event} details={details} profiles={[employee]} canEdit canViewDeliveryStatus={false} busy={false} onClose={() => {}} onSave={async (draft) => { saved = draft }} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
  try {
    const employeeTab = renderer.root.findAllByProps({ role: 'tab' }).find((node) => node.children.includes('Employees'))!
    act(() => employeeTab.props.onClick())
    assert.ok(renderer.root.findAllByType('span').some((node) => node.children.includes('กบง. · ผสอ.')))
    const employeeCheckbox = renderer.root.findAllByProps({ role: 'tabpanel' }).find((node) => node.findAllByType('input').some((input) => input.props.type === 'checkbox'))?.findByType('input')
    assert.ok(employeeCheckbox)
    act(() => employeeCheckbox!.props.onChange({ target: { checked: true } }))
    await act(async () => renderer.root.findByType(SaveActionMenu).props.onSave(false))
    assert.ok(saved?.guestEmails.includes('employee@gmail.com'))
  } finally { act(() => renderer.unmount()) }
})

test('a saved meeting with an incomplete follow-up passes its warning to the save menu', async () => {
  let renderer!: ReactTestRenderer
  const warning = 'Meeting saved; the mobile message has not been confirmed.'
  act(() => { renderer = create(dialog(true, async () => ({ warning }))) })
  let result: unknown
  await act(async () => { result = await renderer.root.findByType(SaveActionMenu).props.onSave(true) })
  assert.deepEqual(result, { warning })
  act(() => renderer.unmount())
})

test('the save menu shows a partial-save warning and closes without claiming recipients were notified', async () => {
  let renderer!: ReactTestRenderer
  let completed = false
  const warning = 'Meeting saved; the mobile message has not been confirmed.'
  const shown: Array<{ icon?: string; text?: string; timer?: number; showConfirmButton?: boolean }> = []
  const originalFire = Swal.fire
  Swal.fire = (async (options: unknown) => {
    if (typeof options === 'object' && options) shown.push(options)
    return { isConfirmed: true, isDenied: shown.length === 1, isDismissed: false }
  }) as typeof Swal.fire
  try {
    act(() => {
      renderer = create(<LanguageProvider><SaveActionMenu busy={false}
        onSave={async () => ({ warning })} onComplete={() => { completed = true }} /></LanguageProvider>)
    })
    await act(async () => {
      renderer.root.findByType('button').props.onClick()
      await new Promise((resolve) => setImmediate(resolve))
    })
    assert.equal(shown[1].icon, 'warning')
    assert.equal(shown[1].text, warning)
    assert.equal(shown[1].showConfirmButton, true)
    assert.equal(shown[1].timer, undefined)
    assert.equal(completed, true)
  } finally {
    Swal.fire = originalFire
    if (renderer) act(() => renderer.unmount())
  }
})

test('mobile checkbox requires a paired organizer or attendee and retains saved preferences', async () => {
  let renderer!: ReactTestRenderer
  const check = async () => true
  act(() => { renderer = create(dialog(false)) })
  assert.equal(checkbox(renderer, 'Mobile notification').props.disabled, true)
  assert.equal(checkbox(renderer, 'Mobile notification').props.checked, true)
  await act(async () => {
    renderer.update(dialog(false, noop, true, event, check))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)) })
  assert.equal(checkbox(renderer, 'Mobile notification').props.disabled, false)
  act(() => { renderer.update(dialog(false)); renderer.unmount() })
})

test('removing a paired attendee disables mobile selection again', async () => {
  let renderer!: ReactTestRenderer
  const check = async (emails: string[]) => emails.includes('attendee@gmail.com')
  act(() => { renderer = create(dialog(false, noop, true, event, check)) })
  const guest = renderer.root.findAllByType('input').find((node) => node.props.type === 'email')!
  act(() => guest.props.onChange({ target: { value: 'attendee@gmail.com' } }))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)) })
  assert.equal(checkbox(renderer, 'Mobile notification').props.disabled, false)
  act(() => guest.props.onChange({ target: { value: '' } }))
  assert.equal(checkbox(renderer, 'Mobile notification').props.disabled, true)
  act(() => renderer.unmount())
})

test('a delayed device query does not clear the saved mobile checkbox or later user edits', () => {
  let renderer!: ReactTestRenderer
  act(() => { renderer = create(dialog(false)) })
  act(() => renderer.update(dialog(true)))
  assert.equal(checkbox(renderer, 'Mobile notification').props.checked, true)
  act(() => checkbox(renderer, 'Mobile notification').props.onChange({ target: { checked: false } }))
  act(() => renderer.update(dialog(false)))
  act(() => renderer.update(dialog(true)))
  assert.equal(checkbox(renderer, 'Mobile notification').props.checked, false)
  act(() => renderer.unmount())
})

test('saving other meeting changes while no device is connected preserves the chosen channels', async () => {
  let saved: EventDraft | undefined
  let renderer!: ReactTestRenderer
  act(() => { renderer = create(dialog(false, async (draft) => { saved = draft })) })
  await act(async () => { await renderer.root.findByType(SaveActionMenu).props.onSave(false) })
  assert.equal(saved?.notifyEmail, true)
  assert.equal(saved?.notifyLine, true)
  act(() => renderer.unmount())
})

test('explicitly disabled channels stay disabled when the meeting is reopened', () => {
  let renderer!: ReactTestRenderer
  const disabled = { ...event, email_notifications_enabled: false, mobile_notifications_enabled: false }
  act(() => { renderer = create(dialog(true, noop, true, disabled)) })
  assert.equal(checkbox(renderer, 'Gmail / Email').props.checked, false)
  assert.equal(checkbox(renderer, 'Mobile notification').props.checked, false)
  act(() => renderer.unmount())
})

test('the recurrence preview includes the off-pattern start in the total of four appointments', () => {
  let renderer!: ReactTestRenderer
  const recurring = { ...event, start_datetime: '2026-10-03T02:00:00.000Z', recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU,WE', recurrence_count: 4 }
  act(() => { renderer = create(dialog(true, noop, true, recurring)) })
  const preview = renderer.root.findByProps({ 'aria-label': 'Appointment date preview' })
  assert.deepEqual(preview.findAllByType('li').map((row) => row.children.join('')), ['1. 03/10/2026', '2. 06/10/2026', '3. 07/10/2026', '4. 13/10/2026'])
  act(() => renderer.unmount())
})

test('new weekly Meetings offer one to four weeks in a readable touch dropdown', () => {
  let renderer!: ReactTestRenderer
  act(() => { renderer = create(dialog(true, noop, true, null)) })
  act(() => renderer.root.findByProps({ id: 'recurrence-frequency' }).props.onChange({ target: { value: 'week' } }))
  const interval = renderer.root.findByProps({ id: 'meeting-week-interval' })
  assert.deepEqual(interval.findAllByType('option').map((option) => option.props.value), [1, 2, 3, 4])
  assert.match(interval.props.className, /min-h-11/)
  assert.match(interval.props.className, /w-full/)
  act(() => renderer.unmount())
})

test('an unsupported weekly interval is rejected unless it is the original saved value', async () => {
  let renderer!: ReactTestRenderer
  let saved = false
  act(() => { renderer = create(dialog(true, async () => { saved = true }, true, { ...event, recurrence_rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR' })) })
  act(() => renderer.root.findByProps({ id: 'meeting-week-interval' }).props.onChange({ target: { value: '5' } }))
  let result: unknown
  await act(async () => { result = await renderer.root.findByType(SaveActionMenu).props.onSave(false) })
  assert.equal(result, false)
  assert.equal(saved, false)
  assert.match(renderer.root.findByProps({ role: 'alert' }).children.join(''), /available weekly repeat interval/)
  act(() => renderer.unmount())
})

test('an existing longer weekly interval remains visible and savable or can change to four weeks', async () => {
  let renderer!: ReactTestRenderer
  let saved: EventDraft | undefined
  const legacy = { ...event, recurrence_rule: 'FREQ=WEEKLY;INTERVAL=12;BYDAY=WE,FR' }
  act(() => { renderer = create(dialog(true, async (draft) => { saved = draft }, true, legacy)) })
  const interval = renderer.root.findByProps({ id: 'meeting-week-interval' })
  assert.equal(interval.props.value, 12)
  assert.deepEqual(interval.findAllByType('option').map((option) => option.props.value), [1, 2, 3, 4, 12])
  assert.match(interval.findAllByType('option')[4].children.join(''), /saved value/)
  await act(async () => { await renderer.root.findByType(SaveActionMenu).props.onSave(false) })
  assert.equal(saved?.recurrence.interval, 12)
  act(() => interval.props.onChange({ target: { value: '4' } }))
  await act(async () => { await renderer.root.findByType(SaveActionMenu).props.onSave(false) })
  assert.equal(saved?.recurrence.interval, 4)
  act(() => renderer.unmount())
})

test('switching a long monthly recurrence to weekly does not carry over an unsupported interval', () => {
  let renderer!: ReactTestRenderer
  act(() => { renderer = create(dialog(true, noop, true, { ...event, recurrence_rule: 'FREQ=MONTHLY;INTERVAL=12' })) })
  act(() => renderer.root.findByProps({ id: 'recurrence-frequency' }).props.onChange({ target: { value: 'week' } }))
  const interval = renderer.root.findByProps({ id: 'meeting-week-interval' })
  assert.equal(interval.props.value, 1)
  assert.deepEqual(interval.findAllByType('option').map((option) => option.props.value), [1, 2, 3, 4])
  act(() => renderer.unmount())
})

test('a saved longer weekly interval can be restored after switching recurrence frequency', () => {
  let renderer!: ReactTestRenderer
  act(() => { renderer = create(dialog(true, noop, true, { ...event, recurrence_rule: 'FREQ=WEEKLY;INTERVAL=12;BYDAY=FR' })) })
  const frequency = renderer.root.findByProps({ id: 'recurrence-frequency' })
  act(() => frequency.props.onChange({ target: { value: 'month' } }))
  act(() => frequency.props.onChange({ target: { value: 'week' } }))
  assert.equal(renderer.root.findByProps({ id: 'meeting-week-interval' }).props.value, 12)
  act(() => renderer.unmount())
})

test('the biweekly preview uses shared calendar weeks for a Friday start and Wednesday-Friday selection', () => {
  let renderer!: ReactTestRenderer
  const recurring = { ...event, start_datetime: '2026-10-16T02:00:00.000Z', recurrence_rule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,FR', recurrence_until: '2026-11-30T16:59:59.999Z' }
  act(() => { renderer = create(dialog(true, noop, true, recurring)) })
  const preview = renderer.root.findByProps({ 'aria-label': 'Appointment date preview' })
  assert.deepEqual(preview.findAllByType('li').map((row) => row.children.join('')), ['1. 16/10/2026', '2. 28/10/2026', '3. 30/10/2026', '4. 11/11/2026'])
  act(() => renderer.unmount())
})

test('deleting or moving a selected occurrence uses its scope and chosen destination date', async () => {
  let renderer!: ReactTestRenderer
  let deleted: string | undefined
  let moved: string | undefined
  const recurring = { ...event, recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU,WE', recurrence_count: 4 }
  act(() => { renderer = create(<LanguageProvider><EventDialog open event={recurring}
    details={{ ...details, occurrenceId: 'selected-occurrence' }} occurrenceStart="2030-10-07T02:00:00.000Z"
    hasConnectedDevices canEdit canViewDeliveryStatus={false} busy={false}
    onClose={() => {}} onSave={noop} onDelete={async (scope) => { deleted = scope }}
    onMoveOccurrence={async (_draft, date) => { moved = date }} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
  act(() => renderer.root.findAllByType('input').filter((input) => input.props.name === 'event-edit-scope')[1].props.onChange())
  const button = (label: string) => renderer.root.findAllByType('button').find((node) => node.children.includes(label))!
  await act(async () => { await button('Delete this appointment only').props.onClick() })
  assert.equal(deleted, 'occurrence')
  assert.equal(button('Move and create a new meeting').props.disabled, true)
  act(() => renderer.root.findByProps({ id: 'move-occurrence-date' }).props.onChange({ target: { value: '2030-10-08' } }))
  await act(async () => { await button('Move and create a new meeting').props.onClick() })
  assert.equal(moved, '2030-10-08')
  act(() => renderer.unmount())
})

test('a pending date move blocks normal saves and form submission until it is cancelled', async () => {
  let renderer!: ReactTestRenderer
  const saved: Array<{ draft: EventDraft; scope: string }> = []
  let moves = 0
  const recurring = { ...event, recurrence_rule: 'FREQ=WEEKLY;BYDAY=TU,WE', recurrence_count: 4 }
  act(() => { renderer = create(<LanguageProvider><EventDialog open event={recurring}
    details={{ ...details, occurrenceId: 'selected-occurrence' }} occurrenceStart="2030-10-07T02:00:00.000Z"
    hasConnectedDevices canEdit canViewDeliveryStatus={false} busy={false}
    onClose={() => {}} onSave={async (draft, _notify, scope) => { saved.push({ draft, scope }) }} onDelete={noop}
    onMoveOccurrence={async () => { moves++ }} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>) })
  try {
    act(() => renderer.root.findAllByType('input').filter((input) => input.props.name === 'event-edit-scope')[1].props.onChange())
    const moveInput = () => renderer.root.findByProps({ id: 'move-occurrence-date' })
    const saveMenu = () => renderer.root.findByType(SaveActionMenu)
    act(() => moveInput().props.onChange({ target: { value: '2030-10-08' } }))
    assert.equal(saveMenu().props.disabled, true)
    assert.equal(saveMenu().findByType('button').props.disabled, true)
    assert.match(renderer.root.findByProps({ role: 'status' }).children.join(''), /date has not been moved/)
    await act(async () => { assert.equal(await saveMenu().props.onSave(false), false) })
    await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    assert.equal(saved.length, 0)
    assert.equal(moves, 0)

    const cancel = renderer.root.findAllByType('button').find((button) => button.children.includes('Cancel date move'))!
    act(() => cancel.props.onClick())
    assert.equal(moveInput().props.value, '')
    assert.equal(saveMenu().props.disabled, false)
    await act(async () => { assert.equal(await saveMenu().props.onSave(false), true) })
    assert.equal(saved.length, 1)
    assert.equal(saved[0].scope, 'occurrence')
    assert.equal(moves, 0)

    act(() => moveInput().props.onChange({ target: { value: '2030-10-08' } }))
    act(() => renderer.root.findAllByType('input').filter((input) => input.props.name === 'event-edit-scope')[0].props.onChange())
    assert.equal(saveMenu().props.disabled, false)
    act(() => renderer.root.findAllByType('input').filter((input) => input.props.name === 'event-edit-scope')[1].props.onChange())
    assert.equal(moveInput().props.value, '')
    assert.equal(saveMenu().props.disabled, false)
  } finally {
    act(() => renderer.unmount())
  }
})

test('meeting completion button is compact with tooltip and handles appointment timing properly', async () => {
  let toggled = 0
  const onToggle = async () => { toggled++ }

  // 1. Future meeting (event start in 2030)
  const futureEvent = { ...event, start_datetime: '2030-10-03T09:00:00.000Z' }
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(
      <LanguageProvider>
        <EventDialog
          open
          event={futureEvent}
          details={details}
          canEdit={true}
          canViewDeliveryStatus={false}
          busy={false}
          onToggleCompleteMeeting={onToggle}
          onClose={noop}
          onSave={noop}
          onDelete={noop}
          onDeleteAttachment={noop}
          onRetryNotification={noop}
        />
      </LanguageProvider>
    )
  })

  const completeButton = () => renderer.root.findAllByType('button').find((btn) => btn.children.includes('Mark meeting complete'))!
  assert.ok(completeButton(), 'Complete button should be rendered')
  assert.equal(completeButton().props['aria-disabled'], true, 'Complete button aria-disabled must be true for future meeting')
  assert.equal(completeButton().props.title, 'Cannot complete a meeting before its scheduled appointment time.')
  // Compact layout: No inline text cluttering the button row
  assert.equal(renderer.root.findAllByType('span').some((span) => span.children.includes('Appointment not reached yet')), false)
  // Clicking calls onToggle (which in CalendarPage shows warning popup before start time)
  await act(async () => { completeButton().props.onClick() })
  assert.equal(toggled, 1)
  act(() => renderer.unmount())

  // 2. Past non-recurring meeting (event start in 2020)
  const pastEvent = { ...event, start_datetime: '2020-10-03T09:00:00.000Z' }
  act(() => {
    renderer = create(
      <LanguageProvider>
        <EventDialog
          open
          event={pastEvent}
          details={details}
          canEdit={true}
          canViewDeliveryStatus={false}
          busy={false}
          onToggleCompleteMeeting={onToggle}
          onClose={noop}
          onSave={noop}
          onDelete={noop}
          onDeleteAttachment={noop}
          onRetryNotification={noop}
        />
      </LanguageProvider>
    )
  })
  assert.equal(completeButton().props['aria-disabled'], false, 'Complete button must not be aria-disabled for past meeting')
  assert.equal(completeButton().props.title, 'Mark meeting complete')
  await act(async () => { completeButton().props.onClick() })
  assert.equal(toggled, 2)
  act(() => renderer.unmount())

  // 3. Past recurring meeting (event has recurrence_rule)
  const recurringPastEvent = { ...event, recurrence_rule: 'FREQ=DAILY', start_datetime: '2020-10-03T09:00:00.000Z' }
  act(() => {
    renderer = create(
      <LanguageProvider>
        <EventDialog
          open
          event={recurringPastEvent}
          occurrenceStart="2020-10-03T09:00:00.000Z"
          details={details}
          canEdit={true}
          canViewDeliveryStatus={false}
          busy={false}
          onToggleCompleteMeeting={onToggle}
          onClose={noop}
          onSave={noop}
          onDelete={noop}
          onDeleteAttachment={noop}
          onRetryNotification={noop}
        />
      </LanguageProvider>
    )
  })
  assert.equal(completeButton().props['aria-disabled'], false)
  assert.equal(completeButton().props.title, 'Mark this occurrence complete (this occurrence only)')
  act(() => renderer.unmount())

  // 4. Already completed meeting can be reopened
  act(() => {
    renderer = create(
      <LanguageProvider>
        <EventDialog
          open
          event={futureEvent}
          details={details}
          canEdit={true}
          canViewDeliveryStatus={false}
          busy={false}
          isOccurrenceCompleted={true}
          onToggleCompleteMeeting={onToggle}
          onClose={noop}
          onSave={noop}
          onDelete={noop}
          onDeleteAttachment={noop}
          onRetryNotification={noop}
        />
      </LanguageProvider>
    )
  })
  const reopenButton = renderer.root.findAllByType('button').find((btn) => btn.children.includes('Reopen meeting'))!
  assert.ok(reopenButton, 'Reopen button should be rendered')
  assert.equal(reopenButton.props['aria-disabled'], false, 'Reopen button should not be aria-disabled')
  act(() => renderer.unmount())
})

test('creating a new meeting with notification channels enabled but no reminder time buttons warns and blocks save', async () => {
  let renderer!: ReactTestRenderer
  let saved = false
  const originalFire = Swal.fire
  let popupTitle = ''
  let popupText = ''
  Swal.fire = (async (options: { title?: string; text?: string }) => {
    popupTitle = options.title ?? ''
    popupText = options.text ?? ''
    return { isConfirmed: true }
  }) as typeof Swal.fire

  try {
    act(() => {
      renderer = create(
        <LanguageProvider>
          <EventDialog
            open
            event={null}
            selectedDate="2035-10-15"
            canEdit
            canViewDeliveryStatus={false}
            busy={false}
            onClose={() => {}}
            onSave={async () => {
              saved = true
            }}
            onDelete={noop}
            onDeleteAttachment={noop}
            onRetryNotification={noop}
          />
        </LanguageProvider>
      )
    })

    // Fill title
    const titleInput = renderer.root.findByProps({ id: 'title' })
    act(() => titleInput.props.onChange({ target: { value: 'New Test Meeting' } }))
    act(() => renderer.root.findByProps({ id: 'event-grc-category' }).props.onChange({ target: { value: 'S001' } }))
    act(() => renderer.root.findByProps({ id: 'event-committee' }).props.onChange({ target: { value: 'C001' } }))

    // Uncheck/toggle off all reminder checkboxes so reminderKeys becomes empty
    const checkedReminders = renderer.root
      .findAllByType('input')
      .filter((input) => input.props.type === 'checkbox' && input.props.checked && input.props.className === 'sr-only')
    for (const input of checkedReminders) {
      act(() => input.props.onChange({ target: { checked: false } }))
    }

    // Attempt to submit form / save
    await act(async () => {
      renderer.root.findByType('form').props.onSubmit({ preventDefault: () => {} })
      await new Promise((resolve) => setImmediate(resolve))
    })

    // Assert that saving was blocked and warning popup was triggered
    assert.equal(saved, false, 'Meeting should not be saved when reminder times are missing')
    assert.equal(popupTitle, 'Reminder time not selected')
    assert.match(popupText, /Notification channel selected/)
  } finally {
    Swal.fire = originalFire
    if (renderer) act(() => renderer.unmount())
  }
})

test('creating a new meeting with reminder times selected but no notification channels warns and blocks save with channel message', async () => {
  let renderer!: ReactTestRenderer
  let saved = false
  const originalFire = Swal.fire
  let popupTitle = ''
  let popupText = ''
  Swal.fire = (async (options: { title?: string; text?: string }) => {
    popupTitle = options.title ?? ''
    popupText = options.text ?? ''
    return { isConfirmed: true }
  }) as typeof Swal.fire

  try {
    act(() => {
      renderer = create(
        <LanguageProvider>
          <EventDialog
            open
            event={null}
            selectedDate="2035-10-15"
            canEdit
            canViewDeliveryStatus={false}
            busy={false}
            onClose={() => {}}
            onSave={async () => {
              saved = true
            }}
            onDelete={noop}
            onDeleteAttachment={noop}
            onRetryNotification={noop}
          />
        </LanguageProvider>
      )
    })

    const titleInput = renderer.root.findByProps({ id: 'title' })
    act(() => titleInput.props.onChange({ target: { value: 'New Test Meeting' } }))
    act(() => renderer.root.findByProps({ id: 'event-grc-category' }).props.onChange({ target: { value: 'S001' } }))
    act(() => renderer.root.findByProps({ id: 'event-committee' }).props.onChange({ target: { value: 'C001' } }))

    // Uncheck email and line notifications
    act(() => checkbox(renderer, 'Gmail / Email').props.onChange({ target: { checked: false } }))
    act(() => checkbox(renderer, 'Mobile notification').props.onChange({ target: { checked: false } }))

    // Attempt to save
    await act(async () => {
      renderer.root.findByType('form').props.onSubmit({ preventDefault: () => {} })
      await new Promise((resolve) => setImmediate(resolve))
    })

    assert.equal(saved, false, 'Meeting should not be saved when channels are missing')
    assert.equal(popupTitle, 'Notification channel not selected')
    assert.match(popupText, /Choose at least 1 notification channel/)
  } finally {
    Swal.fire = originalFire
    if (renderer) act(() => renderer.unmount())
  }
})

test('meeting tabs switch between details and rich text summary editor with toolbar', async () => {
  let renderer!: ReactTestRenderer
  try {
    act(() => {
      renderer = create(
        <LanguageProvider>
          <EventDialog
            open
            event={event}
            details={details}
            canEdit={true}
            canViewDeliveryStatus={false}
            busy={false}
            onClose={noop}
            onSave={noop}
            onDelete={noop}
            onDeleteAttachment={noop}
            onRetryNotification={noop}
          />
        </LanguageProvider>
      )
    })

    const detailsTab = renderer.root.findByProps({ id: 'tab-meeting-details' })
    const summaryTab = renderer.root.findByProps({ id: 'tab-meeting-summary' })
    assert.equal(detailsTab.props['aria-selected'], true)
    assert.equal(summaryTab.props['aria-selected'], false)

    // Switch to summary tab
    act(() => { summaryTab.props.onClick() })
    assert.equal(detailsTab.props['aria-selected'], false)
    assert.equal(summaryTab.props['aria-selected'], true)

    // Verify rich text editor and toolbar buttons
    const editor = renderer.root.findByProps({ id: 'meeting-summary-editor' })
    assert.ok(editor)
    assert.equal(editor.props.contentEditable, true)

    const boldBtn = renderer.root.findByProps({ 'aria-label': 'Bold' })
    const italicBtn = renderer.root.findByProps({ 'aria-label': 'Italic' })
    const underlineBtn = renderer.root.findByProps({ 'aria-label': 'Underline' })
    const bulletListBtn = renderer.root.findByProps({ 'aria-label': 'Bullet list' })
    const numListBtn = renderer.root.findByProps({ 'aria-label': 'Numbered list' })
    assert.ok(boldBtn)
    assert.ok(italicBtn)
    assert.ok(underlineBtn)
    assert.ok(bulletListBtn)
    assert.ok(numListBtn)

    const clearFormatBtn = renderer.root.findByProps({ 'aria-label': 'Clear formatting' })
    const undoBtn = renderer.root.findByProps({ 'aria-label': 'Undo' })
    const redoBtn = renderer.root.findByProps({ 'aria-label': 'Redo' })
    assert.ok(clearFormatBtn)
    assert.ok(undoBtn)
    assert.ok(redoBtn)

    // Verify keyboard shortcut handler
    let preventDefaultCalled = false
    act(() => {
      editor.props.onKeyDown({
        key: 'b',
        ctrlKey: true,
        preventDefault: () => { preventDefaultCalled = true },
      })
    })
    assert.equal(preventDefaultCalled, true)

    // Switch back to details tab
    act(() => { detailsTab.props.onClick() })
    assert.equal(detailsTab.props['aria-selected'], true)
    assert.equal(summaryTab.props['aria-selected'], false)
  } finally {
    if (renderer) act(() => renderer.unmount())
  }
})

test('meeting summary collapsible presentation starts collapsed (false) and toggles on circular button click', async () => {
  let renderer!: ReactTestRenderer
  try {
    act(() => {
      renderer = create(
        <LanguageProvider>
          <EventDialog
            open
            event={event}
            details={{ ...details, summaryHtml: '<p><strong>มติที่ประชุม:</strong> เห็นชอบตามเสนอ</p>' }}
            canEdit={true}
            canViewDeliveryStatus={false}
            busy={false}
            onClose={noop}
            onSave={noop}
            onDelete={noop}
            onDeleteAttachment={noop}
            onRetryNotification={noop}
          />
        </LanguageProvider>
      )
    })

    // Find circular toggle button
    const toggleBtn = renderer.root.findByProps({ id: 'toggle-meeting-summary-presentation' })
    assert.ok(toggleBtn)
    // Default must be false (collapsed / closed)
    assert.equal(toggleBtn.props['aria-expanded'], false)
    assert.equal(JSON.stringify(renderer.toJSON()).includes('มติที่ประชุม:'), false)

    // Click circular button to expand
    act(() => { toggleBtn.props.onClick() })
    assert.equal(toggleBtn.props['aria-expanded'], true)
    assert.equal(JSON.stringify(renderer.toJSON()).includes('มติที่ประชุม:'), true)

    // Click circular button to collapse again
    act(() => { toggleBtn.props.onClick() })
    assert.equal(toggleBtn.props['aria-expanded'], false)
    assert.equal(JSON.stringify(renderer.toJSON()).includes('มติที่ประชุม:'), false)
  } finally {
    if (renderer) act(() => renderer.unmount())
  }
})




