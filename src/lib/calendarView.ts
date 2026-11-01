import { expandEvent, type RecurringEvent } from './recurrence'

export type CalendarView = 'day' | 'week' | 'month' | 'year'

const bangkokDayFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
const bangkokWeekdayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', weekday: 'short' })

export const THAI_WEEKDAY_ABBR: Record<string, string> = {
  Mon: 'จ.',
  Tue: 'อ.',
  Wed: 'พ.',
  Thu: 'พฤ.',
  Fri: 'ศ.',
  Sat: 'ส.',
  Sun: 'อา.',
}

export const ENGLISH_WEEKDAY_ABBR: Record<string, string> = {
  Mon: 'Mon',
  Tue: 'Tue',
  Wed: 'Wed',
  Thu: 'Thu',
  Fri: 'Fri',
  Sat: 'Sat',
  Sun: 'Sun',
}

export function formatCalendarDayHeader(date: Date | string | null | undefined, viewType?: string, language: string = 'th'): string {
  if (!date) return ''
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return ''
  const enWeekday = bangkokWeekdayFormatter.format(parsed)
  const weekday = language === 'th' ? (THAI_WEEKDAY_ABBR[enWeekday] ?? enWeekday) : (ENGLISH_WEEKDAY_ABBR[enWeekday] ?? enWeekday)
  if (viewType === 'timeGridWeek' || viewType === 'timeGridDay') {
    const parts = bangkokDayFormatter.formatToParts(parsed)
    const day = parts.find((p) => p.type === 'day')?.value ?? ''
    const month = parts.find((p) => p.type === 'month')?.value ?? ''
    return `${weekday} ${Number(day)}/${Number(month)}`
  }
  return weekday
}

export function calendarViewType(view: CalendarView, compact: boolean) {
  if (view === 'day') return 'timeGridDay'
  if (view === 'week') return compact ? 'listWeek' : 'timeGridWeek'
  return view === 'year' ? 'multiMonthYear' : 'dayGridMonth'
}

export function calendarDayKey(date: Date | string) {
  const parts = bangkokDayFormatter.formatToParts(new Date(date))
  const value = (type: Intl.DateTimeFormatPart['type']) => parts.find((part) => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

export function calendarEntriesByDay<T extends { start: Date | string }>(entries: readonly T[]) {
  const days = new Map<string, T[]>()
  for (const entry of entries) {
    const key = calendarDayKey(entry.start)
    const day = days.get(key)
    if (day) day.push(entry)
    else days.set(key, [entry])
  }
  return days
}

export function calendarClickedDate(dateStr: string) {
  return dateStr.slice(0, 10)
}

export function calendarMeetingOccurrences<T extends RecurringEvent>(event: T, start: Date, end: Date) {
  const duration = event.end_datetime ? Math.max(0, Date.parse(event.end_datetime) - Date.parse(event.start_datetime)) : 0
  // Include appointments that start before this view but continue into it.
  return expandEvent(event, new Date(start.getTime() - duration), new Date(end.getTime() - 1)).filter((occurrence) => {
    const occurrenceStart = Date.parse(occurrence.start)
    const occurrenceEnd = occurrence.end ? Date.parse(occurrence.end) : occurrenceStart
    return occurrenceStart < end.getTime() && (occurrenceEnd > start.getTime() || occurrenceStart >= start.getTime())
  })
}

export async function readCalendarPages<T>(readPage: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown; count: number | null }>): Promise<T[]> {
  const rows: T[] = []
  while (true) {
    const { data, error, count } = await readPage(rows.length)
    if (error) throw error
    if (!data?.length) return rows
    rows.push(...data)
    if (count !== null && rows.length >= count) return rows
  }
}
