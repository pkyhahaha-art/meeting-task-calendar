export function homePathForRole() {
  return '/calendar'
}

export function passwordRecoveryUrl(href: string): string | null {
  const url = new URL(href)
  if (/^#\/reset-password(?:[?#]|$)/.test(url.hash)) return href
  const fragment = url.hash.split('#').at(-1) ?? ''
  const params = new URLSearchParams(fragment.includes('?') ? fragment.split('?').slice(1).join('?') : fragment)
  url.searchParams.forEach((value, key) => params.set(key, value))
  if (params.get('type') !== 'recovery') return null
  // Supabase may return a token fragment without the HashRouter route.
  url.hash = `/reset-password${url.hash}`
  return url.href
}
