import { departmentsFor, organizationUnits } from '../lib/organization'

export function OrganizationFields({ idPrefix, unit, department, onChange, disabled = false, unitError, departmentError }: {
  idPrefix: string; unit: string; department: string; onChange: (unit: string, department: string) => void;
  disabled?: boolean; unitError?: string; departmentError?: string;
}) {
  const options = departmentsFor(unit)
  return <div className="grid gap-3 sm:grid-cols-2">
    <div>
      <label className="field-label" htmlFor={`${idPrefix}-unit`}>หน่วยงาน *</label>
      <select id={`${idPrefix}-unit`} className="field-input" value={unit} disabled={disabled}
        aria-invalid={Boolean(unitError)} onChange={(event) => onChange(event.target.value, '')}>
        <option value="" disabled>เลือกหน่วยงาน</option>
        {organizationUnits.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      {unitError && <p className="form-error">{unitError}</p>}
    </div>
    <div>
      <label className="field-label" htmlFor={`${idPrefix}-department`}>แผนก{options.length ? ' *' : ''}</label>
      <select id={`${idPrefix}-department`} className="field-input disabled:bg-slate-50 disabled:text-slate-400" value={department}
        disabled={disabled || !options.length} aria-invalid={Boolean(departmentError)} onChange={(event) => onChange(unit, event.target.value)}>
        <option value="" disabled>{!unit ? 'เลือกหน่วยงานก่อน' : options.length ? 'เลือกแผนก' : 'หน่วยงานนี้ไม่มีแผนก'}</option>
        {options.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      {departmentError && <p className="form-error">{departmentError}</p>}
    </div>
  </div>
}
