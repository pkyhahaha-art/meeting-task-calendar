export function AppFooter({ className = '' }: { className?: string }) {
  return (
    <footer className={`flex flex-col justify-center gap-0.5 border-t-[2.5px] border-black bg-[#FFFDF7] px-4 py-3 text-center text-[10px] leading-[18px] text-black font-semibold sm:text-[11px] ${className}`}>
      <p>© 2026 พัฒนาโดย <span className="font-bold text-black underline decoration-[#FFE15D] decoration-2">นายธนกฤชช์ อินสว่าง</span> · นักวิเคราะห์นโยบายและแผน ระดับ 5</p>
      <p>แผนกวางแผนและพัฒนาระบบการควบคุมภายใน <span className="whitespace-nowrap font-bold text-black">(ติดต่อ 9664)</span> | กองควบคุมภายใน | ฝ่ายกำกับดูแลและบริหารความเสี่ยง</p>
    </footer>
  )
}
