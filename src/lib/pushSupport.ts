export interface PushEnvironment {
  userAgent: string
  maxTouchPoints: number
  standalone: boolean
  secure: boolean
  notifications: boolean
  serviceWorker: boolean
  pushManager: boolean
}

// Android Chrome can send a Linux desktop UA when Desktop site is enabled.
// This detects that combination without claiming to know the hidden OS.
export function touchDesktopChrome(userAgent: string, maxTouchPoints: number): boolean {
  return maxTouchPoints > 0 && /Linux/.test(userAgent) && /Chrome/.test(userAgent)
    && !/Android|Edg|OPR/.test(userAgent)
}

export function pushSupport(environment: PushEnvironment): 'ready' | 'ios-install' | 'insecure' | 'unsupported' {
  if (!environment.secure) return 'insecure'
  const ios = /iPad|iPhone|iPod/.test(environment.userAgent)
    || (/Macintosh/.test(environment.userAgent) && environment.maxTouchPoints > 1)
  if (ios && !environment.standalone) return 'ios-install'
  if (!environment.notifications || !environment.serviceWorker || !environment.pushManager) return 'unsupported'
  return 'ready'
}

export function currentPushSupport() {
  return pushSupport({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: window.matchMedia('(display-mode: standalone)').matches
      || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    secure: window.isSecureContext,
    notifications: 'Notification' in window,
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
  })
}

export function tokenFromPairingLink(link: string): string | null {
  try {
    const url = new URL(link.trim())
    if (!['https:', 'http:'].includes(url.protocol) || !url.hash.startsWith('#/pair-device?')) return null
    const token = new URLSearchParams(url.hash.slice('#/pair-device?'.length)).get('token')
    return token && /^[a-zA-Z0-9_-]{16,160}$/.test(token) ? token : null
  } catch {
    return null
  }
}
