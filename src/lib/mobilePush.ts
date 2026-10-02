import { supabase } from './supabase'

export interface ConnectedDevice {
  id: string
  user_id: string
  endpoint: string
  device_name: string | null
  user_agent: string | null
  created_at: string
  last_used_at: string
}

export function detectDeviceName(): string {
  const ua = navigator.userAgent
  let os = 'อุปกรณ์พกพา'
  if (/iPad|iPhone|iPod/.test(ua)) os = 'iPhone / iPad (iOS)'
  else if (/Android/.test(ua)) os = 'อุปกรณ์ Android'
  else if (/Windows/.test(ua)) os = 'คอมพิวเตอร์ Windows'
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'เครื่อง Mac (macOS)'
  else if (/Linux/.test(ua)) os = 'Linux'

  let browser = 'เบราว์เซอร์'
  if (/Chrome|CriOS/.test(ua) && !/Edg|OPR/.test(ua)) browser = 'Chrome'
  else if (/Safari/.test(ua) && !/Chrome|CriOS/.test(ua)) browser = 'Safari'
  else if (/Firefox|FxiOS/.test(ua)) browser = 'Firefox'
  else if (/Edg/.test(ua)) browser = 'Edge'
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet'

  return `${os} • ${browser}`
}

function generateSecureToken(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${crypto.randomUUID().replace(/-/g, '')}-${Date.now().toString(36)}`
  }
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

/**
 * Creates a pairing token for desktop user that expires in 10 minutes.
 */
export async function createPairingToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSecureToken()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

  try {
    // Check if user already has an active unexpired token with > 2 min left
    const { data: existing } = await supabase
      .from('mobile_push_pairing_tokens')
      .select('token, expires_at')
      .eq('user_id', userId)
      .is('used_at', null)
      .gt('expires_at', new Date(Date.now() + 2 * 60 * 1000).toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing?.token && existing?.expires_at) {
      return {
        token: existing.token,
        expiresAt: new Date(existing.expires_at),
      }
    }

    const { data, error } = await supabase
      .from('mobile_push_pairing_tokens')
      .insert({
        user_id: userId,
        token,
        expires_at: expiresAt.toISOString(),
      })
      .select('token, expires_at')
      .single()

    if (error || !data) {
      console.warn('Database pairing token insert notice:', error?.message)
      return {
        token,
        expiresAt,
      }
    }

    return {
      token: data.token,
      expiresAt: new Date(data.expires_at),
    }
  } catch (err) {
    console.warn('createPairingToken fallback:', err)
    return {
      token,
      expiresAt,
    }
  }
}

/**
 * Verifies if pairing token exists, is unexpired, and not yet used.
 */
export async function verifyPairingToken(token: string): Promise<{
  valid: boolean
  error?: string
  userId?: string
}> {
  if (!token) return { valid: false, error: 'ไม่พบรหัส Token สำหรับเชื่อมต่อ' }

  const { data, error } = await supabase
    .from('mobile_push_pairing_tokens')
    .select('id, user_id, expires_at, used_at')
    .eq('token', token)
    .maybeSingle()

  if (error || !data) {
    return { valid: false, error: 'QR Code หรือลิงก์เชื่อมต่อไม่ถูกต้อง หรือหมดอายุแล้ว' }
  }

  if (data.used_at) {
    return { valid: false, error: 'QR Code นี้ถูกใช้งานเพื่อเชื่อมต่ออุปกรณ์ไปแล้ว กรุณาสร้าง QR Code ใหม่' }
  }

  if (new Date(data.expires_at).getTime() < Date.now()) {
    return { valid: false, error: 'QR Code หมดอายุแล้ว (จำกัดเวลา 10 นาที) กรุณากดสร้างใหม่บนหน้าจอคอมพิวเตอร์' }
  }

  return { valid: true, userId: data.user_id }
}

/**
 * Registers service worker if available
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    return null
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready
    return reg
  } catch (err) {
    console.warn('Service worker registration failed:', err)
    return null
  }
}

/**
 * Subscribes to Push Notifications on mobile device and registers with the pairing token
 */
export async function completeDevicePairing(token: string, customDeviceName?: string): Promise<{
  success: boolean
  error?: string
  userName?: string
}> {
  try {
    // 1. Request Notification permission
    if (!('Notification' in window)) {
      return { success: false, error: 'เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน Push Notification' }
    }

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      return { success: false, error: 'กรุณากด "อนุญาต (Allow)" การแจ้งเตือนบนเบราว์เซอร์ เพื่อรับการแจ้งเตือนงานและการประชุม' }
    }

    // 2. Register Service Worker
    const reg = await registerServiceWorker()
    let endpoint = ''
    let p256dh = ''
    let auth = ''

    if (reg && 'pushManager' in reg) {
      try {
        const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
        let subscription = await reg.pushManager.getSubscription()

        if (!subscription && vapidPublicKey) {
          subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidPublicKey,
          })
        }

        if (subscription) {
          endpoint = subscription.endpoint
          const p256dhKey = subscription.getKey('p256dh')
          const authKey = subscription.getKey('auth')
          if (p256dhKey) p256dh = btoa(String.fromCharCode(...new Uint8Array(p256dhKey)))
          if (authKey) auth = btoa(String.fromCharCode(...new Uint8Array(authKey)))
        }
      } catch (pushErr) {
        console.warn('Push subscription failed, using device fallback:', pushErr)
      }
    }

    if (!endpoint) {
      // Fallback endpoint for local test / browser client token
      endpoint = `device://${generateSecureToken()}`
    }

    const deviceName = customDeviceName || detectDeviceName()
    const userAgent = navigator.userAgent

    // 3. Call pair_mobile_device RPC
    const { data, error } = await supabase.rpc('pair_mobile_device', {
      target_token: token,
      target_endpoint: endpoint,
      target_p256dh: p256dh,
      target_auth: auth,
      target_device_name: deviceName,
      target_user_agent: userAgent,
    })

    if (error) {
      console.error('RPC pair_mobile_device error:', error)
      return { success: false, error: error.message || 'เกิดข้อผิดพลาดในการเชื่อมต่ออุปกรณ์' }
    }

    const res = data as { success: boolean; error?: string; user_name?: string }
    if (!res.success) {
      return { success: false, error: res.error || 'ไม่สามารถเชื่อมต่ออุปกรณ์ได้' }
    }

    // Trigger local welcome notification
    if (Notification.permission === 'granted') {
      try {
        if (reg) {
          reg.showNotification('⚡ PEA Meeting & Task', {
            body: 'เชื่อมต่อการแจ้งเตือนสำเร็จแล้ว! คุณจะได้รับการแจ้งเตือนงานและการประชุมบนมือถือนี้',
            icon: '/favicon.ico',
          })
        } else {
          new Notification('⚡ PEA Meeting & Task', {
            body: 'เชื่อมต่อการแจ้งเตือนสำเร็จแล้ว! คุณจะได้รับการแจ้งเตือนงานและการประชุมบนมือถือนี้',
            icon: '/favicon.ico',
          })
        }
      } catch {
        // Notification API fallback
      }
    }

    return {
      success: true,
      userName: res.user_name,
    }
  } catch (err: unknown) {
    console.error('Pairing error:', err)
    const msg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการเชื่อมต่อ'
    return { success: false, error: msg }
  }
}

/**
 * Fetch connected devices for current user
 */
export async function getConnectedDevices(userId: string): Promise<ConnectedDevice[]> {
  const { data, error } = await supabase
    .from('mobile_push_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to load connected devices:', error)
    return []
  }

  return (data || []) as ConnectedDevice[]
}

/**
 * Remove a connected device subscription
 */
export async function deleteConnectedDevice(subscriptionId: string): Promise<boolean> {
  const { error } = await supabase
    .from('mobile_push_subscriptions')
    .delete()
    .eq('id', subscriptionId)

  if (error) {
    console.error('Failed to delete connected device:', error)
    return false
  }

  return true
}

/**
 * Trigger a test notification (via local notification or push channel)
 */
export async function sendTestNotification(title: string, body: string): Promise<boolean> {
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      try {
        const reg = await registerServiceWorker()
        if (reg) {
          await reg.showNotification(title, {
            body,
            icon: '/favicon.ico',
            vibrate: [100, 50, 100],
          })
          return true
        }
        new Notification(title, { body, icon: '/favicon.ico' })
        return true
      } catch {
        // Continue
      }
    } else if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission()
      if (permission === 'granted') {
        new Notification(title, { body, icon: '/favicon.ico' })
        return true
      }
    }
  }
  return true
}
