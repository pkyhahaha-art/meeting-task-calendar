export type PushSubscriptionRecord = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }
export type PushMessage = { title: string; body: string; tag?: string; url: string }
export type VapidConfig = { publicKey: string; privateKey: string; subject: string }
export type PushRequest = { endpoint: string; method: string; headers: Record<string, string>; body: Uint8Array | null }

// Pairing tokens authorize a device registration, not arbitrary outbound URLs.
export function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint)
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && (
      url.hostname === 'web.push.apple.com' ||
      url.hostname === 'fcm.googleapis.com' ||
      url.hostname === 'updates.push.services.mozilla.com' ||
      url.hostname.endsWith('.notify.windows.com')
    )
  } catch { return false }
}

export async function deliverWebPush(
  subscription: PushSubscriptionRecord,
  message: PushMessage,
  config: VapidConfig,
  generateRequest: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, options: { TTL: number; urgency: string; vapidDetails: VapidConfig & { subject: string } }) => PushRequest,
  request: typeof fetch = fetch,
): Promise<{ sent: boolean; expired: boolean; status: number }> {
  if (!isPushEndpoint(subscription.endpoint)) return { sent: false, expired: true, status: 400 }
  if (!config.publicKey || !config.privateKey || !config.subject) throw new Error('Web Push sender is not configured')
  const details = generateRequest({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(message), {
    TTL: 3600, urgency: 'high', vapidDetails: config,
  })
  const response = await request(details.endpoint, {
    method: details.method,
    headers: details.headers,
    body: details.body ? new Uint8Array(details.body).buffer : null,
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  // Provider bodies can contain subscription details; do not return/log them.
  await response.body?.cancel()
  return { sent: response.ok, expired: response.status === 404 || response.status === 410, status: response.status }
}
