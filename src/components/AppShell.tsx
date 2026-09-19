import { CalendarDays, LogOut, Settings, ShieldCheck, UserRound } from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useLanguage } from '../i18n/LanguageProvider'
import { LanguageToggle } from './LanguageToggle'

export function AppShell() {
  const { profile, user, signOut } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const logout = async () => {
    if (!window.confirm('ยืนยันออกจากระบบหรือไม่? หากกดยกเลิก คุณจะยังคงเข้าสู่ระบบอยู่')) return
    await signOut()
    navigate('/login', { replace: true })
  }
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-2.5 font-bold text-slate-900"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white"><CalendarDays size={20} /></span><span className="hidden sm:inline">{t('appName')}</span></div>
          <nav className="ml-2 flex h-full items-center" aria-label="เมนูหลัก">
            <NavLink to="/calendar" className={({ isActive }) => `flex h-full items-center border-b-2 px-3 text-sm font-semibold ${isActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{t('calendar')}</NavLink>
            {profile?.role === 'admin' && <NavLink to="/admin" className={({ isActive }) => `flex h-full items-center gap-1 border-b-2 px-3 text-sm font-semibold ${isActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}><ShieldCheck size={16} />Admin</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <LanguageToggle />
            <div className="hidden max-w-56 items-center gap-2 px-2 text-right md:flex"><UserRound size={18} className="text-slate-400" /><div><div className="flex items-center justify-end gap-1.5"><p className="truncate text-sm font-semibold">{profile?.full_name || user?.email}</p>{profile?.role === 'admin' && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">ผู้ดูแลระบบ</span>}</div><p className="truncate text-xs text-slate-500">{profile?.employee_id || '—'}</p></div></div>
            <NavLink to="/profile" className={({ isActive }) => `rounded-lg p-2.5 ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100'}`} aria-label="โปรไฟล์และตั้งค่า"><Settings size={19} /></NavLink>
            <button type="button" onClick={logout} className="rounded-lg p-2.5 text-slate-500 hover:bg-red-50 hover:text-red-600" aria-label={t('signOut')}><LogOut size={19} /></button>
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
