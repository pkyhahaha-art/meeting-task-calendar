import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const secret = Deno.env.get('REPORTING_SYNC_SECRET')
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'content-type': 'application/json' } })
}

Deno.serve(async (request) => {
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return response({ error: 'Unauthorized' }, 401)
  const cursor = new URL(request.url).searchParams.get('cursor') || '1970-01-01T00:00:00.000Z'
  const [profiles, auditLogs, deliveries, systemLogs] = await Promise.all([
    admin.from('profiles').select('id,employee_id,full_name,email,role,status,updated_at').gt('updated_at', cursor).order('updated_at').limit(1000),
    admin.from('audit_logs').select('id,actor_user_id,action,entity_type,entity_id,created_at').gt('created_at', cursor).order('created_at').limit(1000),
    admin.from('notification_deliveries').select('id,event_id,task_id,recipient_type,channel,template_key,status,attempt,error_code,created_at,sent_at').gt('created_at', cursor).order('created_at').limit(1000),
    admin.from('system_logs').select('id,job_name,status,processed_count,created_at').gt('created_at', cursor).order('created_at').limit(1000),
  ])
  const error = profiles.error || auditLogs.error || deliveries.error || systemLogs.error
  if (error) return response({ error: error.message }, 500)
  return response({
    cursor: new Date().toISOString(),
    profiles: profiles.data ?? [], auditLogs: auditLogs.data ?? [],
    notificationDeliveries: deliveries.data ?? [], systemLogs: systemLogs.data ?? [],
  })
})
