import { useState } from 'react'
import { useLanguage } from '../i18n/LanguageProvider'

export function MobileConnectionGuide() {
  const { text } = useLanguage()
  const [platform, setPlatform] = useState<'ios' | 'android'>('ios')
  return <details className="rounded-3xl border border-purple-100 bg-white p-5 shadow-sm">
    <summary className="min-h-11 cursor-pointer py-2 font-bold text-brand-700">{text('วิธีเชื่อมต่อมือถือ · iPhone / Android', 'Phone setup · iPhone / Android')}</summary>
    <div className="mt-3 min-w-0 space-y-4 text-sm leading-relaxed">
      <p className="text-slate-600">{text('ชื่อเมนูและตำแหน่งปุ่มอาจต่างกันตามรุ่นมือถือ ภาษา และเวอร์ชันเบราว์เซอร์ เลือกอุปกรณ์ด้านล่างแล้วทำตามลำดับ', 'Menu names and button positions vary by phone, language and browser version. Choose your device below and follow the steps in order.')}</p>
      <section className="space-y-2 rounded-2xl bg-purple-50 p-4 text-brand-900">
        <h3 className="font-bold">{text('ก่อนเริ่ม · เตรียม QR ของบัญชีคุณ', 'Before you start · Get your account’s QR code')}</h3>
        <p>{text('บนคอมพิวเตอร์ เข้าสู่ระบบ → แจ้งเตือนมือถือ หากมีเครื่องเชื่อมต่อแล้ว กด “เชื่อมต่ออุปกรณ์เพิ่ม” เพื่อแสดง QR ถ้าใช้มือถือเครื่องเดียว ให้ใช้ “คัดลอกลิงก์เชื่อมต่อ” แทนการสแกน', 'On your computer, sign in → Mobile notifications. If a device is already paired, choose Connect another device to show the QR code. If using only one phone, use Copy pairing link instead of scanning.')}</p>
        <p>{text('QR / ลิงก์ใช้เชื่อมต่อได้ครั้งเดียว ภายใน 10 นาที หากหมดอายุให้กด “สร้าง QR Code ใหม่” เครื่องที่เชื่อมแล้วไม่ต้องสแกนใหม่ทุกครั้ง', 'A QR code / link can pair one device within 10 minutes. If it expires, choose Refresh QR Code. Paired devices do not need to scan again each time.')}</p>
      </section>
      <div className="flex flex-col gap-2 sm:flex-row" role="group" aria-label={text('เลือกชนิดมือถือ', 'Choose phone type')}>
        {(['ios', 'android'] as const).map((value) => <button key={value} type="button" aria-pressed={platform === value} onClick={() => setPlatform(value)} className={platform === value ? 'btn-primary' : 'btn-secondary'}>{value === 'ios' ? 'iPhone / iPad' : 'Android · Chrome'}</button>)}
      </div>
      {platform === 'ios' ? <div className="space-y-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm leading-relaxed text-orange-900">
        <h3 className="font-bold">{text('iPhone / iPad · เพิ่มไอคอนก่อน แล้วจึงเปิดแจ้งเตือน', 'iPhone / iPad · Add the icon before enabling notifications')}</h3>
        <p>{text('ต้องใช้ iOS / iPadOS 16.4 ขึ้นไป และเปิดจากไอคอนบนหน้าจอโฮมเพื่อขอสิทธิ์แจ้งเตือน', 'Use iOS / iPadOS 16.4 or later and open the Home Screen app to request notification permission.')}</p>
        <ol className="list-decimal space-y-3 pl-5">
          <li><strong>{text('เปิดลิงก์ด้วย Safari', 'Open the link in Safari')}</strong><p>{text('ใช้กล้องสแกน QR แล้วแตะลิงก์ หากลิงก์เปิดอยู่ใน LINE หรือแอปอื่น ให้เลือกเปิดใน Safari หรือคัดลอกลิงก์ไปวางในช่องที่อยู่ Safari', 'Scan the QR with Camera and tap the link. If LINE or another app opens it, choose Open in Safari or copy the link into Safari’s address bar.')}</p></li>
          <li><strong>{text('เก็บลิงก์เชื่อมต่อไว้ก่อน', 'Keep the pairing link')}</strong><p>{text('ที่หน้าเชื่อมต่อ แตะ “คัดลอกลิงก์เชื่อมต่อ” เพื่อใช้หลังเพิ่มแอปลงหน้าจอโฮม', 'On the pairing page, tap Copy pairing link. You may need it after adding the app to your Home Screen.')}</p></li>
          <li><strong>{text('เปิดเมนูแชร์ของ Safari', 'Open Safari’s Share menu')}</strong><p>{text('มองหารูปสี่เหลี่ยมมีลูกศรชี้ขึ้น ปุ่มอาจอยู่ด้านบนหรือด้านล่าง หากไม่เห็น ให้แตะเมนูหน้าเว็บ / เพิ่มเติม (…) แล้วเลือก “แชร์”', 'Look for a square with an upward arrow at the top or bottom. If it is hidden, open the Page Menu / More (…) and choose Share.')}</p></li>
          <li><strong>{text('เพิ่มไปยังหน้าจอโฮม', 'Add to Home Screen')}</strong><p>{text('เลื่อนรายการแชร์แล้วเลือก “เพิ่มไปยังหน้าจอโฮม” (Add to Home Screen) บน iPad บางรุ่นต้องแตะ “ดูเพิ่มเติม” ก่อน หากมี “เปิดเป็นแอปหน้าเว็บ” (Open as Web App) ให้เปิดไว้ แล้วแตะ “เพิ่ม”', 'Scroll through Share actions and choose Add to Home Screen. Some iPad layouts show View More first. If Open as Web App appears, leave it on, then tap Add.')}</p></li>
          <li><strong>{text('กลับหน้าจอโฮม แล้วเปิดไอคอน PEA', 'Open the PEA icon from your Home Screen')}</strong><p>{text('เปิดไอคอน PEA Meeting & Task Calendar ที่เพิ่งเพิ่ม หากมีช่อง “ลิงก์เชื่อมต่อ” ให้วางลิงก์ที่คัดลอก แล้วแตะ “ตรวจสอบลิงก์เชื่อมต่อ”', 'Open the new PEA Meeting & Task Calendar icon. If the Pairing link field appears, paste the copied link and tap Verify pairing link.')}</p></li>
          <li><strong>{text('อนุญาตการแจ้งเตือน', 'Allow notifications')}</strong><p>{text('แตะ “เปิดการแจ้งเตือนบนมือถือเครื่องนี้” แล้วเลือก “อนุญาต” (Allow) เมื่อเชื่อมสำเร็จจะเข้าสู่กล่องแจ้งเตือน ครั้งต่อไปเปิดจากไอคอนนี้ได้เลย', 'Tap Enable Notifications on This Device, then Allow. Successful pairing opens your inbox. Use this Home Screen icon next time.')}</p></li>
        </ol>
        <details className="rounded-xl border border-orange-200 bg-white/70 p-3">
          <summary className="min-h-11 cursor-pointer font-semibold">{text('หาเมนูเพิ่มไอคอนไม่พบ / เปิดแล้วยังอยู่ใน Safari', 'Cannot find Add to Home Screen / the icon opens Safari')}</summary>
          <p className="mt-2">{text('ในรายการแชร์ เลื่อนลงล่างสุด → “แก้ไขการทำงาน” → เพิ่ม “เพิ่มไปยังหน้าจอโฮม” หากเปิดไอคอนแล้วมีแถบที่อยู่ Safari และระบบยังขอให้เพิ่มแอป ให้เพิ่มไอคอนโดยเปิด Open as Web App หากมีตัวเลือกนี้ อย่าเพิ่งล้างข้อมูลเว็บไซต์หรือยกเลิกเครื่องที่เชื่อมอยู่', 'In Share, scroll to the bottom → Edit Actions → add Add to Home Screen. If the icon opens Safari’s address bar and the app still asks you to install, add the icon with Open as Web App enabled if offered. Keep existing paired devices and website data.')}</p>
        </details>
        <a className="inline-flex min-h-11 items-center font-semibold underline" href="https://support.apple.com/th-th/guide/iphone/iphea86e5236/ios" target="_blank" rel="noopener noreferrer">{text('ดูขั้นตอนจาก Apple (เปิดแท็บใหม่)', 'Apple’s instructions (opens a new tab)')}</a>
      </div> : <div className="space-y-3 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm leading-relaxed text-green-900">
        <h3 className="font-bold">{text('Android · เชื่อมต่อด้วย Chrome แล้วเพิ่มไอคอน', 'Android · Pair in Chrome, then add the icon')}</h3>
        <p>{text('Samsung, OPPO, vivo, Xiaomi / Redmi หรือ Pixel ใช้ขั้นตอน Chrome นี้ได้ ชื่อปุ่มยืนยันและวิธีวางไอคอนอาจต่างกันตามเครื่อง', 'Use these Chrome steps on Samsung, OPPO, vivo, Xiaomi / Redmi or Pixel. Confirmation buttons and icon placement can vary by device.')}</p>
        <ol className="list-decimal space-y-3 pl-5">
          <li><strong>{text('เปิดลิงก์ด้วย Google Chrome', 'Open the link in Google Chrome')}</strong><p>{text('สแกน QR แล้วเปิดลิงก์ด้วย Chrome หากเปิดใน LINE, Samsung Internet หรือเบราว์เซอร์อื่น ให้คัดลอกลิงก์ไปวางในช่องที่อยู่ของ Chrome', 'Scan the QR and open its link in Chrome. If LINE, Samsung Internet or another browser opens it, copy the link into Chrome’s address bar.')}</p></li>
          <li><strong>{text('ตรวจว่าไม่ได้เปิดเว็บไซต์เดสก์ท็อป', 'Check Desktop site is off')}</strong><p>{text('แตะเมนู ⋮ ของ Chrome หาก “เว็บไซต์เดสก์ท็อป” (Desktop site) มีเครื่องหมายถูก ให้แตะเอาออก หน้าเว็บจะกลับมาขนาดมือถือ', 'Open Chrome’s ⋮ menu. If Desktop site is checked, uncheck it to use the phone layout.')}</p></li>
          <li><strong>{text('เชื่อมต่อและอนุญาตแจ้งเตือน', 'Pair and allow notifications')}</strong><p>{text('ที่หน้าเชื่อมต่อ แตะ “เปิดการแจ้งเตือนบนมือถือเครื่องนี้” แล้วเลือก “อนุญาต” (Allow) รอจนเข้าสู่กล่องแจ้งเตือน', 'On the pairing page, tap Enable Notifications on This Device, then Allow. Wait for the inbox to open.')}</p></li>
          <li><strong>{text('เลือกเมนูเพิ่มไอคอนตามที่เครื่องแสดง', 'Choose the installation menu shown on your phone')}</strong><p>{text('จากกล่องแจ้งเตือน เปิดเมนู ⋮ ของ Chrome แล้วเลือก “เพิ่มลงในหน้าจอหลัก” (Add to Home screen) หรือ “ติดตั้งแอป” (Install app) บางเวอร์ชันอยู่ใน “ติดตั้งและสร้างทางลัด” (Install and create shortcut) → “ติดตั้ง” หากเลือกได้ทั้งติดตั้งกับสร้างทางลัด ให้เลือกติดตั้ง', 'From the inbox, open Chrome’s ⋮ menu → Add to Home screen or Install app. Some versions show Install and create shortcut → Install. If both installation and a shortcut are offered, choose installation.')}</p></li>
          <li><strong>{text('ยืนยันและวางไอคอน', 'Confirm and place the icon')}</strong><p>{text('แตะ “ติดตั้ง” / “เพิ่ม” ตามหน้าต่างของเครื่อง หากมีภาพไอคอนให้ลาก ให้แตะค้างแล้วลากลงหน้าจอหลัก หรือใช้ปุ่มเพิ่มอัตโนมัติหากมี', 'Tap Install / Add in your device’s prompt. If it offers a draggable icon, touch and hold it to place it on the Home screen, or use the automatic Add option if offered.')}</p></li>
          <li><strong>{text('เปิดใช้งานจากไอคอน PEA', 'Open the PEA icon')}</strong><p>{text('กลับหน้าจอหลัก แล้วเปิด PEA Meeting & Task Calendar ตรวจว่าเห็นกล่องแจ้งเตือนของคุณ ครั้งต่อไปเปิดจากไอคอนนี้ได้ ไม่ต้องสแกน QR ใหม่', 'Return to your Home screen and open PEA Meeting & Task Calendar. Check your inbox appears. Open this icon next time without scanning a new QR.')}</p></li>
        </ol>
        <details className="rounded-xl border border-green-200 bg-white/70 p-3">
          <summary className="min-h-11 cursor-pointer font-semibold">{text('ไม่มีเมนูติดตั้ง / หาไอคอนไม่เจอ', 'No installation menu / cannot find the icon')}</summary>
          <p className="mt-2">{text('ตรวจว่าเปิดใน Chrome โดยตรง ปิดเว็บไซต์เดสก์ท็อป และใช้ Chrome เวอร์ชันล่าสุด หากมี “เปิดแอป” แสดงว่าอาจติดตั้งแล้ว ลองค้นหา PEA Meeting & Task Calendar ในรายการแอป แล้วแตะไอคอนค้างเพื่อเพิ่มหรือลากลงหน้าจอหลักตามเมนูของเครื่อง', 'Use Chrome directly, turn off Desktop site and update Chrome. An Open app option can mean it is already installed. Search your apps for PEA Meeting & Task Calendar, then hold its icon to add or drag it onto the Home screen as your device allows.')}</p>
        </details>
        <a className="inline-flex min-h-11 items-center font-semibold underline" href="https://support.google.com/chrome/answer/9658361?hl=th&co=GENIE.Platform%3DAndroid" target="_blank" rel="noopener noreferrer">{text('ดูขั้นตอนจาก Google Chrome (เปิดแท็บใหม่)', 'Google Chrome’s instructions (opens a new tab)')}</a>
      </div>}
      <section className="space-y-2 rounded-2xl border border-purple-100 bg-purple-50/50 p-4 text-slate-700">
        <h3 className="font-bold text-brand-900">{text('ตรวจว่าเชื่อมต่อสำเร็จแล้ว', 'Check pairing is complete')}</h3>
        <p>{text('กลับหน้า “แจ้งเตือนมือถือ” บนคอมพิวเตอร์ ตรวจว่าชื่อมือถือขึ้น “เชื่อมต่อแล้ว” หากต้องการทดสอบ ให้กด “ส่งทดสอบไปเครื่องนี้” ในแถวของมือถือที่ต้องการ แล้วตรวจกล่องแจ้งเตือนและศูนย์การแจ้งเตือนบนมือถือนั้น', 'On your computer’s Mobile notifications page, check the phone is listed as connected. To test, choose Send test to device on that phone’s row, then check its inbox and notification centre.')}</p>
        <p>{platform === 'ios'
          ? text('หากไม่เห็นแบนเนอร์ ให้ดูการตั้งค่ามือถือ → การแจ้งเตือน → PEA Meeting & Task Calendar และตรวจโหมดโฟกัส / ห้ามรบกวน', 'If no banner appears, check phone Settings → Notifications → PEA Meeting & Task Calendar, and Focus / Do Not Disturb.')
          : text('หากเคยบล็อก ให้เปิด Chrome → การตั้งค่า → การตั้งค่าเว็บไซต์ → การแจ้งเตือน แล้วอนุญาตเว็บไซต์นี้ พร้อมตรวจการตั้งค่ามือถือ → แอป → Chrome หรือ PEA Meeting & Task Calendar → การแจ้งเตือน ชื่อเมนูอาจต่างกันตามเครื่อง', 'If blocked, open Chrome → Settings → Site settings → Notifications and allow this site. Also check phone Settings → Apps → Chrome or PEA Meeting & Task Calendar → Notifications; labels vary by device.')}</p>
        <p>{text('เมื่อเชื่อมแล้ว การปัดปิดแอปไม่จำเป็นต้องเชื่อมใหม่ ใช้ไอคอนและเว็บไซต์เดิมต่อได้ ไม่ต้องล้างข้อมูลเว็บไซต์หรือยกเลิกการเชื่อมต่อเพื่อเปิดใช้งานแต่ละครั้ง', 'After pairing, closing the app does not require pairing again. Keep using the same icon and website; there is no need to clear website data or disconnect each time.')}</p>
      </section>
    </div>
  </details>
}
