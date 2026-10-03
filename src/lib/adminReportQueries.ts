import { supabase } from './supabase'
import { collectReportRows, reportDateBounds, type AdminProfile, type AuditFilters, type DeliveryFilters, type ReportDates, type SystemFilters } from './adminReports'

export async function loadAdminProfiles() {
  return collectReportRows<AdminProfile>(async (offset, limit) => {
    const { data, count, error } = await supabase.from('profiles').select('*', { count: 'exact' })
      .order('full_name').order('id').range(offset, offset + limit - 1)
    if (error) throw error
    if (count === null) throw new Error('ไม่พบยอดสมาชิกทั้งหมด')
    return { rows: data || [], count }
  })
}

export async function loadAdminOverview(dates: ReportDates) {
  const { start, end } = reportDateBounds(dates)
  let events = supabase.from('events').select('id', { count: 'exact', head: true }).is('deleted_at', null)
  let tasks = supabase.from('tasks').select('id', { count: 'exact', head: true }).is('deleted_at', null)
  let problems = supabase.from('notification_deliveries').select('id', { count: 'exact', head: true }).in('status', ['failed', 'deferred_quota'])
  if (start) { events = events.gte('created_at', start); tasks = tasks.gte('created_at', start); problems = problems.gte('created_at', start) }
  if (end) { events = events.lt('created_at', end); tasks = tasks.lt('created_at', end); problems = problems.lt('created_at', end) }
  const [eventRows, taskRows, problemRows] = await Promise.all([events, tasks, problems])
  const error = eventRows.error || taskRows.error || problemRows.error
  if (error) throw error
  return { eventCount: eventRows.count || 0, taskCount: taskRows.count || 0, problemCount: problemRows.count || 0 }
}

export async function loadDeliveryReport(filters: DeliveryFilters, offset: number, limit: number, cutoff?: string) {
  const { start, end } = reportDateBounds(filters)
  // Do not load raw provider responses or delivery payload secrets into the report.
  let query = supabase.from('notification_deliveries').select('id,reminder_id,task_reminder_id,event_id,task_id,recipient_type,recipient_reference,channel,attempt,scheduled_at,next_attempt_at,sent_at,status,error_code,error_message,template_key,created_at,updated_at,title:payload->>title,push_user_id:payload->>push_user_id', { count: 'exact' })
  if (start) query = query.gte('created_at', start)
  if (end) query = query.lt('created_at', end)
  if (cutoff) query = query.lte('created_at', cutoff)
  if (filters.channel) query = query.eq('channel', filters.channel as 'email' | 'push' | 'line')
  if (filters.status) query = query.eq('status', filters.status as 'failed')
  if (filters.entity === 'task') query = query.not('task_id', 'is', null)
  if (filters.entity === 'meeting') query = query.not('event_id', 'is', null)
  const search = filters.search.trim()
  if (search) query = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(search)
    ? query.or(`task_id.eq.${search},event_id.eq.${search}`)
    : query.ilike('payload->>title', `%${search.replace(/[\\%_]/g, '\\$&')}%`)
  const { data, count, error } = await query.order('created_at', { ascending: false }).order('id').range(offset, offset + limit - 1)
  if (error) throw error
  if (count === null) throw new Error('ไม่พบยอดรายการทั้งหมด')
  return { rows: data || [], count }
}

export async function loadAuditReport(filters: AuditFilters, offset: number, limit: number, cutoff?: string) {
  const { start, end } = reportDateBounds(filters)
  let query = supabase.from('audit_logs').select('id,actor_user_id,action,entity_type,entity_id,created_at', { count: 'exact' })
  if (start) query = query.gte('created_at', start)
  if (end) query = query.lt('created_at', end)
  if (cutoff) query = query.lte('created_at', cutoff)
  if (filters.action.trim()) query = query.ilike('action', `%${filters.action.trim().replace(/[\\%_]/g, '\\$&')}%`)
  if (filters.entity) query = query.eq('entity_type', filters.entity)
  if (filters.actor) query = query.eq('actor_user_id', filters.actor)
  const { data, count, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1)
  if (error) throw error
  if (count === null) throw new Error('ไม่พบยอดประวัติทั้งหมด')
  return { rows: data || [], count }
}

export async function loadSystemReport(filters: SystemFilters, offset: number, limit: number, cutoff?: string) {
  const { start, end } = reportDateBounds(filters)
  let query = supabase.from('system_logs').select('*', { count: 'exact' })
  if (start) query = query.gte('created_at', start)
  if (end) query = query.lt('created_at', end)
  if (cutoff) query = query.lte('created_at', cutoff)
  if (filters.status) query = query.eq('status', filters.status as 'failed')
  if (filters.search.trim()) query = query.ilike('job_name', `%${filters.search.trim().replace(/[\\%_]/g, '\\$&')}%`)
  const { data, count, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1)
  if (error) throw error
  if (count === null) throw new Error('ไม่พบยอดงานระบบทั้งหมด')
  return { rows: data || [], count }
}

export async function loadLatestSystemLog() {
  const { data, error } = await supabase.from('system_logs').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data
}
