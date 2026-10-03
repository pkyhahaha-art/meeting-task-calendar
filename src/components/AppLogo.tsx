export function AppLogo({ className = 'h-10 w-10' }: { className?: string }) {
  return <img src={`${import.meta.env.BASE_URL}brand/pea-meeting-task-logo-v1.png`} alt="โลโก้ PEA Meeting & Task Calendar" width={40} height={40} className={`shrink-0 rounded-xl object-contain shadow-sm shadow-purple-200 ${className}`} />
}
