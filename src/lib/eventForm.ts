import { subDays, subMonths, subWeeks } from 'date-fns'

export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
export type ReminderKey = '0:minute' | '1:month' | '1:week' | '3:day' | '1:day'
export type MeetingRecurrenceFrequency = 'none' | 'day' | 'week' | 'month' | 'year'
export type MeetingWeekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'
export type MeetingRecurrence = {
  frequency: MeetingRecurrenceFrequency
  interval: number
  weekdays: readonly MeetingWeekday[]
  until: string
  count: number | null
}

const weekdayCodes: MeetingWeekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

function recurrenceParts(rule: string | null) {
  return new Map((rule ?? '').split(';').map((part) => part.split('=', 2) as [string, string]))
}

export const weekdayThaiShort: Record<MeetingWeekday, string> = {
  SU: 'อา', MO: 'จ', TU: 'อ', WE: 'พ', TH: 'พฤ', FR: 'ศ', SA: 'ส',
}

export const weekdayThaiFull: Record<MeetingWeekday, string> = {
  SU: 'วันอาทิตย์', MO: 'วันจันทร์', TU: 'วันอังคาร', WE: 'วันพุธ', TH: 'วันพฤหัสบดี', FR: 'วันศุกร์', SA: 'วันเสาร์',
}

export const weekdayEnglishShort: Record<MeetingWeekday, string> = {
  SU: 'Sun', MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat',
}

export const weekdayEnglishFull: Record<MeetingWeekday, string> = {
  SU: 'Sunday', MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday',
}

export function meetingWeekdayForDate(date: string): MeetingWeekday {
  if (!date || typeof date !== 'string') return 'MO'
  const d = new Date(`${date.slice(0, 10)}T12:00:00+07:00`)
  if (Number.isNaN(d.getTime())) return 'MO'
  return weekdayCodes[d.getUTCDay()] ?? 'MO'
}

export function endOfYearBangkokDate(date: string): string {
  const year = (date || '').slice(0, 4) || new Date().getFullYear().toString()
  return `${year}-12-31`
}

export function meetingRecurrenceSummary(
  value: MeetingRecurrence,
  startDate: string,
  startTime?: string,
  endTime?: string,
  language: 'th' | 'en' = 'th',
): string {
  if (value.frequency === 'none') {
    return language === 'th' ? 'ไม่ทำซ้ำ (นัดหมายครั้งเดียว)' : 'Does not repeat (single meeting)'
  }

  const isTh = language === 'th'
  const timePart = startTime ? (isTh ? ` เวลา ${startTime}${endTime ? ` - ${endTime} น.` : ' น.'}` : ` at ${startTime}${endTime ? ` - ${endTime}` : ''}`) : ''
  let patternText = ''

  if (value.frequency === 'day') {
    patternText = value.interval === 1 ? (isTh ? 'ทุกวัน' : 'Daily') : (isTh ? `ทุก ๆ ${value.interval} วัน` : `Every ${value.interval} days`)
  } else if (value.frequency === 'week') {
    const isWeekdays = value.interval === 1 && value.weekdays.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every((d) => value.weekdays.includes(d as MeetingWeekday))
    const isAllDays = value.interval === 1 && value.weekdays.length === 7
    if (isAllDays) {
      patternText = isTh ? 'ทุกวัน (จันทร์ – อาทิตย์)' : 'Every day (Monday–Sunday)'
    } else if (isWeekdays) {
      patternText = isTh ? 'ทุกวันทำงาน (จันทร์ – ศุกร์)' : 'Every weekday (Monday–Friday)'
    } else {
      const dayNames = value.weekdays.map((d) => isTh ? weekdayThaiShort[d] : weekdayEnglishShort[d]).join(', ')
      if (value.interval === 1) {
        patternText = isTh ? `ทุกสัปดาห์ (วัน${dayNames})` : `Weekly on ${dayNames}`
      } else if (value.interval === 2) {
        patternText = isTh ? `ทุก 2 สัปดาห์ (วัน${dayNames})` : `Every 2 weeks on ${dayNames}`
      } else {
        patternText = isTh ? `ทุก ๆ ${value.interval} สัปดาห์ (วัน${dayNames})` : `Every ${value.interval} weeks on ${dayNames}`
      }
    }
  } else if (value.frequency === 'month') {
    const dayNumber = Number(startDate.slice(8, 10)) || 1
    if (value.interval === 1) {
      patternText = isTh ? `ทุกเดือน (ทุกวันที่ ${dayNumber} ของเดือน)` : `Monthly on day ${dayNumber}`
    } else {
      patternText = isTh ? `ทุก ๆ ${value.interval} เดือน (ทุกวันที่ ${dayNumber})` : `Every ${value.interval} months on day ${dayNumber}`
    }
  } else if (value.frequency === 'year') {
    if (value.interval === 1) {
      patternText = isTh ? `ทุกปี (ทุกวันที่ ${formatDisplayDate(startDate)})` : `Yearly on ${formatDisplayDate(startDate)}`
    } else {
      patternText = isTh ? `ทุก ๆ ${value.interval} ปี` : `Every ${value.interval} years`
    }
  }

  let endText = ''
  if (value.until) {
    endText = isTh ? ` จนถึงวันที่ ${formatDisplayDate(value.until)}` : ` until ${formatDisplayDate(value.until)}`
  } else if (value.count) {
    endText = isTh ? ` รวมทั้งหมด ${value.count} ครั้ง` : ` for ${value.count} times`
  } else {
    endText = isTh ? ' (สูงสุดไม่เกิน 1 ปี)' : ' (up to 1 year)'
  }

  return `${isTh ? 'ทำซ้ำ' : 'Repeats '}${patternText}${timePart}${endText}`
}

export function meetingRecurrenceFromRule(rule: string | null, startDate: string, until: string | null, count: number | null): MeetingRecurrence {
  const parts = recurrenceParts(rule)
  const frequency = ({ DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' } as const)[parts.get('FREQ') ?? ''] ?? 'none'
  const weekdays = parts.get('BYDAY')?.split(',').filter((value): value is MeetingWeekday => weekdayCodes.includes(value as MeetingWeekday))
  return {
    frequency,
    interval: Math.max(1, Number(parts.get('INTERVAL')) || 1),
    weekdays: frequency === 'week' ? (weekdays?.length ? weekdays : [meetingWeekdayForDate(startDate)]) : [],
    until: until?.slice(0, 10) ?? '',
    count: count && count > 0 ? count : null,
  }
}

export function meetingRecurrenceRule(value: MeetingRecurrence) {
  if (value.frequency === 'none') return null
  const frequency = ({ day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' } as const)[value.frequency]
  const parts = [`FREQ=${frequency}`]
  if (value.interval > 1) parts.push(`INTERVAL=${value.interval}`)
  if (value.frequency === 'week' && value.weekdays.length) parts.push(`BYDAY=${value.weekdays.join(',')}`)
  return parts.join(';')
}

export function meetingWeeklyIntervalOptions(existingRule: string | null = null) {
  const options = [1, 2, 3, 4]
  const parts = recurrenceParts(existingRule)
  const existingInterval = Number(parts.get('INTERVAL'))
  if (parts.get('FREQ') === 'WEEKLY' && Number.isInteger(existingInterval) && existingInterval > 4) {
    options.push(existingInterval)
  }
  return options
}

export const reminderOptions: { key: ReminderKey; label: string }[] = [
  { key: '0:minute', label: 'เมื่อถึงเวลานัด' },
  { key: '1:month', label: '1 เดือนก่อน' },
  { key: '1:week', label: '1 สัปดาห์ก่อน' },
  { key: '3:day', label: '3 วันก่อน' },
  { key: '1:day', label: '1 วันก่อน' },
]

type MeetingReminderRow = {
  occurrenceId: string | null
  offsetValue: number
  offsetUnit: string
}

export function meetingReminderKeysFromTemplates(rows: readonly MeetingReminderRow[]): ReminderKey[] {
  return [...new Set(rows
    .filter((row) => row.occurrenceId === null)
    .map((row) => `${row.offsetValue}:${row.offsetUnit}`)
    .filter((key): key is ReminderKey => reminderOptions.some((option) => option.key === key)))]
}

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

export function meetingReminderStatus(scheduledAt: Date, now = new Date()) {
  return scheduledAt.getTime() < now.getTime() ? 'cancelled' as const : 'scheduled' as const
}

export function pastMeetingReminderKeys(start: Date, keys: ReminderKey[], now = new Date()) {
  return keys.filter((key) => meetingReminderStatus(reminderDate(start, key), now) === 'cancelled')
}

export function isMeetingReminderKeyPast(start: Date, key: ReminderKey, now = new Date()): boolean {
  if (!start || Number.isNaN(start.getTime())) return false
  return meetingReminderStatus(reminderDate(start, key), now) === 'cancelled'
}

export function meetingReminderOptionLabel(key: ReminderKey, language: 'th' | 'en' = 'th'): string {
  const labels: Record<ReminderKey, { th: string; en: string }> = {
    '0:minute': { th: 'เมื่อถึงเวลานัด', en: 'At the meeting time' },
    '1:month': { th: '1 เดือนก่อน', en: '1 month before' },
    '1:week': { th: '1 สัปดาห์ก่อน', en: '1 week before' },
    '3:day': { th: '3 วันก่อน', en: '3 days before' },
    '1:day': { th: '1 วันก่อน', en: '1 day before' },
  }
  return labels[key]?.[language] || key
}

export function daysBetweenBangkokDates(startDate: string, endDate: string): number {
  const [y1, m1, d1] = startDate.split('-').map(Number)
  const [y2, m2, d2] = endDate.split('-').map(Number)
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return 0
  const t1 = Date.UTC(y1, m1 - 1, d1)
  const t2 = Date.UTC(y2, m2 - 1, d2)
  return Math.round((t2 - t1) / (24 * 60 * 60 * 1000))
}

export function bangkokDate(now = new Date()) {
  const safeDate = !now || Number.isNaN(now.getTime()) ? new Date() : now
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(safeDate)
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value
  return `${read('year')}-${read('month')}-${read('day')}`
}

export function isPastBangkokDate(value: string, now = new Date()) {
  const selectedDate = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) && selectedDate < bangkokDate(now)
}

export function formatDisplayDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}

export function parseDisplayDate(value: string) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim())
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function validateAttachments(files: File[], existingCount = 0) {
  if (existingCount + files.length > 5) return 'แนบไฟล์ได้ไม่เกิน 5 ไฟล์ต่อการประชุม'
  const tooLarge = files.find((file) => file.size > 10 * 1024 * 1024)
  if (tooLarge) return `ไฟล์ ${tooLarge.name} มีขนาดเกิน 10 MB`
  const invalid = files.find((file) => !allowedAttachmentTypes.has(file.type))
  if (invalid) return `ไม่รองรับไฟล์ ${invalid.name}`
  return ''
}
