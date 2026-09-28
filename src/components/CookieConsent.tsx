import { useState } from 'react'

const consentKey = 'cookie-consent-v1'

export function CookieConsent() {
  const [choice, setChoice] = useState(() => localStorage.getItem(consentKey))

  const choose = (value: 'accepted' | 'rejected') => {
    localStorage.setItem(consentKey, value)
    setChoice(value)
  }

  if (choice) return null

  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="cookie-consent-title" aria-describedby="cookie-consent-description">
    <div className="w-full max-w-md rounded-2xl border border-purple-100 bg-white p-6 shadow-2xl">
      <h2 id="cookie-consent-title" className="text-xl font-bold text-brand-900">การใช้คุกกี้และข้อมูลบนเบราว์เซอร์</h2>
      <p id="cookie-consent-description" className="mt-3 text-sm leading-6 text-slate-600">ระบบใช้ข้อมูลที่จำเป็นสำหรับคงสถานะการเข้าสู่ระบบและจดจำภาษา ปัจจุบันไม่มีคุกกี้เพื่อโฆษณาหรือวิเคราะห์การใช้งาน การปฏิเสธไม่กระทบข้อมูลที่จำเป็นต่อการทำงานของระบบ</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <button type="button" className="btn-secondary justify-center" onClick={() => choose('rejected')}>ปฏิเสธ</button>
        <button type="button" className="btn-primary justify-center" onClick={() => choose('accepted')}>ยอมรับ</button>
      </div>
    </div>
  </div>
}
