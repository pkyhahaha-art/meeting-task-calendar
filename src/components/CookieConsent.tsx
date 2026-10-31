import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

const consentKey = 'cookie-consent-v1'

export function CookieConsent() {
  const [choice, setChoice] = useState(() => localStorage.getItem(consentKey))
  const { user } = useAuth()
  const location = useLocation()

  const choose = (value: 'accepted' | 'rejected') => {
    localStorage.setItem(consentKey, value)
    setChoice(value)
  }

  if (!user || choice || location.pathname === '/acknowledged') return null

  return <div className="fixed inset-x-3 bottom-3 z-[120] mx-auto w-auto max-w-5xl sm:inset-x-6 sm:bottom-6" role="dialog" aria-labelledby="cookie-consent-title" aria-describedby="cookie-consent-description">
    <section className="ui-dialog-panel ui-cookie-panel relative rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
      <div className="relative">
        <div className="flex min-w-0 items-end gap-1.5 sm:gap-3">
          <div className="relative mb-2 min-w-0 flex-1">
            <p className="relative text-xs font-bold leading-5 text-brand-800 sm:text-sm">สวัสดีครับ! เราใช้ข้อมูลที่จำเป็นเพื่อให้ระบบปลอดภัยและจดจำภาษาของคุณ</p>
            <p lang="en" className="relative mt-1 text-[11px] font-medium leading-4 text-slate-600 sm:text-xs">Hello! We use essential data to keep your session secure and remember your language.</p>
          </div>
        </div>
        <div className="mt-2 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0 px-1">
            <h2 id="cookie-consent-title" className="text-base font-extrabold text-brand-900 sm:text-lg">การใช้คุกกี้และข้อมูลบนเบราว์เซอร์ <span lang="en" className="block text-xs font-semibold text-brand-700 sm:inline sm:pl-1">/ Your privacy matters</span></h2>
            <p id="cookie-consent-description" className="mt-1 text-xs leading-5 text-slate-600 sm:text-sm">ระบบใช้ข้อมูลที่จำเป็นสำหรับคงสถานะการเข้าสู่ระบบและจดจำภาษา ไม่มีคุกกี้เพื่อโฆษณาหรือวิเคราะห์การใช้งาน</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:w-72">
            <button type="button" className="btn-secondary" onClick={() => choose('rejected')}>ปฏิเสธ / Decline</button>
            <button type="button" className="btn-primary" onClick={() => choose('accepted')}>ยอมรับ / Accept</button>
          </div>
        </div>
      </div>
    </section>
  </div>
}
