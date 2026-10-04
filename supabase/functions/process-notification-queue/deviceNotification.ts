function limited(value: unknown, maxBytes: number) {
  const encoder = new TextEncoder()
  let result = ''
  for (const character of String(value ?? '').replace(/[\r\n]+/g, ' ').trim()) {
    if (encoder.encode(result + character).length > maxBytes) break
    result += character
  }
  return result
}

export function deviceNotification(deliveryId: string, title: string, payload: Record<string, unknown>, publicAppUrl: string, template = '') {
  const url = new URL(publicAppUrl)
  url.hash = `/device-inbox?notification=${encodeURIComponent(deliveryId)}`
  if (template === 'meeting_occurrence_cancelled' || template === 'meeting_occurrence_moved') {
    // Keep action notices immutable and small, without private agenda/document data.
    const dates = title.slice(title.lastIndexOf('»') + 1).replace(/^(ยกเลิก|ย้าย)ประชุม\s*/, '').trim()
    return {
      id: deliveryId, title: limited(title, 1200), body: limited(dates, 600),
      tag: `delivery-${deliveryId}`, url: url.href,
      details: { entity: 'meeting', notice_template: template },
    }
  }
  return {
    id: deliveryId, title: limited(title, 400),
    body: limited(payload.description, 240) || 'คุณมีข้อความใหม่จากปฏิทิน PEA แตะเพื่อดูรายละเอียด',
    tag: `delivery-${deliveryId}`, url: url.href,
    details: {
      entity: payload.entity === 'task' ? 'task' : 'meeting',
      title: limited(payload.title, 400), description: limited(payload.description, 1000),
      start_datetime: limited(payload.start_datetime, 40), end_datetime: limited(payload.end_datetime, 40),
      due_date: limited(payload.due_date, 20), due_time: limited(payload.due_time, 20),
      location: limited(payload.location, 250),
    },
  }
}
