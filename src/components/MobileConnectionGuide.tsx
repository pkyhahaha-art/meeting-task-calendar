import { useState } from 'react'
import { useLanguage } from '../i18n/LanguageProvider'

export function MobileConnectionGuide() {
  const { text } = useLanguage()
  const [platform, setPlatform] = useState<'ios' | 'android'>('ios')
  return <details className="rounded-3xl border border-purple-100 bg-white p-5 shadow-sm">
    <summary className="min-h-11 cursor-pointer py-2 font-bold text-brand-700">{text('วิธีเชื่อมต่อมือถือ · iPhone / Android', 'Phone setup · iPhone / Android')}</summary>
    <div className="mt-3 space-y-4">
      <div className="flex gap-2" aria-label={text('เลือกชนิดมือถือ', 'Choose phone type')}>
        {(['ios', 'android'] as const).map((value) => <button key={value} type="button" aria-pressed={platform === value} onClick={() => setPlatform(value)} className={platform === value ? 'btn-primary' : 'btn-secondary'}>{value === 'ios' ? 'iPhone / iPad' : 'Android · Chrome'}</button>)}
      </div>
      {platform === 'ios' ? <div className="space-y-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm leading-relaxed text-orange-900">
        <p>{text('ใช้ iOS 16.4 ขึ้นไป และเปิดแอปจาก Home Screen เพื่อเปิดการแจ้งเตือน', 'Use iOS 16.4+ and open the Home Screen app to enable notifications.')}</p>
        <ol className="list-decimal space-y-2 pl-5">
          <li>{text('สแกน QR เปิดลิงก์ใน Safari แล้วคัดลอกลิงก์เชื่อมต่อ', 'Scan the QR, open in Safari, and copy the pairing link.')}</li>
          <li>{text('กด Share → “เพิ่มลงในหน้าจอโฮม” แล้วเปิดแอปจากไอคอนที่เพิ่ม', 'Tap Share → Add to Home Screen, then open the new app icon.')}</li>
          <li>{text('วางลิงก์เชื่อมต่อในแอป PEA Calendar กดตรวจสอบลิงก์ แล้วเปิดการแจ้งเตือนและเลือก “อนุญาต”', 'Paste the pairing link in PEA Calendar, verify it, enable notifications and choose Allow.')}</li>
          <li>{text('เมื่อเชื่อมต่อแล้ว เปิดกล่องแจ้งเตือนจาก Home Screen ได้เลย ไม่ต้องใส่ลิงก์ซ้ำเมื่อปัดปิดแอป', 'After pairing, open the inbox from the Home Screen. Closing the app does not require pairing again.')}</li>
        </ol>
      </div> : <div className="space-y-3 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm leading-relaxed text-green-900">
        <ol className="list-decimal space-y-2 pl-5">
          <li>{text('สแกน QR แล้วเปิดลิงก์ด้วย Chrome หากเปิดใน LINE ให้เลือกเปิดด้วย Chrome', 'Scan the QR and open in Chrome. If LINE opens it, choose Open in Chrome.')}</li>
          <li>{text('กด “เปิดการแจ้งเตือนบนมือถือเครื่องนี้” แล้วเลือก “อนุญาต”', 'Tap Enable notifications on this phone, then Allow.')}</li>
          <li>{text('เปิดกล่องแจ้งเตือน แล้วกดเมนู Chrome ⋮ → “เพิ่มลงในหน้าจอหลัก” / “ติดตั้งแอป”', 'Open the inbox, then Chrome ⋮ → Add to Home screen / Install app.')}</li>
        </ol>
        <p>{text('หากเคยบล็อก ให้เปิด Chrome → การตั้งค่า → การตั้งค่าเว็บไซต์ → การแจ้งเตือน และอนุญาตเว็บไซต์นี้ รวมถึงสิทธิ์แจ้งเตือน Chrome ในการตั้งค่า Android', 'If previously blocked, allow this site under Chrome → Settings → Site settings → Notifications, and allow Chrome notifications in Android settings.')}</p>
      </div>}
      <p className="text-xs text-slate-500">{text('ตรวจว่าอุปกรณ์ปรากฏในรายการที่เชื่อมต่อ แล้วใช้ปุ่มส่งทดสอบที่อุปกรณ์นั้น', 'Check that your device appears in the connected list, then use its test button.')}</p>
    </div>
  </details>
}
