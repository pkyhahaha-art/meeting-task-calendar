import { useState, useMemo, useRef } from 'react'
import {
  Calendar,
  Clock,
  MapPin,
  Building2,
  Users,
  Download,
  Copy,
  Check,
  X,
  FileSpreadsheet,
  FileText,
  CheckSquare,
  Square,
  Printer,
  Edit3,
} from 'lucide-react'
import Swal from 'sweetalert2'
import { toPng } from 'html-to-image'
import { jsPDF } from 'jspdf'
import type { Database } from '../lib/database.types'
import { useLanguage } from '../i18n/LanguageProvider'
import {
  type EventRow,
  THAI_MONTHS,
  getMonthWeeks,
  filterAndSortMeetingsForSummary,
} from '../lib/meetingSummary'

interface MeetingSummaryDialogProps {
  open: boolean
  onClose: () => void
  events: EventRow[]
  cancelledAppointments?: Set<string>
}

const ITEMS_PER_A4_PAGE = 6

export function MeetingSummaryDialog({
  open,
  onClose,
  events,
  cancelledAppointments = new Set(),
}: MeetingSummaryDialogProps) {
  let text = (thai: string, _english?: string) => thai
  try {
    const lang = useLanguage()
    text = (thai: string, english?: string) => lang.text(thai, english ?? thai)
  } catch {
    // safe fallback if rendered outside LanguageProvider
  }

  // Period filter states
  const [periodType, setPeriodType] = useState<'week' | 'month'>('week')
  const now = useMemo(() => new Date(), [])
  const currentYear = now.getFullYear() // e.g. 2026
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth()) // 0 - 11
  const [selectedWeekNumber, setSelectedWeekNumber] = useState<number>(() => {
    const day = now.getDate()
    if (day <= 7) return 1
    if (day <= 14) return 2
    if (day <= 21) return 3
    if (day <= 28) return 4
    return 5
  })

  // Editable title label state
  const [customTitleLabel, setCustomTitleLabel] = useState<string>('')
  const [showDescription, setShowDescription] = useState(true)
  const [descriptionEnabled, setDescriptionEnabled] = useState<Record<string, boolean>>({})
  const [customDescriptions, setCustomDescriptions] = useState<Record<string, string>>({})

  // Weeks available in selected month
  const monthWeeks = useMemo(() => getMonthWeeks(currentYear, selectedMonth), [currentYear, selectedMonth])

  // Current date range for filtering
  const activeRange = useMemo(() => {
    const pad = (n: number) => n.toString().padStart(2, '0')
    const m = pad(selectedMonth + 1)
    const thaiYear = currentYear + 543
    const monthName = THAI_MONTHS[selectedMonth]

    if (periodType === 'month') {
      const lastDay = new Date(currentYear, selectedMonth + 1, 0).getDate()
      return {
        start: new Date(`${currentYear}-${m}-01T00:00:00+07:00`),
        end: new Date(`${currentYear}-${m}-${pad(lastDay)}T23:59:59+07:00`),
        autoLabel: `ประจำเดือน${monthName} ${thaiYear}`,
      }
    }

    // Weekly mode
    const week = monthWeeks.find((w) => w.weekNumber === selectedWeekNumber) ?? monthWeeks[0]
    const startDay = parseInt(week.startDate.slice(8, 10), 10)
    const endDay = parseInt(week.endDate.slice(8, 10), 10)
    return {
      start: new Date(`${week.startDate}T00:00:00+07:00`),
      end: new Date(`${week.endDate}T23:59:59+07:00`),
      autoLabel: `ประจำสัปดาห์ที่ ${week.weekNumber} (${startDay} – ${endDay} ${monthName} ${thaiYear})`,
    }
  }, [periodType, selectedMonth, selectedWeekNumber, monthWeeks, currentYear])

  const effectiveTitleLabel = customTitleLabel.trim() || activeRange.autoLabel

  // Filtered and sorted meetings (Ascending by Date, then Ascending by Start Time)
  const allMeetings = useMemo(() => {
    return filterAndSortMeetingsForSummary(events, activeRange.start, activeRange.end, cancelledAppointments)
  }, [events, activeRange, cancelledAppointments])

  // Selected meeting IDs in checklist (Default to all checked)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(allMeetings.map((m) => m.id)))
  const [hasInteractedWithSelection, setHasInteractedWithSelection] = useState(false)

  // Sync selection when meetings change if user hasn't explicitly customized it
  const currentMeetingIds = useMemo(() => new Set(allMeetings.map((m) => m.id)), [allMeetings])
  const activeSelectedIds = useMemo(() => {
    if (!hasInteractedWithSelection) {
      return currentMeetingIds
    }
    // Keep only items that still exist
    const filtered = new Set<string>()
    for (const id of selectedIds) {
      if (currentMeetingIds.has(id)) filtered.add(id)
    }
    return filtered
  }, [hasInteractedWithSelection, currentMeetingIds, selectedIds])

  // Filtered list of meetings that will be displayed in preview & export
  const selectedMeetings = useMemo(() => {
    return allMeetings.filter((m) => activeSelectedIds.has(m.id))
  }, [allMeetings, activeSelectedIds])

  // Checklist handlers
  const handleToggleItem = (id: string) => {
    setHasInteractedWithSelection(true)
    const next = new Set(activeSelectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const handleSelectAll = () => {
    setHasInteractedWithSelection(true)
    setSelectedIds(new Set(allMeetings.map((m) => m.id)))
  }

  const handleDeselectAll = () => {
    setHasInteractedWithSelection(true)
    setSelectedIds(new Set())
  }

  // Quick range helpers
  const handleSetThisWeek = () => {
    const today = new Date()
    setSelectedMonth(today.getMonth())
    const day = today.getDate()
    setSelectedWeekNumber(day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : day <= 28 ? 4 : 5)
    setPeriodType('week')
    setCustomTitleLabel('')
    setHasInteractedWithSelection(false)
  }

  const handleSetThisMonth = () => {
    const today = new Date()
    setSelectedMonth(today.getMonth())
    setPeriodType('month')
    setCustomTitleLabel('')
    setHasInteractedWithSelection(false)
  }

  // Export handlers
  const previewRef = useRef<HTMLDivElement>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [copied, setCopied] = useState(false)

  // 1. Export as PNG
  const handleExportPng = async () => {
    if (!previewRef.current || selectedMeetings.length === 0) return
    try {
      setIsExporting(true)
      const dataUrl = await toPng(previewRef.current, {
        quality: 0.95,
        pixelRatio: 2, // High DPI for retina / crisp print
        cacheBust: true,
      })
      const link = document.createElement('a')
      const fileName = `PEA-Meeting-Summary-${periodType === 'week' ? `W${selectedWeekNumber}` : 'Month'}-${selectedMonth + 1}-${currentYear + 543}.png`
      link.download = fileName
      link.href = dataUrl
      link.click()
      void Swal.fire({
        icon: 'success',
        title: text('ดาวน์โหลดรูปภาพสำเร็จ', 'Image downloaded successfully'),
        timer: 1800,
        showConfirmButton: false,
      })
    } catch (error) {
      console.error('PNG export failed', error)
      void Swal.fire({
        icon: 'error',
        title: text('ไม่สามารถสร้างรูปภาพได้', 'Failed to generate image'),
        text: error instanceof Error ? error.message : '',
      })
    } finally {
      setIsExporting(false)
    }
  }

  // 2. Export as PDF (A4 format with multi-page support)
  const handleExportPdf = async () => {
    if (selectedMeetings.length === 0) return
    try {
      setIsExporting(true)
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      })

      // If <= 5 items, export direct single page
      if (previewRef.current && selectedMeetings.length <= ITEMS_PER_A4_PAGE) {
        const dataUrl = await toPng(previewRef.current, { pixelRatio: 2, cacheBust: true })
        const pageWidth = doc.internal.pageSize.getWidth()
        const pageHeight = doc.internal.pageSize.getHeight()
        doc.addImage(dataUrl, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST')
      } else if (previewRef.current) {
        // Multi-page export: Capture full long infographic scaled nicely or split
        const dataUrl = await toPng(previewRef.current, { pixelRatio: 2, cacheBust: true })
        const img = new Image()
        img.src = dataUrl
        await new Promise((resolve) => {
          img.onload = resolve
        })

        const pageWidth = doc.internal.pageSize.getWidth()
        const pageHeight = doc.internal.pageSize.getHeight()
        const imgWidth = pageWidth
        const imgHeight = (img.height * pageWidth) / img.width

        let heightLeft = imgHeight
        let position = 0

        doc.addImage(dataUrl, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST')
        heightLeft -= pageHeight

        while (heightLeft > 0) {
          position = heightLeft - imgHeight
          doc.addPage()
          doc.addImage(dataUrl, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST')
          heightLeft -= pageHeight
        }
      }

      const fileName = `PEA-Meeting-Summary-${periodType === 'week' ? `W${selectedWeekNumber}` : 'Month'}-${selectedMonth + 1}-${currentYear + 543}.pdf`
      doc.save(fileName)

      void Swal.fire({
        icon: 'success',
        title: text('ดาวน์โหลด PDF สำเร็จ', 'PDF downloaded successfully'),
        timer: 1800,
        showConfirmButton: false,
      })
    } catch (error) {
      console.error('PDF export failed', error)
      void Swal.fire({
        icon: 'error',
        title: text('ไม่สามารถสร้าง PDF ได้', 'Failed to generate PDF'),
        text: error instanceof Error ? error.message : '',
      })
    } finally {
      setIsExporting(false)
    }
  }

  // 3. Copy text to clipboard
  const handleCopyText = async () => {
    if (selectedMeetings.length === 0) return
    const lines = [
      `📢 สรุปการประชุม ${effectiveTitleLabel}`,
      '──────────────────────────────',
    ]

    selectedMeetings.forEach((m, idx) => {
      lines.push(`${idx + 1}. ${m.title}`)
      lines.push(`   📅 วันที่: ${m.thaiDate} | ⏰ เวลา: ${m.timeText}`)
      lines.push(`   📍 สถานที่: ${m.location}`)
      lines.push(`   🏢 หน่วยงาน: ${m.affiliation}`)
      const desc = (customDescriptions[m.id] ?? m.description).trim()
      if (showDescription && descriptionEnabled[m.id] !== false && desc) {
        const descLines = desc.split('\n').map((l) => l.trim()).filter(Boolean)
        if (descLines.length === 1) {
          lines.push(`   📝 รายละเอียด: ${descLines[0]}`)
        } else if (descLines.length > 1) {
          lines.push(`   📝 รายละเอียด:`)
          descLines.forEach((l) => lines.push(`      • ${l}`))
        }
      }
      lines.push('')
    })

    try {
      await navigator.clipboard.writeText(lines.join('\n').trim())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      void Swal.fire({
        icon: 'success',
        title: text('คัดลอกข้อความแล้ว', 'Copied text to clipboard'),
        timer: 1500,
        showConfirmButton: false,
      })
    } catch {
      // Fallback
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-2 sm:p-4 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative flex flex-col w-full max-w-6xl max-h-[94vh] rounded-2xl bg-white shadow-2xl border border-purple-100 overflow-hidden">
        {/* Modal Top Bar */}
        <div className="flex items-center justify-between border-b border-purple-100 bg-gradient-to-r from-purple-50 via-white to-purple-50/50 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-700 text-white shadow-sm">
              <FileSpreadsheet size={19} />
            </div>
            <div>
              <h2 className="text-base font-bold text-purple-950">
                {text('สรุปการประชุม (Meeting Summary)', 'Meeting Summary')}
              </h2>
              <p className="text-xs text-purple-700/80">
                {text('คัดเลือกนัดหมาย จัดเรียงตามวันและเวลา พร้อมส่งออก PNG และ PDF สไตล์ PEA', 'Select meetings, sort by date and time, and export to PEA-themed PNG & PDF')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body: Split View (Left: Controls & Checklist | Right: Live Preview) */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          {/* LEFT: Controls & Checklist Panel */}
          <div className="w-full lg:w-[460px] xl:w-[480px] flex flex-col border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50/50 overflow-hidden">
            {/* Filter Section */}
            <div className="p-4 border-b border-slate-200 bg-white space-y-3">
              {/* Period Type Buttons */}
              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 border border-slate-200/80">
                <button
                  type="button"
                  onClick={() => {
                    setPeriodType('week')
                    setCustomTitleLabel('')
                    setHasInteractedWithSelection(false)
                  }}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                    periodType === 'week'
                      ? 'bg-purple-700 text-white shadow-sm'
                      : 'text-slate-600 hover:text-purple-800'
                  }`}
                >
                  {text('รายสัปดาห์ (Weekly)', 'Weekly')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPeriodType('month')
                    setCustomTitleLabel('')
                    setHasInteractedWithSelection(false)
                  }}
                  className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                    periodType === 'month'
                      ? 'bg-purple-700 text-white shadow-sm'
                      : 'text-slate-600 hover:text-purple-800'
                  }`}
                >
                  {text('รายเดือน (Monthly)', 'Monthly')}
                </button>
              </div>

              {/* Month & Week Selectors */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    {text('เดือน', 'Month')}
                  </label>
                  <select
                    className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-purple-500 focus:outline-none"
                    value={selectedMonth}
                    onChange={(e) => {
                      setSelectedMonth(parseInt(e.target.value, 10))
                      setSelectedWeekNumber(1)
                      setCustomTitleLabel('')
                      setHasInteractedWithSelection(false)
                    }}
                  >
                    {THAI_MONTHS.map((m, idx) => (
                      <option key={m} value={idx}>
                        {m} {currentYear + 543}
                      </option>
                    ))}
                  </select>
                </div>

                {periodType === 'week' ? (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      {text('สัปดาห์', 'Week')}
                    </label>
                    <select
                      className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-purple-500 focus:outline-none"
                      value={selectedWeekNumber}
                      onChange={(e) => {
                        setSelectedWeekNumber(parseInt(e.target.value, 10))
                        setCustomTitleLabel('')
                        setHasInteractedWithSelection(false)
                      }}
                    >
                      {monthWeeks.map((w) => (
                        <option key={w.weekNumber} value={w.weekNumber}>
                          {w.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      {text('ช่วงเวลา', 'Period')}
                    </label>
                    <div className="h-[34px] flex items-center px-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                      {text('ตลอดทั้งเดือน', 'Full month')}
                    </div>
                  </div>
                )}
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex items-center gap-1.5 pt-1 text-[11px]">
                <span className="text-slate-400 font-medium">{text('ลัด:', 'Quick:')}</span>
                <button
                  type="button"
                  onClick={handleSetThisWeek}
                  className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 hover:bg-purple-100 font-semibold transition"
                >
                  {text('สัปดาห์นี้', 'This Week')}
                </button>
                <button
                  type="button"
                  onClick={handleSetThisMonth}
                  className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-700 hover:bg-purple-100 font-semibold transition"
                >
                  {text('เดือนนี้', 'This Month')}
                </button>
              </div>

              {/* Editable Period Subtitle */}
              <div className="pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-bold text-slate-600 flex items-center gap-1">
                    <Edit3 size={11} className="text-purple-700" />
                    <span>{text('ข้อความหัวเรื่องประจำงวด', 'Period Subtitle')}</span>
                  </label>
                  {customTitleLabel && (
                    <button
                      type="button"
                      onClick={() => setCustomTitleLabel('')}
                      className="text-[10px] text-purple-700 hover:underline"
                    >
                      {text('คืนค่าเดิม', 'Reset')}
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={effectiveTitleLabel}
                  onChange={(e) => setCustomTitleLabel(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-xs text-slate-800 focus:border-purple-500 focus:outline-none"
                  placeholder="เช่น ประจำเดือนพฤศจิกายน 2569"
                />
              </div>

              {/* Toggle description */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={showDescription}
                    onChange={(e) => setShowDescription(e.target.checked)}
                    className="rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                  />
                  <span>{text('แสดงรายละเอียด (สามารถพิมพ์สรุปย่อในแต่ละรายการได้)', 'Show description (editable per item)')}</span>
                </label>
              </div>
            </div>

            {/* Checklist Header & Bulk Actions */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-slate-100/90 border-b border-slate-200 text-xs">
              <div className="flex items-center gap-1.5 font-bold text-slate-700">
                <CheckSquare size={14} className="text-purple-700" />
                <span>
                  {text('เลือกรายการนัดหมาย', 'Select meetings')} (
                  <span className="text-purple-700 font-extrabold">{selectedMeetings.length}</span> / {allMeetings.length})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-purple-700 hover:text-purple-900 font-bold hover:underline"
                >
                  {text('เลือกทั้งหมด', 'Select all')}
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={handleDeselectAll}
                  className="text-slate-500 hover:text-slate-700 font-bold hover:underline"
                >
                  {text('ปลดทั้งหมด', 'Clear')}
                </button>
              </div>
            </div>

            {/* Checklist Items Scroll Container */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {allMeetings.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  <Calendar size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-xs">{text('ไม่มีรายการนัดหมายประชุมในช่วงเวลาที่เลือก', 'No meetings found in this period')}</p>
                </div>
              ) : (
                allMeetings.map((meeting, index) => {
                  const isChecked = activeSelectedIds.has(meeting.id)
                  return (
                    <div
                      key={meeting.id}
                      onClick={() => handleToggleItem(meeting.id)}
                      className={`flex items-start gap-3 p-3 rounded-xl border transition cursor-pointer select-none ${
                        isChecked
                          ? 'border-purple-300 bg-purple-50/40 shadow-xs'
                          : 'border-slate-200 bg-white opacity-60 hover:opacity-100'
                      }`}
                    >
                      <button
                        type="button"
                        className="mt-0.5 text-purple-700 focus:outline-none"
                      >
                        {isChecked ? <CheckSquare size={17} /> : <Square size={17} className="text-slate-400" />}
                      </button>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-xs font-bold text-slate-900 truncate">
                            {index + 1}. {meeting.title}
                          </h4>
                          <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">
                            {meeting.affiliation}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
                          <span className="flex items-center gap-1">
                            <Calendar size={12} className="text-purple-600" />
                            {meeting.thaiDate}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock size={12} className="text-purple-600" />
                            {meeting.timeText}
                          </span>
                        </div>
                        {meeting.location && (
                          <div className="flex items-start gap-1 text-[11px] text-slate-600">
                            <MapPin size={11} className="shrink-0 text-slate-400 mt-0.5" />
                            <span className="leading-tight break-words">{meeting.location}</span>
                          </div>
                        )}
                        {showDescription && (
                          <div className="mt-1.5 pt-1" onClick={(e) => e.stopPropagation()}>
                            <label className="flex min-h-11 items-center gap-2 text-[10px] font-semibold text-purple-900 mb-0.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={descriptionEnabled[meeting.id] !== false}
                                onChange={(e) => setDescriptionEnabled((previous) => ({ ...previous, [meeting.id]: e.target.checked }))}
                                aria-label={text(`แสดงรายละเอียด ${meeting.title}`, `Show description for ${meeting.title}`)}
                                className="h-3.5 w-3.5 shrink-0 appearance-none rounded-full border border-purple-400 checked:bg-purple-600 checked:border-purple-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600"
                              />
                              {text('รายละเอียด (พิมพ์แก้ไขข้อความสรุปได้ / กด Enter ขึ้นบรรทัดใหม่ได้):', 'Description (editable / Enter for new line):')}
                            </label>
                            {descriptionEnabled[meeting.id] !== false && (
                            <textarea
                              rows={2}
                              value={customDescriptions[meeting.id] ?? meeting.description}
                              onChange={(e) => {
                                const val = e.target.value
                                setCustomDescriptions((prev) => ({ ...prev, [meeting.id]: val }))
                              }}
                              placeholder={text('พิมพ์ข้อความสรุปย่อ (กด Enter ขึ้นบรรทัดใหม่ได้)...', 'Type short summary (Enter for new line)...')}
                              className="w-full text-[11px] px-2 py-1.5 rounded-md border border-purple-200 bg-white focus:outline-none focus:border-purple-500 text-slate-700 shadow-sm resize-y leading-snug"
                            />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* RIGHT: Live Preview & Export Container */}
          <div className="flex-1 flex flex-col min-h-0 bg-slate-200/60 overflow-hidden">
            {/* Action Bar Above Preview */}
            <div className="flex items-center justify-between px-5 py-2.5 bg-white border-b border-slate-200">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700">
                  {text('ตัวอย่างภาพสรุป (Live Preview)', 'Live Preview')}
                </span>
                <span className="text-[11px] text-slate-500">
                  ({selectedMeetings.length} {text('รายการ', 'items')}
                  {selectedMeetings.length <= ITEMS_PER_A4_PAGE ? text(' • พอดี 1 หน้า A4', ' • Fits 1 A4 page') : text(' • ยาวต่อเนื่อง', ' • Long infographic')})
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyText}
                  disabled={selectedMeetings.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-xs transition disabled:opacity-40"
                >
                  {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                  <span>{copied ? text('คัดลอกแล้ว', 'Copied') : text('คัดลอกข้อความ', 'Copy Text')}</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportPng}
                  disabled={selectedMeetings.length === 0 || isExporting}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-purple-300 bg-purple-50 text-xs font-bold text-purple-800 hover:bg-purple-100 shadow-xs transition disabled:opacity-40"
                >
                  <Download size={14} />
                  <span>{text('ดาวน์โหลด PNG', 'Download PNG')}</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  disabled={selectedMeetings.length === 0 || isExporting}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-purple-700 text-xs font-bold text-white hover:bg-purple-800 shadow-xs transition disabled:opacity-40"
                >
                  <Printer size={14} />
                  <span>{text('ดาวน์โหลด PDF (A4)', 'Download PDF (A4)')}</span>
                </button>
              </div>
            </div>

            {/* Scrollable Preview Area */}
            <div className="flex-1 overflow-auto p-4 flex justify-center items-start">
              {/* THE INFOGRAPHIC CANVAS / TEMPLATE CONTAINER */}
              <div
                ref={previewRef}
                id="pea-meeting-summary-canvas"
                className="w-[740px] min-h-[960px] bg-gradient-to-b from-[#fbf8ff] via-[#f7f2fc] to-[#ede4f6] p-7 shadow-xl rounded-2xl border border-purple-200/80 flex flex-col justify-between font-sans relative"
                style={{
                  boxSizing: 'border-box',
                }}
              >
                {/* 1. TOP HEADER SECTION */}
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-purple-200/60">
                    <div className="flex items-center gap-4">
                      {/* PEA Official Round Emblem (Enlarged) */}
                      <img
                        src={`${import.meta.env?.BASE_URL ?? '/'}email-assets/pea-logo.png`}
                        alt="PEA Emblem"
                        className="w-[72px] h-[72px] object-contain shrink-0 drop-shadow-xs"
                        crossOrigin="anonymous"
                      />
                      {/* Vertical line divider */}
                      <div className="h-12 w-[2px] bg-[#611667]/40" />
                      <div>
                        <h1 className="text-3xl font-extrabold tracking-tight text-[#4c1553] leading-none">
                          สรุปการประชุม
                        </h1>
                        <p className="text-base font-bold text-[#71277a] mt-1.5">
                          {effectiveTitleLabel}
                        </p>
                      </div>
                    </div>

                    {/* 3D Calendar / Schedule Illustration Accent */}
                    <div className="flex items-center gap-2">
                      <div className="relative flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-[#782280] text-white shadow-md">
                        <Calendar size={26} strokeWidth={2.2} />
                        <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-white text-purple-700 shadow-xs text-[10px] font-extrabold">
                          ✓
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. MEETING CARDS TIMELINE SECTION */}
                <div className="my-5 relative flex-1">
                  {selectedMeetings.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-purple-400">
                      <Calendar size={48} className="mb-2 opacity-40" />
                      <p className="text-sm font-medium">โปรดติ๊กเลือกนัดหมายประชุมที่ต้องการสรุป</p>
                    </div>
                  ) : (
                    <div className="relative pl-9 space-y-2.5">
                      {/* Vertical Purple Timeline Line */}
                      <div className="absolute left-[13px] top-3 bottom-3 w-[2.5px] bg-gradient-to-b from-[#7a227f] via-[#9e3fa5] to-[#c074c7] rounded-full" />

                      {selectedMeetings.map((meeting) => (
                        <div key={meeting.id} className="relative group">
                          {/* Timeline Node Badge (Calendar Icon) */}
                          <div className="absolute -left-9 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#7a227f] text-white shadow-xs border-2 border-white">
                            <Calendar size={11} strokeWidth={2.5} />
                          </div>

                          {/* Meeting Card Container */}
                          <div className="rounded-xl overflow-hidden border border-purple-200/90 shadow-sm bg-white transition">
                            {/* Card Header (Deep Purple Strip) */}
                            <div className="bg-gradient-to-r from-[#712276] via-[#7d2783] to-[#913297] text-white px-3.5 py-1.5 flex items-center justify-between">
                              <h3 className="font-bold text-[13px] tracking-tight leading-snug">
                                {meeting.title}
                              </h3>
                            </div>

                            {/* Card Body: 4 Columns (วันที่, เวลา, สถานที่, หน่วยงานผู้รับผิดชอบ) */}
                            <div className="px-3 py-2 bg-white">
                              <div className="grid grid-cols-[135px_105px_minmax(0,1fr)_minmax(0,1fr)] gap-3 text-xs items-start">
                                {/* Col 1: วันที่ (แสดงข้อความเต็ม ไม่ตัดคำ) */}
                                <div className="space-y-0.5 min-w-0">
                                  <div className="flex items-center gap-1.5 text-purple-900 font-bold text-[10.5px]">
                                    <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-purple-100 text-purple-800 shrink-0">
                                      <Calendar size={10} />
                                    </span>
                                    <span>วันที่</span>
                                  </div>
                                  <p className="text-[11.5px] font-semibold text-slate-800 pl-6 leading-tight whitespace-nowrap">
                                    {meeting.thaiDate}
                                  </p>
                                </div>

                                {/* Col 2: เวลา (แสดงข้อความเต็ม) */}
                                <div className="space-y-0.5 min-w-0">
                                  <div className="flex items-center gap-1.5 text-purple-900 font-bold text-[10.5px]">
                                    <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-purple-100 text-purple-800 shrink-0">
                                      <Clock size={10} />
                                    </span>
                                    <span>เวลา</span>
                                  </div>
                                  <p className="text-[11.5px] font-semibold text-slate-800 pl-6 leading-tight whitespace-nowrap">
                                    {meeting.timeText}
                                  </p>
                                </div>

                                {/* Col 3: สถานที่ (จัด layout เรียบร้อย ตัดบรรทัดตาม / หรือ \ หรือขึ้นบรรทัดใหม่ให้ได้ใจความ) */}
                                <div className="space-y-0.5 min-w-0">
                                  <div className="flex items-center gap-1.5 text-purple-900 font-bold text-[10.5px]">
                                    <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-purple-100 text-purple-800 shrink-0">
                                      <MapPin size={10} />
                                    </span>
                                    <span>สถานที่</span>
                                  </div>
                                  <div className="text-[11.5px] font-medium text-slate-800 pl-6 leading-snug space-y-0.5 break-words">
                                    {meeting.location ? (
                                      meeting.location
                                        .split(/\s*[\/\\]\s*|\n/)
                                        .map((part) => part.trim())
                                        .filter(Boolean)
                                        .map((part, pIdx) => (
                                          <div key={pIdx} className="leading-snug">{part}</div>
                                        ))
                                    ) : (
                                      <span className="text-slate-400">-</span>
                                    )}
                                  </div>
                                </div>

                                {/* Col 4: หน่วยงานผู้รับผิดชอบ (แบ่งพื้นที่สมดุลกับสถานที่ แสดงครบถ้วนไม่ถูกตัดทอน) */}
                                <div className="space-y-0.5 min-w-0">
                                  <div className="flex items-center gap-1.5 text-purple-900 font-bold text-[10.5px]">
                                    <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-purple-100 text-purple-800 shrink-0">
                                      <Users size={10} />
                                    </span>
                                    <span>หน่วยงาน</span>
                                  </div>
                                  <div className="text-[11.5px] font-semibold text-slate-800 pl-6 leading-snug space-y-0.5 break-words">
                                    {meeting.affiliation ? (
                                      meeting.affiliation
                                        .split(/\s*[\/\\]\s*|\n/)
                                        .map((part) => part.trim())
                                        .filter(Boolean)
                                        .map((part, pIdx) => (
                                          <div key={pIdx} className="leading-snug">{part}</div>
                                        ))
                                    ) : (
                                      <span className="text-slate-400">-</span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Description row: ปิดได้ หรือพิมพ์แก้ไขสรุปเองได้ (รองรับข้อความหลายบรรทัด) */}
                              {showDescription && descriptionEnabled[meeting.id] !== false && (customDescriptions[meeting.id] ?? meeting.description).trim() && (
                                <div className="mt-2 pt-1.5 border-t border-purple-100/70 flex items-start gap-1.5 text-[10.5px] text-slate-700 bg-purple-50/40 px-2.5 py-1.5 rounded-md min-w-0 break-words">
                                  <FileText size={11} className="shrink-0 text-purple-700 mt-0.5" />
                                  <div className="leading-relaxed font-normal text-slate-700 break-words whitespace-pre-wrap min-w-0 flex-1">
                                    {(customDescriptions[meeting.id] ?? meeting.description).trim()}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 3. FOOTER: PEA BANNER ACCENT */}
                <div className="mt-4 pt-3 border-t border-purple-200/60 flex items-center justify-between text-xs text-purple-900/70">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-purple-900 tracking-wider">PEA</span>
                    <span className="text-[11px]">การไฟฟ้าส่วนภูมิภาค • Provincial Electricity Authority</span>
                  </div>
                  <span className="text-[10px] text-purple-700/60">
                    Meeting & Task Calendar
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
