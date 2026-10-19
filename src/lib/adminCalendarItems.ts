import type { Json } from './database.types'
import { reportDateBounds, reportPageSize, type ReportDates } from './adminReports'
import { supabase } from './supabase'

export type AdminCalendarItem = {
  entity: 'task' | 'meeting'; id: string; title: string; creator_user_id: string
  creator_name: string; creator_email: string; created_at: string; affiliation: string
  status: string; recurring: boolean; start_datetime: string | null; end_datetime: string | null
  due_date: string | null; due_time: string | null
}
export type AdminCalendarFilters = ReportDates & { entity: string; creator: string; search: string }
export type AdminMeetingOccurrence = { id: string; occurrence_key: string; start_datetime: string; end_datetime: string | null }
export const adminItemKey = (item: Pick<AdminCalendarItem, 'entity' | 'id'>) => `${item.entity}:${item.id}`

export type AdminCalendarTrashCounts = { taskCount: number; meetingCount: number; totalCount: number }
export type AdminCalendarTrashPreview = AdminCalendarTrashCounts & { snapshot: string }

function trashCounts(value: unknown): AdminCalendarTrashCounts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ผลการตรวจรายการไม่ครบถ้วน กรุณาโหลดภาพรวมใหม่')
  const row = value as Record<string, unknown>
  const counts = [row.task_count, row.meeting_count, row.total_count]
  if (!counts.every((count) => typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
    || Number(row.task_count) + Number(row.meeting_count) !== row.total_count) throw new Error('จำนวนรายการไม่ถูกต้อง กรุณาโหลดภาพรวมใหม่')
  return { taskCount: row.task_count as number, meetingCount: row.meeting_count as number, totalCount: row.total_count as number }
}

export async function loadAdminCalendarTrashPreview(): Promise<AdminCalendarTrashPreview> {
  const { data, error } = await supabase.rpc('admin_calendar_trash_preview')
  if (error) throw error
  const counts = trashCounts(data)
  const snapshot = (data as Record<string, unknown>).snapshot
  if (typeof snapshot !== 'string' || !/^v1:[0-9a-f]{32}$/.test(snapshot)) throw new Error('ไม่พบภาพรวมรายการที่ยืนยันได้ กรุณาโหลดใหม่')
  return { ...counts, snapshot }
}

export async function trashAllAdminCalendarItems(preview: AdminCalendarTrashPreview, reason: string, confirmation: string): Promise<AdminCalendarTrashCounts> {
  const trimmed = reason.trim()
  if (!trimmed || [...trimmed].length > 500) throw new Error('กรุณาระบุเหตุผลไม่เกิน 500 ตัวอักษร')
  if (confirmation !== 'ลบทั้งหมด') throw new Error('กรุณาพิมพ์ “ลบทั้งหมด” ให้ตรงตามข้อความ')
  if (!preview || typeof preview.snapshot !== 'string' || !/^v1:[0-9a-f]{32}$/.test(preview.snapshot)) throw new Error('กรุณาโหลดภาพรวมรายการใหม่')
  trashCounts({ task_count: preview.taskCount, meeting_count: preview.meetingCount, total_count: preview.totalCount })
  const { data, error } = await supabase.rpc('admin_trash_all_calendar_items', {
    target_snapshot: preview.snapshot, target_reason: trimmed, target_confirmation: confirmation,
  })
  if (error) throw error
  const counts = trashCounts(data)
  if (counts.taskCount !== preview.taskCount || counts.meetingCount !== preview.meetingCount || counts.totalCount !== preview.totalCount) throw new Error('จำนวนรายการที่ตอบกลับไม่ตรงกับภาพรวม กรุณาโหลดข้อมูลใหม่ก่อนดำเนินการต่อ')
  return counts
}

export async function loadAdminCalendarItems(filters: AdminCalendarFilters, page: number) {
  const { start, end } = reportDateBounds(filters)
  const { data, error } = await supabase.rpc('admin_calendar_items', {
    target_entity: filters.entity, target_creator_user_id: filters.creator || undefined,
    target_search: filters.search.trim(), target_created_from: start, target_created_to: end,
    target_offset: page * reportPageSize, target_limit: reportPageSize,
  })
  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || !Array.isArray(data.rows) || typeof data.total_count !== 'number') throw new Error('โหลดรายการไม่ครบถ้วน กรุณาลองใหม่')
  return { rows: data.rows as unknown as AdminCalendarItem[], count: data.total_count }
}

export async function loadAdminMeetingOccurrences(eventId: string) {
  const { data, error } = await supabase.rpc('admin_meeting_occurrences', { target_event_id: eventId })
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('โหลดวันนัดไม่ได้ กรุณาลองใหม่')
  return data as unknown as AdminMeetingOccurrence[]
}

export async function trashAdminCalendarItems(items: Pick<AdminCalendarItem, 'entity' | 'id'>[], reason: string) {
  const unique = [...new Map(items.map(item => [adminItemKey(item), { entity: item.entity, id: item.id }])).values()]
  if (!unique.length || unique.length > 100) throw new Error('กรุณาเลือก 1–100 รายการ')
  const trimmed = reason.trim()
  if (!trimmed || trimmed.length > 500) throw new Error('กรุณาระบุเหตุผลไม่เกิน 500 ตัวอักษร')
  const { data, error } = await supabase.rpc('admin_trash_calendar_items', { target_items: unique as Json, target_reason: trimmed })
  if (error) throw error
  if (typeof data !== 'number') throw new Error('ไม่พบผลการย้ายเข้าถังขยะ กรุณาโหลดรายการใหม่')
  return data
}

export async function cancelAdminMeetingOccurrence(eventId: string, occurrenceKey: string, reason: string) {
  const trimmed = reason.trim()
  if (!trimmed || trimmed.length > 500) throw new Error('กรุณาระบุเหตุผลไม่เกิน 500 ตัวอักษร')
  const { data, error } = await supabase.rpc('admin_cancel_meeting_occurrence', {
    target_event_id: eventId, target_occurrence_start: occurrenceKey, target_reason: trimmed,
  })
  if (error) throw error
  return data
}
