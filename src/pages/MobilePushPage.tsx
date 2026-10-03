import { useEffect, useState, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import {
  Smartphone,
  CheckCircle2,
  Copy,
  RefreshCw,
  BellRing,
  Trash2,
  Sparkles,
  ShieldCheck,
  Clock,
  Laptop,
  Check,
  AlertCircle,
  Loader2,
  Wifi,
  Settings2
} from 'lucide-react'
import mascotHoldingPad from '../../ภาพประกอบUI/02_Hand I-Pad.jpg'
import { useAuth } from '../auth/AuthProvider'
import { useLanguage } from '../i18n/LanguageProvider'
import { useConfirm } from '../components/ConfirmDialogProvider'
import { appUrl } from '../lib/appUrl'
import { loadMobilePushConfig } from '../lib/mobilePushConfig'
import {
  createPairingToken,
  getConnectedDevices,
  deleteConnectedDevice,
  sendDeviceTestNotification,
  type ConnectedDevice,
} from '../lib/mobilePush'

import { MobileConnectionGuide } from '../components/MobileConnectionGuide'

export function MobilePushPage() {
  const { user } = useAuth()
  const { text } = useLanguage()
  const confirm = useConfirm()
  const queryClient = useQueryClient()

  const [pairingToken, setPairingToken] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<Date | null>(null)
  const [timeLeft, setTimeLeft] = useState<number>(0)
  const [isGenerating, setIsGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const initialGeneratedRef = useRef(false)
  const [testingDevice, setTestingDevice] = useState<string | null>(null)
  const [remoteTestStatus, setRemoteTestStatus] = useState<string | null>(null)
  const [showPairing, setShowPairing] = useState(false)
  const previousDeviceCount = useRef<number | null>(null)
  const pushConfig = useQuery({ queryKey: ['mobile-push-config'], queryFn: () => loadMobilePushConfig(import.meta.env.VITE_SUPABASE_URL), retry: false })

  // Query connected devices
  const devicesQuery = useQuery({
    queryKey: ['mobile-push-devices', user?.id],
    queryFn: () => getConnectedDevices(user!.id),
    enabled: Boolean(user?.id),
    refetchInterval: 5000, // Poll every 5s while page is open to detect new scan immediately
  })

  const devices = devicesQuery.data || []
  const showPairingPanel = devicesQuery.isFetchedAfterMount && devicesQuery.isSuccess && (!devices.length || showPairing)

  // Delete device mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteConnectedDevice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mobile-push-devices', user?.id] })
    },
  })

  // Function to generate a new pairing token
  const generateNewToken = useCallback(async () => {
    if (!user?.id) return
    setIsGenerating(true)
    setPairingToken(null)
    setExpiresAt(null)
    setTimeLeft(0)
    setTestError(null)
    try {
      const result = await createPairingToken(user.id)
      if (result && result.token) {
        setPairingToken(result.token)
        setExpiresAt(result.expiresAt)
        const seconds = Math.max(0, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000))
        setTimeLeft(seconds)
      }
    } catch (err: unknown) {
      console.error('generateNewToken error:', err)
      const msg = err instanceof Error ? err.message : 'ไม่สามารถสร้าง QR Code ได้'
      setTestError(msg)
    } finally {
      setIsGenerating(false)
    }
  }, [user?.id])

  // Initialize pairing token on mount or when user loads
  useEffect(() => {
    if (!showPairingPanel) { initialGeneratedRef.current = false; return }
    if (user?.id && !initialGeneratedRef.current) {
      initialGeneratedRef.current = true
      void generateNewToken()
    }
  }, [user?.id, generateNewToken, showPairingPanel])

  useEffect(() => {
    if (!devicesQuery.isSuccess) return
    if (previousDeviceCount.current !== null && devices.length > previousDeviceCount.current) setShowPairing(false)
    previousDeviceCount.current = devices.length
  }, [devicesQuery.isSuccess, devices.length])

  // Countdown timer effect
  useEffect(() => {
    if (!expiresAt) return

    const interval = setInterval(() => {
      const diff = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
      setTimeLeft(diff)
      if (diff <= 0) {
        clearInterval(interval)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [expiresAt])

  // Format MM:SS
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const [customHost, setCustomHost] = useState(() => localStorage.getItem('mobile_push_host') || '')
  const [showNetworkSetting, setShowNetworkSetting] = useState(false)

  const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

  const effectiveBaseUrl = customHost.trim()
    ? (customHost.trim().startsWith('http://') || customHost.trim().startsWith('https://')
        ? customHost.trim()
        : `http://${customHost.trim()}`)
    : window.location.origin

  // Pairing URL for QR code — uses appUrl to ensure GitHub Pages subpath is preserved
  const pairingUrl = pairingToken
    ? isLocalhost && customHost.trim()
      ? (() => {
          const base = customHost.trim().startsWith('http://') || customHost.trim().startsWith('https://')
            ? customHost.trim().replace(/\/$/, '')
            : `http://${customHost.trim().replace(/\/$/, '')}`
          return `${base}/#/pair-device?token=${pairingToken}`
        })()
      : appUrl(`pair-device?token=${pairingToken}`)
    : ''

  const handleSaveCustomHost = (value: string) => {
    setCustomHost(value)
    localStorage.setItem('mobile_push_host', value)
  }

  const handleCopyLink = async () => {
    if (!pairingUrl) return
    try {
      await navigator.clipboard.writeText(pairingUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // ignore
    }
  }

  const handleDeleteDevice = async (device: ConnectedDevice) => {
    const ok = await confirm({
      title: text('ยกเลิกการเชื่อมต่ออุปกรณ์?', 'Disconnect device?'),
      message: text(
        `คุณต้องการยกเลิกการแจ้งเตือนบนอุปกรณ์ "${device.device_name || 'อุปกรณ์นี้'}" หรือไม่?`,
        `Are you sure you want to disconnect notifications for "${device.device_name || 'this device'}"?`
      ),
      confirmLabel: text('ยกเลิกการเชื่อมต่อ', 'Disconnect'),
      tone: 'danger',
    })
    if (ok) {
      await deleteMutation.mutateAsync(device.id)
    }
  }

  const handleDeviceTest = async (device: ConnectedDevice) => {
    setTestingDevice(device.id)
    setRemoteTestStatus(null)
    try {
      await sendDeviceTestNotification(device.id)
      setRemoteTestStatus(text('เซิร์ฟเวอร์ส่งข้อความทดสอบให้ผู้ให้บริการ Push แล้ว กรุณาตรวจบนมือถือ', 'The push provider accepted the test. Check your phone.'))
    } catch (error) {
      setRemoteTestStatus(error instanceof Error ? error.message : text('ส่งไม่สำเร็จ', 'Send failed'))
    } finally {
      setTestingDevice(null)
    }
  }

  return (
    <main className="min-h-screen p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-6">
      {!pushConfig.data?.ready && !pushConfig.isFetching && (
        <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {pushConfig.error?.message || text('ระบบส่งแจ้งเตือนมือถือยังไม่พร้อม คุณสามารถติดตั้งแอปบนหน้าจอโฮมไว้ก่อน แล้วกดตรวจสอบระบบอีกครั้งบนมือถือเมื่อผู้ดูแลตั้งค่าแล้ว', 'Mobile delivery is not ready yet. Install the Home Screen app, then check the server again after setup.')}
        </p>
      )}
      {/* Hero Header Banner */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-900 via-brand-800 to-purple-950 p-6 sm:p-8 text-white shadow-xl shadow-purple-950/20">
        <div className="absolute -right-12 -top-12 h-64 w-64 rounded-full bg-purple-500/20 blur-3xl" />
        <div className="absolute -left-12 -bottom-12 h-64 w-64 rounded-full bg-amber-500/20 blur-3xl" />

        <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="max-w-xl space-y-3 text-center md:text-left">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-400/20 border border-amber-300/30 px-3.5 py-1 text-xs font-semibold text-amber-300 backdrop-blur-sm">
              <Sparkles size={14} className="animate-pulse" />
              <span>{text('ระบบแจ้งเตือนแบบเรียลไทม์ (Device Pairing)', 'Real-time Push Notification (Device Pairing)')}</span>
            </div>

            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight">
              {text('เชื่อมต่อการแจ้งเตือนผ่านมือถือ', 'Connect Mobile Notifications')}
            </h1>

            <p className="text-sm sm:text-base text-purple-100/90 leading-relaxed">
              {text(
                'สแกน QR Code ครั้งเดียวด้วยมือถือเครื่องที่คุณต้องการรับการแจ้งเตือน ไม่ต้องล็อกอิน Gmail ซ้ำ ระบบจะแจ้งเตือนการประชุมและงานที่คุณต้องทำทันทีเมื่อถึงเวลา',
                'Scan the QR code once on your mobile phone to receive meeting and task alerts instantly without logging into Gmail again.'
              )}
            </p>
          </div>

          <div className="relative flex shrink-0 items-center justify-center">
            <div className="relative h-32 w-32 sm:h-40 sm:w-40 rounded-2xl overflow-hidden border-2 border-white/20 bg-white/10 p-1 shadow-2xl backdrop-blur">
              <img
                src={mascotHoldingPad}
                alt="PEA Mascot holding tablet"
                className="h-full w-full object-cover rounded-xl"
              />
            </div>
            <div className="absolute -bottom-2 -right-2 rounded-full bg-amber-400 p-2 text-brand-950 shadow-lg animate-bounce">
              <BellRing size={20} />
            </div>
          </div>
        </div>
      </section>

      {/* Connected Devices List */}
      <section className="bg-white rounded-3xl border border-purple-100 p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-purple-100 pb-4">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Smartphone className="text-brand-600" size={22} />
              {text('อุปกรณ์ที่เชื่อมต่อแล้ว', 'Connected Devices')}
              <span className="ml-2 rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-bold text-brand-700">
                {devices.length} {text('เครื่อง', 'devices')}
              </span>
            </h2>
            {testError && <p role="alert" className="text-sm text-red-700">{testError}</p>}
            <p className="text-xs text-slate-500">
              {text('อุปกรณ์ทั้งหมดที่จะได้รับการแจ้งเตือน Meeting และ Task ของคุณ', 'All devices configured to receive your meeting and task notifications.')}
            </p>
          </div>
          {devicesQuery.isSuccess && devices.length > 0 && <button type="button" className="btn-secondary" onClick={() => setShowPairing((value) => !value)}>{showPairing ? text('ปิด QR Code', 'Close QR code') : text('เชื่อมต่ออุปกรณ์เพิ่ม', 'Connect another device')}</button>}
        </div>

        {devicesQuery.isPending ? <p role="status" className="text-slate-500">{text('กำลังตรวจอุปกรณ์…', 'Checking devices…')}</p> : devicesQuery.isError ? <div role="alert" className="space-y-2 text-red-700"><p>{text('โหลดอุปกรณ์ไม่ได้ กรุณาลองใหม่', 'Could not load devices. Please retry.')}</p><button type="button" className="btn-secondary" onClick={() => void devicesQuery.refetch()}>{text('ลองใหม่', 'Retry')}</button></div> : devices.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-purple-200/80 bg-purple-50/40 p-8 text-center space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-100 text-brand-600 shadow-sm">
              <Smartphone size={28} />
            </div>
            <h3 className="text-base font-bold text-slate-800">{text('ยังไม่มีอุปกรณ์ที่เชื่อมต่อ', 'No connected devices yet')}</h3>
            <p className="max-w-md mx-auto text-xs text-slate-500">
              {text(
                'ใช้โทรศัพท์มือถือสแกน QR Code ด้านล่างเพื่อเริ่มรับการแจ้งเตือนบนมือถือของคุณได้ทันที',
                'Scan the QR code below with your mobile phone to begin receiving notifications.'
              )}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {devices.map((device) => {
              const isPhone = !device.user_agent || /iPhone|Android|Mobile/i.test(device.user_agent)
              return (
                <div
                  key={device.id}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-purple-100 bg-gradient-to-r from-purple-50/50 via-white to-amber-50/30 p-4 shadow-sm hover:border-purple-200 transition"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-100 to-amber-100 text-brand-800 shadow-sm">
                      {isPhone ? <Smartphone size={24} /> : <Laptop size={24} />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-bold text-slate-900">
                          {device.device_name || text('อุปกรณ์มือถือ', 'Mobile Device')}
                        </p>
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                          <CheckCircle2 size={12} />
                          {text('เชื่อมต่อแล้ว', 'Active')}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {text('เชื่อมเมื่อ: ', 'Paired: ')}
                        {new Date(device.created_at).toLocaleDateString('th-TH', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => void handleDeviceTest(device)} disabled={Boolean(testingDevice) || !pushConfig.data?.ready} className="min-h-11 rounded-xl px-3 text-xs font-semibold text-brand-700 hover:bg-purple-100 disabled:opacity-50">{testingDevice === device.id ? text('กำลังส่ง…', 'Sending…') : text('ส่งทดสอบไปเครื่องนี้', 'Send test to device')}</button>
                  <button
                    type="button"
                    disabled={deleteMutation.isPending} onClick={() => void handleDeleteDevice(device).catch(() => {})}
                    className="shrink-0 rounded-xl p-2.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
                    title={text('ยกเลิกการเชื่อมต่อ', 'Disconnect')}
                    aria-label={text('ยกเลิกการเชื่อมต่อ', 'Disconnect')}
                  >
                    <Trash2 size={18} />
                  </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {remoteTestStatus && <p role="status" className="rounded-xl bg-purple-50 p-3 text-sm text-brand-800">{remoteTestStatus}</p>}
        {deleteMutation.isError && <p role="alert" className="text-sm text-red-700">{text('ยกเลิกการเชื่อมต่อไม่ได้ กรุณาลองใหม่', 'Could not disconnect. Please retry.')}</p>}
      </section>
      {/* Pairing QR is opened only for a first or additional device. */}
      {showPairingPanel && <div className="mx-auto max-w-xl">
        {/* Left Column: QR Code Box */}
        <section className="bg-white rounded-3xl border border-purple-100 p-6 sm:p-8 shadow-sm flex flex-col items-center text-center space-y-6">
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-slate-900 flex items-center justify-center gap-2">
              <Smartphone className="text-brand-600" size={24} />
              {text('สแกน QR Code เพื่อเชื่อมต่อ', 'Scan QR Code to Pair')}
            </h2>
            <p className="text-xs text-slate-500">
              {text('เปิดกล้องหรือแอปสแกน QR บนมือถือของคุณเพื่อจับคู่อุปกรณ์', 'Open camera or QR scanner on your phone')}
            </p>
          </div>

          {/* QR Container */}
          <div className="relative p-5 rounded-3xl bg-gradient-to-b from-purple-50 via-white to-amber-50 border-2 border-brand-200/60 shadow-inner flex flex-col items-center">
            {isGenerating ? (
              <div className="flex h-[242px] w-[242px] flex-col items-center justify-center rounded-2xl bg-white p-6 shadow-sm border border-purple-100">
                <Loader2 size={40} className="animate-spin text-brand-600 mb-3" />
                <p className="font-semibold text-sm text-slate-700">{text('กำลังสร้าง QR Code…', 'Generating QR Code…')}</p>
                <p className="text-xs mt-1 text-slate-400">{text('กรุณารอสักครู่', 'Please wait')}</p>
              </div>
            ) : pairingUrl && timeLeft > 0 ? (
              <div className="rounded-2xl bg-white p-4 shadow-md border border-purple-100">
                <QRCodeSVG
                  value={pairingUrl}
                  size={210}
                  level="M"
                  marginSize={4}
                />
              </div>
            ) : (
              <div className="flex h-[242px] w-[242px] flex-col items-center justify-center rounded-2xl bg-slate-100 p-6 text-slate-500">
                <AlertCircle size={40} className="text-amber-600 mb-2" />
                <p className="font-semibold text-sm text-slate-700">{text('QR Code หมดอายุแล้ว', 'QR Code expired')}</p>
                <p className="text-xs mt-1 text-slate-500">{text('กรุณากดสร้างใหม่ด้านล่าง', 'Please click refresh below')}</p>
              </div>
            )}

            {/* Countdown timer badge */}
            <div className="mt-4 flex items-center gap-2 rounded-full bg-white px-4 py-1.5 shadow-sm border border-purple-100">
              <Clock size={15} className={timeLeft <= 60 ? 'text-red-500 animate-pulse' : 'text-brand-600'} />
              <span className="text-xs text-slate-600 font-medium">
                {text('หมดอายุใน: ', 'Expires in: ')}
              </span>
              <span className={`text-xs font-bold ${timeLeft <= 60 ? 'text-red-600 animate-pulse' : 'text-brand-700'}`}>
                {formatTime(timeLeft)}
              </span>
            </div>
          </div>

          {/* Action buttons under QR */}
          <div className="w-full flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={generateNewToken}
              disabled={isGenerating}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-purple-50 hover:text-brand-700 hover:border-purple-200 transition disabled:opacity-50"
            >
              <RefreshCw size={16} className={isGenerating ? 'animate-spin text-brand-600' : ''} />
              {text('สร้าง QR Code ใหม่', 'Refresh QR Code')}
            </button>

            <button
              type="button"
              onClick={handleCopyLink}
              disabled={!pairingUrl || timeLeft <= 0}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-brand-50 border border-brand-200 px-4 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-100 transition disabled:opacity-50"
            >
              {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
              {copied ? text('คัดลอกลิงก์แล้ว!', 'Link Copied!') : text('คัดลอกลิงก์เชื่อมต่อ', 'Copy Pairing Link')}
            </button>
          </div>

          {/* Localhost / Network Wi-Fi helper */}
          {isLocalhost && (
            <div className="w-full rounded-2xl border border-amber-200 bg-amber-50/70 p-3.5 text-left text-xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-amber-900">
                  <Wifi size={15} className="text-amber-700" />
                  <span>{text('สแกนผ่าน Wi-Fi เดียวกัน (Local IP)', 'Connect via local Wi-Fi IP')}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowNetworkSetting((prev) => !prev)}
                  className="text-[11px] font-semibold text-brand-700 underline flex items-center gap-1"
                >
                  <Settings2 size={13} />
                  <span>{showNetworkSetting ? text('ซ่อนตั้งค่า IP', 'Hide IP setting') : text('ตั้งค่า IP เครื่อง', 'Set Computer IP')}</span>
                </button>
              </div>

              {showNetworkSetting ? (
                <div className="space-y-2 pt-1">
                  <p className="text-slate-600 text-[11px] leading-relaxed">
                    {text(
                      'พิมพ์ IP เครื่องคอมพิวเตอร์ของคุณ (ดูจาก ipconfig เช่น 192.168.1.50:5173) เพื่อให้ Safari บนมือถือเปิดได้:',
                      'Enter your computer local IP address (e.g. 192.168.1.50:5173):'
                    )}
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="field-input text-xs py-1.5 bg-white"
                      placeholder="เช่น 192.168.1.50:5173"
                      value={customHost}
                      onChange={(e) => handleSaveCustomHost(e.target.value)}
                    />
                    {customHost && (
                      <button
                        type="button"
                        onClick={() => handleSaveCustomHost('')}
                        className="rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        {text('รีเซ็ต', 'Reset')}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-amber-800 text-[11px] leading-relaxed">
                  {customHost
                    ? `🔗 กำลังใช้ IP: ${effectiveBaseUrl}`
                    : text(
                        '💡 หาก Safari เปิดไม่ได้ ให้กด "ตั้งค่า IP เครื่อง" แล้วใส่ IP คอมพิวเตอร์ เช่น 192.168.1.X:5173 หรือเปิดเว็บนี้ด้วย IP เครื่อง',
                        '💡 If Safari cannot open, click "Set Computer IP" and enter your local IP, or open this page via your IP address.'
                      )}
                </p>
              )}
            </div>
          )}

          <div className="inline-flex items-center gap-2 text-xs text-slate-500 bg-slate-50 rounded-xl px-4 py-2 border border-slate-200/80">
            <ShieldCheck size={16} className="text-green-600 shrink-0" />
            <span>{text('ปลอดภัย: โทเค็นเข้ารหัสใช้ได้ครั้งเดียว ไม่เปิดเผยข้อมูลส่วนตัว', 'Secure: One-time encrypted token without credential exposure')}</span>
          </div>
        </section>
      </div>}
      <MobileConnectionGuide />
    </main>
  )
}
