import { Bell, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Database } from '../lib/database.types'
import { useLanguage } from '../i18n/LanguageProvider'

export type DeliveryStatusRow = Pick<Database['public']['Tables']['notification_deliveries']['Row'], 'id' | 'reminder_id' | 'recipient_type' | 'recipient_reference' | 'channel' | 'status' | 'scheduled_at' | 'sent_at' | 'error_message' | 'created_at'>

type StatusDisplay = { label: string; className: string }

const statusDisplay: Record<DeliveryStatusRow['status'], StatusDisplay> = {
  queued: { label: 'รอส่ง', className: 'bg-slate-100 text-slate-700' },
  processing: { label: 'กำลังส่ง', className: 'bg-sky-100 text-sky-700' },
  sent: { label: 'ส่งแล้ว', className: 'bg-emerald-100 text-emerald-700' },
  retry: { label: 'กำลังลองส่งใหม่', className: 'bg-amber-100 text-amber-800' },
  failed: { label: 'ส่งไม่สำเร็จ', className: 'bg-red-100 text-red-700' },
  skipped: { label: 'ข้ามการส่ง', className: 'bg-slate-100 text-slate-600' },
  deferred_quota: { label: 'รอโควตา', className: 'bg-amber-100 text-amber-800' },
}

const recipientExplanation: Record<string, string> = {
  owner: 'ผู้สร้าง Meeting — ได้รับแจ้งเตือนอัตโนมัติ',
  task_creator: 'ผู้สร้าง Task — ได้รับแจ้งเตือนอัตโนมัติ',
  task_assignee: 'ผู้รับมอบหมาย',
  external_assignee: 'ผู้รับมอบหมายภายนอก',
  guest: 'ผู้เข้าร่วม',
  registered_user: 'ผู้ใช้ในระบบ',
}

function displayDate(value: string, language: 'th' | 'en') {
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(value))
}

export function NotificationDeliveryStatus({ deliveries, acknowledgements, onRetry, title, description, emptyMessage, embedded = false }: {
  deliveries: DeliveryStatusRow[]
  acknowledgements: Record<string, string | null>
  onRetry?: (deliveryId: string) => Promise<void>
  title?: { thai: string; english: string }
  description?: { thai: string; english: string }
  emptyMessage?: { thai: string; english: string }
  embedded?: boolean
}) {
  const { language, text } = useLanguage()
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const latestDeliveries = useMemo(() => {
    const latest = new Map<string, DeliveryStatusRow>()
    for (const delivery of deliveries) {
      const key = `${delivery.recipient_reference}\u0000${delivery.channel}\u0000${delivery.recipient_type}`
      const current = latest.get(key)
      if (!current || delivery.created_at > current.created_at) latest.set(key, delivery)
    }
    return [...latest.values()]
  }, [deliveries])

  const retry = async (deliveryId: string) => {
    if (!onRetry) return
    setRetryingId(deliveryId)
    try { await onRetry(deliveryId) } finally { setRetryingId(null) }
  }

  return (
    <section className={embedded ? 'space-y-3' : 'space-y-3 rounded-xl border border-slate-200 p-4'}>
      <div><h3 className="flex items-center gap-2 font-semibold text-slate-800"><Bell size={18} className="text-brand-600" />{text(title?.thai ?? 'สถานะการแจ้งเตือน', title?.english ?? 'Notification status')}</h3><p className="mt-1 text-xs text-slate-500">{text(description?.thai ?? 'แสดงสถานะล่าสุดของแต่ละผู้รับและช่องทาง', description?.english ?? 'Shows the latest status for each recipient and channel.')}</p></div>
      {!deliveries.length && <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">{text(emptyMessage?.thai ?? 'ยังไม่มีรายการแจ้งเตือนสำหรับ Meeting หรือ Task นี้', emptyMessage?.english ?? 'There are no notifications for this meeting or task yet.')}</p>}
      <div className="space-y-2">
        {latestDeliveries.map((delivery) => {
          const status = statusDisplay[delivery.status]
          const acknowledgement = acknowledgements[delivery.recipient_reference.toLowerCase()]
          const canRetry = Boolean(onRetry && (delivery.status === 'failed' || delivery.status === 'deferred_quota'))
          const isRetrying = retryingId === delivery.id
          const explanation = recipientExplanation[delivery.recipient_type]
          return <div key={delivery.id} className="rounded-lg bg-slate-50 px-3 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="min-w-0 flex-1 break-all font-medium text-slate-800">{delivery.recipient_reference}{explanation && <span className="font-normal text-slate-500"> ({text(explanation, ({ owner: 'Meeting creator — notified automatically', task_creator: 'Task creator — notified automatically', task_assignee: 'Assignee', external_assignee: 'External assignee', guest: 'Attendee', registered_user: 'Registered user' } as Record<string, string>)[delivery.recipient_type] ?? explanation)})</span>}</span><span className="rounded-full px-2 py-1 text-xs font-medium text-slate-600">{delivery.channel === 'email' ? 'Email' : text('แจ้งเตือนมือถือ', 'Mobile Push')}</span><span className={`rounded-full px-2 py-1 text-xs font-medium ${status.className}`}>{text(status.label, ({ queued: 'Queued', processing: 'Sending', sent: 'Sent', retry: 'Retrying', failed: 'Failed', skipped: 'Skipped', deferred_quota: 'Waiting for quota' } as Record<string, string>)[delivery.status])}</span></div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500"><span>{delivery.sent_at ? text(`ส่งเมื่อ ${displayDate(delivery.sent_at, language)}`, `Sent ${displayDate(delivery.sent_at, language)}`) : text(`กำหนดส่ง ${displayDate(delivery.scheduled_at, language)}`, `Scheduled ${displayDate(delivery.scheduled_at, language)}`)}</span>{Object.prototype.hasOwnProperty.call(acknowledgements, delivery.recipient_reference.toLowerCase()) && <span className={acknowledgement ? 'text-emerald-700' : 'text-slate-500'}>{acknowledgement ? text(`รับทราบเมื่อ ${displayDate(acknowledgement, language)}`, `Acknowledged ${displayDate(acknowledgement, language)}`) : text('รอรับทราบ', 'Awaiting acknowledgement')}</span>}</div>
            {delivery.error_message && (delivery.status === 'failed' || delivery.status === 'deferred_quota') && <p className="mt-2 text-xs text-red-700">{delivery.error_message}</p>}
            {canRetry && <button type="button" className="btn-secondary mt-3" disabled={isRetrying} onClick={() => void retry(delivery.id)}>{isRetrying && <Loader2 className="animate-spin" size={16} />}{text('ส่งอีกครั้ง', 'Retry')}</button>}
          </div>
        })}
      </div>
    </section>
  )
}
