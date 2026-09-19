import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ConfigurationRequired } from './components/ConfigurationRequired'
import { ProtectedRoute } from './components/ProtectedRoute'
import { isSupabaseConfigured } from './lib/supabase'
import { AuthCallbackPage } from './pages/AuthCallbackPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'

const CalendarPage = lazy(() => import('./pages/CalendarPage').then((module) => ({ default: module.CalendarPage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })))
const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })))

const pageFallback = <div className="p-8 text-center text-slate-500">กำลังโหลด…</div>

export default function App() {
  if (!isSupabaseConfigured) return <ConfigurationRequired />
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route path="/auth/callback" element={<AuthCallbackPage />} />
    <Route element={<ProtectedRoute />}><Route element={<AppShell />}>
      <Route path="/calendar" element={<Suspense fallback={pageFallback}><CalendarPage /></Suspense>} />
      <Route path="/profile" element={<Suspense fallback={pageFallback}><ProfilePage /></Suspense>} />
      <Route path="/admin" element={<Suspense fallback={pageFallback}><AdminPage /></Suspense>} />
    </Route></Route>
    <Route path="/account-disabled" element={<main className="flex min-h-screen items-center justify-center p-6 text-center"><div><h1 className="text-2xl font-bold">บัญชีถูกระงับ</h1><p className="mt-2 text-slate-600">กรุณาติดต่อผู้ดูแลระบบ</p></div></main>} />
    <Route path="*" element={<Navigate to="/calendar" replace />} />
  </Routes>
}
