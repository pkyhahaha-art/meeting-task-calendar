import { ChevronDown, Globe2 } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageProvider'

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage()
  return (
    <button
      type="button"
      onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}
      className="group inline-flex min-h-11 items-center gap-2 rounded-full border border-brand-200 bg-gradient-to-br from-white via-purple-50 to-brand-50 px-3 py-2 text-sm font-extrabold text-brand-800 shadow-sm transition hover:-translate-y-px hover:border-brand-300 hover:from-brand-50 hover:to-purple-100 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 active:translate-y-0"
      aria-label={language === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-700 text-white shadow-sm transition-transform group-hover:rotate-6">
        <Globe2 size={16} aria-hidden="true" />
      </span>
      <span>{language === 'th' ? 'ไทย' : 'English'}</span>
      <ChevronDown size={17} className="text-brand-600 transition-transform group-hover:translate-y-0.5" aria-hidden="true" />
    </button>
  )
}
