export function internalTaskUrl(publicAppUrl: string, taskId: string) {
  const url = new URL(publicAppUrl)
  url.hash = `/calendar?task=${encodeURIComponent(taskId)}`
  return url.toString()
}
