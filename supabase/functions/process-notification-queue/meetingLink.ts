export function internalMeetingUrl(publicAppUrl: string, eventId: string) {
  const url = new URL(publicAppUrl)
  url.hash = `/calendar?event=${encodeURIComponent(eventId)}`
  return url.toString()
}
