import type { Database } from './database.types'
type Guest = Database['public']['Tables']['event_guests']['Row']
type Exclusion = Database['public']['Tables']['event_occurrence_guest_exclusions']['Row']

export function avatarGuestEmails(guests: Guest[], exclusions: Exclusion[], occurrenceId: string | undefined, start: string | undefined) {
  const at = Date.parse(start || '')
  if (!Number.isFinite(at)) return new Set<string>()
  return new Set(guests.filter(guest => {
    if (guest.revoked_at) return false
    if (guest.occurrence_id) return guest.occurrence_id === occurrenceId
    if (exclusions.some(item => item.occurrence_id === occurrenceId && item.email.toLowerCase() === guest.email.toLowerCase())) return false
    const current = (!guest.self_join_from || at >= Date.parse(guest.self_join_from)) && (!guest.self_join_until || at <= Date.parse(guest.self_join_until))
    const history = Array.isArray(guest.attendance_history) && guest.attendance_history.some(range => range && typeof range === 'object' && !Array.isArray(range) && (range.from === null || typeof range.from === 'string') && typeof range.until === 'string' && (!range.from || at >= Date.parse(range.from)) && at <= Date.parse(range.until))
    return current || history
  }).map(guest => guest.email.trim().toLowerCase()))
}
