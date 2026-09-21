import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const cronSecret = Deno.env.get('NOTIFICATION_CRON_SECRET')

Deno.serve(async (request) => {
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) return new Response('Unauthorized', { status: 401 })
  const { data: candidates, error: candidateError } = await supabase.rpc('maintenance_storage_candidates')
  if (candidateError) return new Response(candidateError.message, { status: 500 })
  const byBucket = new Map<string, string[]>()
  for (const candidate of candidates ?? []) {
    const paths = byBucket.get(candidate.bucket_id) ?? []
    paths.push(candidate.storage_path)
    byBucket.set(candidate.bucket_id, paths)
  }
  for (const [bucket, paths] of byBucket) {
    for (let index = 0; index < paths.length; index += 100) {
      const { error } = await supabase.storage.from(bucket).remove(paths.slice(index, index + 100))
      if (error) return new Response(error.message, { status: 500 })
    }
  }
  const { data, error } = await supabase.rpc('run_scheduled_maintenance')
  if (error) return new Response(error.message, { status: 500 })
  return Response.json({ removedFiles: (candidates ?? []).length, maintenance: data })
})
