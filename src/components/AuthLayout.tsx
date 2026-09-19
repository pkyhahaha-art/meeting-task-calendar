import { CalendarDays } from 'lucide-react'
import type { ReactNode } from 'react'
import { useLanguage } from '../i18n/LanguageProvider'
import { LanguageToggle } from './LanguageToggle'

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-4 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(20,125,128,.16),_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(45,91,122,.12),_transparent_35%)]" />
      <div className="absolute right-4 top-4"><LanguageToggle /></div>
      <section className="card relative w-full max-w-md p-6 sm:p-8" aria-labelledby="auth-title">
        <div className="mb-7 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600">
            <CalendarDays size={26} />
          </span>
          <p className="mb-1 text-sm font-semibold text-brand-600">{t('appName')}</p>
          <h1 id="auth-title" className="text-2xl font-bold text-slate-900">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{subtitle}</p>
        </div>
        {children}
      </section>
    </main>
  )
}

