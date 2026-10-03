import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CheckCircle2, Copy, ExternalLink, Link2, Loader2, MessageCircle, Smartphone, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { useAuth } from '../auth/AuthProvider'
import { useLanguage } from '../i18n/LanguageProvider'
import type { Database } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { ProfileOrganizationForm } from '../components/ProfileOrganizationForm'
import { getConnectedDevices } from '../lib/mobilePush'

type LineConnection = Database['public']['Tables']['line_connections']['Row']

export function ProfilePage() {
  const { profile, user } = useAuth()
  const { text } = useLanguage()
  const addFriendUrl = import.meta.env.VITE_LINE_ADD_FRIEND_URL?.trim()
  const [linkCode, setLinkCode] = useState('')
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState('')
  const lineQuery = useQuery({
    queryKey: ['line-connection', user?.id],
    enabled: Boolean(user && addFriendUrl),
    queryFn: async () => {
      const { data, error } = await supabase.from('line_connections').select('*').eq('user_id', user!.id).is('disconnected_at', null).returns<LineConnection[]>().maybeSingle()
      if (error) throw error
      return data
    },
    refetchInterval: linkCode ? 5000 : false,
  })
  const devicesQuery = useQuery({ queryKey: ['mobile-push-devices', user?.id],
    enabled: Boolean(user), queryFn: () => getConnectedDevices(user!.id), staleTime: 0 })
  const createLinkCode = async () => {
    setLinking(true); setLinkError('')
    const { data, error } = await supabase.functions.invoke('line-webhook', { body: { action: 'create-code' } })
    if (error || !data?.code) setLinkError(error?.message || text('สร้างรหัสเชื่อมต่อไม่สำเร็จ', 'Could not create a connection code.'))
    else setLinkCode(data.code)
    setLinking(false)
  }
  return <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
    <div><h1 className="text-2xl font-bold text-slate-900">{text('บัญชีและตั้งค่า', 'Account & Settings')}</h1><p className="mt-1 text-sm text-slate-500">{text('ตรวจสอบบัญชีและจัดการช่องทางการแจ้งเตือน', 'Review your account and notification channels.')}</p></div>
    
    <section className="card p-5"><h2 className="flex items-center gap-2 text-lg font-bold"><UserRound size={20} className="text-brand-600" />{text('ข้อมูลบัญชี', 'Account details')}</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2"><div><dt className="text-xs font-semibold text-slate-500">{text('ชื่อ', 'Name')}</dt><dd className="mt-1 font-medium">{profile?.full_name || '—'}</dd></div><div><dt className="text-xs font-semibold text-slate-500">Gmail</dt><dd className="mt-1 font-medium">{profile?.email || user?.email}</dd></div><div><dt className="text-xs font-semibold text-slate-500">{text('รหัสพนักงาน', 'Employee ID')}</dt><dd className="mt-1 font-medium">{profile?.employee_id || '—'}</dd></div><div><dt className="text-xs font-semibold text-slate-500">{text('สิทธิ์', 'Role')}</dt><dd className="mt-1 font-medium">{profile?.role === 'admin' ? text('ผู้ดูแลระบบ', 'Administrator') : text('พนักงาน', 'Employee')}</dd></div></dl><ProfileOrganizationForm /></section>
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="flex items-center gap-2 font-bold"><Smartphone size={20} className="text-brand-600" />{text('แจ้งเตือนมือถือ', 'Mobile notifications')}</h2>
          <p role="status" className="mt-1 text-sm text-slate-600">{devicesQuery.isPending ? text('กำลังตรวจอุปกรณ์…', 'Checking devices…')
            : devicesQuery.isError ? text('ตรวจสถานะไม่ได้ กรุณาเปิดหน้าจัดการอุปกรณ์แล้วลองใหม่', 'Could not check devices. Open device management to retry.')
              : devicesQuery.data?.length ? text(`เชื่อมต่อแล้ว ${devicesQuery.data.length} เครื่อง`, `${devicesQuery.data.length} connected devices`)
                : text('ยังไม่ได้เชื่อมต่อมือถือ', 'No connected devices')}</p></div>
        <Link to="/mobile-push" className="btn-secondary">{text('จัดการอุปกรณ์', 'Manage devices')}<ArrowRight size={16} /></Link>
      </div>
      <p className="text-sm leading-relaxed text-slate-500">{text('รับแจ้งเตือนเฉพาะงานและประชุมที่เกี่ยวข้องกับคุณ ตามผู้รับ ช่องทาง และเวลาเตือนที่กำหนดในแต่ละรายการ', 'Notifications are limited to your related tasks and meetings, based on each item’s recipients, channels and reminder times.')}</p>
    </section>
    {addFriendUrl && <section className="card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-bold"><MessageCircle size={20} className="text-green-600" />{text('เชื่อม LINE', 'Connect LINE')}</h2><p className="mt-1 text-sm text-slate-500">{text('ใช้สำหรับรับการแจ้งเตือนการประชุม', 'Use LINE to receive meeting notifications.')}</p></div>{lineQuery.data && <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-green-700"><CheckCircle2 size={16} />{text('เชื่อมต่อแล้ว', 'Connected')}</span>}</div>
      {lineQuery.data ? <div className="mt-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{text(`LINE ของคุณเชื่อมกับระบบเมื่อ ${new Date(lineQuery.data.connected_at).toLocaleString('th-TH')} แล้ว`, `Your LINE account was connected on ${new Date(lineQuery.data.connected_at).toLocaleString('en-GB')}.`)}</div> : addFriendUrl ? <div className="mt-5 grid items-center gap-6 sm:grid-cols-[220px_1fr]"><div className="mx-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><QRCodeSVG value={addFriendUrl} size={184} level="M" title={text('QR Code เพิ่มเพื่อน LINE', 'QR code to add LINE')} /></div><div><h3 className="font-bold">{text('วิธีเชื่อมต่อ', 'How to connect')}</h3><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600"><li>{text('สแกน QR และเพิ่ม LINE Official Account เป็นเพื่อน', 'Scan the QR code and add the LINE Official Account.')}</li><li>{text('กด “สร้างรหัสเชื่อมต่อ” ด้านล่าง', 'Select “Create connection code” below.')}</li><li>{text('ส่งข้อความ LINK ตามด้วยรหัส ไปที่บัญชี LINE ภายใน 15 นาที', 'Send “LINK” followed by the code to the LINE account within 15 minutes.')}</li></ol>{linkCode ? <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3"><p className="text-xs font-semibold text-green-700">{text('ส่งข้อความนี้ใน LINE', 'Send this message in LINE')}</p><div className="mt-1 flex items-center gap-2"><code className="text-xl font-bold">LINK {linkCode}</code><button type="button" className="rounded-lg p-2 hover:bg-green-100" onClick={() => void navigator.clipboard.writeText(`LINK ${linkCode}`)} aria-label={text('คัดลอกรหัส', 'Copy code')}><Copy size={17} /></button></div></div> : <button type="button" className="btn-secondary mt-4" onClick={() => void createLinkCode()} disabled={linking}>{linking && <Loader2 size={17} className="animate-spin" />}{text('สร้างรหัสเชื่อมต่อ', 'Create connection code')}</button>}{linkError && <p className="mt-2 text-sm text-red-600">{linkError}</p>}<a className="btn-primary mt-4" href={addFriendUrl} target="_blank" rel="noreferrer"><Link2 size={17} />{text('เปิดใน LINE', 'Open in LINE')} <ExternalLink size={15} /></a></div></div> : <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-bold">{text('ยังไม่ได้ตั้งค่า LINE Official Account', 'LINE Official Account is not configured')}</p><p className="mt-1">{text('ผู้ดูแลต้องใส่ลิงก์ Add Friend ในตัวแปร VITE_LINE_ADD_FRIEND_URL แล้วเปิดเซิร์ฟเวอร์ใหม่ จากนั้น QR Code จะปรากฏที่หน้านี้', 'An administrator must set the Add Friend link in VITE_LINE_ADD_FRIEND_URL and restart the server. The QR code will then appear here.')}</p></div>}
    </section>}
  </main>
}
