export type RecurringEvent = {
  id: string
  start_datetime: string
  end_datetime: string | null
  recurrence_rule: string | null
}

export type EventOccurrence<T extends RecurringEvent> = {
  key: string
  event: T
  start: string
  end: string | null
}

function nextDate(current: Date, rule: string) {
  const next = new Date(current)
  if (rule.startsWith('FREQ=DAILY') || rule.includes('BYDAY=MO,TU,WE,TH,FR')) next.setUTCDate(next.getUTCDate() + 1)
  else if (rule.startsWith('FREQ=WEEKLY')) next.setUTCDate(next.getUTCDate() + 7)
  else if (rule.startsWith('FREQ=MONTHLY')) {
    const day = next.getUTCDate()
    next.setUTCMonth(next.getUTCMonth() + 1, 1)
    const daysInMonth = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()
    if (day > daysInMonth) next.setUTCMonth(next.getUTCMonth() + 1, day)
    else next.setUTCDate(day)
  } else if (rule.startsWith('FREQ=YEARLY')) {
    const month = next.getUTCMonth()
    const day = next.getUTCDate()
    next.setUTCFullYear(next.getUTCFullYear() + 1, month, day)
    if (next.getUTCMonth() !== month) next.setUTCFullYear(next.getUTCFullYear() + 1, month, day)
  } else return null
  return next
}

export function expandEvent<T extends RecurringEvent>(event: T, rangeStart: Date, rangeEnd: Date): EventOccurrence<T>[] {
  const first = new Date(event.start_datetime)
  if (Number.isNaN(first.getTime())) return []
  const duration = event.end_datetime ? new Date(event.end_datetime).getTime() - first.getTime() : null
  if (!event.recurrence_rule) {
    return first <= rangeEnd && (duration === null || new Date(first.getTime() + duration) >= rangeStart)
      ? [{ key: event.id, event, start: first.toISOString(), end: duration === null ? null : new Date(first.getTime() + duration).toISOString() }]
      : []
  }

  const occurrences: EventOccurrence<T>[] = []
  let current = first
  for (let index = 0; index < 5000 && current <= rangeEnd; index += 1) {
    const weekday = current.getUTCDay()
    const allowed = !event.recurrence_rule.includes('BYDAY=MO,TU,WE,TH,FR') || (weekday >= 1 && weekday <= 5)
    if (allowed && current >= rangeStart) occurrences.push({
      key: `${event.id}-${current.toISOString()}`,
      event,
      start: current.toISOString(),
      end: duration === null ? null : new Date(current.getTime() + duration).toISOString(),
    })
    const next = nextDate(current, event.recurrence_rule)
    if (!next || next <= current) break
    current = next
  }
  return occurrences
}
