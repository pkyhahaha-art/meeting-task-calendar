const retryDelaysInMinutes = [5, 15, 30] as const

// `attempt` is one-based: the first failed send is attempt 1.
export function retryDelayMinutes(attempt: number): number | null {
  return retryDelaysInMinutes[attempt - 1] ?? null
}
