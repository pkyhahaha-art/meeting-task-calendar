export type MobilePushConfig = { ready: boolean; publicKey: string | null }

export function parseMobilePushConfig(value: unknown): MobilePushConfig {
  if (!value || typeof value !== 'object') throw new Error('ข้อมูลระบบแจ้งเตือนไม่ถูกต้อง')
  const { ready, publicKey } = value as Record<string, unknown>
  if (ready !== true) return { ready: false, publicKey: null }
  if (typeof publicKey !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(publicKey)) throw new Error('Key ของระบบแจ้งเตือนไม่ถูกต้อง')
  return { ready: true, publicKey }
}

export async function loadMobilePushConfig(supabaseUrl: string | undefined, request: typeof fetch = fetch): Promise<MobilePushConfig> {
  if (!supabaseUrl) throw new Error('ยังไม่ได้ตั้งค่าที่อยู่เซิร์ฟเวอร์')
  const response = await request(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/mobile-push`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error('ยังตรวจสอบระบบส่งแจ้งเตือนไม่ได้ กรุณากดตรวจสอบอีกครั้ง')
  return parseMobilePushConfig(await response.json())
}
