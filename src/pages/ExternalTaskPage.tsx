import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, FileText, Link2, Loader2 } from 'lucide-react'
import { isSupabaseConfigured, supabasePublishableKey, supabaseUrl } from '../lib/supabase'

type ExternalTask = {
  title: string
  description: string
  due_date: string
  due_time: string | null
  status: 'pending' | 'completed'
  attachments: Array<{ id: string; file_name: string; url: string }>
  documentLinks: Array<{ id: string; display_name: string; url: string }>
}

function endpoint(token: string) {
  const url = new URL('/functions/v1/external-task', supabaseUrl)
  url.searchParams.set('token', token)
  return url
}

export function ExternalTaskPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token')?.trim() ?? '', [])
  const [task, setTask] = useState<ExternalTask | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured || !token) { setError('ลิงก์งานไม่ถูกต้อง'); setLoading(false); return }
    void fetch(endpoint(token), { headers: { apikey: supabasePublishableKey! } })
      .then(async (response) => {
        const body = await response.json()
        if (!response.ok) throw new Error(body.error || 'เปิดงานไม่สำเร็จ')
        setTask(body.task as ExternalTask)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'เปิดงานไม่สำเร็จ'))
      .finally(() => setLoading(false))
  }, [token])

  const complete = async () => {
    if (!token || !task || task.status === 'completed' || !window.confirm('ยืนยันว่า Task นี้เสร็จแล้ว?')) return
    setCompleting(true); setError('')
    try {
      const response = await fetch(endpoint(token), {
        method: 'POST', headers: { apikey: supabasePublishableKey!, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'complete' }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'อัปเดตงานไม่สำเร็จ')
      setTask({ ...task, status: 'completed' })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'อัปเดตงานไม่สำเร็จ')
    } finally { setCompleting(false) }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center p-6 text-slate-600"><Loader2 className="animate-spin" size={24} /></main>
  if (error || !task) return <main className="flex min-h-screen items-center justify-center p-6 text-center"><div><h1 className="text-2xl font-bold">เปิด Task ไม่ได้</h1><p className="mt-2 text-slate-600">{error || 'ลิงก์หมดอายุหรือถูกยกเลิกแล้ว'}</p></div></main>

  return <main className="min-h-screen bg-slate-50 p-4 sm:p-8"><article className="mx-auto max-w-2xl space-y-5 rounded-2xl bg-white p-5 shadow-sm sm:p-7"><header><p className="text-sm font-semibold text-amber-700">Task ที่ได้รับมอบหมาย</p><h1 className="mt-1 text-2xl font-bold text-slate-900">{task.title}</h1><p className="mt-3 whitespace-pre-wrap text-slate-600">{task.description || 'ไม่มีรายละเอียดเพิ่มเติม'}</p></header><dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">กำหนดส่ง</dt><dd className="mt-1 font-semibold">{task.due_date}{task.due_time ? ` ${task.due_time.slice(0, 5)}` : ''}</dd></div><div><dt className="text-slate-500">สถานะ</dt><dd className="mt-1 font-semibold">{task.status === 'completed' ? 'เสร็จแล้ว' : 'รอดำเนินการ'}</dd></div></dl>{(task.attachments.length > 0 || task.documentLinks.length > 0) && <section><h2 className="mb-2 font-bold">เอกสาร</h2><div className="space-y-2">{task.attachments.map((file) => <a key={file.id} href={file.url} className="flex items-center gap-2 rounded-lg border p-3 text-brand-700 hover:bg-brand-50"><FileText size={17} />{file.file_name}</a>)}{task.documentLinks.map((link) => <a key={link.id} href={link.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border p-3 text-brand-700 hover:bg-brand-50"><Link2 size={17} />{link.display_name}</a>)}</div></section>}{error && <p className="text-sm text-red-700">{error}</p>}<button type="button" onClick={() => void complete()} disabled={completing || task.status === 'completed'} className="btn-primary w-full">{completing ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}{task.status === 'completed' ? 'Task นี้เสร็จแล้ว' : 'ยืนยันว่าทำ Task เสร็จแล้ว'}</button></article></main>
}
