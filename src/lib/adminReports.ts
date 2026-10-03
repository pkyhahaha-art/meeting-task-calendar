import type { Database, Json } from './database.types'
import { validOrganization } from './organization'

export type AdminProfile = Database['public']['Tables']['profiles']['Row']
export type AdminDelivery = Omit<Database['public']['Tables']['notification_deliveries']['Row'], 'payload' | 'idempotency_key' | 'provider_reference'> & { title: string | null; push_user_id: string | null }
export type AdminAudit = Omit<Database['public']['Tables']['audit_logs']['Row'], 'metadata'>
export type AdminSystemLog = Database['public']['Tables']['system_logs']['Row']
export type ReportDates = { from: string; to: string }
export type MemberFilters = { search: string; status: string; unit: string; department: string; missing: boolean }
export type DeliveryFilters = ReportDates & { channel: string; status: string; entity: string; search: string }
export type AuditFilters = ReportDates & { action: string; entity: string; actor: string }
export type SystemFilters = ReportDates & { status: string; search: string }
export type ReportPage<T> = { rows: T[]; count: number }
export const reportPageSize = 25

export function reportDateBounds({ from, to }: ReportDates) {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('กรุณาเลือกวันที่ให้ถูกต้อง')
    const date = new Date(`${value}T00:00:00+07:00`)
    if (!Number.isFinite(date.getTime()) || new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10) !== value) throw new Error('กรุณาเลือกวันที่ให้ถูกต้อง')
    return date
  }
  const start = from ? parse(from) : null
  const end = to ? parse(to) : null
  if (start && end && start > end) throw new Error('วันเริ่มต้นต้องไม่อยู่หลังวันสิ้นสุด')
  return { start: start?.toISOString(), end: end ? new Date(end.getTime() + 86400000).toISOString() : undefined }
}

export function filterAdminProfiles(rows: AdminProfile[], filters: MemberFilters) {
  const search = filters.search.trim().toLocaleLowerCase()
  return rows.filter((row) => (!search || [row.full_name, row.employee_id, row.email].some((value) => value?.toLocaleLowerCase().includes(search)))
    && (!filters.status || row.status === filters.status) && (!filters.unit || row.organization_unit === filters.unit)
    && (!filters.department || row.department === filters.department)
    && (!filters.missing || !validOrganization(row.organization_unit || '', row.department || '')))
}

/** Read every page, detecting truncation or a changing result instead of exporting a partial report. */
export async function collectReportRows<T extends { id: string | number }>(load: (offset: number, limit: number) => Promise<ReportPage<T>>) {
  const rows: T[] = []
  const ids = new Set<string | number>()
  let total: number | undefined
  for (;;) {
    const page = await load(rows.length, 200)
    if (total === undefined) total = page.count
    if (page.count !== total || (rows.length < total && !page.rows.length)) throw new Error('ข้อมูลเปลี่ยนระหว่างโหลดรายงาน กรุณาลองใหม่')
    for (const row of page.rows) {
      if (ids.has(row.id)) throw new Error('ข้อมูลเปลี่ยนระหว่างโหลดรายงาน กรุณาลองใหม่')
      ids.add(row.id); rows.push(row)
    }
    if (rows.length === total) return rows
    if (rows.length > total) throw new Error('ข้อมูลรายงานไม่ครบถ้วน กรุณาลองใหม่')
  }
}

export function csvReport(headers: string[], rows: unknown[][]) {
  const cell = (value: unknown) => {
    let text = value == null ? '' : String(value)
    // Spreadsheet apps must treat user-entered names/titles as text, not formulas.
    if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`
    return `"${text.replaceAll('"', '""')}"`
  }
  return '\uFEFF' + [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')
}

export function downloadCsv(name: string, headers: string[], rows: unknown[][]) {
  const url = URL.createObjectURL(new Blob([csvReport(headers, rows)], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = name
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function jsonText(value: Json, key: string): string {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof value[key] === 'string' ? value[key] as string : ''
}

export function safeDiagnosticText(value: string) {
  return value.replace(/https?:\/\/[^\s"'<>]+/g, (url) => {
    try { return `${new URL(url).origin}/…` } catch { return '[ลิงก์]' }
  }).replace(/((?:authorization|apikey|token|password|secret|p256dh)\s*[=:]\s*)[^\s,;]+/gi, '$1[ซ่อน]').slice(0, 1500)
}

export function deliveryTitle(row: AdminDelivery) { return row.title || row.task_id || row.event_id || row.template_key }
export function deliveryRecipient(row: AdminDelivery, members: AdminProfile[]) {
  const userId = row.push_user_id
  const member = members.find((item) => item.id === userId || item.email.toLowerCase() === row.recipient_reference.toLowerCase())
  return member ? `${member.full_name} · ${member.email}` : row.channel === 'push' ? `อุปกรณ์ ${row.recipient_reference}` : row.recipient_reference
}

export function deliveryAdvice(row: AdminDelivery) {
  if (row.status === 'retry') return 'ระบบกำลังลองส่งใหม่อัตโนมัติ ตรวจเวลาลองครั้งถัดไปแล้วกดโหลดข้อมูลใหม่ ไม่ต้องกดส่งซ้ำ'
  if (row.status === 'deferred_quota') return 'ระบบติดข้อจำกัดการส่ง ตรวจรอบทำงานและโควตาของบริการกับผู้ดูแลด้านเทคนิค'
  if (row.status === 'sent') return 'รายการนี้ส่งแล้ว หากมือถือไม่แสดง ให้ผู้รับตรวจอินเทอร์เน็ต ศูนย์การแจ้งเตือน และการตั้งค่าแจ้งเตือนของแอป'
  if (row.status === 'queued' || row.status === 'processing') return 'ตรวจเวลาที่กำหนดส่งและงานระบบล่าสุด จากนั้นโหลดข้อมูลใหม่เพื่อตรวจสถานะ'
  if (row.status === 'skipped') return 'ตรวจเหตุผลที่ข้ามรายการและสถานะงาน/ประชุม ระบบอาจข้ามรายการที่ยกเลิกหรือไม่เข้าเงื่อนไขแล้ว'
  if (row.channel === 'push' && /410|404|expired|subscription|อุปกรณ์/i.test(`${row.error_code} ${row.error_message}`)) return 'ให้ผู้รับเปิดแอปจาก Home Screen และตรวจการเชื่อมต่อ หากการเชื่อมต่อหมดอายุ ให้เชื่อมมือถือใหม่จากบัญชีของผู้รับ'
  if (/401|403|credential|configuration|vapid/i.test(`${row.error_code} ${row.error_message}`)) return 'ให้ผู้ดูแลด้านเทคนิคตรวจการตั้งค่าบริการส่งแจ้งเตือนและสิทธิ์ของระบบ'
  return 'ตรวจรายละเอียดข้อผิดพลาดและงานระบบล่าสุด หากเป็นปัญหาเอกสารให้ผู้สร้างตรวจไฟล์แนบ หากเป็นบริการส่งให้ผู้ดูแลด้านเทคนิคตรวจการเชื่อมต่อ'
}
