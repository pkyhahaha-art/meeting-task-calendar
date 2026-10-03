type DocumentRecord = { id?: string; name?: string; size?: number; mime_type?: string;
  kind?: string; bucket?: string; storage_path?: string; url?: string }
export type MobileDocument = { id: string; name: string; size?: number; kind: 'file' | 'drive';
  previewUrl?: string; downloadUrl?: string; error?: string }

function secureUrl(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url : null }
  catch { return null }
}

/** Private paths are signed only after the RPC has authorized this delivery/device. */
export async function mobileNotificationDocuments(input: unknown,
  sign: (bucket: string, path: string, download: false | string) => Promise<string>,
): Promise<MobileDocument[]> {
  if (!Array.isArray(input)) return []
  const files = input.filter((file) => file && typeof file === 'object' && !Array.isArray(file)) as DocumentRecord[]
  return await Promise.all(files.slice(0, 100).map(async (file) => {
    const result: MobileDocument = { id: String(file.id || ''), name: String(file.name || 'เอกสารแนบ'),
      kind: file.kind === 'drive' ? 'drive' : 'file', ...(file.size ? { size: file.size } : {}) }
    if (file.kind === 'drive') {
      const url = secureUrl(file.url || '')
      if (url && ['drive.google.com', 'docs.google.com'].includes(url.hostname)) result.previewUrl = url.href
      else result.error = 'ลิงก์เอกสารนี้ไม่รองรับ'
      return result
    }
    try {
      if (!['task-documents', 'meeting-documents'].includes(file.bucket || '') || !file.storage_path) throw new Error('Invalid document')
      const [preview, download] = await Promise.all([
        sign(file.bucket!, file.storage_path, false), sign(file.bucket!, file.storage_path, result.name),
      ])
      if (!secureUrl(preview) || !secureUrl(download)) throw new Error('Invalid link')
      result.previewUrl = preview
      // Some Storage SDK versions encode the filename twice. Set it once while
      // preserving the signed path/token, so Thai download names remain readable.
      const namedDownload = new URL(download)
      namedDownload.searchParams.set('download', result.name)
      result.downloadUrl = namedDownload.href
    } catch { result.error = 'เปิดเอกสารนี้ไม่ได้ กรุณาโหลดรายละเอียดใหม่หรือติดต่อผู้สร้าง' }
    return result
  }))
}
