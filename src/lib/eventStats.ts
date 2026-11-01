import { bangkokDate } from './eventForm'

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
