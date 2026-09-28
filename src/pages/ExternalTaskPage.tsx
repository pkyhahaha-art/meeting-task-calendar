import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FileText, Link2, Loader2 } from 'lucide-react'
import { isSupabaseConfigured, supabasePublishableKey, supabaseUrl } from '../lib/supabase'

type ExternalTask = {
  title: string
  description: string
  due_date: string
  due_time: string | null
  status: 'pending' | 'completed'
  acknowledged_at: string | null
  attachments: Array<{ id: string; file_name: string; url: string }>
  documentLinks: Array<{ id: string; display_name: string; url: string }>
}

function endpoint(token: string) {
  const url = new URL('/functions/v1/external-task', supabaseUrl)
  url.searchParams.set('token', token)
  return url
}

async function postAcknowledgement(token: string): Promise<string> {
  const response = await fetch(endpoint(token), {
    method: 'POST', headers: { apikey: supabasePublishableKey!, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'acknowledge', token }),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || 'รับทราบไม่สำเร็จ')
  return body.acknowledged_at as string
}

function clearEmailAction() {
  const url = new URL(window.location.href)
  const [route, query = ''] = url.hash.slice(1).split('?')
  const params = new URLSearchParams(query)
  params.delete('ack')
  url.hash = params.size ? `${route}?${params}` : route
  window.history.replaceState(null, '', url)
}

export function ExternalTaskPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token')?.trim() ?? '', [])
  const acknowledgeFromEmail = useMemo(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('ack') === '1', [])
  const [task, setTask] = useState<ExternalTask | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [acknowledging, setAcknowledging] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured || !token) { setError('ลิงก์งานไม่ถูกต้อง'); setLoading(false); return }
    void fetch(endpoint(token), { headers: { apikey: supabasePublishableKey! } })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'เปิดงานไม่สำเร็จ')
        const loadedTask = body.task as ExternalTask
        setTask(loadedTask)
        if (acknowledgeFromEmail && loadedTask.status === 'pending' && !loadedTask.acknowledged_at) {
          setAcknowledging(true)
          try {
            const acknowledged_at = await postAcknowledgement(token)
            setTask({ ...loadedTask, acknowledged_at })
            clearEmailAction()
          } catch (reason) { setError(reason instanceof Error ? reason.message : 'รับทราบไม่สำเร็จ') }
          finally { setAcknowledging(false) }
        } else if (acknowledgeFromEmail && loadedTask.acknowledged_at) clearEmailAction()
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'เปิดงานไม่สำเร็จ'))
      .finally(() => setLoading(false))
  }, [token, acknowledgeFromEmail])

  const acknowledge = async () => {
    if (!token || !task || task.status === 'completed' || task.acknowledged_at) return
    setAcknowledging(true); setError('')
    try {
      const acknowledged_at = await postAcknowledgement(token)
      setTask({ ...task, acknowledged_at })
      clearEmailAction()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'อัปเดตงานไม่สำเร็จ')
    } finally { setAcknowledging(false) }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center p-6 text-slate-600"><Loader2 className="animate-spin" size={24} /></main>
  if (!task) return <main className="flex min-h-screen items-center justify-center p-6 text-center"><div><h1 className="text-2xl font-bold">เปิด Task ไม่ได้</h1><p className="mt-2 text-slate-600">{error || 'ลิงก์หมดอายุหรือถูกยกเลิกแล้ว'}</p></div></main>
  if (acknowledgeFromEmail && task.acknowledged_at) return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center"><article className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm"><CheckCircle2 className="mx-auto text-green-600" size={40} /><h1 className="mt-4 text-2xl font-bold text-green-700">รับทราบแล้ว</h1><p className="mt-2 text-slate-600">คุณปิดหน้านี้ได้เลย</p></article></main>

  return <main className="min-h-screen bg-slate-50 p-4 sm:p-8"><article className="mx-auto max-w-2xl space-y-5 rounded-2xl bg-white p-5 shadow-sm sm:p-7"><header><p className="text-sm font-semibold text-amber-700">Task ที่ได้รับมอบหมาย</p><h1 className="mt-1 text-2xl font-bold text-slate-900">{task.title}</h1><p className="mt-3 whitespace-pre-wrap text-slate-600">{task.description || 'ไม่มีรายละเอียดเพิ่มเติม'}</p></header><dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">กำหนดส่ง</dt><dd className="mt-1 font-semibold">{task.due_date}{task.due_time ? ` ${task.due_time.slice(0, 5)}` : ''}</dd></div><div><dt className="text-slate-500">สถานะ</dt><dd className="mt-1 font-semibold">{task.status === 'completed' ? 'เสร็จแล้ว' : 'รอดำเนินการ'}</dd></div></dl><section><h2 className="mb-2 font-bold">เอกสาร</h2><div className="space-y-2">{task.attachments.map((file) => <a key={file.id} href={file.url} download={file.file_name} className="flex items-center gap-2 rounded-lg border p-3 text-brand-700 hover:bg-brand-50"><FileText size={17} />ดาวน์โหลด {file.file_name}</a>)}{task.documentLinks.map((link) => <a key={link.id} href={link.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border p-3 text-brand-700 hover:bg-brand-50"><Link2 size={17} />{link.display_name}</a>)}</div></section>{error && <p className="text-sm text-red-700">{error}</p>}{task.acknowledged_at ? <p className="rounded-xl bg-green-50 px-4 py-3 text-center font-semibold text-green-700">รับทราบแล้ว</p> : <button type="button" onClick={() => void acknowledge()} disabled={acknowledging || task.status === 'completed'} className="btn-primary w-full">{acknowledging ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}รับทราบ</button>}<p className="text-center text-xs text-slate-500">ผู้สร้าง Task เป็นผู้ยืนยันว่าเสร็จแล้ว</p></article></main>
}
