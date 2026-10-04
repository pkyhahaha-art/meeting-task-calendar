export function text(value: unknown) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim()
}

function escapeHtml(value: unknown) {
  return text(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

function formatDateTime(value: unknown) {
  const date = new Date(String(value ?? ''))
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
  }).format(date)
}

function formatDate(value: unknown) {
  const date = new Date(String(value ?? ''))
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'full', timeZone: 'Asia/Bangkok',
  }).format(date)
}

function recurrenceLabel(value: unknown) {
  const rule = text(value)
  if (!rule) return ''
  const parts = new Map<string, string>(rule.split(';').map((part) => part.split('=', 2) as [string, string]))
  const interval = Math.max(1, Number(parts.get('INTERVAL')) || 1)
  const every = interval === 1 ? 'ทุก' : `ทุก ${interval}`
  const weekdays = (parts.get('BYDAY') ?? '').split(',').filter(Boolean)
  const weekdayLabels: Record<string, string> = { MO: 'จันทร์', TU: 'อังคาร', WE: 'พุธ', TH: 'พฤหัสบดี', FR: 'ศุกร์', SA: 'เสาร์', SU: 'อาทิตย์' }
  if (parts.get('FREQ') === 'DAILY') return interval === 1 ? 'ทุกวัน' : `${every} วัน`
  if (parts.get('FREQ') === 'WEEKLY') {
    if (interval === 1 && weekdays.join(',') === 'MO,TU,WE,TH,FR') return 'ทุกวันทำการ'
    const days = weekdays.map((day) => weekdayLabels[day] ?? day).join(', ')
    return `${every} สัปดาห์${days ? ` (${days})` : ''}`
  }
  if (parts.get('FREQ') === 'MONTHLY') return interval === 1 ? 'ทุกเดือน' : `${every} เดือน`
  if (parts.get('FREQ') === 'YEARLY') return interval === 1 ? 'ทุกปี' : `${every} ปี`
  return rule
}

function statusLabel(value: unknown) {
  const labels: Record<string, string> = {
    scheduled: 'นัดหมายแล้ว', cancelled: 'ยกเลิกแล้ว', pending: 'รอดำเนินการ',
    completed: 'เสร็จแล้ว', active: 'ใช้งานอยู่', disabled: 'ระงับการใช้งาน',
  }
  const status = text(value)
  return labels[status] ?? status
}

function validUrl(value: unknown) {
  const url = text(value)
  return url.startsWith('https://') || url.startsWith('http://') ? url : ''
}

type DocumentItem = { name: string; size: number | null; url: string; kind: string }

function documents(value: unknown): DocumentItem[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).map((item) => {
    if (typeof item === 'string') return { name: text(item), size: null, url: '', kind: 'file' }
    if (!item || typeof item !== 'object') return { name: '', size: null, url: '', kind: 'file' }
    const record = item as Record<string, unknown>
    const size = Number(record.size)
    return { name: text(record.name), size: Number.isFinite(size) && size > 0 ? size : null, url: validUrl(record.url), kind: record.kind === 'drive' ? 'drive' : 'file' }
  }).filter((item) => item.name)
}

function formatSize(value: number | null) {
  if (!value) return ''
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function subject(template: string, payload: Record<string, unknown>) {
  const title = text(payload.title)
  if (template === 'meeting_occurrence_cancelled' || template === 'meeting_occurrence_moved') {
    const titleCharacters = Array.from(title)
    const noticeTitle = titleCharacters.length > 80 ? `${titleCharacters.slice(0, 80).join('')}…` : title
    const original = new Date(String(payload.original_occurrence_start ?? ''))
    const destination = new Date(String(payload.new_occurrence_start ?? ''))
    const validOriginal = !Number.isNaN(original.getTime())
    const validDestination = !Number.isNaN(destination.getTime())
    const crossYear = validOriginal && validDestination && new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Bangkok' }).format(original)
      !== new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Bangkok' }).format(destination)
    const day = (date: Date) => new Intl.DateTimeFormat('th-TH', {
      day: 'numeric', month: 'short', ...(crossYear ? { year: 'numeric' as const } : {}), timeZone: 'Asia/Bangkok',
    }).format(date)
    const appointment = template === 'meeting_occurrence_moved' ? destination : original
    const time = !Number.isNaN(appointment.getTime()) && payload.all_day !== true
      ? ` เวลา ${new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Bangkok' }).format(appointment)} น.` : ''
    const heading = `${template === 'meeting_occurrence_moved' ? 'ย้ายประชุม' : 'ยกเลิกประชุม'}${noticeTitle ? ` «${noticeTitle}»` : ''}`
    const dates = template === 'meeting_occurrence_moved'
      ? validOriginal && validDestination ? ` จากวันที่ ${day(original)} เป็นวันที่ ${day(destination)}` : ''
      : validOriginal ? ` วันที่ ${day(original)}` : ''
    return `${heading}${dates}${time}`
  }
  const labels: Record<string, string> = {
    meeting_created: 'คุณได้สร้าง Meeting แล้ว', task_created: 'คุณได้สร้าง Task แล้ว', meeting_updated: 'Meeting ถูกแก้ไข', meeting_cancelled: 'Meeting ถูกยกเลิก',
    meeting_guest_added: 'คุณได้รับเชิญเข้าร่วม Meeting', meeting_reminder: 'แจ้งเตือน Meeting', task_assigned: 'คุณได้รับมอบหมาย Task',
    task_reminder: 'แจ้งเตือน Task', task_updated: 'Task ถูกแก้ไข', task_cancelled: 'Task ถูกยกเลิก', task_completed: 'Task เสร็จแล้ว',
  }
  return `${labels[template] ?? 'การแจ้งเตือน'}${title ? `: ${title}` : ''}`
}

function emailAssetUrl(appUrl: string, file: string) {
  try {
    const base = new URL(appUrl)
    if (base.protocol !== 'https:') return ''
    base.search = ''
    base.hash = ''
    base.pathname = `${base.pathname.replace(/\/$/, '')}/email-assets/${file}`
    return base.toString()
  } catch { return '' }
}

export function html(template: string, payload: Record<string, unknown>, appUrl = '') {
  const isMeeting = payload.entity === 'meeting'
  const occurrenceNotice = template === 'meeting_occurrence_cancelled' || template === 'meeting_occurrence_moved'
  const mascotUrl = emailAssetUrl(appUrl, 'pea-mail-mascot-v1.png')
  const logoUrl = emailAssetUrl(appUrl, 'pea-logo.png')
  const description = occurrenceNotice ? '' : text(payload.description)
  const allDay = payload.all_day === true
  const startsAt = allDay ? formatDate(payload.start_datetime) : formatDateTime(payload.start_datetime)
  const endsAt = allDay ? formatDate(payload.end_datetime) : formatDateTime(payload.end_datetime)
  const dueDate = text(payload.due_date)
  const dueTime = text(payload.due_time)
  const acknowledgeUrl = occurrenceNotice ? '' : validUrl(payload.ack_url)
  const documentItems = occurrenceNotice ? [] : documents(isMeeting ? payload.meeting_documents : payload.task_documents)
  const rows = (occurrenceNotice ? [] : [
    ['ผู้จัด', text(payload.organizer)],
    ['หน่วยงาน / สังกัด', text(payload.affiliation)],
    ['วันและเวลาเริ่ม', startsAt],
    ['วันและเวลาสิ้นสุด', endsAt],
    ['สถานที่', text(payload.location)],
    ['การทำซ้ำ', recurrenceLabel(payload.recurrence_rule)],
    ['กำหนดส่ง', [dueDate, dueTime].filter(Boolean).join(' ')],
    ['สถานะ', statusLabel(payload.status)],
  ]).filter(([, value]) => value)
    .map(([label, value]) => `<tr><td width="112" valign="top" style="width:112px;padding:12px;color:#766280;font-size:12px;line-height:1.7;border-bottom:1px solid #eee5f3;background:#fbf8fd">${escapeHtml(label)}</td><td valign="top" style="padding:12px;color:#35213f;font-size:14px;line-height:1.7;border-bottom:1px solid #eee5f3;word-break:break-word;overflow-wrap:anywhere">${escapeHtml(value)}</td></tr>`)
    .join('')
  const descriptionBlock = occurrenceNotice
    ? `<p style="margin:0;color:#35213f;font-size:16px;line-height:1.8;word-break:break-word">${escapeHtml(subject(template, payload))}</p>`
    : description
    ? `<div style="margin-top:22px"><div style="margin-bottom:10px;color:#650773;font-size:14px;font-weight:700">${isMeeting ? 'รายละเอียด / วาระการประชุม' : 'รายละเอียดงาน'}</div><div style="padding:16px;background:#faf5fc;border-left:4px solid #e4b445;border-radius:0 12px 12px 0;color:#51425c;font-size:14px;line-height:1.8;word-break:break-word;overflow-wrap:anywhere">${escapeHtml(description)}</div></div>`
    : ''
  const acknowledgeAction = acknowledgeUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px"><tr><td bgcolor="#74067b" style="background:#74067b;border-radius:12px"><a target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#74067b;color:#ffffff;padding:14px 28px;border-radius:12px;text-decoration:none;font-size:15px;font-weight:700" href="${escapeHtml(acknowledgeUrl)}">รับทราบ</a></td></tr></table><div style="margin-top:12px;color:#766280;font-size:12px;line-height:1.7">หากปุ่มรับทราบใช้งานไม่ได้ <a target="_blank" rel="noopener noreferrer" href="${escapeHtml(acknowledgeUrl)}" style="color:#74067b;text-decoration:underline;word-break:break-all">คลิกลิงก์รับทราบสำรอง</a></div>`
    : ''
  const documentList = documentItems.length
    ? `<div style="margin-top:22px;padding:16px;background:#fffbef;border:1px solid #f0dcab;border-radius:14px"><div style="margin-bottom:12px;color:#650773;font-size:15px;font-weight:700">เอกสารและลิงก์ Google Drive (${documentItems.length})</div>${documentItems.map((document) => {
      const url = document.url
      const name = url ? `<a target="_blank" rel="noopener noreferrer" href="${escapeHtml(url)}" style="color:#74067b;text-decoration:underline;font-weight:600;word-break:break-word;overflow-wrap:anywhere">${escapeHtml(document.name)}</a>` : escapeHtml(document.name)
      const size = formatSize(document.size)
      return `<div style="padding:10px 0;border-top:1px solid #f0e3c3;font-size:14px;line-height:1.7;word-break:break-word">${document.kind === 'drive' ? '🔗 Google Drive: ' : '📎 '}${name}${size ? `<span style="color:#766280;font-size:12px"> · ${size}</span>` : ''}</div>`
    }).join('')}<div style="margin-top:10px;color:#877446;font-size:11px;line-height:1.7">ลิงก์ไฟล์แนบภายในระบบใช้ได้ 7 วัน โปรดเก็บเป็นส่วนตัว หากหมดอายุให้เปิดรายการในระบบเพื่อโหลดลิงก์ใหม่</div></div>`
    : ''
  const brand = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="164" alt="PEA การไฟฟ้าส่วนภูมิภาค" style="display:block;width:164px;max-width:100%;height:auto;border:0">`
    : '<span style="color:#74067b;font-size:32px;font-weight:700">PEA</span>'
  const mascot = mascotUrl
    ? `<td width="104" valign="middle" style="width:104px;padding-left:14px"><img src="${escapeHtml(mascotUrl)}" width="104" alt="มาสคอต PEA ถือซองจดหมาย" style="display:block;width:104px;max-width:100%;height:auto;border:0"></td>`
    : ''
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject(template, payload))}</title></head><body style="margin:0;padding:0;background:#f6f1f9;font-family:Arial,'Noto Sans Thai',Tahoma,sans-serif;color:#35213f"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f6f1f9" style="width:100%;background:#f6f1f9"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #e9dbee;border-radius:22px;overflow:hidden"><tr><td style="padding:22px 24px 18px">${brand}<div style="margin-top:10px;color:#766280;font-size:10px;font-weight:700;letter-spacing:1px">PEA MEETING &amp; TASK CALENDAR</div></td></tr><tr><td bgcolor="#650773" style="padding:24px;background:#650773;border-bottom:4px solid #e4b445"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed"><tr><td valign="middle"><div style="margin-bottom:10px;color:#f7d879;font-size:13px;font-weight:700;line-height:1.7">${escapeHtml(subject(template, {}))}</div><h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;line-height:1.5;word-break:break-word;overflow-wrap:anywhere">${escapeHtml(payload.title || subject(template, payload))}</h1></td>${mascot}</tr></table></td></tr><tr><td style="padding:24px"><div style="margin-bottom:14px;color:#650773;font-size:15px;font-weight:700">${isMeeting ? 'รายละเอียดการประชุม' : 'รายละเอียดงาน'}</div>${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse;border:1px solid #eee5f3">${rows}</table>` : ''}${descriptionBlock}${documentList}${acknowledgeAction}</td></tr><tr><td bgcolor="#faf7fc" style="padding:18px 24px;background:#faf7fc;border-top:1px solid #eee5f3"><div style="color:#650773;font-size:12px;font-weight:700;line-height:1.7">PEA · พลังงานเพื่อชีวิตที่ดีกว่า</div><div style="margin-top:5px;color:#8c7a97;font-size:11px;line-height:1.7">อีเมลนี้ส่งโดยระบบ PEA Meeting &amp; Task Calendar</div></td></tr></table></td></tr></table></body></html>`
}
