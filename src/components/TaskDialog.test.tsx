import assert from 'node:assert/strict'
import test from 'node:test'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import Swal from 'sweetalert2'
import { LanguageProvider } from '../i18n/LanguageProvider'
import type { Database } from '../lib/database.types'
import { TaskDialog, type TaskDetails, type TaskDraft } from './TaskDialog'

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'en' } })
const task = {
  id: 'saved-task', title: 'Saved task', description: '', affiliation: '',
  due_date: '2099-10-07', due_time: '09:00:00', assignee_user_id: 'creator',
  creator_user_id: 'creator', external_assignee_email: null, linked_event_id: null, status: 'pending',
} as Database['public']['Tables']['tasks']['Row']
const details: TaskDetails = {
  reminderMode: 'single', reminderKeys: ['due'], notifyEmail: true, notifyLine: true,
  attachments: [], documentLinks: [], internalRecipients: [{ user_id: 'creator', acknowledged_at: null }],
  externalRecipients: [], notificationDeliveries: [], reminders: [], reminderNotificationDeliveries: [],
}
const noop = async () => {}
function dialog(connected: boolean, onSave: (draft: TaskDraft) => Promise<void> = noop, savedDetails = details, savedTask: typeof task | null = task) {
  return <LanguageProvider><TaskDialog open task={savedTask} details={savedTask ? savedDetails : undefined} userId="creator"
    profiles={[]} events={[]} canEdit canComplete canAcknowledge={false} canViewDeliveryStatus={false}
    hasConnectedDevices={connected} busy={false} onClose={() => {}} onSave={onSave}
    onDelete={noop} onToggleComplete={noop} onAcknowledge={noop} onDeleteAttachment={noop} onRetryNotification={noop} /></LanguageProvider>
}
function mobileCheckbox(renderer: ReactTestRenderer) {
  return renderer.root.findAllByType('label').find((node) => node.findAll((child) =>
    child.children.some((text) => typeof text === 'string' && text.includes('Mobile notification'))).length > 0)!.findByType('input')
}

test('a delayed device query preserves the saved mobile choice and subsequent edits', () => {
  let renderer!: ReactTestRenderer
  act(() => { renderer = create(dialog(false)) })
  assert.equal(mobileCheckbox(renderer).props.checked, true)
  assert.equal(mobileCheckbox(renderer).props.disabled, true)
  act(() => renderer.update(dialog(true)))
  assert.equal(mobileCheckbox(renderer).props.checked, true)
  assert.equal(mobileCheckbox(renderer).props.disabled, false)
  act(() => mobileCheckbox(renderer).props.onChange({ target: { checked: false } }))
  act(() => renderer.update(dialog(false)))
  act(() => renderer.update(dialog(true)))
  assert.equal(mobileCheckbox(renderer).props.checked, false)
  act(() => renderer.unmount())
})

test('a new task cannot enable mobile notifications while no device is connected', () => {
  let renderer!: ReactTestRenderer
  act(() => { renderer = create(dialog(false, noop, details, null)) })
  assert.equal(mobileCheckbox(renderer).props.checked, false)
  assert.equal(mobileCheckbox(renderer).props.disabled, true)
  act(() => renderer.unmount())
})

test('saving another task edit while device availability is unknown keeps mobile reminders enabled', async () => {
  let renderer!: ReactTestRenderer
  let saved: TaskDraft | undefined
  const originalFire = Swal.fire
  Swal.fire = (async () => ({ isConfirmed: true, isDenied: false, isDismissed: false })) as typeof Swal.fire
  try {
    act(() => { renderer = create(dialog(false, async (draft) => { saved = draft }, { ...details, notifyEmail: false })) })
    const save = renderer.root.findAllByType('button').find((node) => node.children.includes('Save'))!
    await act(async () => { save.props.onClick(); await new Promise((resolve) => setImmediate(resolve)) })
    assert.equal(saved?.notifyLine, true)
  } finally {
    Swal.fire = originalFire
    if (renderer) act(() => renderer.unmount())
  }
})
