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
  const result = new Date(due)
  if (key === '1_hour') result.setHours(result.getHours() - 1)
  if (key === '1_day') result.setDate(result.getDate() - 1)
  if (key === '3_days') result.setDate(result.getDate() - 3)
  if (key === 'overdue') {
    result.setDate(result.getDate() + 1)
    result.setHours(9, 0, 0, 0)
  }
  return result
}

export function isGoogleDocumentUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && ['drive.google.com', 'docs.google.com'].includes(url.hostname)
  } catch {
    return false
  }
}
