export type MeetingEventPayload = {
  title: string
  description: string
  location: string
  affiliation: string
  all_day: boolean
  start_datetime: string
  end_datetime: string | null
  recurrence_rule: string | null
}

export function meetingCreateArgs(payload: MeetingEventPayload) {
  return {
    target_title: payload.title,
    target_description: payload.description,
    target_location: payload.location,
    target_affiliation: payload.affiliation,
    target_all_day: payload.all_day,
    target_start_datetime: payload.start_datetime,
    target_end_datetime: payload.end_datetime,
    target_recurrence_rule: payload.recurrence_rule,
  }
}

export function canManageMeeting(ownerUserId: string | undefined, userId: string | undefined, role: 'user' | 'admin' | undefined) {
  if (!userId) return false
  return !ownerUserId || ownerUserId === userId || role === 'admin'
}
