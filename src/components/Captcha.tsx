import { useEffect, useRef } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string
      remove: (widgetId: string) => void
    }
  }
}

const scriptId = 'cloudflare-turnstile'

export function Captcha({ onToken }: { onToken: (token: string | null) => void }) {
  const container = useRef<HTMLDivElement>(null)
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim()
  useEffect(() => {
    if (!siteKey || !container.current) return
    let widgetId: string | undefined
    const render = () => {
      if (!container.current || !window.turnstile || widgetId) return
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        callback: (token: string) => onToken(token),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      })
    }
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null
    if (existing) { existing.addEventListener('load', render); render() }
    else {
      const script = document.createElement('script')
      script.id = scriptId; script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true
      script.addEventListener('load', render); document.head.appendChild(script)
    }
    return () => {
      if (existing) existing.removeEventListener('load', render)
      if (widgetId) window.turnstile?.remove(widgetId)
    }
  }, [onToken, siteKey])
  if (!siteKey) return null
  return <div ref={container} className="flex justify-center" />
}
