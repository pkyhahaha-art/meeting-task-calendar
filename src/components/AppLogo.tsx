export function AppLogo({ className = 'h-12 w-12' }: { className?: string }) {
  return <img src={`${import.meta.env.BASE_URL}brand/pea-meeting-task-logo-v2.png`} alt="โลโก้ PEA Meeting & Task Calendar" width={1254} height={1254} className={`shrink-0 object-contain ${className}`} />
}
