import { bangkokDate } from './eventForm'
import { expandEvent, type RecurringEvent } from './recurrence'

function shiftDay(day: string, days: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

function bangkokMidnight(day: string) {
  return new Date(`${day}T00:00:00+07:00`).toISOString()
}

export function eventCreationPeriods(now = new Date()) {
  const today = bangkokDate(now)
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
  const end = bangkokMidnight(shiftDay(today, 1))
  return {
    today: { start: bangkokMidnight(today), end },
    week: { start: bangkokMidnight(shiftDay(today, -((weekday + 6) % 7))), end },
    month: { start: bangkokMidnight(`${today.slice(0, 7)}-01`), end },
  }
}

export function eventAgendaPeriods(now = new Date()) {
  const today = bangkokDate(now)
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
  const weekStart = shiftDay(today, -((weekday + 6) % 7))
  const weekEnd = shiftDay(weekStart, 7)
  const monthStart = `${today.slice(0, 7)}-01`
  const [y, m] = today.slice(0, 7).split('-').map(Number)
  const nextMonthY = m === 12 ? y + 1 : y
  const nextMonthM = m === 12 ? 1 : m + 1
  const monthEnd = `${nextMonthY}-${String(nextMonthM).padStart(2, '0')}-01`

  return {
    today: {
      startDay: today,
      endDay: shiftDay(today, 1),
      start: bangkokMidnight(today),
      end: bangkokMidnight(shiftDay(today, 1)),
    },
    week: {
      startDay: weekStart,
      endDay: weekEnd,
      start: bangkokMidnight(weekStart),
      end: bangkokMidnight(weekEnd),
    },
    month: {
      startDay: monthStart,
      endDay: monthEnd,
      start: bangkokMidnight(monthStart),
      end: bangkokMidnight(monthEnd),
    },
  }
}

export function countScheduledMeetings(
  events: readonly RecurringEvent[],
  exceptions: readonly { event_id: string; occurrence_key: string }[],
  periods: ReturnType<typeof eventAgendaPeriods>,
) {
  // PostgREST and recurrence expansion format the same instant differently.
  const occurrenceKey = (eventId: string, start: string) => `${eventId}:${Date.parse(start)}`
  const excluded = new Set(exceptions.map((exception) => occurrenceKey(exception.event_id, exception.occurrence_key)))
  const countBetween = (period: { start: string; end: string }) => {
    const start = new Date(period.start)
    const end = new Date(period.end)
    const lastIncluded = new Date(end.getTime() - 1)
    let count = 0
    for (const event of events) {
      if (!event.recurrence_rule) {
        const appointment = new Date(event.start_datetime)
        if (appointment >= start && appointment < end) count++
        continue
      }
      for (const occurrence of expandEvent(event, start, lastIncluded)) {
        if (!excluded.has(occurrenceKey(event.id, occurrence.start))) count++
      }
    }
    return count
  }
  return { today: countBetween(periods.today), week: countBetween(periods.week), month: countBetween(periods.month) }
}
