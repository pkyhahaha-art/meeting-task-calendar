import assert from 'node:assert/strict'
import test from 'node:test'
import React, { useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { OrganizationFields } from './OrganizationFields'
import * as organization from '../lib/organization'
import { departmentsFor, memberOrganizationData, normalizeOrganizationUnit, organizationUnits, profileAffiliation, unspecifiedDepartment, validOrganization } from '../lib/organization'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
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
    assert.deepEqual(department().findAllByType('option').slice(1).map((node) => node.props.value), departmentsFor(value).length ? [unspecifiedDepartment, ...departmentsFor(value)] : [])
    if (!departmentsFor(value).length) assert.equal(department().findAllByType('option')[0].children[0], 'หน่วยงานนี้ไม่มีแผนก')
    if (departmentsFor(value).length) {
      act(() => department().props.onChange({ target: { value: unspecifiedDepartment } }))
      assert.equal(department().props.value, unspecifiedDepartment)
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
  assert.equal(profileAffiliation({ organization_unit: 'กกร.', department: null }), 'กกร. (Team-Based) ฝลส.')
  assert.equal(profileAffiliation({ organization_unit: 'กกก.', department: 'ผนผ.' }), 'ผนผ. กกท. ฝลส.')
  assert.equal(normalizeOrganizationUnit('กกก.'), 'กกท.')
  assert.equal(profileAffiliation({ organization_unit: 'กคน.', department: null }), 'กคน. ฝลส.')
  assert.equal(profileAffiliation({ organization_unit: 'กคน.', department: unspecifiedDepartment }), 'กคน. ฝลส.')
  for (const unit of organizationUnits) {
    assert.equal(validOrganization(unit, ''), true)
    assert.deepEqual(memberOrganizationData(unit, departmentsFor(unit).length ? unspecifiedDepartment : ''), { organization_unit: unit, department: null })
  }
  for (const unit of organizationUnits) for (const department of departmentsFor(unit)) {
    assert.equal(validOrganization(unit, department), true)
    assert.equal(profileAffiliation({ organization_unit: unit, department }), `${department} ${unit} ฝลส.`)
  }
  assert.equal(profileAffiliation({ organization_unit: 'กคน.', department: 'ผสอ.' }), '')
})

test('profile displays legacy names canonically, requires explicit department choice after unit change, and saves unspecified as null', async () => {
  const updates: unknown[] = []
  const profile = { id: 'fixture-member', organization_unit: 'กกก.', department: 'ผนผ.' }
  const mocks: Record<string, unknown> = {
    react: React,
    '../auth/AuthProvider': { useAuth: () => ({ profile, profileLoading: false, refreshProfile: async () => {} }) },
    '../i18n/LanguageProvider': { useLanguage: () => ({ text: (thai: string) => thai }) },
    '../lib/organization': organization,
    './OrganizationFields': { OrganizationFields },
    '../lib/supabase': { supabase: { from: () => ({ update: (payload: unknown) => {
      updates.push(payload); return { eq: () => ({ select: () => ({ single: async () => ({ data: { id: profile.id }, error: null }) }) }) }
    } }) } },
  }
  const exports: { ProfileOrganizationForm?: React.ComponentType } = {}
  const require = createRequire(import.meta.url)
  vm.runInContext(ts.transpileModule(readFileSync(new URL('./ProfileOrganizationForm.tsx', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
  vm.createContext({ exports, require: (name: string) => mocks[name] || require(name), console }))
  const Form = exports.ProfileOrganizationForm!
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<Form />) })
  try {
    assert.equal(renderer.root.findByProps({ id: 'profile-unit' }).props.value, 'กกท.')
    assert.equal(updates.length, 0)
    assert.equal(profile.organization_unit, 'กกก.')
    act(() => renderer.root.findByProps({ id: 'profile-unit' }).props.onChange({ target: { value: 'กคน.' } }))
    assert.equal(renderer.root.findByType('button').props.disabled, true)
    act(() => renderer.root.findByProps({ id: 'profile-department' }).props.onChange({ target: { value: unspecifiedDepartment } }))
    assert.equal(renderer.root.findByType('button').props.disabled, false)
    await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }) })
    assert.deepEqual(updates, [{ organization_unit: 'กคน.', department: null }])
    assert.equal(profile.organization_unit, 'กกก.')
  } finally { act(() => renderer.unmount()) }
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
