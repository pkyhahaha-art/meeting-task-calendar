import { AlertCircle, CheckCircle2 } from 'lucide-react'

export function FormMessage({ type, children }: { type: 'error' | 'success'; children: string }) {
  const success = type === 'success'
  return (
    <div className={`flex gap-2 rounded-xl border px-3 py-2.5 text-sm ${success ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`} role={success ? 'status' : 'alert'}>
      {success ? <CheckCircle2 className="mt-0.5 shrink-0" size={17} /> : <AlertCircle className="mt-0.5 shrink-0" size={17} />}
      <span>{children}</span>
    </div>
  )
}

