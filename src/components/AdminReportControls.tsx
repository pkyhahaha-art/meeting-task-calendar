import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { reportPageSize } from '../lib/adminReports'

export function AdminFilter({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1 text-sm font-semibold text-slate-700"><span>{label}</span>{children}</label>
}

export function AdminPager({ count, page, busy, onPage }: { count: number; page: number; busy: boolean; onPage: (page: number) => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 p-4 text-sm">
    <span>{count === 0 ? 'ไม่พบรายการตามเงื่อนไข' : `แสดง ${page * reportPageSize + 1}–${Math.min((page + 1) * reportPageSize, count)} จาก ${count.toLocaleString('th-TH')} รายการ`}</span>
    <div className="flex items-center gap-2">
      <button type="button" className="btn-secondary" disabled={busy || page <= 0} onClick={() => onPage(page - 1)}><ChevronLeft size={16} />ก่อนหน้า</button>
      <button type="button" className="btn-secondary" disabled={busy || (page + 1) * reportPageSize >= count} onClick={() => onPage(page + 1)}>ถัดไป<ChevronRight size={16} /></button>
    </div>
  </div>
}

export function adminDate(value: string | null) {
  return value ? new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }) : '—'
}

// These are the existing Task/Meeting status words; delivery behavior is unchanged.
export const adminDeliveryStatus = { queued: 'รอส่ง', processing: 'กำลังส่ง', sent: 'ส่งแล้ว', retry: 'กำลังลองส่งใหม่', failed: 'ส่งไม่สำเร็จ', skipped: 'ข้ามการส่ง', deferred_quota: 'รอโควตา' }
export function AdminStatus({ value, label = value }: { value: string; label?: string }) {
  const color = value === 'sent' || value === 'completed' || value === 'active' ? 'bg-green-50 text-green-700'
    : value === 'failed' || value === 'disabled' || value === 'deferred_quota' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${color}`}>{label}</span>
}
