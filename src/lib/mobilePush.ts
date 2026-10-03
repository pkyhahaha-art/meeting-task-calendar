import { supabase, supabaseUrl, supabasePublishableKey } from './supabase'
import { currentPushSupport } from './pushSupport'
import { activeNotificationWorker, showLocalTestNotification } from './notificationWorker'
import { readDevicePairing, saveDevicePairing, type DevicePairing } from './deviceInbox'
import { withNotificationTimeout } from './notificationWorker'

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
      console.error('Database pairing token insert error:', error)
      throw new Error(error?.message ? `ไม่สามารถสร้าง Token ในฐานข้อมูลได้ (${error.message})` : 'ไม่สามารถสร้าง Token ในฐานข้อมูลได้ กรุณาตรวจสอบตารางบน Supabase')
    }

    return {
      token: data.token,
      expiresAt: new Date(data.expires_at),
    }
  } catch (err) {
    console.error('createPairingToken error:', err)
    throw err
  }
}

/**
 * Verifies if pairing token exists, is unexpired, and not yet used.
 */
export async function verifyPairingToken(token: string): Promise<{
  valid: boolean
  error?: string
}> {
  if (!token) return { valid: false, error: 'ไม่พบรหัส Token สำหรับเชื่อมต่อ' }

  // The scanned token authorizes this lookup; the phone does not need a login
  // or direct access to the pairing-token table.
  const { data, error } = await supabase.rpc('verify_mobile_pairing_token', {
    target_token: token,
  })

  if (error) {
    console.error('verifyPairingToken database error:', error)
    return { valid: false, error: error.code === 'PGRST202'
      ? 'ระบบเชื่อมต่อมือถือยังไม่ได้อัปเดตฐานข้อมูล กรุณาให้ผู้ดูแลรัน SQL 202610020004_fix_mobile_pairing_access.sql แล้วสแกน QR Code ใหม่'
      : `ไม่สามารถตรวจสอบข้อมูล Token บนเซิร์ฟเวอร์ได้ (${error.message})` }
  }

  if (!data) {
    return { valid: false, error: 'QR Code หรือลิงก์เชื่อมต่อไม่ถูกต้อง หรือหมดอายุแล้ว' }
  }

  return data
}

/**
 * Registers service worker if available
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    return null
  }
  try {
    return await activeNotificationWorker()
  } catch (err) {
    console.warn('Service worker registration failed:', err)
    return null
  }
}

/**
 * Subscribes to Push Notifications on mobile device and registers with the pairing token
 */
export async function completeDevicePairing(token: string, customDeviceName?: string, vapidPublicKey?: string): Promise<{
  success: boolean
  error?: string
  userName?: string
}> {
  try {
    const support = currentPushSupport()
    if (support === 'ios-install') return { success: false, error: 'บน iPhone / iPad กรุณาเพิ่มเว็บไปยังหน้าจอโฮม แล้วเปิดจากไอคอน PEA Calendar เพื่อเปิดการแจ้งเตือน (iOS 16.4 ขึ้นไป)' }
    if (support === 'insecure') return { success: false, error: 'กรุณาเปิดเว็บไซต์ผ่าน HTTPS เพื่อเปิดการแจ้งเตือน' }
    if (support !== 'ready') return { success: false, error: 'กรุณาเปิดใน Chrome หรือแอปบนหน้าจอโฮมของ iPhone / iPad และตรวจสอบว่าอัปเดตระบบแล้ว' }
    if (!vapidPublicKey) return { success: false, error: 'ระบบยังไม่ได้ตั้งค่าการส่งแจ้งเตือนมือถือ กรุณาติดต่อผู้ดูแลระบบ' }

    // Keep the permission request directly inside the button interaction on iOS.
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      return { success: false, error: 'กรุณากด "อนุญาต (Allow)" การแจ้งเตือนบนเบราว์เซอร์ เพื่อรับการแจ้งเตือนงานและการประชุม' }
    }

    // 2. Register Service Worker
    const reg = await registerServiceWorker()
    if (!reg || !('pushManager' in reg)) return { success: false, error: 'ไม่สามารถเตรียมการแจ้งเตือนบนอุปกรณ์นี้ได้ กรุณาปิดแอปแล้วเปิดใหม่' }
    const subscription = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidPublicKey,
    })
    const p256dhKey = subscription.getKey('p256dh')
    const authKey = subscription.getKey('auth')
    if (!p256dhKey || !authKey) return { success: false, error: 'ไม่สามารถสมัครการแจ้งเตือนได้ กรุณาลองใหม่' }
    const endpoint = subscription.endpoint
    const p256dh = btoa(String.fromCharCode(...new Uint8Array(p256dhKey)))
    const auth = btoa(String.fromCharCode(...new Uint8Array(authKey)))

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

    const res = data as { success: boolean; error?: string; user_name?: string; subscription_id: string }
    if (!res.success) {
      return { success: false, error: res.error || 'ไม่สามารถเชื่อมต่ออุปกรณ์ได้' }
    }

    await saveDevicePairing({ subscriptionId: res.subscription_id, endpoint,
      userName: res.user_name || '', pairedAt: new Date().toISOString() }, true)

    // Trigger local welcome notification
    if (Notification.permission === 'granted') {
      try {
        await showLocalTestNotification(reg, '⚡ PEA Meeting & Task', 'เชื่อมต่ออุปกรณ์นี้สำเร็จแล้ว')
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

/** Restore a paired device using its existing Push secret, never a consumed QR. */
export async function restoreDevicePairing(): Promise<DevicePairing | null> {
  if (currentPushSupport() !== 'ready' || Notification.permission !== 'granted') return null
  const registration = await activeNotificationWorker()
  const subscription = await registration.pushManager.getSubscription()
  const authKey = subscription?.getKey('auth')
  if (!subscription || !authKey) return null
  const saved = await readDevicePairing()
  try {
    const { data, error } = await withNotificationTimeout(supabase.rpc('get_mobile_device_status', {
      target_endpoint: subscription.endpoint,
      target_auth: btoa(String.fromCharCode(...new Uint8Array(authKey))),
    }), 'ตรวจการเชื่อมต่อไม่สำเร็จ กรุณาลองใหม่')
    if (error) throw error
    const result = data as { paired: boolean; subscription_id?: string; user_name?: string; user_id?: string }
    if (!result.paired || !result.subscription_id) return null
    const pairing = { subscriptionId: result.subscription_id, endpoint: subscription.endpoint,
      userName: result.user_name || '', userId: result.user_id, pairedAt: saved?.pairedAt || new Date().toISOString() }
    await saveDevicePairing(pairing, Boolean(saved && (saved.subscriptionId !== pairing.subscriptionId || (saved.userId && saved.userId !== pairing.userId))))
    return pairing
  } catch (error) {
    // A network outage must not turn a remembered device into an unpaired one.
    if (saved?.endpoint === subscription.endpoint) return saved
    throw error
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
    .like('endpoint', 'https://%')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Failed to load connected devices:', error)
    return []
  }

  return (data || []) as ConnectedDevice[]
}

export async function checkMeetingMobileRecipients(emails: string[], eventId?: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('meeting_mobile_recipients_available', { target_guest_emails: emails, ...(eventId ? { target_event_id: eventId } : {}) })
  if (error) throw error
  return data === true
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

/** A provider acceptance confirms server submission, not that iOS displayed a banner. */
export async function sendDeviceTestNotification(subscriptionId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('mobile-push', { body: { subscriptionId } })
  if (error || !data?.accepted) {
    let message = data?.error || 'ส่งแจ้งเตือนจากเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองอีกครั้ง'
    if (error?.context instanceof Response) {
      const response = await error.context.json().catch(() => null)
      message = response?.error || message
    }
    throw new Error(message)
  }
}

/** The paired device can test only its own subscription, without a calendar login. */
export async function sendPairedDeviceTestNotification(): Promise<string> {
  if (currentPushSupport() !== 'ready' || Notification.permission !== 'granted') {
    throw new Error('กรุณาเปิดแอปจาก Home Screen และอนุญาตการแจ้งเตือนในการตั้งค่ามือถือ')
  }
  const registration = await activeNotificationWorker()
  const subscription = await registration.pushManager.getSubscription()
  const authKey = subscription?.getKey('auth')
  if (!subscription || !authKey) throw new Error('ไม่พบการเชื่อมต่อของเครื่องนี้ กรุณาเชื่อมต่ออุปกรณ์อีกครั้ง')
  const response = await fetch(`${supabaseUrl}/functions/v1/mobile-push`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: supabasePublishableKey || '' },
    body: JSON.stringify({ endpoint: subscription.endpoint, auth: btoa(String.fromCharCode(...new Uint8Array(authKey))) }),
    signal: AbortSignal.timeout(20000),
  })
  const result = await response.json()
  if (!response.ok || !result.accepted || !result.notificationId) throw new Error(result.error || 'ส่งข้อความทดสอบไม่ได้ กรุณาลองใหม่')
  return result.notificationId as string
}
