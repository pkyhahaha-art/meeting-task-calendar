export function externalTaskUrl(publicAppUrl: string, token: string) {
  const url = new URL(publicAppUrl)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('PUBLIC_APP_URL must be HTTPS outside local development')
  }
  url.searchParams.set('token', token)
  url.hash = '/external-task'
  return url.toString()
}
