import { Languages } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageProvider'

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage()
  return (
    <button
      type="button"
      onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}
      className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
      aria-label={language === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
    >
      <Languages size={17} /> {language === 'th' ? 'EN' : 'ไทย'}
    </button>
  )
}

