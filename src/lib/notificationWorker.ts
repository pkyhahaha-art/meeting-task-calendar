import { appUrl } from './appUrl'

export async function withNotificationTimeout<T>(operation: Promise<T>, message: string, timeoutMs = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function activeNotificationWorker(
  workers: Pick<ServiceWorkerContainer, 'register'> = navigator.serviceWorker,
  pageUrl = window.location.href,
): Promise<ServiceWorkerRegistration> {
  const workerUrl = new URL('sw.js', appUrl('/', pageUrl).split('#')[0])
  const registration = await withNotificationTimeout(
    workers.register(workerUrl.href, { scope: new URL('./', workerUrl).pathname }),
    'เตรียมระบบแจ้งเตือนนานเกินไป กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
  )
  if (registration.active?.state === 'activated') return registration

  let cleanup: (() => void) | undefined
  try {
    await withNotificationTimeout(new Promise<void>((resolve, reject) => {
      const worker = registration.installing || registration.waiting || registration.active
      if (!worker) { reject(new Error('ไม่พบระบบแจ้งเตือนที่พร้อมใช้งาน กรุณาปิดแอปแล้วเปิดใหม่')); return }
      const check = () => {
        if (worker.state === 'activated') {
          resolve()
        } else if (worker.state === 'redundant') {
          reject(new Error('ติดตั้งระบบแจ้งเตือนไม่สำเร็จ กรุณารีเฟรชหน้าแล้วลองใหม่'))
        }
      }
      cleanup = () => worker.removeEventListener('statechange', check)
      worker.addEventListener('statechange', check)
      check()
    }), 'ระบบแจ้งเตือนยังไม่พร้อม กรุณาปิดแอป PEA Calendar แล้วเปิดใหม่')
  } finally {
    cleanup?.()
  }
  return registration
}

export async function showLocalTestNotification(
  registration: ServiceWorkerRegistration,
  title: string,
  body: string,
): Promise<boolean> {
  const tag = `pea-test-${crypto.randomUUID()}`
  await withNotificationTimeout(registration.showNotification(title, {
    body,
    tag,
    icon: new URL('icon-192.png', registration.scope).href,
    data: { url: new URL('./#/mobile-push', registration.scope).href },
  }), 'อุปกรณ์ยังไม่ยืนยันการสร้างแจ้งเตือน กรุณาตรวจสิทธิ์แจ้งเตือนในการตั้งค่า iPhone')
  // This checks the notification list, not whether iOS displayed a banner.
  const notifications = await withNotificationTimeout(registration.getNotifications({ tag }),
    'ตรวจสอบผลแจ้งเตือนนานเกินไป กรุณาเปิดศูนย์การแจ้งเตือนบน iPhone')
  return notifications.length > 0
}
