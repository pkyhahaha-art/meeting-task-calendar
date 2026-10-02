import { useLanguage } from '../i18n/LanguageProvider'

const hours = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'))
const minutes = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0'))

export function TimeSelect({ id, value, onChange, optional = false, disabled = false }: {
  id: string
  value: string
  onChange: (value: string) => void
  optional?: boolean
  disabled?: boolean
}) {
  const { text } = useLanguage()
  const [hour = '', minute = ''] = (value || '').split(':')

  return <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
    <select id={id} className="field-input" value={hour} disabled={disabled} onChange={(event) => onChange(event.target.value ? `${event.target.value}:${minute || '00'}` : '')} aria-label={text('ชั่วโมง (ระบบ 24 ชั่วโมง)', 'Hour (24-hour clock)')}>
      {optional && <option value="">{text('ไม่ระบุ', 'Not set')}</option>}
      {hours.map((item) => <option key={item} value={item}>{item}</option>)}
    </select>
    <span aria-hidden="true">:</span>
    <select className="field-input" value={minute} disabled={disabled || !hour} onChange={(event) => onChange(`${hour}:${event.target.value}`)} aria-label={text('นาที', 'Minute')}>
      {optional && !hour && <option value="">--</option>}
      {minutes.map((item) => <option key={item} value={item}>{item}</option>)}
    </select>
  </div>
}
