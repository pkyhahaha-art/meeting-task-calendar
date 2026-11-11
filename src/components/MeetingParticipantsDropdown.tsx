import { useRef } from 'react'
import { ChevronDown } from 'lucide-react'
import { meetingExecutiveOptions, parseMeetingParticipants, serializeMeetingParticipants } from '../lib/meetingParticipants'

interface MeetingParticipantsDropdownProps {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  compact?: boolean
}

export function MeetingParticipantsDropdown({ id, value, onChange, disabled = false, compact = false }: MeetingParticipantsDropdownProps) {
  const dropdownRef = useRef<HTMLDetailsElement>(null)
  const selected = parseMeetingParticipants(value).filter((name) => meetingExecutiveOptions.some((option) => option === name))

  function toggle(name: string) {
    const next = selected.includes(name) ? selected.filter((entry) => entry !== name) : [...selected, name]
    onChange(serializeMeetingParticipants(next))
  }

  return (
    <details ref={dropdownRef} className="group relative" onClick={(event) => event.stopPropagation()}>
      <summary
        id={id}
        aria-label="เลือกผู้เข้าร่วมประชุม (ผู้บริหาร)"
        aria-disabled={disabled}
        onClick={(event) => { if (disabled) event.preventDefault() }}
        className={`${compact ? 'min-h-9 rounded-md px-2 text-xs' : 'field-input'} flex cursor-pointer list-none items-center justify-between gap-2 ${disabled ? 'cursor-not-allowed bg-slate-100 text-slate-400' : 'bg-white text-slate-800'}`}
      >
        <span className="min-w-0 truncate">
          {selected.length ? `เลือกแล้ว ${selected.length} ท่าน` : 'เลือกผู้เข้าร่วมประชุม'}
        </span>
        <ChevronDown size={compact ? 13 : 16} className="shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      {!disabled && (
        <div className="absolute z-30 mt-1 max-h-64 w-full min-w-72 overflow-y-auto rounded-xl border border-purple-200 bg-white p-2 shadow-xl" role="group" aria-label="รายชื่อผู้บริหาร">
          {meetingExecutiveOptions.map((name) => (
            <label key={name} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-800 hover:bg-purple-50">
              <input type="checkbox" checked={selected.includes(name)} onChange={() => toggle(name)} className="h-4 w-4 shrink-0 accent-purple-700" />
              <span>{name}</span>
            </label>
          ))}
          <div className="sticky bottom-0 border-t border-purple-100 bg-white p-2">
            <button type="button" onClick={() => { if (dropdownRef.current) dropdownRef.current.open = false }} className="min-h-10 w-full rounded-lg bg-purple-700 px-3 text-sm font-semibold text-white hover:bg-purple-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700">
              เสร็จสิ้นการเลือก{selected.length ? ` (${selected.length})` : ''}
            </button>
          </div>
        </div>
      )}
    </details>
  )
}
