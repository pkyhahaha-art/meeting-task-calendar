export type RecurringEvent = {
  id: string
  start_datetime: string
  end_datetime: string | null
  recurrence_rule: string | null
  recurrence_until?: string | null
  recurrence_count?: number | null
}

export type EventOccurrence<T extends RecurringEvent> = {
  key: string
  event: T
  start: string
  end: string | null
}

export type RecurringTask = {
  id: string
  due_date: string
  due_time: string | null
  recurrence_rule: string | null
  recurrence_end_at?: string | null
}

export type TaskOccurrence<T extends RecurringTask> = {
  key: string
  task: T
  dueDate: string
}

const weekdayCodes = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const bangkokParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })

function localDate(value: Date) {
  const parts = bangkokParts.formatToParts(value)
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value
  return `${read('year')}-${read('month')}-${read('day')}`
}

function dayDifference(first: string, second: string) {
  return Math.round((Date.parse(`${second}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000)
}

function ruleParts(rule: string) {
  return new Map(rule.split(';').map((part) => part.split('=', 2) as [string, string]))
}

function matches(current: Date, first: Date, parts: Map<string, string>) {
  const frequency = parts.get('FREQ')
  const interval = Math.max(1, Number(parts.get('INTERVAL')) || 1)
  const currentDate = localDate(current)
  const firstDate = localDate(first)
  const dayOffset = dayDifference(firstDate, currentDate)
  if (dayOffset < 0) return false
  if (frequency === 'DAILY') return dayOffset % interval === 0
  if (frequency === 'WEEKLY') {
    if (Math.floor(dayOffset / 7) % interval !== 0) return false
    const allowedDays = parts.get('BYDAY')?.split(',')
    const weekday = weekdayCodes[new Date(`${currentDate}T12:00:00+07:00`).getUTCDay()]
    return allowedDays ? allowedDays.includes(weekday) : weekday === weekdayCodes[new Date(`${firstDate}T12:00:00+07:00`).getUTCDay()]
  }
  const [currentYear, currentMonth, currentDay] = currentDate.split('-').map(Number)
  const [firstYear, firstMonth, firstDay] = firstDate.split('-').map(Number)
  if (frequency === 'MONTHLY') return currentDay === firstDay && ((currentYear - firstYear) * 12 + currentMonth - firstMonth) % interval === 0
  if (frequency === 'YEARLY') return currentMonth === firstMonth && currentDay === firstDay && (currentYear - firstYear) % interval === 0
  return false
}

export function expandEvent<T extends RecurringEvent>(event: T, rangeStart: Date, rangeEnd: Date): EventOccurrence<T>[] {
  return expandOccurrences(event, rangeStart, rangeEnd, true)
}

function expandOccurrences<T extends RecurringEvent>(event: T, rangeStart: Date, rangeEnd: Date, includeFirst: boolean): EventOccurrence<T>[] {
  const first = new Date(event.start_datetime)
  if (Number.isNaN(first.getTime())) return []
  const duration = event.end_datetime ? new Date(event.end_datetime).getTime() - first.getTime() : null
  if (!event.recurrence_rule) {
    return first <= rangeEnd && (duration === null || new Date(first.getTime() + duration) >= rangeStart)
      ? [{ key: event.id, event, start: first.toISOString(), end: duration === null ? null : new Date(first.getTime() + duration).toISOString() }]
      : []
  }

  const parts = ruleParts(event.recurrence_rule)
  const recurrenceUntil = event.recurrence_until ? new Date(event.recurrence_until) : null
  const occurrences: EventOccurrence<T>[] = []
  let occurrenceCount = 0
  for (let current = new Date(first); current <= rangeEnd && occurrenceCount < (event.recurrence_count ?? Infinity); current.setUTCDate(current.getUTCDate() + 1)) {
    if (recurrenceUntil && current > recurrenceUntil) break
    if (!(includeFirst && current.getTime() === first.getTime()) && !matches(current, first, parts)) continue
    occurrenceCount += 1
    if (current >= rangeStart) occurrences.push({
      key: `${event.id}-${current.toISOString()}`,
      event,
      start: current.toISOString(),
      end: duration === null ? null : new Date(current.getTime() + duration).toISOString(),
    })
  }
  return occurrences
}

export function expandTask<T extends RecurringTask>(task: T, rangeStart: Date, rangeEnd: Date): TaskOccurrence<T>[] {
  const adjustedEnd = new Date(rangeEnd)
  if (
    adjustedEnd.getUTCHours() === 0 &&
    adjustedEnd.getUTCMinutes() === 0 &&
    adjustedEnd.getUTCSeconds() === 0 &&
    adjustedEnd.getUTCMilliseconds() === 0
  ) {
    adjustedEnd.setUTCHours(23, 59, 59, 999)
  }

  if (!task.recurrence_rule) {
    const taskDate = new Date(`${task.due_date}T12:00:00+07:00`)
    return taskDate >= rangeStart && taskDate <= adjustedEnd
      ? [{ key: task.id, task, dueDate: task.due_date }]
      : []
  }

  const startIso = new Date(`${task.due_date}T${task.due_time?.slice(0, 5) || '00:00'}:00+07:00`).toISOString()
  const adapted: RecurringEvent = {
    id: task.id,
    start_datetime: startIso,
    end_datetime: null,
    recurrence_rule: task.recurrence_rule,
    recurrence_until: task.recurrence_end_at ?? null,
  }

  return expandOccurrences(adapted, rangeStart, adjustedEnd, false).map((occurrence) => ({
    key: occurrence.key,
    task,
    dueDate: localDate(new Date(occurrence.start)),
  }))
}
