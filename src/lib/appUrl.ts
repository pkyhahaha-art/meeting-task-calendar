export function appUrl(path: string) {
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.href)
  const base = baseUrl.href.replace(/\/$/, '')
  const route = path.startsWith('/') ? path : `/${path}`
  return `${base}/#${route}`
}
