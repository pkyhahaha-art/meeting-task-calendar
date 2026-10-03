import { isPushEndpoint, type PushSubscriptionRecord } from './webPushDelivery.ts'

export type TestDeviceLookup = { id: string } | { endpoint: string; auth: string }

/** A login proves account ownership; an existing Push secret proves this device only. */
export async function mobileTestTarget(
  body: unknown,
  userId: string | null,
  lookup: (target: TestDeviceLookup) => Promise<PushSubscriptionRecord | null>,
): Promise<PushSubscriptionRecord | null> {
  if (!body || typeof body !== 'object') return null
  const input = body as Record<string, unknown>
  if (typeof input.subscriptionId === 'string') {
    if (!userId || !/^[0-9a-f-]{36}$/i.test(input.subscriptionId)) return null
    const device = await lookup({ id: input.subscriptionId })
    return device?.user_id === userId ? device : null
  }
  if (typeof input.endpoint !== 'string' || typeof input.auth !== 'string' ||
      !isPushEndpoint(input.endpoint) || input.endpoint.length > 4096 ||
      input.auth.length < 20 || input.auth.length > 128) return null
  const device = await lookup({ endpoint: input.endpoint, auth: input.auth })
  return device?.endpoint === input.endpoint && device.auth === input.auth ? device : null
}
