import { Languages } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageProvider'

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage()
  return (
    <button
      type="button"
      onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}
      className="group inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white px-2.5 py-2 text-sm font-bold text-brand-700 shadow-sm transition hover:-translate-y-px hover:border-brand-300 hover:from-brand-100 hover:shadow-md active:translate-y-0"
      aria-label={language === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
    >
      <Languages size={17} className="transition-transform group-hover:rotate-6" />
      <span className="hidden lg:inline">{language === 'th' ? 'ไทย' : 'EN'}</span>
      <span className="rounded-md bg-brand-600 px-1.5 py-0.5 text-xs font-bold text-white shadow-sm">{language === 'th' ? 'EN' : 'ไทย'}</span>
    </button>
  )
}
