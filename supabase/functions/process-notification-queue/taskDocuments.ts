export function taskDocumentItems(
  attachments: Array<{ file_name: string }>,
  links: Array<{ display_name: string; url: string }>,
) {
  return [
    ...attachments.map((file) => ({ name: file.file_name, kind: 'file' })),
    ...links.map((link) => ({ name: link.display_name, url: link.url, kind: 'drive' })),
  ]
}
