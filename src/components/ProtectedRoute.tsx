import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

export function ProtectedRoute() {
  const { user, profile, loading, profileLoading, authError, profileError, refreshSession, refreshProfile } = useAuth()
  const location = useLocation()
  if (loading || (user && profileLoading)) return <div className="flex min-h-screen items-center justify-center text-slate-500">กำลังโหลด…</div>
  const error = authError || (user && profileError)
  if (error) return <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center"><p role="alert" className="text-slate-600">{error}</p><button type="button" className="btn-primary" onClick={() => void (authError ? refreshSession() : refreshProfile())}>ลองอีกครั้ง</button></main>
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  if (profile?.status === 'disabled') return <Navigate to="/account-disabled" replace />
  return <Outlet />
}
