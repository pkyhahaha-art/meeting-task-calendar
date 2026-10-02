import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import {
  Smartphone,
  BellRing,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  ShieldCheck,
  CalendarDays,
  Check,
  ArrowRight,
  Copy,
  Share,
} from 'lucide-react'
import mascotHoldingPad from '../../ภาพประกอบUI/02_Hand I-Pad.jpg'
import peaLogo from '../../ภาพประกอบUI/PEA Logo (1).png'
import { useLanguage } from '../i18n/LanguageProvider'
import { currentPushSupport, tokenFromPairingLink } from '../lib/pushSupport'
import { appUrl } from '../lib/appUrl'
import {
  verifyPairingToken,
  completeDevicePairing,
  detectDeviceName,
} from '../lib/mobilePush'

export function PairDevicePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const { text } = useLanguage()

  const [loading, setLoading] = useState(true)
  const [pairing, setPairing] = useState(false)
  const [tokenValid, setTokenValid] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pairedUserName, setPairedUserName] = useState<string | null>(null)
  const [deviceName, setDeviceName] = useState('')
  const [pastedLink, setPastedLink] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const support = currentPushSupport()
  const pushConfigured = Boolean(import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim())

  const importPairingLink = () => {
    const nextToken = tokenFromPairingLink(pastedLink)
    if (!nextToken) {
      setLinkError(text('กรุณาวางลิงก์เชื่อมต่อที่คัดลอกจากหน้า QR Code', 'Paste the pairing link copied from the QR page.'))
      return
    }
    setLinkError(null)
    setSearchParams({ token: nextToken })
  }

  const copyPairingLink = async () => {
    try {
      await navigator.clipboard.writeText(appUrl(`/pair-device?token=${encodeURIComponent(token)}`))
      setCopied(true)
    } catch {
      setLinkError(text('คัดลอกไม่ได้ กรุณาคัดลอกลิงก์จากแถบที่อยู่ Safari', 'Copy the link from the Safari address bar.'))
    }
  }

  useEffect(() => {
    let cancelled = false
    setDeviceName(detectDeviceName())
    setTokenValid(false)
    setSuccess(false)
    setErrorMessage(null)

    async function checkToken() {
      if (!token) {
        setLoading(false)
        return
      }

      setLoading(true)
      const res = await verifyPairingToken(token)
      if (cancelled) return
      if (!res.valid) {
        setErrorMessage(res.error || 'QR Code ไม่ถูกต้อง หรือหมดอายุแล้ว')
        setTokenValid(false)
      } else {
        setTokenValid(true)
        setErrorMessage(null)
      }
      setLoading(false)
    }

    checkToken()
    return () => { cancelled = true }
  }, [token])

  const handleEnablePush = async () => {
    if (!token || !tokenValid) return
    setPairing(true)
    setErrorMessage(null)

    try {
      const result = await completeDevicePairing(token, deviceName)
      if (result.success) {
        setSuccess(true)
        setPairedUserName(result.userName || null)
      } else {
        setErrorMessage(result.error || 'เกิดข้อผิดพลาดในการเปิดการแจ้งเตือน')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการเชื่อมต่อ'
      setErrorMessage(msg)
    } finally {
      setPairing(false)
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-amber-50 p-4 sm:p-6 flex flex-col items-center justify-center">
      <div className="w-full max-w-md space-y-6">
        {/* PEA Brand Header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <img
            src={peaLogo}
            alt="PEA การไฟฟ้าส่วนภูมิภาค"
            className="h-12 object-contain drop-shadow-sm"
          />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-purple-100/80 px-3 py-0.5 text-xs font-bold text-brand-700">
            <Sparkles size={13} className="text-amber-500" />
            Meeting &amp; Task Calendar Mobile Alert
          </span>
        </div>

        {/* Content Card */}
        <div className="relative overflow-hidden rounded-3xl border border-purple-100 bg-white p-6 sm:p-8 shadow-xl shadow-purple-950/5 text-center">
          {/* Top Mascot image */}
          <div className="mx-auto mb-5 relative flex h-32 w-32 items-center justify-center rounded-3xl overflow-hidden border-2 border-brand-200/80 bg-gradient-to-b from-purple-50 to-amber-50 shadow-md">
            <img
              src={mascotHoldingPad}
              alt="PEA Mascot holding tablet"
              className="h-full w-full object-cover"
            />
            {success && (
              <div className="absolute inset-0 bg-brand-900/40 backdrop-blur-xs flex items-center justify-center">
                <div className="rounded-full bg-green-500 p-2 text-white shadow-lg animate-bounce">
                  <Check size={28} />
                </div>
              </div>
            )}
          </div>

          {support === 'ios-install' && (
            <section className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-950 space-y-3">
              <h2 className="flex items-center gap-2 font-bold"><Share size={18} />{text('เพิ่มไปยังหน้าจอโฮมก่อนเปิดแจ้งเตือน', 'Add to Home Screen first')}</h2>
              <p>{text('Safari บน iPhone / iPad ขอสิทธิ์แจ้งเตือนได้เมื่อเปิดจากไอคอนแอปบนหน้าจอโฮมเท่านั้น (iOS 16.4 ขึ้นไป)', 'On iOS 16.4 or later, open the Home Screen app to enable notifications.')}</p>
              <ol className="list-decimal pl-5 space-y-2">
                <li>{text('คัดลอกลิงก์เชื่อมต่อด้วยปุ่มด้านล่าง', 'Copy the pairing link below.')}</li>
                <li>{text('แตะปุ่มแชร์ใน Safari → เพิ่มไปยังหน้าจอโฮม → เพิ่ม', 'Tap Share in Safari → Add to Home Screen → Add.')}</li>
                <li>{text('เปิดไอคอน PEA Calendar ที่เพิ่มใหม่ แล้ววางลิงก์ที่คัดลอกไว้', 'Open the new PEA Calendar icon and paste the copied link.')}</li>
                <li>{text('กดตรวจสอบลิงก์ แล้วเปิดการแจ้งเตือนและกดอนุญาต', 'Verify the link, enable notifications, and tap Allow.')}</li>
              </ol>
              {token && <button type="button" onClick={copyPairingLink} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-700 px-4 py-2 font-bold text-white"><Copy size={16} />{copied ? text('คัดลอกแล้ว', 'Copied') : text('คัดลอกลิงก์เชื่อมต่อ', 'Copy pairing link')}</button>}
              <p className="text-xs">{text('หากมีไอคอนเก่าที่เปิดกลับเข้า Safari ให้เพิ่มไอคอนใหม่ ลิงก์เชื่อมต่อหมดอายุใน 10 นาที', 'If an old icon opens Safari, add a new icon. Pairing links expire after 10 minutes.')}</p>
              {linkError && <p role="alert" className="text-red-700">{linkError}</p>}
            </section>
          )}

          {loading ? (
            <div className="py-8 space-y-3">
              <Loader2 size={32} className="mx-auto animate-spin text-brand-600" />
              <p className="text-sm font-semibold text-slate-600">กำลังตรวจสอบข้อมูลการเชื่อมต่อ…</p>
            </div>
          ) : !token ? (
            <form onSubmit={(event) => { event.preventDefault(); importPairingLink() }} className="space-y-4 text-left">
              <h1 className="text-xl font-extrabold text-slate-900">{text('เชื่อมต่อมือถือกับปฏิทิน', 'Pair this device')}</h1>
              <p className="text-sm text-slate-600">{text('วางลิงก์ที่คัดลอกไว้จากหน้า QR Code เพื่อเชื่อมต่อโดยไม่ต้องล็อกอินอีกครั้ง', 'Paste the copied QR pairing link without signing in again.')}</p>
              <label htmlFor="pairing-link" className="block text-sm font-semibold">{text('ลิงก์เชื่อมต่อ', 'Pairing link')}</label>
              <input id="pairing-link" type="text" value={pastedLink} onChange={(event) => setPastedLink(event.target.value)} placeholder="https://…/#/pair-device?token=…" autoComplete="off" className="field-input w-full" />
              {linkError && <p role="alert" className="text-sm text-red-600">{linkError}</p>}
              <button type="submit" className="w-full min-h-11 rounded-xl bg-brand-700 px-4 py-2 font-bold text-white">{text('ตรวจสอบลิงก์เชื่อมต่อ', 'Verify pairing link')}</button>
            </form>
          ) : success ? (
            /* Success View */
            <div className="space-y-5 animate-fadeIn">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700 border border-green-200">
                <CheckCircle2 size={14} />
                <span>{text('เชื่อมต่อสำเร็จแล้ว', 'Pairing Successful')}</span>
              </div>

              <div className="space-y-2">
                <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">
                  {text('เปิดการแจ้งเตือนบนอุปกรณ์แล้ว!', 'Device Notifications Enabled!')}
                </h1>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  {pairedUserName
                    ? `บัญชีของคุณ (${pairedUserName}) ได้รับการเชื่อมต่อกับอุปกรณ์นี้แล้ว`
                    : 'อุปกรณ์นี้ได้รับการเชื่อมต่อกับระบบปฏิทินเรียบร้อยแล้ว'}
                </p>
              </div>

              <div className="rounded-2xl border border-green-100 bg-gradient-to-br from-green-50/60 to-purple-50/40 p-4 text-left text-xs text-slate-700 space-y-2">
                <div className="flex items-center gap-2 font-bold text-green-900">
                  <BellRing size={16} className="text-green-600" />
                  <span>สิ่งที่คุณจะได้รับ:</span>
                </div>
                <ul className="list-disc pl-5 space-y-1 text-slate-600">
                  <li>การแจ้งเตือนก่อนถึงเวลานัดหมายการประชุม</li>
                  <li>การแจ้งเตือนงานที่ได้รับมอบหมายและวันครบกำหนดส่งงาน</li>
                  <li>การส่งแจ้งเตือนจากระบบต้องเปิดใช้งานโดยผู้ดูแล</li>
                </ul>
              </div>

              <div className="pt-2">
                <Link
                  to="/calendar"
                  className="w-full inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-700 via-fuchsia-600 to-amber-500 px-4 py-2.5 font-semibold text-white shadow-md shadow-purple-300/40 hover:from-brand-800 transition text-sm"
                >
                  <CalendarDays size={17} />
                  <span>{text('เข้าสู่หน้าปฏิทิน', 'Go to Calendar')}</span>
                  <ArrowRight size={16} />
                </Link>
              </div>
            </div>
          ) : errorMessage ? (
            /* Error View */
            <div className="space-y-4 animate-fadeIn">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                <AlertCircle size={28} />
              </div>
              <h2 className="text-lg font-bold text-slate-900">
                {text('ไม่สามารถเชื่อมต่อได้', 'Pairing Failed')}
              </h2>
              <p className="text-xs sm:text-sm text-red-600 bg-red-50 rounded-xl p-3 border border-red-100">
                {errorMessage}
              </p>
              <p className="text-xs text-slate-500">
                {tokenValid
                  ? text('ตรวจสอบการอนุญาตแจ้งเตือนในการตั้งค่า แล้วลองใหม่', 'Check notification permissions in settings and try again.')
                  : text('กรุณาสร้าง QR Code ใหม่บนคอมพิวเตอร์ แล้วคัดลอกลิงก์ใหม่', 'Generate a new QR code on your desktop and copy the new link.')}
              </p>
              {tokenValid && support === 'ready' && <button type="button" onClick={() => setErrorMessage(null)} className="min-h-11 rounded-xl bg-brand-700 px-4 py-2 font-bold text-white">{text('ลองใหม่', 'Try again')}</button>}
              {!tokenValid && <button type="button" onClick={() => setSearchParams({})} className="min-h-11 rounded-xl bg-brand-700 px-4 py-2 font-bold text-white">{text('วางลิงก์ใหม่', 'Paste a new link')}</button>}
            </div>
          ) : (
            /* Ready to Pair View */
            <div className="space-y-5">
              <div className="space-y-1">
                <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">
                  {text('เปิดรับการแจ้งเตือนบนมือถือ', 'Enable Mobile Notifications')}
                </h1>
                <p className="text-xs text-slate-500">
                  {text('เชื่อมต่ออุปกรณ์นี้เข้ากับระบบปฏิทิน PEA', 'Pair this device with your PEA Calendar')}
                </p>
              </div>

              <div className="rounded-2xl border border-purple-100 bg-purple-50/50 p-3.5 text-left text-xs text-slate-600 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-brand-700">
                  <Smartphone size={20} />
                </div>
                <div className="min-w-0">
                  <span className="block font-bold text-slate-900">{deviceName}</span>
                  <span className="block text-slate-500 text-[11px]">ตรวจพบอุปกรณ์ปัจจุบัน</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleEnablePush}
                disabled={pairing || support !== 'ready' || !pushConfigured}
                className="w-full inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-700 via-fuchsia-600 to-amber-500 px-5 py-3 font-bold text-white shadow-lg shadow-purple-400/30 hover:from-brand-800 hover:via-fuchsia-700 hover:to-amber-600 transition disabled:opacity-60 text-base"
              >
                {pairing ? (
                  <>
                    <Loader2 size={19} className="animate-spin" />
                    <span>กำลังเปิดการแจ้งเตือน…</span>
                  </>
                ) : (
                  <>
                    <BellRing size={19} />
                    <span>{text('เปิดการแจ้งเตือนบนมือถือเครื่องนี้', 'Enable Notifications on This Device')}</span>
                  </>
                )}
              </button>

              {support === 'insecure' && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{text('กรุณาเปิดเว็บไซต์ผ่าน HTTPS เพื่อเปิดการแจ้งเตือน', 'Open this site over HTTPS to enable notifications.')}</p>}
              {support === 'unsupported' && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{text('กรุณาอัปเดต iOS เป็น 16.4 ขึ้นไป และเปิดจากไอคอน PEA Calendar บนหน้าจอโฮม สำหรับ Android ให้เปิดด้วย Chrome', 'Update to iOS 16.4 or later and open the Home Screen app. On Android, use Chrome.')}</p>}
              {!pushConfigured && support === 'ready' && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{text('ระบบยังไม่ได้ตั้งค่าการส่งแจ้งเตือนมือถือ กรุณาติดต่อผู้ดูแลระบบ', 'Mobile notification delivery has not been configured. Contact your administrator.')}</p>}

              <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                <ShieldCheck size={14} className="text-green-600" />
                <span>{text('ปลอดภัย ไม่ต้องกรอกรหัสผ่าน Gmail', 'Safe & encrypted without password entry')}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
