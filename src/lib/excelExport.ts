// Pure TypeScript browser-compatible XLSX generator without external dependencies.
// Creates valid OpenXML .xlsx files with STORE compression (method 0).

const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  CRC_TABLE[i] = c
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0 ^ (-1)
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff]
  }
  return (crc ^ (-1)) >>> 0
}

export function colLetter(index: number): string {
  let temp = index
  let letter = ''
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter
    temp = Math.floor(temp / 26) - 1
  }
  return letter
}

export function escapeXml(value: unknown): string {
  if (value == null) return ''
  const str = String(value)
  return str
    .replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function buildSheetXml(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '  <sheetData>',
  ]

  let rowNum = 1
  if (headers.length) {
    const cells = headers.map((header, colIdx) => {
      const ref = `${colLetter(colIdx)}${rowNum}`
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(header)}</t></is></c>`
    }).join('')
    lines.push(`    <row r="${rowNum}">${cells}</row>`)
    rowNum++
  }

  for (const row of rows) {
    const cells = row.map((cell, colIdx) => {
      const ref = `${colLetter(colIdx)}${rowNum}`
      if (cell == null) return ''
      if (typeof cell === 'number' && Number.isFinite(cell)) {
        return `<c r="${ref}"><v>${cell}</v></c>`
      }
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`
    }).filter(Boolean).join('')
    lines.push(`    <row r="${rowNum}">${cells}</row>`)
    rowNum++
  }

  lines.push('  </sheetData>', '</worksheet>')
  return lines.join('\n')
}

export type ZipEntry = { name: string; content: Uint8Array }

export function createZipArchive(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const centralDirs: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const dataBytes = entry.content
    const crc = crc32(dataBytes)
    const size = dataBytes.length

    // Local file header: 30 bytes + name.length
    const local = new Uint8Array(30 + nameBytes.length)
    const view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true) // signature
    view.setUint16(4, 20, true)         // version needed
    view.setUint16(6, 0x0800, true)     // utf-8 flag
    view.setUint16(8, 0, true)          // compression 0 (store)
    view.setUint16(10, 0, true)         // mod time
    view.setUint16(12, 0, true)         // mod date
    view.setUint32(14, crc, true)       // crc32
    view.setUint32(18, size, true)      // compressed size
    view.setUint32(22, size, true)      // uncompressed size
    view.setUint16(26, nameBytes.length, true)
    view.setUint16(28, 0, true)         // extra field length
    local.set(nameBytes, 30)

    parts.push(local, dataBytes)

    // Central directory header: 46 bytes + name.length
    const central = new Uint8Array(46 + nameBytes.length)
    const cView = new DataView(central.buffer)
    cView.setUint32(0, 0x02014b50, true) // signature
    cView.setUint16(4, 20, true)         // version made by
    cView.setUint16(6, 20, true)         // version needed
    cView.setUint16(8, 0x0800, true)     // utf-8 flag
    cView.setUint16(10, 0, true)         // compression 0
    cView.setUint16(12, 0, true)         // mod time
    cView.setUint16(14, 0, true)         // mod date
    cView.setUint32(16, crc, true)       // crc32
    cView.setUint32(20, size, true)      // compressed size
    cView.setUint32(24, size, true)      // uncompressed size
    cView.setUint16(28, nameBytes.length, true)
    cView.setUint16(30, 0, true)         // extra length
    cView.setUint16(32, 0, true)         // comment length
    cView.setUint16(34, 0, true)         // disk number
    cView.setUint16(36, 0, true)         // internal attrs
    cView.setUint32(38, 0, true)         // external attrs
    cView.setUint32(42, offset, true)    // relative offset
    central.set(nameBytes, 46)

    centralDirs.push(central)
    offset += local.length + dataBytes.length
  }

  const centralDirSize = centralDirs.reduce((acc, cur) => acc + cur.length, 0)
  const eocd = new Uint8Array(22)
  const eView = new DataView(eocd.buffer)
  eView.setUint32(0, 0x06054b50, true) // signature
  eView.setUint16(4, 0, true)          // disk number
  eView.setUint16(6, 0, true)          // central dir start disk
  eView.setUint16(8, entries.length, true)  // entries on disk
  eView.setUint16(10, entries.length, true) // total entries
  eView.setUint32(12, centralDirSize, true) // size of central dir
  eView.setUint32(16, offset, true)         // offset of central dir
  eView.setUint16(20, 0, true)              // comment length

  // Combine everything into a single Uint8Array
  const totalLength = offset + centralDirSize + 22
  const result = new Uint8Array(totalLength)
  let pos = 0
  for (const part of parts) {
    result.set(part, pos)
    pos += part.length
  }
  for (const c of centralDirs) {
    result.set(c, pos)
    pos += c.length
  }
  result.set(eocd, pos)
  return result
}

export function generateXlsxBlob(headers: string[], rows: (string | number | null | undefined)[][], sheetName = 'CalendarItems'): Blob {
  const encoder = new TextEncoder()
  const cleanSheetName = escapeXml(sheetName.slice(0, 31).replace(/[\\/?*[\]]/g, '')) || 'Sheet1'

  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
    '  <Default Extension="xml" ContentType="application/xml"/>\n' +
    '  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n' +
    '  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n' +
    '</Types>'

  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n' +
    '</Relationships>'

  const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>\n' +
    '</Relationships>'

  const workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n' +
    '  <sheets>\n' +
    `    <sheet name="${cleanSheetName}" sheetId="1" r:id="rId1"/>\n` +
    '  </sheets>\n' +
    '</workbook>'

  const sheetXml = buildSheetXml(headers, rows)

  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', content: encoder.encode(contentTypes) },
    { name: '_rels/.rels', content: encoder.encode(rootRels) },
    { name: 'xl/_rels/workbook.xml.rels', content: encoder.encode(workbookRels) },
    { name: 'xl/workbook.xml', content: encoder.encode(workbookXml) },
    { name: 'xl/worksheets/sheet1.xml', content: encoder.encode(sheetXml) },
  ]

  const zipBytes = createZipArchive(entries)
  return new Blob([zipBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function downloadXlsx(filename: string, headers: string[], rows: (string | number | null | undefined)[][], sheetName = 'CalendarItems') {
  const cleanFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  const blob = generateXlsxBlob(headers, rows, sheetName)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = cleanFilename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

