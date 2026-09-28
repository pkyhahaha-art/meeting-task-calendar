export function acknowledgementUrl(pageUrl: string) {
  const url = new URL(pageUrl)
  const [route, query = ''] = url.hash.slice(1).split('?')
  const params = new URLSearchParams(query)
  params.set('ack', '1')
  url.hash = `${route}?${params.toString()}`
  return url.toString()
}
