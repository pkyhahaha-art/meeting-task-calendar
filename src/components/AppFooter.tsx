export function AppFooter({ className = '' }: { className?: string }) {
  return (
    <footer className={`flex flex-col justify-center gap-0.5 border-t border-purple-100 bg-white/70 px-4 py-3 text-center text-[10px] leading-[18px] text-slate-500 sm:text-[11px] ${className}`}>
      <p>© 2026 พัฒนาโดย <span className="font-semibold text-brand-700">นายธนกฤชช์ อินสว่าง</span> · นักวิเคราะห์นโยบายและแผน ระดับ 5</p>
      <p>แผนกวางแผนและพัฒนาระบบการควบคุมภายใน <span className="whitespace-nowrap font-semibold text-brand-700">(ติดต่อ 9664)</span> | กองควบคุมภายใน | ฝ่ายกำกับดูแลและบริหารความเสี่ยง</p>
    </footer>
  )
}
