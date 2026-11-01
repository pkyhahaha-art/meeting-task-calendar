import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertCircle, Check, Loader2, UserCheck, X } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageProvider'
import type { AdminProfile } from '../lib/adminReports'
import { departmentsFor, memberOrganizationData, normalizeOrganizationUnit, unspecifiedDepartment, validOrganization } from '../lib/organization'
import { supabase } from '../lib/supabase'
import { OrganizationFields } from './OrganizationFields'

export function AdminEditMemberDialog({
  account,
  onClose,
  onSaved,
}: {
  account: AdminProfile
  onClose: () => void
  onSaved: () => Promise<void> | void
}) {
  const { text } = useLanguage()
  const [fullName, setFullName] = useState(account.full_name)
  const [employeeId, setEmployeeId] = useState(account.employee_id || '')
  const [unit, setUnit] = useState(normalizeOrganizationUnit(account.organization_unit))
  const [department, setDepartment] = useState(account.department || (departmentsFor(account.organization_unit).length ? unspecifiedDepartment : ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstInputRef.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, saving])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmedName = fullName.trim()
    if (!trimmedName || trimmedName.length < 2) {
      setError(text('กรุณากรอกชื่อ-นามสกุลอย่างน้อย 2 ตัวอักษร', 'Please enter a name of at least 2 characters.'))
      return
    }

    if (unit && !validOrganization(unit, department)) {
      setError(text('กรุณาระบุหน่วยงานและแผนกให้ถูกต้อง', 'Please select a valid organization unit and department.'))
      return
    }

    const { organization_unit: nextUnit, department: nextDept } = unit
      ? memberOrganizationData(unit, department)
      : { organization_unit: null, department: null }

    setSaving(true)
    setError('')

    try {
      const { error: rpcError } = await supabase.rpc('admin_update_member_profile' as never, {
        target_user_id: account.id,
        next_full_name: trimmedName,
        next_employee_id: employeeId.trim() || null,
        next_organization_unit: nextUnit,
        next_department: nextDept,
      } as never)

      if (rpcError) {
        throw rpcError
      }

      await onSaved()
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg || text('บันทึกข้อมูลไม่สำเร็จ กรุณาลองใหม่', 'Could not update profile. Please retry.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-edit-member-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
    >
      <div
        ref={dialogRef}
        className="relative w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-purple-100 overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-purple-100 bg-purple-50/70 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100 text-brand-700">
              <UserCheck size={20} />
            </div>
            <div>
              <h2 id="admin-edit-member-title" className="text-lg font-bold text-slate-900">
                {text('แก้ไขข้อมูลสมาชิก', 'Edit Member Profile')}
              </h2>
              <p className="text-xs text-slate-500">{account.email}</p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-600 transition"
            onClick={onClose}
            disabled={saving}
            aria-label={text('ปิด', 'Close')}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={(e) => void handleSubmit(e)} className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="field-label" htmlFor="edit-member-name">
              {text('ชื่อ - นามสกุล', 'Full Name')} <span className="text-red-600">*</span>
            </label>
            <input
              ref={firstInputRef}
              id="edit-member-name"
              type="text"
              required
              minLength={2}
              maxLength={120}
              className="field-input"
              value={fullName}
              disabled={saving}
              onChange={(e) => {
                setFullName(e.target.value)
                setError('')
              }}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="edit-member-empid">
              {text('รหัสพนักงาน', 'Employee ID')}
            </label>
            <input
              id="edit-member-empid"
              type="text"
              maxLength={20}
              className="field-input"
              value={employeeId}
              disabled={saving}
              placeholder={text('เช่น 509792 (เว้นว่างได้ถ้าไม่มี)', 'e.g. 509792 (optional)')}
              onChange={(e) => {
                setEmployeeId(e.target.value)
                setError('')
              }}
            />
          </div>

          <div className="space-y-1.5 pt-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {text('สังกัด / หน่วยงาน', 'Organization & Department')}
            </span>
            <OrganizationFields
              idPrefix="admin-edit-member"
              unit={unit}
              department={department}
              disabled={saving}
              onChange={(nextUnit, nextDept) => {
                setUnit(nextUnit)
                setDepartment(nextDept)
                setError('')
              }}
            />
            {unit && (
              <button
                type="button"
                className="text-xs text-brand-700 hover:underline mt-1"
                disabled={saving}
                onClick={() => {
                  setUnit('')
                  setDepartment('')
                }}
              >
                {text('ล้างสังกัด (ไม่ระบุ)', 'Clear affiliation')}
              </button>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              {text('ยกเลิก', 'Cancel')}
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={saving || !fullName.trim()}
            >
              {saving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {text('กำลังบันทึก…', 'Saving…')}
                </>
              ) : (
                <>
                  <Check size={16} />
                  {text('บันทึกข้อมูล', 'Save Changes')}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

