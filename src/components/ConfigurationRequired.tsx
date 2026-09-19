import { Settings } from 'lucide-react'

export function ConfigurationRequired() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <section className="card max-w-lg p-7 text-center">
        <Settings className="mx-auto mb-4 text-brand-600" size={38} />
        <h1 className="text-xl font-bold">ต้องเชื่อมต่อ Supabase ก่อน</h1>
        <p className="mt-3 leading-7 text-slate-600">คัดลอก <code>.env.example</code> เป็น <code>.env.local</code> แล้วใส่ Project URL และ client-safe publishable/anon key จาก Supabase</p>
      </section>
    </main>
  )
}

