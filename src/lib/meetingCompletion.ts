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

