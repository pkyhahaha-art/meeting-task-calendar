import type { ReactNode } from 'react'
import { useLanguage } from '../i18n/LanguageProvider'
import { LanguageToggle } from './LanguageToggle'
import { AppFooter } from './AppFooter'
import { AppLogo } from './AppLogo'

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <main className="ui-auth-layout relative flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-16">
      <div className="absolute right-4 top-4"><LanguageToggle /></div>
      <section className="ui-panel card relative w-full max-w-md p-6 sm:p-8" aria-labelledby="auth-title">
        <div className="mb-7 text-center">
          <AppLogo className="mx-auto mb-4 h-28 w-28" />
          <p className="mb-3 text-sm font-semibold text-brand-600">{t('appName')}</p>
          <h1 id="auth-title" className="text-2xl font-bold text-slate-900">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{subtitle}</p>
        </div>
        {children}
      </section>
      <AppFooter className="relative w-full max-w-3xl" />
    </main>
  )
}
