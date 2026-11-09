import { calendarDayKey } from './calendarView'
import { bangkokDate, isPastBangkokDate } from './eventForm'

const STORAGE_KEY = 'pea_meeting_completions'

export function meetingOccurrenceKey(eventId: string, occurrenceStart: string): string {
  const normalizedDate = occurrenceStart ? occurrenceStart.slice(0, 19) : ''
  return `${eventId}:${normalizedDate}`
}

export function getStoredMeetingCompletions(): Set<string> {
  if (typeof window === 'undefined' || !window.localStorage) return new Set()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((item): item is string => typeof item === 'string'))
    }
  } catch {
    // Ignore storage parse errors and return empty set
  }
  return new Set()
}

export function saveStoredMeetingCompletion(
  eventId: string,
  occurrenceStart: string,
  completed: boolean
): Set<string> {
  const current = getStoredMeetingCompletions()
  const key = meetingOccurrenceKey(eventId, occurrenceStart)
  if (completed) {
    current.add(key)
  } else {
    current.delete(key)
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...current]))
    } catch {
      // Ignore storage write errors
    }
  }
  return current
}

export function isMeetingCompleted(
  completedKeys: ReadonlySet<string>,
  eventId: string,
  occurrenceStart: string
): boolean {
  return completedKeys.has(meetingOccurrenceKey(eventId, occurrenceStart))
}

export function isMeetingPendingConfirmation(
  isCompleted: boolean,
  occurrenceStart: string,
  now = new Date()
): boolean {
  if (isCompleted) return false
  const dayKey = calendarDayKey(occurrenceStart)
  return isPastBangkokDate(dayKey, now)
}

export function isMeetingAppointmentPassed(
  event: { start_datetime: string; all_day?: boolean } | null | undefined,
  occurrenceStart?: string | null,
  now = new Date()
): boolean {
  if (!event) return false
  const targetIso = occurrenceStart || event.start_datetime
  if (!targetIso) return false

  if (event.all_day) {
    const dayKey = targetIso.slice(0, 10)
    return dayKey <= bangkokDate(now)
  }

  const appointmentTime = new Date(targetIso).getTime()
  if (Number.isNaN(appointmentTime)) return false
  return now.getTime() >= appointmentTime
}

export type MeetingStatusKind = 'upcoming' | 'pending_confirmation' | 'completed'

export function getMeetingStatus(
  isCompleted: boolean,
  occurrenceStart: string,
  now = new Date()
): MeetingStatusKind {
  if (isCompleted) return 'completed'
  if (isMeetingPendingConfirmation(isCompleted, occurrenceStart, now)) {
    return 'pending_confirmation'
  }
  return 'upcoming'
}

export function getMeetingColors(status: MeetingStatusKind, isOwner = false) {
  switch (status) {
    case 'completed':
      return {
        backgroundColor: '#dcf8e9',
        textColor: '#166534',
        borderColor: '#bbf7d0',
      }
    case 'pending_confirmation':
      return {
        backgroundColor: '#ffedd5',
        textColor: '#9a3412',
        borderColor: '#fde68a',
      }
    case 'upcoming':
    default:
      return {
        backgroundColor: isOwner ? '#edddf6' : '#f1e7fa',
        textColor: '#6b2170',
        borderColor: '#e9d5ff',
      }
  }
}

export function sanitizeMeetingSummaryHtml(input: string): string {
  if (!input) return ''
  if (typeof document !== 'undefined') {
    const div = document.createElement('div')
    div.innerHTML = input

    function cleanNode(node: Node): string {
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement
        const tag = el.tagName.toLowerCase()
        const inner = Array.from(el.childNodes).map(cleanNode).join('')

        if (['p', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li'].includes(tag)) {
          return `<${tag}>${inner}</${tag}>`
        }
        if (tag === 'span') {
          let wrapped = inner
          const style = el.getAttribute('style') || ''
          if (/font-weight:\s*(bold|[7-9]00)/i.test(style)) wrapped = `<strong>${wrapped}</strong>`
          if (/font-style:\s*italic/i.test(style)) wrapped = `<em>${wrapped}</em>`
          if (/text-decoration:\s*underline/i.test(style)) wrapped = `<u>${wrapped}</u>`
          return wrapped
        }
        if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
          return `<p><strong>${inner}</strong></p>`
        }
        if (tag === 'br') return '<br>'
        if (tag === 'div') {
          return inner ? `<p>${inner}</p>` : ''
        }
        return inner
      }
      return ''
    }

    return Array.from(div.childNodes).map(cleanNode).join('').trim()
  }

  // Regex fallback for Node/tests
  let text = input
    .replace(/<div[^>]*>/gi, '<p>')
    .replace(/<\/div>/gi, '</p>')
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '<p><strong>$1</strong></p>')
    .replace(/<span\b[^>]*style="[^"]*font-weight:\s*(bold|[7-9]00)[^"]*"[^>]*>(.*?)<\/span>/gi, '<strong>$2</strong>')
    .replace(/<span\b[^>]*style="[^"]*font-style:\s*italic[^"]*"[^>]*>(.*?)<\/span>/gi, '<em>$1</em>')
    .replace(/<span\b[^>]*style="[^"]*text-decoration:\s*underline[^"]*"[^>]*>(.*?)<\/span>/gi, '<u>$1</u>')
  text = text.replace(/<(p|strong|b|em|i|u|ul|ol|li)\b[^>]*>/gi, '<$1>')
  text = text.replace(/<br\b[^>]*\/?>/gi, '<br>')
  text = text.replace(/<\/?(?!p|br|strong|b|em|i|u|ul|ol|li\b)[a-z0-9_-]+[^>]*>/gi, '')
  return text.trim()
}

export function getMeetingSummaryVisibleText(html: string): string {
  if (!html) return ''
  const stripped = html.replace(/<\/?(p|br|strong|b|em|i|u|ul|ol|li)\s*\/?>/gi, '')
  return stripped.replace(/(&nbsp;|&#0*160;|&#x0*a0;|[[:space:]]|​| )/gi, '').trim()
}

export function hasMeetingSummary(html: string): boolean {
  return getMeetingSummaryVisibleText(html).length > 0
}


