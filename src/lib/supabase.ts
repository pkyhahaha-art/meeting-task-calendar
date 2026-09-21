import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
export const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

export const supabase = createClient<Database>(
  supabaseUrl || 'https://configuration-required.supabase.co',
  supabasePublishableKey || 'configuration-required',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
