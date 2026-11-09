import type { Database } from './database.types'
import { calendarDayKey, calendarMeetingOccurrences } from './calendarView'
import { normalizeAffiliationText } from './organization'

export type EventRow = Database['public']['Tables']['events']['Row']

export interface SummaryMeetingItem {
  id: string
  eventId: string
  occurrenceKey?: string
  occurrenceStart?: string
  title: string
  dateKey: string // YYYY-MM-DD
  thaiDate: string // e.g. "5 พฤศจิกายน 2569"
  startTime: string // "13:30" or ""
  endTime: string // "16:30" or ""
  timeText: string // "13:30 – 16:30 น." or "ตลอดวัน"
  location: string
  description: string
  affiliation: string
  allDay: boolean
  startIso: string
  endIso?: string | null
}

export interface WeekOption {
  weekNumber: number
  label: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
}

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน',
  'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม',
  'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.',
  'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.',
  'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
]

const bangkokTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/**
 * Format date string "YYYY-MM-DD" to Thai full date e.g. "5 พฤศจิกายน 2569"
 */
export function formatThaiFullDate(dateStr: string): string {
  const parts = dateStr.slice(0, 10).split('-')
  if (parts.length !== 3) return dateStr
  const year = parseInt(parts[0], 10) + 543
  const monthIdx = parseInt(parts[1], 10) - 1
  const day = parseInt(parts[2], 10)
  return `${day} ${THAI_MONTHS[monthIdx] ?? ''} ${year}`
}

/**
 * Format date string "YYYY-MM-DD" to Thai short date e.g. "5 พ.ย. 69"
 */
export function formatThaiShortDate(dateStr: string): string {
  const parts = dateStr.slice(0, 10).split('-')
  if (parts.length !== 3) return dateStr
  const thaiYearShort = (parseInt(parts[0], 10) + 543) % 100
  const monthIdx = parseInt(parts[1], 10) - 1
  const day = parseInt(parts[2], 10)
  return `${day} ${THAI_MONTHS_SHORT[monthIdx] ?? ''} ${thaiYearShort}`
}

/**
 * Format time range e.g. "13:30 – 16:30 น." or "ตลอดวัน"
 */
export function formatTimeRange(startIso: string, endIso?: string | null, allDay = false): { startTime: string; endTime: string; text: string } {
  if (allDay) {
    return { startTime: '00:00', endTime: '23:59', text: 'ตลอดวัน' }
  }

  const startTime = bangkokTimeFormatter.format(new Date(startIso))

  if (!endIso) {
    return { startTime, endTime: '', text: `${startTime} น.` }
  }

  const endTime = bangkokTimeFormatter.format(new Date(endIso))
  return { startTime, endTime, text: `${startTime} – ${endTime} น.` }
}

/**
 * Get the weeks of a month (1 to 4 or 5) with date boundaries
 */
export function getMonthWeeks(year: number, monthIndex: number): WeekOption[] {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()
  const thaiYear = year + 543
  const monthName = THAI_MONTHS_SHORT[monthIndex]
  const pad = (n: number) => n.toString().padStart(2, '0')
  const m = pad(monthIndex + 1)

  const weeks: WeekOption[] = []
  const intervals = [
    { weekNumber: 1, start: 1, end: 7 },
    { weekNumber: 2, start: 8, end: 14 },
    { weekNumber: 3, start: 15, end: 21 },
    { weekNumber: 4, start: 22, end: 28 },
  ]

  for (const interval of intervals) {
    weeks.push({
      weekNumber: interval.weekNumber,
      label: `สัปดาห์ที่ ${interval.weekNumber} (${interval.start} - ${interval.end} ${monthName})`,
      startDate: `${year}-${m}-${pad(interval.start)}`,
      endDate: `${year}-${m}-${pad(interval.end)}`,
    })
  }

  if (lastDay > 28) {
    weeks.push({
      weekNumber: 5,
      label: `สัปดาห์ที่ 5 (${29} - ${lastDay} ${monthName})`,
      startDate: `${year}-${m}-29`,
      endDate: `${year}-${m}-${pad(lastDay)}`,
    })
  }

  return weeks
}

/**
 * Get date range for Monday-Sunday calendar week containing a given date
 */
export function getCurrentCalendarWeekRange(refDate = new Date()): { startDate: string; endDate: string; label: string } {
  const date = new Date(refDate)
  // Day of week: 0 is Sun, 1 is Mon, ..., 6 is Sat
  const day = date.getDay()
  const diffToMonday = (day === 0 ? -6 : 1) - day
  const monday = new Date(date)
  monday.setDate(date.getDate() + diffToMonday)

  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const pad = (n: number) => n.toString().padStart(2, '0')
  const startStr = `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`
  const endStr = `${sunday.getFullYear()}-${pad(sunday.getMonth() + 1)}-${pad(sunday.getDate())}`

  return {
    startDate: startStr,
    endDate: endStr,
    label: `${formatThaiShortDate(startStr)} – ${formatThaiShortDate(endStr)}`,
  }
}

/**
 * Filter and sort meetings:
 * 1. Primary sort: Date ascending (น้อย -> มาก)
 * 2. Secondary sort: Start time ascending (ถ้าวันเดียวกัน ให้เรียงตามเวลาเริ่ม)
 */
export function filterAndSortMeetingsForSummary(
  events: EventRow[],
  rangeStart: Date,
  rangeEnd: Date,
  cancelledKeys: Set<string> = new Set(),
): SummaryMeetingItem[] {
  const items: SummaryMeetingItem[] = []

  for (const event of events) {
    if (event.deleted_at || event.status === 'cancelled') continue

    const occurrences = calendarMeetingOccurrences(event, rangeStart, rangeEnd)
    for (const occ of occurrences) {
      const occurrenceTime = new Date(occ.start).getTime()
      if (cancelledKeys.has(`${event.id}:${occurrenceTime}`)) continue

      const dateKey = calendarDayKey(occ.start)
      const timeInfo = formatTimeRange(occ.start, occ.end, event.all_day)

      items.push({
        id: `summary-${event.id}-${occ.key ?? occ.start}`,
        eventId: event.id,
        occurrenceKey: occ.key ? String(occ.key) : occ.start,
        occurrenceStart: occ.start,
        title: event.title,
        dateKey,
        thaiDate: formatThaiFullDate(dateKey),
        startTime: timeInfo.startTime,
        endTime: timeInfo.endTime,
        timeText: timeInfo.text,
        location: event.location || 'ไม่ระบุสถานที่',
        description: event.description || '',
        affiliation: normalizeAffiliationText(event.affiliation) || 'กฟภ.',
        allDay: event.all_day,
        startIso: occ.start,
        endIso: occ.end,
      })
    }
  }

  // Sorting: Date ascending, then start time ascending
  items.sort((a, b) => {
    // 1. Compare Date (YYYY-MM-DD)
    const dateComparison = a.dateKey.localeCompare(b.dateKey)
    if (dateComparison !== 0) return dateComparison

    // 2. Compare Time (allDay first, then startTime)
    if (a.allDay && !b.allDay) return -1
    if (!a.allDay && b.allDay) return 1

    const timeComparison = a.startTime.localeCompare(b.startTime)
    if (timeComparison !== 0) return timeComparison

    // Tie-breaker: title
    return a.title.localeCompare(b.title, 'th')
  })

  return items
}

export { THAI_MONTHS, THAI_MONTHS_SHORT }

