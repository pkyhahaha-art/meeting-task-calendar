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
