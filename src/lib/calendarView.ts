import { expandEvent, type RecurringEvent } from './recurrence'

export type CalendarView = 'day' | 'week' | 'month' | 'year'

export function calendarViewType(view: CalendarView, compact: boolean) {
  if (view === 'day') return 'timeGridDay'
  if (view === 'week') return compact ? 'listWeek' : 'timeGridWeek'
  return view === 'year' ? 'multiMonthYear' : 'dayGridMonth'
}

export function calendarDayKey(date: Date | string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(date))
  const value = (type: Intl.DateTimeFormatPart['type']) => parts.find((part) => part.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}`
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
