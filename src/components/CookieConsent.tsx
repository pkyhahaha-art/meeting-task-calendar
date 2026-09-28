import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import mascot from '../../ภาพประกอบUI/Thumb Up Mascot 3D.png'
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
    <section className="relative overflow-hidden rounded-[24px] border-2 border-purple-200/80 bg-gradient-to-br from-white via-purple-50 to-amber-50 p-3 shadow-[0_18px_50px_rgba(76,15,93,0.28)] sm:p-4">
      <span className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-fuchsia-300/30 blur-2xl" aria-hidden="true" />
      <span className="pointer-events-none absolute -bottom-16 left-1/3 h-32 w-32 rounded-full bg-amber-200/35 blur-2xl" aria-hidden="true" />
      <div className="relative">
        <div className="flex min-w-0 items-end gap-1.5 sm:gap-3">
          <img src={mascot} alt="มาสคอต PEA กำลังทักทาย" className="h-20 w-20 shrink-0 object-contain drop-shadow-[0_8px_7px_rgba(76,15,93,0.25)] sm:h-24 sm:w-24" />
          <div className="relative mb-2 min-w-0 flex-1 rounded-[18px] border-2 border-purple-200 bg-white/90 px-3 py-2.5 shadow-sm sm:px-4">
            <span className="absolute -left-2.5 bottom-4 h-5 w-5 rotate-45 border-b-2 border-l-2 border-purple-200 bg-white" aria-hidden="true" />
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
            <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-xl border-2 border-purple-200 bg-white/80 px-4 py-2 font-semibold text-brand-800 shadow-sm transition hover:bg-purple-50" onClick={() => choose('rejected')}>ปฏิเสธ / Decline</button>
            <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-gradient-to-r from-brand-700 via-fuchsia-500 to-amber-500 px-4 py-2 font-semibold text-white shadow-lg shadow-purple-300/50 transition hover:from-brand-800 hover:via-fuchsia-600 hover:to-amber-600" onClick={() => choose('accepted')}>ยอมรับ / Accept</button>
          </div>
        </div>
      </div>
    </section>
  </div>
}
