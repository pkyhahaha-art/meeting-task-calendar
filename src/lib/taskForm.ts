export type TaskReminderKey = 'due' | '1_hour' | '1_day' | '3_days' | 'overdue'

export const taskReminderOptions: { key: TaskReminderKey; label: string }[] = [
  { key: 'due', label: 'ตรงเวลาครบกำหนด' },
  { key: '1_hour', label: 'ก่อน 1 ชั่วโมง' },
  { key: '1_day', label: 'ก่อน 1 วัน' },
  { key: '3_days', label: 'ก่อน 3 วัน' },
  { key: 'overdue', label: 'เมื่อเลยกำหนด' },
]

export function taskDueDateTime(dueDate: string, dueTime: string) {
  return new Date(`${dueDate}T${dueTime || '09:00'}:00+07:00`)
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
