import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { passwordRecoveryUrl } from './authRouting'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
export const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

const recoveryUrl = typeof window === 'undefined' ? null : passwordRecoveryUrl(window.location.href)
if (recoveryUrl && recoveryUrl !== window.location.href) window.history.replaceState(null, '', recoveryUrl)

export const supabase = createClient<Database>(
  supabaseUrl || 'https://configuration-required.supabase.co',
  supabasePublishableKey || 'configuration-required',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // ResetPasswordPage validates recovery credentials; automatic detection can clear the hash route first.
      detectSessionInUrl: !recoveryUrl,
    },
  },
)
