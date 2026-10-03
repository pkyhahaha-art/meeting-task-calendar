import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, LogOut, Menu, Settings, ShieldCheck, Smartphone, UserRound, X } from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import peaLogo from '../../ภาพประกอบUI/PEA Logo (1).png'
import mascot from '../../ภาพประกอบUI/Thumb Up Mascot 3D.png'
import { useAuth } from '../auth/AuthProvider'
import { useLanguage } from '../i18n/LanguageProvider'
import { eventCreationPeriods } from '../lib/eventStats'
import { supabase } from '../lib/supabase'
import { useConfirm } from './ConfirmDialogProvider'
import { LanguageToggle } from './LanguageToggle'

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
    <div className="flex items-center gap-1 rounded-2xl border border-purple-100 bg-gradient-to-r from-purple-50 via-white to-amber-50 px-2 py-1 shadow-sm" aria-label={text('จำนวน Meeting และ Task ที่สร้างและยังไม่ถูกยกเลิกหรือลบ', 'Meetings and tasks created that have not been cancelled or deleted')}>
      <span className="hidden px-1 text-[10px] font-bold leading-tight text-brand-700 xl:block">{text('รายการ', 'Items')}<br />{text('ที่สร้าง', 'created')}</span>
      {([[text('วันนี้', 'Today'), stats?.today], [text('สัปดาห์นี้', 'This week'), stats?.week], [text('เดือนนี้', 'This month'), stats?.month]] as const).map(([label, count]) => (
        <span key={label} className="min-w-[69px] rounded-xl px-1.5 py-0.5 text-center">
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
    await signOut()
    navigate('/login', { replace: true })
  }
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs font-semibold whitespace-nowrap transition ${isActive ? 'bg-amber-50 text-amber-700' : 'text-slate-600 hover:bg-purple-50 hover:text-brand-700'}`
  const displayName = profile?.full_name || user?.email || text('ผู้ใช้งาน', 'User')

  return (
    <div className={`min-h-screen bg-[#f8f6fb] text-slate-900 lg:grid lg:grid-cols-[254px_minmax(0,1fr)] ${location.pathname === '/calendar' ? 'calendar-page-shell' : ''}`}>
      <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center justify-between gap-2 border-b border-purple-100 bg-white/95 px-4 py-2 backdrop-blur lg:hidden">
        <button type="button" onClick={() => setMenuOpen(true)} className="rounded-xl p-2 text-brand-700 hover:bg-purple-50" aria-label={text('เปิดเมนู', 'Open menu')}><Menu size={24} /></button>
        <span className="truncate text-sm font-bold text-brand-700">{t('appName')}</span>
        <LanguageToggle />
        <div className="flex w-full justify-center">{statsCard}</div>
      </header>
      {menuOpen && <button type="button" className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden" onClick={() => setMenuOpen(false)} aria-label={text('ปิดเมนู', 'Close menu')} />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[254px] flex-col border-r border-purple-100 bg-white shadow-xl transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 lg:shadow-none ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex min-h-28 items-center justify-between border-b border-purple-100 px-5">
          <img src={peaLogo} alt={text('PEA การไฟฟ้าส่วนภูมิภาค', 'PEA Provincial Electricity Authority')} className="w-44 object-contain" />
          <button type="button" onClick={() => setMenuOpen(false)} className="rounded-lg p-1 text-slate-500 lg:hidden" aria-label={text('ปิดเมนู', 'Close menu')}><X size={20} /></button>
        </div>
        <nav className="space-y-1 px-3 py-5" aria-label={text('เมนูหลัก', 'Main navigation')}>
          <NavLink to="/calendar" onClick={() => setMenuOpen(false)} className={navClass}><CalendarDays size={19} />{t('calendar')}</NavLink>
          <NavLink to="/mobile-push" onClick={() => setMenuOpen(false)} className={navClass}><Smartphone size={19} className="shrink-0" /><span>{text('แจ้งเตือนมือถือ', 'Mobile notifications')}</span></NavLink>
          <NavLink to="/profile" onClick={() => setMenuOpen(false)} className={navClass}><UserRound size={19} />{text('บัญชีและตั้งค่า', 'Account & settings')}</NavLink>
          {profile?.role === 'admin' && <NavLink to="/admin" onClick={() => setMenuOpen(false)} className={navClass}><ShieldCheck size={19} />Admin</NavLink>}
        </nav>
        <div className="relative mx-4 mt-auto mb-4 min-h-36 overflow-visible rounded-2xl bg-gradient-to-br from-purple-50 via-pink-50 to-amber-50 p-3">
          <img src={mascot} alt={text('มาสคอต PEA ชูนิ้วโป้ง', 'PEA mascot giving a thumbs-up')} className="pointer-events-none absolute -right-10 -top-6 z-20 h-40 w-40 max-w-none -rotate-3 object-contain drop-shadow-[0_12px_9px_rgba(76,15,93,0.38)]" />
          <div className="relative z-10 max-w-[45%] pt-3 text-left">
            <p className="text-sm font-bold leading-5 text-brand-700">{text('พลังงานเพื่อชีวิตที่ดีกว่า', 'Energy for a better life')}</p>
            <p className="mt-1 text-xs text-slate-500">{text('ของทุกคน', 'for everyone')}</p>
          </div>
        </div>
        <div className="border-t border-purple-100 px-4 py-3">
          <div className="mb-2 flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-100 text-brand-700"><UserRound size={18} /></span><div className="min-w-0"><p className="truncate text-sm font-bold">{displayName}</p><p className="truncate text-xs text-slate-500">{profile?.employee_id || user?.email}</p></div></div>
          <button type="button" onClick={() => void logout()} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-red-50 hover:text-red-700" aria-label={t('signOut')}><LogOut size={17} />{t('signOut')}</button>
        </div>
      </aside>
      <div className={location.pathname === '/calendar' ? 'calendar-page-content min-w-0' : 'min-w-0'}>
        <header className="hidden min-h-16 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-purple-100 bg-white/90 px-6 lg:grid">
          <div className="flex min-w-0 items-center gap-3">
            {location.pathname !== '/calendar' && <button type="button" onClick={() => navigate('/calendar')} className="btn-secondary min-h-9 px-3" aria-label={text('กลับไปหน้าปฏิทิน', 'Back to calendar')}><ArrowLeft size={16} />{text('กลับ', 'Back')}</button>}
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-purple-400 text-white shadow-md shadow-purple-200"><CalendarDays size={21} /></span>
            <span className="min-w-0 leading-tight"><span className="block truncate text-base font-extrabold tracking-tight text-brand-900">Meeting &amp; Task Calendar</span><span className="block truncate text-xs font-medium text-slate-500">{text('ระบบปฏิทินการประชุมและงาน', 'Meeting and task management')}</span></span>
          </div>
          {statsCard}
          <div className="flex min-w-0 items-center justify-end gap-2"><LanguageToggle /><span className="hidden max-w-32 truncate text-sm font-semibold text-slate-700 xl:block">{displayName}</span><NavLink to="/profile" className="rounded-full bg-purple-100 p-2 text-brand-700" aria-label={text('บัญชีและตั้งค่า', 'Account & settings')}><Settings size={18} /></NavLink></div>
        </header>
        <Outlet />
      </div>
    </div>
  )
}
