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
