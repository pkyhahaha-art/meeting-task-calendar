import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Copy, ExternalLink, Link2, Loader2, MessageCircle, UserRound } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useAuth } from '../auth/AuthProvider'
import type { Database } from '../lib/database.types'
import { supabase } from '../lib/supabase'

type LineConnection = Database['public']['Tables']['line_connections']['Row']

export function ProfilePage() {
  const { profile, user } = useAuth()
  const addFriendUrl = import.meta.env.VITE_LINE_ADD_FRIEND_URL?.trim()
  const [linkCode, setLinkCode] = useState('')
  const [linking, setLinking] = useState(false)
  const [linkError, setLinkError] = useState('')
  const lineQuery = useQuery({
    queryKey: ['line-connection', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from('line_connections').select('*').eq('user_id', user!.id).is('disconnected_at', null).returns<LineConnection[]>().maybeSingle()
      if (error) throw error
      return data
    },
    refetchInterval: linkCode ? 5000 : false,
  })
  const createLinkCode = async () => {
    setLinking(true); setLinkError('')
    const { data, error } = await supabase.functions.invoke('line-webhook', { body: { action: 'create-code' } })
    if (error || !data?.code) setLinkError(error?.message || 'สร้างรหัสเชื่อมต่อไม่สำเร็จ')
    else setLinkCode(data.code)
    setLinking(false)
  }
  return <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
    <div><h1 className="text-2xl font-bold text-slate-900">โปรไฟล์และการแจ้งเตือน</h1><p className="mt-1 text-sm text-slate-500">ตรวจสอบบัญชีและเชื่อม LINE Official Account</p></div>
    <section className="card p-5"><h2 className="flex items-center gap-2 text-lg font-bold"><UserRound size={20} className="text-brand-600" />ข้อมูลบัญชี</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2"><div><dt className="text-xs font-semibold text-slate-500">ชื่อ</dt><dd className="mt-1 font-medium">{profile?.full_name || '—'}</dd></div><div><dt className="text-xs font-semibold text-slate-500">Gmail</dt><dd className="mt-1 font-medium">{profile?.email || user?.email}</dd></div><div><dt className="text-xs font-semibold text-slate-500">รหัสพนักงาน</dt><dd className="mt-1 font-medium">{profile?.employee_id || '—'}</dd></div><div><dt className="text-xs font-semibold text-slate-500">สิทธิ์</dt><dd className="mt-1 font-medium">{profile?.role === 'admin' ? 'ผู้ดูแลระบบ' : 'พนักงาน'}</dd></div></dl></section>
    <section className="card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-bold"><MessageCircle size={20} className="text-green-600" />เชื่อม LINE</h2><p className="mt-1 text-sm text-slate-500">ใช้สำหรับรับการแจ้งเตือนการประชุม</p></div>{lineQuery.data && <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-green-700"><CheckCircle2 size={16} />เชื่อมต่อแล้ว</span>}</div>
      {lineQuery.data ? <div className="mt-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">LINE ของคุณเชื่อมกับระบบเมื่อ {new Date(lineQuery.data.connected_at).toLocaleString('th-TH')} แล้ว</div> : addFriendUrl ? <div className="mt-5 grid items-center gap-6 sm:grid-cols-[220px_1fr]"><div className="mx-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><QRCodeSVG value={addFriendUrl} size={184} level="M" title="QR Code เพิ่มเพื่อน LINE" /></div><div><h3 className="font-bold">วิธีเชื่อมต่อ</h3><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600"><li>สแกน QR และเพิ่ม LINE Official Account เป็นเพื่อน</li><li>กด “สร้างรหัสเชื่อมต่อ” ด้านล่าง</li><li>ส่งข้อความ <strong>LINK ตามด้วยรหัส</strong> ไปที่บัญชี LINE ภายใน 15 นาที</li></ol>{linkCode ? <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3"><p className="text-xs font-semibold text-green-700">ส่งข้อความนี้ใน LINE</p><div className="mt-1 flex items-center gap-2"><code className="text-xl font-bold">LINK {linkCode}</code><button type="button" className="rounded-lg p-2 hover:bg-green-100" onClick={() => void navigator.clipboard.writeText(`LINK ${linkCode}`)} aria-label="คัดลอกรหัส"><Copy size={17} /></button></div></div> : <button type="button" className="btn-secondary mt-4" onClick={() => void createLinkCode()} disabled={linking}>{linking && <Loader2 size={17} className="animate-spin" />}สร้างรหัสเชื่อมต่อ</button>}{linkError && <p className="mt-2 text-sm text-red-600">{linkError}</p>}<a className="btn-primary mt-4" href={addFriendUrl} target="_blank" rel="noreferrer"><Link2 size={17} />เปิดใน LINE <ExternalLink size={15} /></a></div></div> : <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-bold">ยังไม่ได้ตั้งค่า LINE Official Account</p><p className="mt-1">ผู้ดูแลต้องใส่ลิงก์ Add Friend ในตัวแปร <code>VITE_LINE_ADD_FRIEND_URL</code> แล้วเปิดเซิร์ฟเวอร์ใหม่ จากนั้น QR Code จะปรากฏที่หน้านี้</p></div>}
    </section>
  </main>
}
