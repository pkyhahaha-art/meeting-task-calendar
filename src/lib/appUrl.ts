export function appUrl(path: string, pageUrl = window.location.href) {
  const url = new URL(pageUrl)
  // HashRouter routes are in the fragment; keep the deployment directory.
  const directory = url.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '')
  const base = `${url.origin}${directory}`
  const route = path.startsWith('/') ? path : `/${path}`
  return `${base}/#${route}`
}
