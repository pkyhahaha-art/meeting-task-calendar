import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useLanguage } from '../i18n/LanguageProvider'
import { validOrganization } from '../lib/organization'
import { supabase } from '../lib/supabase'
import { OrganizationFields } from './OrganizationFields'

export function ProfileOrganizationForm() {
  const { profile, refreshProfile, profileLoading } = useAuth()
  const { text } = useLanguage()
  const [unit, setUnit] = useState('')
  const [department, setDepartment] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setUnit(profile?.organization_unit || '')
    setDepartment(profile?.department || '')
  }, [profile?.id, profile?.organization_unit, profile?.department])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!profile || !validOrganization(unit, department) || saving) return
    setSaving(true); setMessage(''); setFailed(false)
    try {
      const { data, error } = await supabase.from('profiles').update({ organization_unit: unit, department: department || null })
        .eq('id', profile.id).select('id').single()
      if (error || !data) throw error || new Error('No profile updated')
      await refreshProfile()
      setMessage(text('บันทึกสังกัดแล้ว ใช้เติมใน Task / Meeting ใหม่อัตโนมัติ', 'Saved. New Tasks and Meetings will use this affiliation.'))
    } catch {
      setFailed(true)
      setMessage(text('บันทึกสังกัดไม่ได้ กรุณาลองใหม่', 'Could not save your organization. Please try again.'))
    } finally { setSaving(false) }
  }
  return <form className="mt-5 space-y-3 border-t border-slate-100 pt-4" onSubmit={(event) => void save(event)}>
    <p className="text-sm text-slate-500">{text('สังกัดของคุณใช้เติมในงานและประชุมใหม่ สมาชิกเดิมเลือกข้อมูลส่วนนี้ได้โดยไม่ต้องสมัครใหม่', 'Your affiliation is filled into new Tasks and Meetings. Existing members can set it here. No new account is needed.')}</p>
    <OrganizationFields idPrefix="profile" unit={unit} department={department} disabled={saving || profileLoading || !profile}
      onChange={(value, selectedDepartment) => { setUnit(value); setDepartment(selectedDepartment); setMessage('') }} />
    <button type="submit" className="btn-secondary" disabled={saving || profileLoading || !profile || !validOrganization(unit, department)}>{saving ? text('กำลังบันทึก…', 'Saving…') : text('บันทึกสังกัด', 'Save affiliation')}</button>
    {message && <p role={failed ? 'alert' : 'status'} className={`text-sm ${failed ? 'text-red-700' : 'text-green-700'}`}>{message}</p>}
  </form>
}
