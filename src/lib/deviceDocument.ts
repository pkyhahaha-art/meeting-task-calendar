import type { DeviceNotificationContent } from './deviceInbox'

export function deviceDocumentRoute(notificationId: string, fileId: string, download = false) {
  return `/device-document?${new URLSearchParams({ notification: notificationId, file: fileId, mode: download ? 'download' : 'view' })}`
}

export function deviceDocumentUrl(content: DeviceNotificationContent, fileId: string, download = false) {
  const file = content.documents.find((item) => item.id === fileId)
  if (!file || file.error) throw new Error(file?.error || 'เอกสารนี้ถูกลบหรือเปลี่ยนแล้ว กรุณากลับไปเปิดข้อความใหม่')
  const value = download ? file.downloadUrl : file.previewUrl
  if (!value) throw new Error('ไม่พบลิงก์เอกสาร กรุณาโหลดใหม่')
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('ลิงก์เอกสารไม่ถูกต้อง')
  return url.href
}
