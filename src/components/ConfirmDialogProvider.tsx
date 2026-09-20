import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CircleHelp, X } from 'lucide-react'

type ConfirmOptions = {
  title: string
  message: string
  confirmLabel?: string
  tone?: 'default' | 'danger'
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm | null>(null)

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
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
    {options && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-2xl">
        <button type="button" className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => close(false)} aria-label="ปิด"><X size={20} /></button>
        <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${options.tone === 'danger' ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-600'}`}>
          {options.tone === 'danger' ? <AlertTriangle size={30} /> : <CircleHelp size={30} />}
        </div>
        <h2 id="confirm-dialog-title" className="text-xl font-bold text-slate-900">{options.title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{options.message}</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button type="button" className="btn-secondary justify-center" onClick={() => close(false)} autoFocus>ยกเลิก</button>
          <button type="button" className={`justify-center ${options.tone === 'danger' ? 'btn-secondary border-red-200 bg-red-600 text-white hover:bg-red-700' : 'btn-primary'}`} onClick={() => close(true)}>{options.confirmLabel ?? 'ยืนยัน'}</button>
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
