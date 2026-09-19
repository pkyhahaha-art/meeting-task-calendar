import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink, Link2, MessageCircle, UserRound } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useAuth } from '../auth/AuthProvider'
import type { Database } from '../lib/database.types'
import { supabase } from '../lib/supabase'

type LineConnection = Database['public']['Tables']['line_connections']['Row']

export function ProfilePage() {
  const { profile, user } = useAuth()
  const addFriendUrl = import.meta.env.VITE_LINE_ADD_FRIEND_URL?.trim()
  const lineQuery = useQuery({
    queryKey: ['line-connection', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase.from('line_connections').select('*').eq('user_id', user!.id).is('disconnected_at', null).returns<LineConnection[]>().maybeSingle()
      if (error) throw error
      return data
    },
  })
  return <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
    <div><h1 className="text-2xl font-bold text-slate-900">โปรไฟล์และการแจ้งเตือน</h1><p className="mt-1 text-sm text-slate-500">ตรวจสอบบัญชีและเชื่อม LINE Official Account</p></div>
    <section className="card p-5"><h2 className="flex items-center gap-2 text-lg font-bold"><UserRound size={20} className="text-brand-600" />ข้อมูลบัญชี</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2"><div><dt className="text-xs font-semibold text-slate-500">ชื่อ</dt><dd className="mt-1 font-medium">{profile?.full_name || '—'}</dd></div><div><dt className="text-xs font-semibold text-slate-500">Gmail</dt><dd className="mt-1 font-medium">{profile?.email || user?.email}</dd></div><div><dt className="text-xs font-semibold text-slate-500">รหัสพนักงาน</dt><dd className="mt-1 font-medium">{profile?.employee_id || '—'}</dd></div><div><dt className="text-xs font-semibold text-slate-500">สิทธิ์</dt><dd className="mt-1 font-medium">{profile?.role === 'admin' ? 'ผู้ดูแลระบบ' : 'พนักงาน'}</dd></div></dl></section>
    <section className="card p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-bold"><MessageCircle size={20} className="text-green-600" />เชื่อม LINE</h2><p className="mt-1 text-sm text-slate-500">ใช้สำหรับรับการแจ้งเตือนการประชุม</p></div>{lineQuery.data && <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-3 py-1 text-sm font-semibold text-green-700"><CheckCircle2 size={16} />เชื่อมต่อแล้ว</span>}</div>
      {lineQuery.data ? <div className="mt-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">LINE ของคุณเชื่อมกับระบบเมื่อ {new Date(lineQuery.data.connected_at).toLocaleString('th-TH')} แล้ว</div> : addFriendUrl ? <div className="mt-5 grid items-center gap-6 sm:grid-cols-[220px_1fr]"><div className="mx-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><QRCodeSVG value={addFriendUrl} size={184} level="M" title="QR Code เพิ่มเพื่อน LINE" /></div><div><h3 className="font-bold">วิธีเพิ่มเพื่อน</h3><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600"><li>เปิด LINE แล้วเลือกสแกน QR Code</li><li>สแกน QR ทางซ้ายและกด “เพิ่มเพื่อน”</li><li>ส่งข้อความตามคำแนะนำของบัญชี LINE เพื่อยืนยันการเชื่อมต่อ</li></ol><a className="btn-primary mt-4" href={addFriendUrl} target="_blank" rel="noreferrer"><Link2 size={17} />เปิดใน LINE <ExternalLink size={15} /></a></div></div> : <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-bold">ยังไม่ได้ตั้งค่า LINE Official Account</p><p className="mt-1">ผู้ดูแลต้องใส่ลิงก์ Add Friend ในตัวแปร <code>VITE_LINE_ADD_FRIEND_URL</code> แล้วเปิดเซิร์ฟเวอร์ใหม่ จากนั้น QR Code จะปรากฏที่หน้านี้</p></div>}
    </section>
  </main>
}
