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
  if (rule.includes('BYDAY=MO,TU,WE,TH,FR')) return 'ทุกวันทำการ'
  if (rule.includes('FREQ=DAILY')) return 'ทุกวัน'
  if (rule.includes('FREQ=WEEKLY')) return 'ทุกสัปดาห์'
  if (rule.includes('FREQ=MONTHLY')) return 'ทุกเดือน'
  if (rule.includes('FREQ=YEARLY')) return 'ทุกปี'
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

type DocumentItem = { name: string; size: number | null; url: string }

function documents(value: unknown): DocumentItem[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).map((item) => {
    if (typeof item === 'string') return { name: text(item), size: null, url: '' }
    if (!item || typeof item !== 'object') return { name: '', size: null, url: '' }
    const record = item as Record<string, unknown>
    const size = Number(record.size)
    return { name: text(record.name), size: Number.isFinite(size) && size > 0 ? size : null, url: validUrl(record.url) }
  }).filter((item) => item.name)
}

function formatSize(value: number | null) {
  if (!value) return ''
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function subject(template: string, payload: Record<string, unknown>) {
  const title = text(payload.title)
  const labels: Record<string, string> = {
    meeting_created: 'Meeting ใหม่', meeting_updated: 'Meeting ถูกแก้ไข', meeting_cancelled: 'Meeting ถูกยกเลิก',
    meeting_guest_added: 'คุณได้รับเชิญเข้าร่วม Meeting', meeting_reminder: 'แจ้งเตือน Meeting', task_assigned: 'คุณได้รับมอบหมาย Task',
    task_reminder: 'แจ้งเตือน Task', task_updated: 'Task ถูกแก้ไข', task_cancelled: 'Task ถูกยกเลิก', task_completed: 'Task เสร็จแล้ว',
  }
  return `${labels[template] ?? 'การแจ้งเตือน'}${title ? `: ${title}` : ''}`
}

export function html(template: string, payload: Record<string, unknown>) {
  const isMeeting = payload.entity === 'meeting'
  const description = text(payload.description)
  const allDay = payload.all_day === true
  const startsAt = allDay ? formatDate(payload.start_datetime) : formatDateTime(payload.start_datetime)
  const endsAt = allDay ? formatDate(payload.end_datetime) : formatDateTime(payload.end_datetime)
  const dueDate = text(payload.due_date)
  const dueTime = text(payload.due_time)
  const guestUrl = validUrl(payload.guest_url)
  const meetingUrl = validUrl(payload.meeting_url)
  const externalUrl = validUrl(payload.external_url)
  const internalTaskUrl = validUrl(payload.internal_task_url)
  const actionUrl = guestUrl || meetingUrl || externalUrl || internalTaskUrl
  const documentUrl = isMeeting ? guestUrl || meetingUrl : externalUrl || internalTaskUrl
  const documentItems = documents(isMeeting ? payload.meeting_documents : payload.task_documents)
  const rows = [
    ['ผู้จัด', text(payload.organizer)],
    ['หน่วยงาน / สังกัด', text(payload.affiliation)],
    ['วันและเวลาเริ่ม', startsAt],
    ['วันและเวลาสิ้นสุด', endsAt],
    ['สถานที่', text(payload.location)],
    ['การทำซ้ำ', recurrenceLabel(payload.recurrence_rule)],
    ['กำหนดส่ง', [dueDate, dueTime].filter(Boolean).join(' ')],
    ['สถานะ', statusLabel(payload.status)],
  ].filter(([, value]) => value)
    .map(([label, value]) => `<tr><td style="width:150px;padding:9px 12px;color:#64748b;font-size:13px;border-bottom:1px solid #e2e8f0">${escapeHtml(label)}</td><td style="padding:9px 12px;color:#0f172a;font-size:14px;border-bottom:1px solid #e2e8f0">${escapeHtml(value)}</td></tr>`)
    .join('')
  const descriptionBlock = description
    ? `<div style="margin-top:18px"><div style="margin-bottom:6px;color:#64748b;font-size:13px;font-weight:700">รายละเอียด / วาระการประชุม</div><div style="padding:14px;background:#f8fafc;border-radius:10px;color:#334155;font-size:14px;line-height:1.7">${escapeHtml(description)}</div></div>`
    : ''
  const actionLabel = isMeeting ? 'เปิดรายละเอียด Meeting' : 'เปิด Task / อัปโหลดเอกสาร'
  const action = actionUrl
    ? `<div style="margin-top:20px"><a style="display:inline-block;background:#0f696c;color:#ffffff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700" href="${escapeHtml(actionUrl)}">${actionLabel}</a></div>`
    : ''
  const documentList = documentItems.length
    ? `<div style="margin-top:20px;padding:16px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:10px"><div style="margin-bottom:10px;color:#115e59;font-size:15px;font-weight:700">เอกสารแนบ (${documentItems.length})</div>${documentItems.map((document) => {
      const url = document.url || documentUrl
      const name = url ? `<a href="${escapeHtml(url)}" style="color:#0f696c;text-decoration:none;font-weight:600">${escapeHtml(document.name)}</a>` : escapeHtml(document.name)
      const size = formatSize(document.size)
      return `<div style="padding:8px 0;border-top:1px solid #ccfbf1">📎 ${name}${size ? `<span style="color:#64748b;font-size:12px"> · ${size}</span>` : ''}</div>`
    }).join('')}<div style="margin-top:8px;color:#64748b;font-size:12px">ลิงก์ดาวน์โหลดมีอายุจำกัด โปรดเก็บเป็นส่วนตัว</div></div>`
    : ''
  return `<div style="margin:0;padding:24px;background:#f1f5f9"><div style="max-width:640px;margin:auto;overflow:hidden;border:1px solid #cbd5e1;border-radius:16px;background:#ffffff;font-family:Arial,'Noto Sans Thai',sans-serif;color:#1e293b"><div style="padding:12px 24px;background:#0f696c;color:#ccfbf1;font-size:12px;font-weight:700;letter-spacing:.08em">MEETING &amp; TASK CALENDAR</div><div style="padding:24px"><div style="margin-bottom:6px;color:#0f766e;font-size:13px;font-weight:700">${escapeHtml(subject(template, {}))}</div><h1 style="margin:0 0 20px;color:#0f172a;font-size:24px;line-height:1.35">${escapeHtml(payload.title || subject(template, payload))}</h1>${rows ? `<table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px">${rows}</table>` : ''}${descriptionBlock}${documentList}${action}<div style="margin-top:24px;color:#94a3b8;font-size:11px">อีเมลนี้ส่งโดยระบบ Meeting &amp; Task Calendar</div></div></div></div>`
}
