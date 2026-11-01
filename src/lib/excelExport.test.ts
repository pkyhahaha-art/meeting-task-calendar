import test from 'node:test'
import assert from 'node:assert/strict'
import { colLetter, escapeXml, buildSheetXml, createZipArchive, generateXlsxBlob } from './excelExport'

test('colLetter maps zero-based index to spreadsheet columns', () => {
  assert.equal(colLetter(0), 'A')
  assert.equal(colLetter(1), 'B')
  assert.equal(colLetter(25), 'Z')
  assert.equal(colLetter(26), 'AA')
  assert.equal(colLetter(27), 'AB')
  assert.equal(colLetter(51), 'AZ')
  assert.equal(colLetter(52), 'BA')
})

test('escapeXml escapes dangerous characters and strips invalid control chars', () => {
  assert.equal(escapeXml('A & B < C > "quoted" \'single\''), 'A &amp; B &lt; C &gt; &quot;quoted&quot; &apos;single&apos;')
  assert.equal(escapeXml('Valid\tTab\nNewline\rReturn'), 'Valid\tTab\nNewline\rReturn')
  assert.equal(escapeXml('Invalid\x00Null\x07Bell'), 'InvalidNullBell')
  assert.equal(escapeXml(null), '')
  assert.equal(escapeXml(undefined), '')
  assert.equal(escapeXml(123), '123')
})

test('buildSheetXml generates valid spreadsheetml rows and cells', () => {
  const xml = buildSheetXml(['ประเภท', 'หัวข้อ', 'จำนวน'], [['Task', 'ทดสอบ & งาน', 42]])
  assert.ok(xml.includes('<row r="1">'))
  assert.ok(xml.includes('<c r="A1" t="inlineStr"><is><t>ประเภท</t></is></c>'))
  assert.ok(xml.includes('<c r="B1" t="inlineStr"><is><t>หัวข้อ</t></is></c>'))
  assert.ok(xml.includes('<c r="C1" t="inlineStr"><is><t>จำนวน</t></is></c>'))
  assert.ok(xml.includes('<row r="2">'))
  assert.ok(xml.includes('<c r="A2" t="inlineStr"><is><t>Task</t></is></c>'))
  assert.ok(xml.includes('<c r="B2" t="inlineStr"><is><t>ทดสอบ &amp; งาน</t></is></c>'))
  assert.ok(xml.includes('<c r="C2"><v>42</v></c>'))
})

test('generateXlsxBlob builds a valid zip archive of openxml files', async () => {
  const blob = generateXlsxBlob(['ชื่อ', 'รหัส'], [['สมชาย', '509792']], 'PEA Sheet')
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  const arrayBuffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)

  // Standard zip file starts with 0x04034b50 (PK\x03\x04)
  assert.equal(bytes[0], 0x50)
  assert.equal(bytes[1], 0x4b)
  assert.equal(bytes[2], 0x03)
  assert.equal(bytes[3], 0x04)
  assert.ok(bytes.length > 1000)
})
