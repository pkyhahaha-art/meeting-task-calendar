import assert from 'node:assert/strict'
import test from 'node:test'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { LanguageProvider } from '../i18n/LanguageProvider'
import type { Database } from '../lib/database.types'
import { MeetingSummaryDialog } from './MeetingSummaryDialog'

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'th' } })

const mockMeeting: Database['public']['Tables']['events']['Row'] = {
  id: 'm-1',
  title: 'สตภ. มาสัมภาษณ์',
  description: 'สัมภาษณ์ระบบสารสนเทศ',
  location: 'ห้อง 2ศรีวิชัย',
  affiliation: 'กกร.',
  start_datetime: '2026-11-05T13:30:00+07:00',
  end_datetime: '2026-11-05T16:30:00+07:00',
  all_day: false,
  owner_user_id: 'u-1',
  creator_name: 'นายอลงกรณ์ สุเสาร์จัง',
  timezone: 'Asia/Bangkok',
  recurrence_rule: null,
  recurrence_until: null,
  recurrence_count: null,
  status: 'scheduled',
  deleted_at: null,
  notification_requested_at: null,
  initial_notification_requested_at: null,
  suppress_guest_notifications: false,
  mobile_notifications_enabled: false,
  email_notifications_enabled: false,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
}

test('MeetingSummaryDialog does not render when open is false', () => {
  let renderer: ReactTestRenderer | undefined
  act(() => {
    renderer = create(
      <LanguageProvider>
        <MeetingSummaryDialog
          open={false}
          onClose={() => {}}
          events={[mockMeeting]}
        />
      </LanguageProvider>
    )
  })
  assert.equal(renderer?.toJSON(), null)
})

test('MeetingSummaryDialog renders dialog with PEA theme header, checklist, and buttons when open is true', () => {
  let renderer: ReactTestRenderer | undefined
  act(() => {
    renderer = create(
      <LanguageProvider>
        <MeetingSummaryDialog
          open={true}
          onClose={() => {}}
          events={[mockMeeting]}
        />
      </LanguageProvider>
    )
  })

  const text = JSON.stringify(renderer?.toJSON())
  assert.ok(text.includes('สรุปการประชุม'), 'Should render title header')
  assert.ok(!text.includes('ผู้ครอบครองปฏิทิน'), 'Should not render owner section')
  assert.ok(!text.includes('หน่วยงานผู้รับผิดชอบ : -'), 'Should not render department section')
  assert.ok(text.includes('ดาวน์โหลด PNG'), 'Should render PNG button')
  assert.ok(text.includes('ดาวน์โหลด PDF'), 'Should render PDF button')
  assert.ok(text.includes('คัดลอกข้อความ'), 'Should render copy text button')
})

