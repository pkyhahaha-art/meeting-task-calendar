import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, CalendarPlus, CalendarRange, CalendarClock, FileSpreadsheet, ListTodo, LogOut, Menu, Settings, ShieldCheck, Smartphone, UserRound, X } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import peaLogo from '../../ภาพประกอบUI/PEA Logo (1).png'

import { useAuth } from '../auth/AuthProvider'
import { useLanguage } from '../i18n/LanguageProvider'
import { eventAgendaPeriods } from '../lib/eventStats'
import { expandEvent } from '../lib/recurrence'
import { supabase } from '../lib/supabase'
import { useConfirm } from './ConfirmDialogProvider'
import { LanguageToggle } from './LanguageToggle'
import { MemberAvatar } from './MemberAvatar'
import { AppFooter } from './AppFooter'


async function countScheduledAgenda(periods: ReturnType<typeof eventAgendaPeriods>) {
  const [
    todayTasksRes,
    weekTasksRes,
    monthTasksRes,
    eventsRes,
    exceptionsRes,
  ] = await Promise.all([
    supabase.from('tasks').select('id', { count: 'exact', head: true }).neq('status', 'cancelled').is('deleted_at', null).is('recurrence_series_id', null).gte('due_date', periods.today.startDay).lt('due_date', periods.today.endDay),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).neq('status', 'cancelled').is('deleted_at', null).is('recurrence_series_id', null).gte('due_date', periods.week.startDay).lt('due_date', periods.week.endDay),
    supabase.from('tasks').select('id', { count: 'exact', head: true }).neq('status', 'cancelled').is('deleted_at', null).is('recurrence_series_id', null).gte('due_date', periods.month.startDay).lt('due_date', periods.month.endDay),
    supabase.from('events').select('id,start_datetime,end_datetime,recurrence_rule,recurrence_count,recurrence_until,status,deleted_at').eq('status', 'scheduled').is('deleted_at', null),
    supabase.from('event_occurrences').select('event_id,occurrence_key').neq('status', 'scheduled'),
  ])

  if (todayTasksRes.error) throw todayTasksRes.error
  if (weekTasksRes.error) throw weekTasksRes.error
  if (monthTasksRes.error) throw monthTasksRes.error
  if (eventsRes.error) throw eventsRes.error
  if (exceptionsRes.error) throw exceptionsRes.error

  const events = eventsRes.data ?? []
  const cancelledExceptions = new Set(
    (exceptionsRes.data ?? []).map((exc) => `${exc.event_id}:${exc.occurrence_key}`)
  )

  const countEventsBetween = (rangeStart: Date, rangeEnd: Date) => {
    let count = 0
    for (const evt of events) {
      if (!evt.recurrence_rule) {
        const start = new Date(evt.start_datetime)
        if (start >= rangeStart && start < rangeEnd) {
          count++
        }
      } else {
        const occurrences = expandEvent(
          {
            id: evt.id,
            start_datetime: evt.start_datetime,
            end_datetime: evt.end_datetime,
            recurrence_rule: evt.recurrence_rule,
            recurrence_count: evt.recurrence_count,
            recurrence_until: evt.recurrence_until,
          },
          rangeStart,
          rangeEnd
        )
        for (const occ of occurrences) {
          const occKey = `${evt.id}:${occ.start}`
          if (!cancelledExceptions.has(occKey)) {
            count++
          }
        }
      }
    }
    return count
  }

  const todayMeetings = countEventsBetween(new Date(periods.today.start), new Date(periods.today.end))
  const weekMeetings = countEventsBetween(new Date(periods.week.start), new Date(periods.week.end))
  const monthMeetings = countEventsBetween(new Date(periods.month.start), new Date(periods.month.end))

  return {
    today: (todayTasksRes.count ?? 0) + todayMeetings,
    week: (weekTasksRes.count ?? 0) + weekMeetings,
    month: (monthTasksRes.count ?? 0) + monthMeetings,
  }
}

function EventStatsCard({ stats, loading, error }: { stats?: { today: number; week: number; month: number }; loading: boolean; error: boolean }) {
  const { language, text } = useLanguage()
  const value = (count?: number) => error ? '–' : loading && count === undefined ? '…' : (count ?? 0).toLocaleString(language === 'th' ? 'th-TH' : 'en-GB')
  return (
    <div className="calendar-event-stats-card" aria-label={text('จำนวนนัดหมายและงานตามกำหนดการ (วันนี้, สัปดาห์นี้, เดือนนี้)', 'Scheduled meetings and tasks (today, this week, this month)')}>
      <span className="calendar-created-caption sr-only">{text('นัดหมายตามกำหนดการ', 'Scheduled items')}</span>
      {([[text('นัดหมายวันนี้', 'Today'), stats?.today, CalendarDays], [text('สัปดาห์นี้', 'This week'), stats?.week, CalendarRange], [text('เดือนนี้', 'This month'), stats?.month, CalendarClock]] as const).map(([label, count, Icon]) => (
        <span key={label} className="calendar-created-period">
          <Icon className="calendar-created-icon" size={20} aria-hidden="true" />
          <span className="calendar-created-info">
            <span className="calendar-created-label">{label}</span>
            <span className="calendar-created-value">{value(count)}</span>
          </span>
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
      const periods = eventAgendaPeriods()
      return countScheduledAgenda(periods)
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
    `flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-bold whitespace-nowrap transition border-2 ${isActive ? 'bg-[#FFE15D] text-black border-black shadow-[3px_3px_0px_#000000]' : 'border-transparent text-black hover:bg-[#FFFBEA] hover:border-black hover:shadow-[2px_2px_0px_#000000]'}`
  const navLabel = 'lg:sr-only lg:group-hover:not-sr-only lg:group-has-[:focus-visible]:not-sr-only'
  const desktopSidebarWidth = desktopMenuExpanded ? 'lg:w-[254px]' : 'lg:w-[70px]'
  const displayName = profile?.full_name || user?.email || text('ผู้ใช้งาน', 'User')

  return (
    <div className={`app-shell min-h-screen bg-[#FFFDF7] text-black lg:grid lg:grid-cols-[70px_minmax(0,1fr)] ${calendarMode ? 'calendar-page-shell' : ''}`}>
      <a className="app-skip-link" href={`#${location.pathname}`} onClick={(event) => { event.preventDefault(); document.getElementById('app-main-content')?.focus() }}>{text('ข้ามไปยังเนื้อหา', 'Skip to content')}</a>
      <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center justify-between gap-2 border-b-[3px] border-black bg-[#FFFDF7] px-4 py-2 lg:hidden">
        <button type="button" onClick={() => setMenuOpen(true)} className="rounded-md border-2 border-black bg-white p-2 text-black shadow-[2px_2px_0px_#000000] hover:bg-[#FFE15D]" aria-label={text('เปิดเมนู', 'Open menu')}><Menu size={24} /></button>
        <span className="min-w-0 flex-1 text-xs font-extrabold leading-tight text-black">{t('appName')}</span>
        <LanguageToggle />
        <div className="flex w-full justify-center">{statsCard}</div>
      </header>
      {menuOpen && <button type="button" className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMenuOpen(false)} aria-label={text('ปิดเมนู', 'Close menu')} />}
      <aside className={`calendar-app-rail group fixed inset-y-0 left-0 z-50 flex w-[254px] flex-col border-r-[3px] border-black bg-white shadow-[4px_0px_0px_#000000] transition-[width,transform] duration-300 motion-reduce:transition-none lg:sticky lg:top-0 lg:h-screen ${desktopSidebarWidth} lg:translate-x-0 lg:overflow-hidden lg:shadow-none lg:hover:w-[254px] lg:has-[:focus-visible]:w-[254px] ${desktopMenuExpanded || menuOpen ? 'sidebar-expanded' : ''} ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex min-h-20 items-center justify-between border-b-[2.5px] border-black px-5 lg:px-2 lg:group-hover:px-5 lg:group-has-[:focus-visible]:px-5">
          <span className="sidebar-brand-tile rounded-md border-2 border-black bg-white p-1.5 shadow-[2px_2px_0px_#000000]" role="img" aria-label={text('PEA การไฟฟ้าส่วนภูมิภาค', 'PEA Provincial Electricity Authority')}>
            <span className="sidebar-brand-seal" aria-hidden="true"><img src={peaLogo} alt="" width="5114" height="1823" /></span>
            <img className="sidebar-brand-full" src={peaLogo} alt="" width="5114" height="1823" aria-hidden="true" />
          </span>
          <button type="button" onClick={() => setDesktopMenuExpanded((expanded) => !expanded)} className="touch-sidebar-toggle rounded-md border-2 border-black bg-white p-2 text-black hover:bg-[#FFE15D] shadow-[2px_2px_0px_#000000] transition" aria-label={desktopMenuExpanded ? text('ยุบเมนู', 'Collapse menu') : text('ขยายเมนู', 'Expand menu')} aria-expanded={desktopMenuExpanded}><Menu size={18} className="text-black" /></button>
          <button type="button" onClick={() => setMenuOpen(false)} className="rounded-md border-2 border-black bg-white p-1 text-black hover:bg-[#FFE15D] shadow-[2px_2px_0px_#000000] lg:hidden" aria-label={text('ปิดเมนู', 'Close menu')}><X size={20} className="text-black" /></button>
        </div>
        <nav className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto px-3 py-5 text-black" aria-label={text('เมนูหลัก', 'Main navigation')}>
          <NavLink to="/calendar" title={t('calendar')} onClick={() => { setMenuOpen(false); setDesktopMenuExpanded(false) }} className={navClass}><CalendarDays size={19} className="text-black shrink-0" /><span className={`${navLabel} lg:group-[.sidebar-expanded]:not-sr-only text-black`}>{t('calendar')}</span></NavLink>
          <div className={`my-2 space-y-1 border-y-2 border-black py-2 ${menuOpen || desktopMenuExpanded ? '' : 'lg:hidden'}`} aria-label={text('จัดการรายการปฏิทิน', 'Calendar actions')}>
            {([
              ['create-task', text('เพิ่ม Task', 'Add task'), ListTodo],
              ['create-meeting', text('เพิ่ม Meeting', 'Add meeting'), CalendarPlus],
              ['meeting-summary', text('สรุปการประชุม', 'Meeting summary'), FileSpreadsheet],
            ] as const).map(([action, label, Icon]) => (
              <Link key={action} to={`/calendar?action=${action}`} onClick={() => { setMenuOpen(false); setDesktopMenuExpanded(false) }} className="flex min-h-11 items-center gap-3 rounded-md border-2 border-transparent px-3 text-sm font-bold text-black transition hover:border-black hover:bg-[#FFFBEA] hover:shadow-[2px_2px_0px_#000000]"><Icon size={19} className="shrink-0 text-black" /><span className="text-black">{label}</span></Link>
            ))}
          </div>
          <NavLink to="/mobile-push" title={text('แจ้งเตือนมือถือ', 'Mobile notifications')} onClick={() => { setMenuOpen(false); setDesktopMenuExpanded(false) }} className={navClass}><Smartphone size={19} className="shrink-0 text-black" /><span className={`${navLabel} lg:group-[.sidebar-expanded]:not-sr-only text-black`}>{text('แจ้งเตือนมือถือ', 'Mobile notifications')}</span></NavLink>
          <NavLink to="/profile" title={text('บัญชีและตั้งค่า', 'Account & settings')} onClick={() => { setMenuOpen(false); setDesktopMenuExpanded(false) }} className={navClass}><UserRound size={19} className="text-black shrink-0" /><span className={`${navLabel} lg:group-[.sidebar-expanded]:not-sr-only text-black`}>{text('บัญชีและตั้งค่า', 'Account & settings')}</span></NavLink>
          {profile?.role === 'admin' && <NavLink to="/admin" title="Admin" onClick={() => { setMenuOpen(false); setDesktopMenuExpanded(false) }} className={navClass}><ShieldCheck size={19} className="text-black shrink-0" /><span className={`${navLabel} lg:group-[.sidebar-expanded]:not-sr-only text-black`}>Admin</span></NavLink>}
        </nav>
        <div className="app-sidebar-footer mt-auto border-t-[2.5px] border-black px-4 py-3 bg-[#FFFDF7]">
          {logoutError && <p role="alert" className="mb-2 text-xs font-bold text-red-600">{logoutError}</p>}
          <div className="app-sidebar-identity mb-2 flex min-w-0 items-center gap-3"><MemberAvatar id={user?.id || ""} name={displayName} size={36} /><div className={`min-w-0 ${navLabel} lg:group-[.sidebar-expanded]:not-sr-only`}><p className="truncate text-sm font-bold text-black">{displayName}</p><p className="truncate text-xs text-black/70 font-semibold">{profile?.employee_id || user?.email}</p></div></div>
          <button type="button" onClick={() => void logout()} className="flex min-h-11 w-full items-center gap-3 rounded-md border-2 border-black bg-white px-3 py-2 text-sm font-bold text-black hover:bg-[#FF6B6B] hover:text-white shadow-[2px_2px_0px_#000000] transition" aria-label={t('signOut')} title={t('signOut')}><LogOut size={17} className="text-black shrink-0" /><span className={`${navLabel} lg:group-[.sidebar-expanded]:not-sr-only text-black`}>{t('signOut')}</span></button>
        </div>
      </aside>
      <div className={`flex min-h-screen min-w-0 flex-col ${location.pathname === '/calendar' ? 'calendar-page-content' : ''}`}>
        <header className={`app-desktop-topbar hidden ${calendarMode ? 'calendar-app-topbar min-h-[4.25rem]' : 'min-h-16'} grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b-[3px] border-black bg-[#FFFDF7] px-6 lg:grid`}>
          <div className="flex min-w-0 items-center gap-3">
            {location.pathname !== '/calendar' && (
              <button
                type="button"
                onClick={() => navigate('/calendar')}
                className="btn-secondary min-h-9 px-3"
                aria-label={text('กลับไปหน้าปฏิทิน', 'Back to calendar')}
              >
                <ArrowLeft size={16} />
                {text('กลับ', 'Back')}
              </button>
            )}

            <img
              src={`${import.meta.env.BASE_URL}brand/pea-meeting-task-header.png`}
              alt="PEA Meeting & Task Calendar ระบบปฏิทินการประชุมและงาน"
              className="app-header-logo h-12 w-auto max-h-13 object-contain shrink-0 select-none"
            />
          </div>
          {statsCard}
          <div className="app-header-account flex min-w-0 items-center justify-end gap-3"><LanguageToggle /><span className="app-header-user-name hidden text-sm font-bold text-black xl:block">{displayName}</span><NavLink to="/profile" className="flex shrink-0 items-center gap-2 rounded-full border-2 border-black bg-white p-1.5 text-black shadow-[2px_2px_0px_#000000] hover:bg-[#FFE15D]" aria-label={text('บัญชีและตั้งค่า', 'Account & settings')}><MemberAvatar id={user?.id || ""} name={displayName} size={28} /><Settings size={18} /></NavLink></div>
        </header>
        <div id="app-main-content" className="app-route-content" tabIndex={-1}><Outlet /></div>
        <AppFooter className="mt-auto xl:h-12 xl:shrink-0 xl:py-1" />
      </div>
    </div>
  )
}
