import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, CheckCircle2, FileText, Loader2, MapPin } from 'lucide-react'
import { isSupabaseConfigured, supabasePublishableKey, supabaseUrl } from '../lib/supabase'

type GuestEvent = {
  title: string
  description: string
  affiliation: string
  start_datetime: string
  end_datetime: string | null
  all_day: boolean
  location: string
  timezone: string
  acknowledged_at: string | null
  attachments: Array<{ id: string; file_name: string; url: string }>
}

async function postAcknowledgement(token: string): Promise<string> {
  const response = await fetch(new URL('/functions/v1/guest-event', supabaseUrl), {
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

export function GuestEventPage() {
  const token = useMemo(() => new URLSearchParams(window.location.hash.split('?')[1] ?? window.location.search).get('token')?.trim() ?? '', [])
  const acknowledgeFromEmail = useMemo(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('ack') === '1', [])
  const [event, setEvent] = useState<GuestEvent | null>(null)
  const [error, setError] = useState('')
  const [acknowledging, setAcknowledging] = useState(false)
  useEffect(() => {
    if (!isSupabaseConfigured || !token) { setError('ลิงก์ Meeting ไม่ถูกต้อง'); return }
    const url = new URL('/functions/v1/guest-event', supabaseUrl)
    url.searchParams.set('token', token)
    void fetch(url, { headers: { apikey: supabasePublishableKey! } }).then(async (response) => {
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'เปิด Meeting ไม่สำเร็จ')
      const loadedEvent = body.event as GuestEvent
      setEvent(loadedEvent)
      if (acknowledgeFromEmail && !loadedEvent.acknowledged_at) {
        setAcknowledging(true)
        try {
          const acknowledged_at = await postAcknowledgement(token)
          setEvent({ ...loadedEvent, acknowledged_at })
          clearEmailAction()
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'รับทราบไม่สำเร็จ') }
        finally { setAcknowledging(false) }
      } else if (acknowledgeFromEmail && loadedEvent.acknowledged_at) clearEmailAction()
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'เปิด Meeting ไม่สำเร็จ'))
  }, [token, acknowledgeFromEmail])

  const acknowledge = async () => {
    if (!event || event.acknowledged_at) return
    setAcknowledging(true); setError('')
    try {
      const acknowledged_at = await postAcknowledgement(token)
      setEvent({ ...event, acknowledged_at })
      clearEmailAction()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'รับทราบไม่สำเร็จ') }
    finally { setAcknowledging(false) }
  }

  if (!event && !error) return <main className="flex min-h-screen items-center justify-center"><Loader2 className="animate-spin text-brand-600" /></main>
  if (!event) return <main className="flex min-h-screen items-center justify-center p-6 text-center"><div><h1 className="text-2xl font-bold">เปิด Meeting ไม่ได้</h1><p className="mt-2 text-slate-600">{error}</p></div></main>
  if (acknowledgeFromEmail && event.acknowledged_at) return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center"><article className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm"><CheckCircle2 className="mx-auto text-green-600" size={40} /><h1 className="mt-4 text-2xl font-bold text-green-700">รับทราบแล้ว</h1><p className="mt-2 text-slate-600">คุณปิดหน้านี้ได้เลย</p></article></main>
  const format = (value: string) => new Date(value).toLocaleString('th-TH', { dateStyle: 'long', timeStyle: event.all_day ? undefined : 'short', timeZone: event.timezone })
  return <main className="min-h-screen bg-slate-50 p-4 sm:p-8"><article className="mx-auto max-w-2xl space-y-5 rounded-2xl bg-white p-5 shadow-sm sm:p-7"><header><p className="flex items-center gap-2 text-sm font-semibold text-brand-700"><CalendarClock size={18} />รายละเอียด Meeting</p><h1 className="mt-2 text-2xl font-bold text-slate-900">{event.title}</h1><p className="mt-3 whitespace-pre-wrap text-slate-600">{event.description || 'ไม่มีรายละเอียดเพิ่มเติม'}</p></header><dl className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">เริ่ม</dt><dd className="mt-1 font-semibold">{format(event.start_datetime)}</dd></div>{event.end_datetime && <div><dt className="text-slate-500">สิ้นสุด</dt><dd className="mt-1 font-semibold">{format(event.end_datetime)}</dd></div>}{event.affiliation && <div><dt className="text-slate-500">หน่วยงาน / สังกัด</dt><dd className="mt-1 font-semibold">{event.affiliation}</dd></div>}{event.location && <div className="sm:col-span-2"><dt className="text-slate-500">สถานที่</dt><dd className="mt-1 flex items-center gap-2 font-semibold"><MapPin size={16} />{event.location}</dd></div>}</dl>{event.attachments.length > 0 && <section><h2 className="mb-2 font-bold">ไฟล์แนบ</h2><div className="space-y-2">{event.attachments.map((file) => <a key={file.id} href={file.url} className="flex items-center gap-2 rounded-lg border p-3 text-brand-700 hover:bg-brand-50"><FileText size={17} />{file.file_name}</a>)}</div></section>}{error && <p className="text-sm text-red-700">{error}</p>}{event.acknowledged_at ? <p className="rounded-xl bg-green-50 px-4 py-3 text-center font-semibold text-green-700">รับทราบแล้ว</p> : <button type="button" className="btn-primary w-full" disabled={acknowledging} onClick={() => void acknowledge()}>{acknowledging ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}รับทราบ</button>}<p className="text-xs text-slate-400">ลิงก์ไฟล์มีอายุ 5 นาทีและสร้างใหม่เมื่อเปิดหน้านี้</p></article></main>
}
