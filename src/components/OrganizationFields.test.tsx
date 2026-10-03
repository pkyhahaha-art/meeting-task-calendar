import assert from 'node:assert/strict'
import test from 'node:test'
import { useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { OrganizationFields } from './OrganizationFields'
import { departmentsFor, organizationUnits, profileAffiliation, validOrganization } from '../lib/organization'
import { LanguageProvider } from '../i18n/LanguageProvider'
import { EventDialog, type EventDetails } from './EventDialog'
import { TaskDialog, type TaskDetails } from './TaskDialog'
import type { Database } from '../lib/database.types'

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'en' } })
const noop = async () => {}
function Selector() {
  const [value, setValue] = useState(['', ''])
  return <OrganizationFields idPrefix="test" unit={value[0]} department={value[1]} onChange={(unit, department) => setValue([unit, department])} />
}

test('department options follow each organization, clear on unit change, and disable before/no departments', () => {
  let renderer!: ReactTestRenderer
  act(() => { renderer = create(<Selector />) })
  const unit = () => renderer.root.findByProps({ id: 'test-unit' })
  const department = () => renderer.root.findByProps({ id: 'test-department' })
  assert.equal(department().props.disabled, true)
  for (const value of organizationUnits) {
    act(() => unit().props.onChange({ target: { value } }))
    assert.equal(department().props.value, '')
    assert.equal(department().props.disabled, departmentsFor(value).length === 0)
    assert.deepEqual(department().findAllByType('option').slice(1).map((node) => node.props.value), departmentsFor(value))
    if (departmentsFor(value).length) {
      act(() => department().props.onChange({ target: { value: departmentsFor(value)[0] } }))
      assert.equal(department().props.value, departmentsFor(value)[0])
    }
  }
  act(() => renderer.unmount())
})

test('profile affiliation handles all department pairs and preserves the empty legacy fallback', () => {
  assert.equal(profileAffiliation(null), '')
  assert.equal(profileAffiliation({ organization_unit: null, department: null }), '')
  assert.equal(profileAffiliation({ organization_unit: 'ประจำฝ่าย (ฝลส.)', department: null }), 'ฝลส.')
  assert.equal(profileAffiliation({ organization_unit: 'กกร.', department: null }), 'กกร. ฝลส.')
  for (const unit of organizationUnits) for (const department of departmentsFor(unit)) {
    assert.equal(validOrganization(unit, department), true)
    assert.equal(profileAffiliation({ organization_unit: unit, department }), `${department} ${unit} ฝลส.`)
  }
  assert.equal(profileAffiliation({ organization_unit: 'กคน.', department: 'ผสอ.' }), '')
})

const eventDetails: EventDetails = { guestEmails: [], occurrenceGuestEmails: [], guestAcknowledgements: {}, reminderKeys: [],
  attachments: [], occurrenceId: null, occurrenceOverride: null, hasOccurrenceChanges: false, notificationDeliveries: [], occurrenceReminders: [], occurrenceNotificationDeliveries: [] }
const taskDetails: TaskDetails = { reminderKeys: [], notifyEmail: true, notifyLine: false, attachments: [], documentLinks: [], internalRecipients: [], externalRecipients: [], notificationDeliveries: [], reminders: [], reminderNotificationDeliveries: [] }

for (const kind of ['meeting', 'task'] as const) {
  test(`${kind} fills a late profile without resetting other fields, respects manual changes, and preserves legacy items`, () => {
    let renderer!: ReactTestRenderer
    const dialog = (affiliation: string, saved = false, open = true) => <LanguageProvider>{kind === 'meeting'
      ? <EventDialog open={open} event={saved ? { id: 'legacy', affiliation: '', title: 'Saved', description: '', location: '', start_datetime: '2030-10-03T02:00:00Z', all_day: false } as Database['public']['Tables']['events']['Row'] : null}
        details={eventDetails} defaultAffiliation={affiliation} canEdit canViewDeliveryStatus={false} busy={false}
        onClose={() => {}} onSave={noop} onDelete={noop} onDeleteAttachment={noop} onRetryNotification={noop} />
      : <TaskDialog open={open} task={saved ? { id: 'legacy', affiliation: '', title: 'Saved', description: '', due_date: '2030-10-03', assignee_type: 'internal' } as Database['public']['Tables']['tasks']['Row'] : null}
        details={taskDetails} defaultAffiliation={affiliation} userId="self" profiles={[]} events={[]} canEdit canComplete={false} canAcknowledge={false} canViewDeliveryStatus={false} busy={false}
        onClose={() => {}} onSave={noop} onDelete={noop} onToggleComplete={noop} onAcknowledge={noop} onDeleteAttachment={noop} onRetryNotification={noop} />}</LanguageProvider>
    const field = () => renderer.root.findByProps({ id: kind === 'meeting' ? 'event-affiliation' : 'task-affiliation' })
    const title = () => renderer.root.findByProps({ id: kind === 'meeting' ? 'title' : 'task-name' })
    act(() => { renderer = create(dialog('')) })
    assert.equal(field().props.value, '')
    act(() => title().props.onChange({ target: { value: 'Unsaved draft' } }))
    act(() => renderer.update(dialog('ผคอ. กคน. ฝลส.')))
    assert.equal(field().props.value, 'ผคอ. กคน. ฝลส.')
    assert.equal(title().props.value, 'Unsaved draft')
    act(() => field().props.onChange({ target: { value: '' } }))
    act(() => renderer.update(dialog('ผปก. กคน. ฝลส.')))
    assert.equal(field().props.value, '')
    act(() => renderer.update(dialog('ผปก. กคน. ฝลส.', false, false)))
    act(() => renderer.update(dialog('ผปก. กคน. ฝลส.')))
    assert.equal(field().props.value, 'ผปก. กคน. ฝลส.')
    act(() => renderer.update(dialog('ผปก. กคน. ฝลส.', true)))
    assert.equal(field().props.value, '')
    assert.equal(title().props.value, 'Saved')
    act(() => renderer.unmount())
  })
}
