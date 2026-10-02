import { bangkokDate, isPastBangkokDate } from './eventForm'

export type TaskReminderKey = 'due' | '1_hour' | '1_day' | '3_days' | 'overdue' | 'continuous'
export type TaskReminderMode = 'single' | 'continuous'
export type TaskContinuousFrequency = 'daily' | 'weekdays'

export type TaskContinuousConfig = {
  startDaysBefore: number
  frequency: TaskContinuousFrequency
}

export const taskSingleReminderOptions: { key: TaskReminderKey; label: string }[] = [
  { key: 'due', label: 'ตรงเวลาครบกำหนด' },
  { key: '1_hour', label: 'ก่อน 1 ชั่วโมง' },
  { key: '1_day', label: 'ก่อน 1 วัน' },
  { key: '3_days', label: 'ก่อน 3 วัน' },
  { key: 'overdue', label: 'เมื่อเลยกำหนด' },
]

export const taskReminderOptions = taskSingleReminderOptions

export function taskDueDateTime(dueDate: string, dueTime: string) {
  return new Date(`${dueDate}T${dueTime || '09:00'}:00+07:00`)
}

export function isTaskOverdue(status: 'pending' | 'completed' | 'cancelled', dueDate: string, now = new Date()) {
  return status === 'pending' && isPastBangkokDate(dueDate, now)
}

export function calculateContinuousStartDate(dueDate: string, startDaysBefore: number): string {
  const [yearStr, monthStr, dayStr] = dueDate.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr) - 1
  const day = Number(dayStr)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return ''
  }

  const daysBefore = Math.max(1, Math.min(60, Math.round(startDaysBefore || 1)))
  const d = new Date(Date.UTC(year, month, day - daysBefore, 12, 0, 0))
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dt = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dt}`
}

export function daysBetweenBangkokDates(startDate: string, endDate: string): number {
  const [y1, m1, d1] = startDate.split('-').map(Number)
  const [y2, m2, d2] = endDate.split('-').map(Number)
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return 0
  const t1 = Date.UTC(y1, m1 - 1, d1)
  const t2 = Date.UTC(y2, m2 - 1, d2)
  return Math.round((t2 - t1) / (24 * 60 * 60 * 1000))
}

export function taskReminderDate(due: Date, key: TaskReminderKey) {
  if (key === '1_hour') return new Date(due.getTime() - 60 * 60 * 1000)
  if (key === '1_day') return new Date(due.getTime() - 24 * 60 * 60 * 1000)
  if (key === '3_days') return new Date(due.getTime() - 3 * 24 * 60 * 60 * 1000)

  if (key === 'overdue') {
    const bangkokTime = new Date(due.getTime() + 7 * 60 * 60 * 1000)
    return new Date(
      Date.UTC(
        bangkokTime.getUTCFullYear(),
        bangkokTime.getUTCMonth(),
        bangkokTime.getUTCDate() + 1,
        2,
      ),
    )
  }

  return new Date(due)
}

export function isTaskReminderKeyPast(dueDate: string, dueTime: string, key: TaskReminderKey, now = new Date()): boolean {
  if (!dueDate || key === 'continuous') return false
  const due = taskDueDateTime(dueDate, dueTime)
  if (Number.isNaN(due.getTime())) return false
  const reminderTime = taskReminderDate(due, key)
  return reminderTime.getTime() <= now.getTime()
}

export function pastTaskSingleReminderKeys(
  dueDate: string,
  dueTime: string,
  keys: readonly TaskReminderKey[],
  now = new Date(),
): TaskReminderKey[] {
  return keys.filter((key) => isTaskReminderKeyPast(dueDate, dueTime, key, now))
}

export function taskSingleReminderOptionLabel(key: TaskReminderKey, language: 'th' | 'en' = 'th'): string {
  const labels: Record<TaskReminderKey, { th: string; en: string }> = {
    due: { th: 'ตรงเวลาครบกำหนด', en: 'At the due time' },
    '1_hour': { th: 'ก่อน 1 ชั่วโมง', en: '1 hour before' },
    '1_day': { th: 'ก่อน 1 วัน', en: '1 day before' },
    '3_days': { th: 'ก่อน 3 วัน', en: '3 days before' },
    overdue: { th: 'เมื่อเลยกำหนด', en: 'When overdue' },
    continuous: { th: 'แจ้งต่อเนื่อง', en: 'Continuous' },
  }
  return labels[key]?.[language] || key
}

export function generateContinuousReminderDates(
  dueDate: string,
  dueTime: string,
  config: TaskContinuousConfig,
): Date[] {
  const daysBefore = Math.max(1, Math.min(60, Math.round(config.startDaysBefore || 1)))
  const [yearStr, monthStr, dayStr] = dueDate.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr) - 1
  const day = Number(dayStr)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return []
  }

  const results: Date[] = []
  for (let offset = daysBefore; offset >= 0; offset--) {
    // Create UTC representation corresponding to Bangkok calendar date
    const d = new Date(Date.UTC(year, month, day - offset, 12, 0, 0))
    const dayOfWeek = d.getUTCDay() // 0 = Sunday, 6 = Saturday

    if (config.frequency === 'weekdays' && (dayOfWeek === 0 || dayOfWeek === 6)) {
      continue
    }

    const y = d.getUTCFullYear()
    const m = String(d.getUTCMonth() + 1).padStart(2, '0')
    const dt = String(d.getUTCDate()).padStart(2, '0')
    const dateStr = `${y}-${m}-${dt}`

    results.push(taskDueDateTime(dateStr, dueTime))
  }

  return results
}

export function isGoogleDocumentUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && ['drive.google.com', 'docs.google.com'].includes(url.hostname)
  } catch {
    return false
  }
}

const gmailPattern = /^[^\s@]+@gmail\.com$/i

export function normalizeExternalEmails(emails: string[]) {
  return [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))]
}

export function invalidExternalEmails(emails: string[]) {
  return normalizeExternalEmails(emails).filter((email) => !gmailPattern.test(email))
}
