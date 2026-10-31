import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CircleHelp, X } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageProvider'

type ConfirmOptions = {
  title: string
  message: string
  confirmLabel?: string
  tone?: 'default' | 'danger'
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm | null>(null)

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const { text } = useLanguage()
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((confirmed: boolean) => void) | null>(null)

  const confirm = useCallback<Confirm>((nextOptions) => new Promise((resolve) => {
    resolver.current?.(false)
    resolver.current = resolve
    setOptions(nextOptions)
  }), [])

  const close = useCallback((confirmed: boolean) => {
    resolver.current?.(confirmed)
    resolver.current = null
    setOptions(null)
  }, [])

  useEffect(() => {
    if (!options) return
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(false) }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [close, options])

  return <ConfirmContext.Provider value={confirm}>
    {children}
    {options && <div className="ui-dialog-backdrop fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <div className="ui-dialog-panel ui-confirm-panel relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-left shadow-xl">
        <button type="button" className="absolute right-4 top-4 rounded-md p-2 text-slate-400 hover:bg-slate-50" onClick={() => close(false)} aria-label={text('ปิด', 'Close')}><X size={20} /></button>
        <div className={options.tone === 'danger' ? 'mb-4 text-red-600' : 'mb-4 text-brand-500'}>{options.tone === 'danger' ? <AlertTriangle size={28} aria-hidden="true" /> : <CircleHelp size={28} aria-hidden="true" />}</div>
        <h2 id="confirm-dialog-title" className="pr-8 text-xl font-semibold text-slate-800">{options.title}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">{options.message}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="btn-secondary" onClick={() => close(false)} autoFocus>{text('ยกเลิก', 'Cancel')}</button>
          <button type="button" className={options.tone === 'danger' ? 'btn-primary ui-danger bg-red-600 hover:bg-red-700' : 'btn-primary'} onClick={() => close(true)}>{options.confirmLabel ?? text('ยืนยัน', 'Confirm')}</button>
        </div>
      </div>
    </div>}
  </ConfirmContext.Provider>
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm must be used inside ConfirmDialogProvider')
  return confirm
}
