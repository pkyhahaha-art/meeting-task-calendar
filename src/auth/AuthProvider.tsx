import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session, User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import type { Database } from '../lib/database.types'

type Profile = Database['public']['Tables']['profiles']['Row']

type AuthContextValue = {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  profileLoading: boolean
  authError: string | null
  profileError: string | null
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
  refreshSession: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileLoading, setProfileLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const sessionRevision = useRef(0)
  const profileRevision = useRef(0)
  const currentUserId = useRef<string | undefined>(undefined)
  const queryClient = useQueryClient()
  const invalidatePendingRequests = useCallback(() => {
    sessionRevision.current++
    profileRevision.current++
  }, [])

  const applySession = useCallback((nextSession: Session | null) => {
    const nextUserId = nextSession?.user.id
    if (currentUserId.current !== nextUserId) {
      profileRevision.current++
      queryClient.clear()
      setProfile(null)
      setProfileError(null)
      setProfileLoading(Boolean(nextUserId))
      currentUserId.current = nextUserId
    }
    setSession(nextSession)
    setAuthError(null)
    setLoading(false)
  }, [queryClient])

  const refreshSession = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    const revision = sessionRevision.current
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.getSession()
      if (error) throw error
      if (revision === sessionRevision.current) applySession(data.session)
    } catch {
      if (revision === sessionRevision.current) {
        setAuthError('ตรวจสอบการเข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง')
        setLoading(false)
      }
    }
  }, [applySession])

  const userId = session?.user.id
  const refreshProfile = useCallback(async () => {
    const revision = ++profileRevision.current
    if (!userId) { setProfile(null); setProfileError(null); setProfileLoading(false); return }
    setProfileLoading(true)
    setProfileError(null)
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).returns<Profile[]>().maybeSingle()
      if (error || !data) throw error ?? new Error('Profile not found')
      if (revision === profileRevision.current && currentUserId.current === userId) setProfile(data)
    } catch {
      if (revision === profileRevision.current && currentUserId.current === userId) {
        setProfile(null)
        setProfileError('โหลดข้อมูลบัญชีไม่สำเร็จ กรุณาลองอีกครั้ง')
      }
    } finally {
      if (revision === profileRevision.current && currentUserId.current === userId) setProfileLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    void refreshSession()
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      sessionRevision.current++
      applySession(nextSession)
    })
    return () => {
      invalidatePendingRequests()
      listener.subscription.unsubscribe()
    }
  }, [applySession, refreshSession, invalidatePendingRequests])

  useEffect(() => { void refreshProfile() }, [refreshProfile])

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    profile: profile?.id === userId ? profile : null,
    loading,
    profileLoading,
    authError,
    profileError,
    signOut: async () => {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      sessionRevision.current++
      applySession(null)
    },
    refreshProfile,
    refreshSession,
  }), [session, userId, profile, loading, profileLoading, authError, profileError, applySession, refreshProfile, refreshSession])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
