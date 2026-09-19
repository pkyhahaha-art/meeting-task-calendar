import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

export function ProtectedRoute() {
  const { user, profile, loading, profileLoading } = useAuth()
  const location = useLocation()
  if (loading || (user && profileLoading)) return <div className="flex min-h-screen items-center justify-center text-slate-500">กำลังโหลด…</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  if (profile?.status === 'disabled') return <Navigate to="/account-disabled" replace />
  return <Outlet />
}
