import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CircleHelp, Sparkles, X } from 'lucide-react'
import mascot from '../../ภาพประกอบUI/Thumb Up Mascot 3D.png'
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
    {options && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#291333]/60 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <div className="relative w-full max-w-md overflow-hidden rounded-[28px] border-2 border-purple-200/80 bg-gradient-to-br from-white via-purple-50/90 to-amber-50/80 text-center shadow-[0_28px_80px_rgba(76,15,93,0.38)]">
        <div className={`h-2.5 w-full ${options.tone === 'danger' ? 'bg-gradient-to-r from-red-500 via-rose-500 to-amber-400' : 'bg-gradient-to-r from-brand-700 via-fuchsia-500 to-amber-400'}`} />
        <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-fuchsia-300/35 blur-2xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-16 -left-12 h-40 w-40 rounded-full bg-amber-200/35 blur-2xl" aria-hidden="true" />
        <div className="relative px-6 pb-6 pt-7 sm:px-7">
          <button type="button" className="absolute right-4 top-4 rounded-xl bg-white/70 p-2 text-slate-400 shadow-sm transition hover:bg-white hover:text-brand-700" onClick={() => close(false)} aria-label={text('ปิด', 'Close')}><X size={20} /></button>
          <div className={`mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[24px] border-2 text-white ring-8 ring-white/70 ${options.tone === 'danger' ? 'border-red-300 bg-gradient-to-br from-red-500 to-orange-400 shadow-lg shadow-red-200/70' : 'border-purple-300 bg-gradient-to-br from-brand-700 via-fuchsia-500 to-amber-400 shadow-lg shadow-purple-300/60'}`}>
            {options.tone === 'danger' ? <AlertTriangle size={31} /> : <CircleHelp size={31} />}
          </div>
          <Sparkles className="absolute left-[calc(50%+2.8rem)] top-7 text-amber-500 drop-shadow-sm" size={21} aria-hidden="true" />
          <h2 id="confirm-dialog-title" className="text-2xl font-extrabold text-brand-900">{options.title}</h2>
          <div className="mt-4 grid grid-cols-[5.5rem_minmax(0,1fr)] items-end gap-2 text-left">
            <img src={mascot} alt={text('มาสคอต PEA', 'PEA mascot')} className="h-24 w-24 max-w-none object-contain drop-shadow-[0_10px_8px_rgba(76,15,93,0.28)]" />
            <div className={`relative mb-2 rounded-[20px] border-2 px-4 py-3 shadow-sm ${options.tone === 'danger' ? 'border-red-200 bg-red-50/90' : 'border-purple-200 bg-white/90'}`}>
              <span className={`absolute -left-3 bottom-5 h-6 w-6 rotate-45 border-b-[3px] border-l-[3px] drop-shadow-[-2px_2px_2px_rgba(76,15,93,0.08)] ${options.tone === 'danger' ? 'border-red-200 bg-red-50' : 'border-purple-200 bg-white'}`} />
              <p className="relative z-10 text-sm font-semibold leading-6 text-slate-700">{options.message}</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-xl border-2 border-purple-200 bg-purple-50/80 px-4 py-2.5 font-semibold text-brand-800 shadow-sm transition hover:bg-purple-100" onClick={() => close(false)} autoFocus>{text('ยกเลิก', 'Cancel')}</button>
            <button type="button" className={`inline-flex min-h-11 items-center justify-center rounded-xl px-4 py-2.5 font-semibold text-white shadow-lg transition ${options.tone === 'danger' ? 'bg-gradient-to-r from-red-600 to-orange-500 shadow-red-200 hover:from-red-700 hover:to-orange-600' : 'bg-gradient-to-r from-brand-700 via-fuchsia-500 to-amber-500 shadow-purple-300/50 hover:from-brand-800 hover:via-fuchsia-600 hover:to-amber-600'}`} onClick={() => close(true)}>{options.confirmLabel ?? text('ยืนยัน', 'Confirm')}</button>
          </div>
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
