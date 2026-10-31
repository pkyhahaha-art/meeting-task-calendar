import { ChevronDown } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageProvider'

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage()
  return (
    <details className="language-menu">
      <summary className="language-menu-trigger" aria-label={language === 'th' ? 'เลือกภาษา' : 'Choose language'}>
        <svg className="language-globe" width="34" height="34" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
          <circle cx="20" cy="20" r="18" />
          <ellipse cx="20" cy="20" rx="9" ry="18" />
          <path d="M20 2v36M2 20h36M5 10c8 5 22 5 30 0M5 30c8-5 22-5 30 0" />
        </svg>
        <span>Language</span>
        <ChevronDown size={19} className="language-menu-chevron" aria-hidden="true" />
      </summary>
      <div className="language-menu-options" role="group" aria-label={language === 'th' ? 'เลือกภาษา' : 'Choose language'}>
        <button type="button" aria-pressed={language === 'th'} onClick={(event) => { setLanguage('th'); event.currentTarget.closest('details')?.removeAttribute('open') }}>ไทย</button>
        <button type="button" aria-pressed={language === 'en'} onClick={(event) => { setLanguage('en'); event.currentTarget.closest('details')?.removeAttribute('open') }}>English</button>
      </div>
    </details>
  )
}
