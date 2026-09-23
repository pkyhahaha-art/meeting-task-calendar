import { subDays, subMonths, subWeeks } from 'date-fns'

export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
export type ReminderKey = '0:minute' | '1:month' | '1:week' | '3:day' | '1:day'

export const reminderOptions: { key: ReminderKey; label: string }[] = [
  { key: '0:minute', label: 'ทันที' },
  { key: '1:month', label: '1 เดือนก่อน' },
  { key: '1:week', label: '1 สัปดาห์ก่อน' },
  { key: '3:day', label: '3 วันก่อน' },
  { key: '1:day', label: '1 วันก่อน' },
]

export const allowedAttachmentTypes = new Set([
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg', 'image/png',
])

export function parseGuestEmails(value: string | string[]) {
  const values = Array.isArray(value) ? value : value.split(/[\s,;]+/)
  return [...new Set(values.map((email) => email.trim().toLowerCase()).filter(Boolean))]
}

export function invalidGuestEmails(value: string | string[]) {
  return parseGuestEmails(value).filter((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
}

export function recurrenceRule(value: Recurrence) {
  const rules: Record<Recurrence, string | null> = {
    none: null,
    daily: 'FREQ=DAILY',
    weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    weekly: 'FREQ=WEEKLY',
    monthly: 'FREQ=MONTHLY',
    yearly: 'FREQ=YEARLY',
  }
  return rules[value]
}

export function recurrenceFromRule(rule: string | null): Recurrence {
  if (!rule) return 'none'
  if (rule.includes('BYDAY=MO,TU,WE,TH,FR')) return 'weekdays'
  if (rule.includes('FREQ=DAILY')) return 'daily'
  if (rule.includes('FREQ=WEEKLY')) return 'weekly'
  if (rule.includes('FREQ=MONTHLY')) return 'monthly'
  if (rule.includes('FREQ=YEARLY')) return 'yearly'
  return 'none'
}

export function reminderDate(start: Date, key: ReminderKey) {
  if (key === '0:minute') return start
  if (key === '1:month') return subMonths(start, 1)
  if (key === '1:week') return subWeeks(start, 1)
  return subDays(start, key === '3:day' ? 3 : 1)
}

export function bangkokDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value
  return `${read('year')}-${read('month')}-${read('day')}`
}

export function isPastBangkokDate(value: string, now = new Date()) {
  const selectedDate = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) && selectedDate < bangkokDate(now)
}

export function validateAttachments(files: File[], existingCount = 0) {
  if (existingCount + files.length > 5) return 'แนบไฟล์ได้ไม่เกิน 5 ไฟล์ต่อการประชุม'
  const tooLarge = files.find((file) => file.size > 10 * 1024 * 1024)
  if (tooLarge) return `ไฟล์ ${tooLarge.name} มีขนาดเกิน 10 MB`
  const invalid = files.find((file) => !allowedAttachmentTypes.has(file.type))
  if (invalid) return `ไม่รองรับไฟล์ ${invalid.name}`
  return ''
}
