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
function dialog(connected: boolean, onSave: (draft: EventDraft) => Promise<void | { warning: string }> = noop, open = true, savedEvent = event, checkMobileRecipients?: (emails: string[]) => Promise<boolean>) {
  return <LanguageProvider><EventDialog open={open} event={savedEvent} details={details}
    hasConnectedDevices={connected} checkMobileRecipients={checkMobileRecipients} canEdit canViewDeliveryStatus={false} busy={false}
    onClose={() => {}} onSave={onSave} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>
}
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
