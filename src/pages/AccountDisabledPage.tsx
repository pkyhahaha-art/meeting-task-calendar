import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useLanguage } from '../i18n/LanguageProvider'

export function AccountDisabledPage() {
  const { signOut } = useAuth()
  const { text } = useLanguage()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const logout = async () => {
    if (busy) return
    setBusy(true); setError('')
    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch {
      setError(text('ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง', 'Unable to sign out. Please try again.'))
    } finally { setBusy(false) }
  }
  return <main className="flex min-h-screen items-center justify-center p-6 text-center"><div className="w-full max-w-md space-y-4">
    <h1 className="text-2xl font-bold">{text('บัญชีถูกระงับ', 'Account disabled')}</h1>
    <p className="text-slate-600">{text('กรุณาติดต่อผู้ดูแลระบบ', 'Please contact an administrator.')}</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <button type="button" className="btn-secondary w-full" disabled={busy} onClick={() => void logout()}>{busy ? text('กำลังออกจากระบบ…', 'Signing out…') : text('ออกจากระบบ', 'Sign out')}</button>
  </div></main>
}
