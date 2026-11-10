import type { DriveLinkDraft } from '../components/EventDialog'

// Only remove links the editor explicitly removed; a concurrent Calendar sync
// may have added another link since the form was opened.
export function planMeetingDocumentLinkChanges(links: DriveLinkDraft[], removedIds: string[] = []) {
  const deletedIds = new Set(removedIds)
  const updates: Array<{ id: string; display_name: string; url: string }> = []
  const inserts: Array<{ display_name: string; url: string }> = []
  for (const link of links) {
    const url = link.url.trim()
    if (!url) {
      if (link.id) deletedIds.add(link.id)
      continue
    }
    const display_name = link.displayName.trim() || 'ลิงก์เอกสาร / เว็บไซต์'
    if (!link.id) inserts.push({ display_name, url })
    else if (url !== link.originalUrl || display_name !== link.originalDisplayName) updates.push({ id: link.id, display_name, url })
  }
  return { deletedIds: [...deletedIds], updates, inserts }
}

export function requireUpdatedMeetingLink(rows: Array<{ id: string }> | null, error: unknown) {
  if (error) throw new Error('แก้ไขลิงก์เอกสารไม่สำเร็จ')
  if (!rows?.length) throw new Error('ลิงก์ถูกเปลี่ยนหรือลบระหว่างแก้ไข กรุณาเปิดรายการใหม่และตรวจสอบลิงก์')
}
