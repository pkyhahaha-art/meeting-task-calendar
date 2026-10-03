import type { ReactNode } from 'react'
import peaLogo from '../../ภาพประกอบUI/PEA Logo (1).png'
import { useLanguage } from '../i18n/LanguageProvider'
import { LanguageToggle } from './LanguageToggle'
import { AppFooter } from './AppFooter'
import { AppLogo } from './AppLogo'

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const { t } = useLanguage()
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-6 overflow-hidden bg-[#f8f6fb] px-4 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(133,20,132,.14),_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(194,138,16,.10),_transparent_35%)]" />
      <div className="absolute right-4 top-4"><LanguageToggle /></div>
      <section className="card relative w-full max-w-md p-6 sm:p-8" aria-labelledby="auth-title">
        <div className="mb-7 text-center">
          <img src={peaLogo} alt="PEA การไฟฟ้าส่วนภูมิภาค" className="mx-auto mb-4 w-40 object-contain" />
          <div className="mb-3 flex items-center justify-center gap-2"><AppLogo className="h-8 w-8" /><p className="text-sm font-semibold text-brand-600">{t('appName')}</p></div>
          <h1 id="auth-title" className="text-2xl font-bold text-slate-900">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{subtitle}</p>
        </div>
        {children}
      </section>
      <AppFooter className="relative w-full max-w-3xl rounded-2xl border border-purple-100 bg-white/60" />
    </main>
  )
}
