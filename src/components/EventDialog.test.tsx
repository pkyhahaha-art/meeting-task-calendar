import assert from 'node:assert/strict'
import test from 'node:test'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
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
function dialog(connected: boolean, onSave: (draft: EventDraft) => Promise<void> = noop, open = true, savedEvent = event) {
  return <LanguageProvider><EventDialog open={open} event={savedEvent} details={details}
    hasConnectedDevices={connected} canEdit canViewDeliveryStatus={false} busy={false}
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
