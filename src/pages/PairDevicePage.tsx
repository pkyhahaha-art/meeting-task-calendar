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
  ArrowRight
} from 'lucide-react'
import mascotHoldingPad from '../../ภาพประกอบUI/02_Hand I-Pad.jpg'
import peaLogo from '../../ภาพประกอบUI/PEA Logo (1).png'
import { useLanguage } from '../i18n/LanguageProvider'
import {
  verifyPairingToken,
  completeDevicePairing,
  detectDeviceName,
} from '../lib/mobilePush'

export function PairDevicePage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const { text } = useLanguage()

  const [loading, setLoading] = useState(true)
  const [pairing, setPairing] = useState(false)
  const [tokenValid, setTokenValid] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [pairedUserName, setPairedUserName] = useState<string | null>(null)
  const [deviceName, setDeviceName] = useState('')

  useEffect(() => {
    setDeviceName(detectDeviceName())

    async function checkToken() {
      if (!token) {
        setErrorMessage('ไม่พบรหัสเชื่อมต่อ (Token) กรุณาสแกน QR Code ใหม่อีกครั้ง')
        setLoading(false)
        return
      }

      setLoading(true)
      const res = await verifyPairingToken(token)
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

          {loading ? (
            <div className="py-8 space-y-3">
              <Loader2 size={32} className="mx-auto animate-spin text-brand-600" />
              <p className="text-sm font-semibold text-slate-600">กำลังตรวจสอบข้อมูลการเชื่อมต่อ…</p>
            </div>
          ) : success ? (
            /* Success View */
            <div className="space-y-5 animate-fadeIn">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700 border border-green-200">
                <CheckCircle2 size={14} />
                <span>{text('เชื่อมต่อสำเร็จแล้ว', 'Pairing Successful')}</span>
              </div>

              <div className="space-y-2">
                <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900">
                  {text('พร้อมรับการแจ้งเตือนแล้ว!', 'Notifications Enabled!')}
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
                  <li>ไม่ต้องเปิดแอปค้างไว้ ระบบจะแจ้งเตือนอัตโนมัติ</li>
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
                {text('กรุณาเปิดหน้า "เชื่อมต่อการแจ้งเตือนผ่านมือถือ" บนคอมพิวเตอร์ แล้วสแกน QR Code ใหม่อีกครั้ง', 'Please refresh the QR code on your desktop screen and scan again.')}
              </p>
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
                disabled={pairing}
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
