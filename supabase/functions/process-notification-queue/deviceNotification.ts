function limited(value: unknown, maxBytes: number) {
  const encoder = new TextEncoder()
  let result = ''
  for (const character of String(value ?? '').replace(/[\r\n]+/g, ' ').trim()) {
    if (encoder.encode(result + character).length > maxBytes) break
    result += character
  }
  return result
}

function jsonLimited(value: unknown, maxBytes: number) {
  const encoder = new TextEncoder()
  let result = ''
  for (const character of String(value ?? '').replace(/[\r\n]+/g, ' ').trim()) {
    // Quotes, backslashes and pasted controls can expand when serialized for Push.
    if (encoder.encode(JSON.stringify(result + character)).length > maxBytes) break
    result += character
  }
  return result
}

export function deviceNotification(deliveryId: string, title: string, payload: Record<string, unknown>, publicAppUrl: string, template = '') {
  const url = new URL(publicAppUrl)
  url.hash = `/device-inbox?notification=${encodeURIComponent(deliveryId)}`
  const occurrenceNotice = template === 'meeting_occurrence_cancelled' || template === 'meeting_occurrence_moved'
  const snapshotText = occurrenceNotice ? jsonLimited : limited
  const dates = occurrenceNotice ? title.slice(title.lastIndexOf('»') + 1).replace(/^(ยกเลิก|ย้าย)ประชุม\s*/, '').trim() : ''
  return {
    id: deliveryId, title: snapshotText(title, occurrenceNotice ? 900 : 400),
    body: occurrenceNotice ? snapshotText(dates, 400) : limited(payload.description, 240) || 'คุณมีข้อความใหม่จากปฏิทิน PEA แตะเพื่อดูรายละเอียด',
    tag: `delivery-${deliveryId}`, url: url.href,
    details: {
      entity: payload.entity === 'task' ? 'task' : 'meeting',
      title: snapshotText(payload.title, occurrenceNotice ? 300 : 400), description: snapshotText(payload.description, occurrenceNotice ? 600 : 1000),
      start_datetime: snapshotText(payload.start_datetime, 40), end_datetime: snapshotText(payload.end_datetime, 40),
      due_date: snapshotText(payload.due_date, 20), due_time: snapshotText(payload.due_time, 20),
      location: snapshotText(payload.location, occurrenceNotice ? 150 : 250),
      ...(occurrenceNotice ? {
        notice_template: template, affiliation: snapshotText(payload.affiliation, 200), all_day: payload.all_day === true,
        status: snapshotText(payload.status, 20), original_occurrence_start: snapshotText(payload.original_occurrence_start, 40),
        new_occurrence_start: snapshotText(payload.new_occurrence_start, 40),
      } : {}),
    },
  }
}
