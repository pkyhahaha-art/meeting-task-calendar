import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, CalendarRange, CalendarClock, LogOut, Menu, Settings, ShieldCheck, Smartphone, UserRound, X } from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import peaLogo from '../../ภาพประกอบUI/PEA Logo (1).png'

import { useAuth } from '../auth/AuthProvider'
import { useLanguage } from '../i18n/LanguageProvider'
import { eventCreationPeriods } from '../lib/eventStats'
import { supabase } from '../lib/supabase'
import { useConfirm } from './ConfirmDialogProvider'
import { LanguageToggle } from './LanguageToggle'
import { MemberAvatar } from './MemberAvatar'
import { AppFooter } from './AppFooter'


async function countCreatedItems(start: string, end: string) {
  const [meetings, tasks] = await Promise.all([
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('status', 'scheduled').is('deleted_at', null).gte('created_at', start).lt('created_at', end),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).neq('status', 'cancelled').is('deleted_at', null).gte('created_at', start).lt('created_at', end),
  ])
  if (meetings.error) throw meetings.error
  if (tasks.error) throw tasks.error
  return (meetings.count ?? 0) + (tasks.count ?? 0)
}

function EventStatsCard({ stats, loading, error }: { stats?: { today: number; week: number; month: number }; loading: boolean; error: boolean }) {
  const { language, text } = useLanguage()
  const value = (count?: number) => error ? '–' : loading && count === undefined ? '…' : (count ?? 0).toLocaleString(language === 'th' ? 'th-TH' : 'en-GB')
  return (
    <div className="calendar-event-stats-card" aria-label={text('จำนวน Meeting และ Task ที่สร้างและยังไม่ถูกยกเลิกหรือลบ', 'Meetings and tasks created that have not been cancelled or deleted')}>
      <span className="calendar-created-caption sr-only">{text('รายการที่สร้าง', 'Items created')}</span>
      {([[text('วันนี้', 'Today'), stats?.today, CalendarDays], [text('สัปดาห์นี้', 'This week'), stats?.week, CalendarRange], [text('เดือนนี้', 'This month'), stats?.month, CalendarClock]] as const).map(([label, count, Icon]) => (
        <span key={label} className="calendar-created-period">
          <Icon className="calendar-created-icon" size={22} aria-hidden="true" />
          <span className="block text-[10px] font-medium text-slate-500">{label}</span>
          <span className="block text-base font-extrabold leading-5 text-brand-800">{value(count)}</span>
        </span>
      ))}
    </div>
  )
}

export function AppShell() {
  const { profile, user, signOut } = useAuth()
  const { t, text } = useLanguage()
  const confirm = useConfirm()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [desktopMenuExpanded, setDesktopMenuExpanded] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const eventStatsQuery = useQuery({
    queryKey: ['event-creation-stats', user?.id],
    enabled: Boolean(user && profile?.status === 'active'),
    refetchInterval: 5 * 60 * 1000,
    queryFn: async () => {
      const periods = eventCreationPeriods()
      const [today, week, month] = await Promise.all([
        countCreatedItems(periods.today.start, periods.today.end),
        countCreatedItems(periods.week.start, periods.week.end),
        countCreatedItems(periods.month.start, periods.month.end),
      ])
      return { today, week, month }
    },
  })
  const statsCard = <EventStatsCard stats={eventStatsQuery.data} loading={eventStatsQuery.isLoading} error={eventStatsQuery.isError} />
  const logout = async () => {
    if (!await confirm({ title: text('ออกจากระบบ?', 'Sign out?'), message: text('คุณจะต้องเข้าสู่ระบบใหม่ในครั้งถัดไป', 'You will need to sign in again next time.'), confirmLabel: t('signOut'), tone: 'danger' })) return
    setLogoutError(null)
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch {
      setLogoutError(text('ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง', 'Unable to sign out. Please try again.'))
    }
  }
  const calendarMode = location.pathname === '/calendar'
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium whitespace-nowrap transition ${isActive ? 'bg-purple-100 text-purple-900' : 'text-slate-700 hover:bg-purple-50 hover:text-purple-900'}`
  const navLabel = 'lg:sr-only lg:group-hover:not-sr-only lg:group-has-[:focus-visible]:not-sr-only'
  const desktopSidebarWidth = desktopMenuExpanded ? 'lg:w-[254px]' : 'lg:w-[70px]'
  const displayName = profile?.full_name || user?.email || text('ผู้ใช้งาน', 'User')

  return (
    <div className={`app-shell min-h-screen bg-[#F7F5F9] text-slate-900 lg:grid lg:grid-cols-[70px_minmax(0,1fr)] ${calendarMode ? 'calendar-page-shell' : ''}`}>
      <a className="app-skip-link" href={`#${location.pathname}`} onClick={(event) => { event.preventDefault(); document.getElementById('app-main-content')?.focus() }}>{text('ข้ามไปยังเนื้อหา', 'Skip to content')}</a>
      <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-white/95 px-4 py-2 backdrop-blur lg:hidden">
        <button type="button" onClick={() => setMenuOpen(true)} className="rounded-xl p-2 text-brand-700 hover:bg-slate-50" aria-label={text('เปิดเมนู', 'Open menu')}><Menu size={24} /></button>
        <span className="min-w-0 flex-1 text-xs font-bold leading-tight text-brand-700">{t('appName')}</span>
        <LanguageToggle />
        <div className="flex w-full justify-center">{statsCard}</div>
      </header>
      {menuOpen && <button type="button" className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden" onClick={() => setMenuOpen(false)} aria-label={text('ปิดเมนู', 'Close menu')} />}
      <aside className={`calendar-app-rail group fixed inset-y-0 left-0 z-50 flex w-[254px] flex-col border-r border-purple-100 bg-white shadow-xl transition-[width,transform,box-shadow] duration-300 motion-reduce:transition-none lg:sticky lg:top-0 lg:h-screen ${desktopSidebarWidth} lg:translate-x-0 lg:overflow-hidden lg:shadow-none lg:hover:w-[254px] lg:hover:shadow-xl lg:has-[:focus-visible]:w-[254px] lg:has-[:focus-visible]:shadow-xl ${desktopMenuExpanded ? 'sidebar-expanded' : ''} ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex min-h-20 items-center justify-between border-b border-purple-100 px-5 lg:px-2 lg:group-hover:px-5 lg:group-has-[:focus-visible]:px-5">
          <span className="sidebar-brand-tile" role="img" aria-label={text('PEA การไฟฟ้าส่วนภูมิภาค', 'PEA Provincial Electricity Authority')}>
            <span className="sidebar-brand-seal" aria-hidden="true"><img src={peaLogo} alt="" width="5114" height="1823" /></span>
            <img className="sidebar-brand-full" src={peaLogo} alt="" width="5114" height="1823" aria-hidden="true" />
          </span>
          <button type="button" onClick={() => setDesktopMenuExpanded((expanded) => !expanded)} className="touch-sidebar-toggle rounded-lg p-2 text-slate-600 hover:bg-purple-50 hover:text-brand-700" aria-label={desktopMenuExpanded ? text('ยุบเมนู', 'Collapse menu') : text('ขยายเมนู', 'Expand menu')} aria-expanded={desktopMenuExpanded}><Menu size={18} /></button>
          <button type="button" onClick={() => setMenuOpen(false)} className="rounded-lg p-1 text-slate-500 lg:hidden" aria-label={text('ปิดเมนู', 'Close menu')}><X size={20} /></button>
        </div>
        <nav className="px-3 py-5" aria-label={text('เมนูหลัก', 'Main navigation')}>
          <NavLink to="/calendar" title={t('calendar')} onClick={() => { setMenuOpen(false); setDesktopMenuExpanded(false) }} className={navClass}><CalendarDays size={19} /><span className={`${navLabel} lg:group-[.sidebar-expanded]:not-sr-only`}>{t('calendar')}</span></NavLink>
          <NavLink to="/mobile-push" title={text('แจ้งเตือนมือถือ', 'Mobile notifications')} onClick={() => { setMenuOpen(false); setDesktopMenuExpanded(false) }} className={navClass}><Smartphone size={19} className="shrink-0" /><span className={`${navLabel} lg:group-[.sidebar-expanded]:not-sr-only`}>{text('แจ้งเตือนมือถือ', 'Mobile notifications')}</span></NavLink>
          <NavLink to="/profile" title={text('บัญชีและตั้งค่า', 'Account & settings')} onClick={() => { setMenuOpen(false); setDesktopMenuExpanded(false) }} className={navClass}><UserRound size={19} /><span className={`${navLabel} lg:group-[.sidebar-expanded]:not-sr-only`}>{text('บัญชีและตั้งค่า', 'Account & settings')}</span></NavLink>
          {profile?.role === 'admin' && <NavLink to="/admin" title="Admin" onClick={() => { setMenuOpen(false); setDesktopMenuExpanded(false) }} className={navClass}><ShieldCheck size={19} /><span className={`${navLabel} lg:group-[.sidebar-expanded]:not-sr-only`}>Admin</span></NavLink>}
        </nav>
        <div className="app-sidebar-footer mt-auto border-t border-purple-100 px-4 py-3">
          {logoutError && <p role="alert" className="mb-2 text-xs text-red-600">{logoutError}</p>}
          <div className="app-sidebar-identity mb-2 flex min-w-0 items-center gap-3"><MemberAvatar id={user?.id || ""} name={displayName} size={36} /><div className={`min-w-0 ${navLabel} lg:group-[.sidebar-expanded]:not-sr-only`}><p className="truncate text-sm font-bold">{displayName}</p><p className="truncate text-xs text-slate-500">{profile?.employee_id || user?.email}</p></div></div>
          <button type="button" onClick={() => void logout()} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-red-50 hover:text-red-700" aria-label={t('signOut')} title={t('signOut')}><LogOut size={17} /><span className={`${navLabel} lg:group-[.sidebar-expanded]:not-sr-only`}>{t('signOut')}</span></button>
        </div>
      </aside>
      <div className={`flex min-h-screen min-w-0 flex-col ${location.pathname === '/calendar' ? 'calendar-page-content' : ''}`}>
        <header className={`app-desktop-topbar hidden min-h-16 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-slate-100 bg-white/90 px-6 lg:grid ${calendarMode ? 'calendar-app-topbar' : ''}`}>
          <div className="flex min-w-0 items-center gap-3">
            {location.pathname !== '/calendar' && <button type="button" onClick={() => navigate('/calendar')} className="btn-secondary min-h-9 px-3" aria-label={text('กลับไปหน้าปฏิทิน', 'Back to calendar')}><ArrowLeft size={16} />{text('กลับ', 'Back')}</button>}

            <span className="app-header-heading min-w-0 leading-tight"><span className="block text-sm font-extrabold leading-tight tracking-tight text-brand-900">{calendarMode ? text('ปฏิทิน', 'Calendar') : 'PEA Meeting & Task Calendar'}</span><span className="block text-xs font-medium text-slate-500">{calendarMode ? text('การจัดการนัดหมาย ประชุม และงานที่ต้องดำเนินการ', 'Manage appointments, meetings and tasks') : text('ระบบปฏิทินการประชุมและงาน', 'Meeting and task management')}</span></span>
          </div>
          {statsCard}
          <div className="app-header-account flex min-w-0 items-center justify-end gap-3"><LanguageToggle /><span className="app-header-user-name hidden text-sm font-semibold text-slate-700 xl:block">{displayName}</span><NavLink to="/profile" className="flex shrink-0 items-center gap-2 rounded-full bg-slate-100 p-2 text-brand-700" aria-label={text('บัญชีและตั้งค่า', 'Account & settings')}><MemberAvatar id={user?.id || ""} name={displayName} size={28} /><Settings size={18} /></NavLink></div>
        </header>
        <div id="app-main-content" className="app-route-content" tabIndex={-1}><Outlet /></div>
        <AppFooter className="mt-auto xl:h-12 xl:shrink-0 xl:py-1" />
      </div>
    </div>
  )
}
