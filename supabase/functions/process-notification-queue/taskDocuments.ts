export function taskDocumentItems(
  attachments: Array<{ file_name: string; url?: string; file_size?: number }>,
  links: Array<{ display_name: string; url: string }>,
) {
  return [
    ...attachments.map((file) => ({ name: file.file_name, kind: 'file', ...(file.url ? { url: file.url } : {}), ...(file.file_size ? { size: file.file_size } : {}) })),
    ...links.map((link) => ({ name: link.display_name, url: link.url, kind: 'drive' })),
  ]
}
