import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { DeviceNotificationDetails } from '../components/DeviceNotificationDetails'
import { mobileNotificationDocuments } from '../../supabase/functions/_shared/mobileNotificationDocuments'
import { deviceDocumentRoute, deviceDocumentUrl } from './deviceDocument'

test('Task and Meeting attachments get separate private preview and named download links', async () => {
  const calls: Array<[string, string, false | string]> = []
  const documents = await mobileNotificationDocuments([
    { id: 'task-file', name: 'คำสั่งงาน.pdf', size: 1000, bucket: 'task-documents', storage_path: 'creator/task/report.pdf' },
    { id: 'meeting-file', name: 'วาระประชุม.docx', bucket: 'meeting-documents', storage_path: 'creator/meeting/agenda.docx' },
  ], async (bucket, path, download) => {
    calls.push([bucket, path, download])
    return `https://storage.example/${bucket}/${path}?token=temporary${download ? `&download=${encodeURIComponent(download)}` : ''}`
  })
  assert.equal(calls.length, 4)
  assert.ok(calls.some(([bucket, , download]) => bucket === 'task-documents' && download === false))
  assert.ok(calls.some(([bucket, , download]) => bucket === 'meeting-documents' && download === 'วาระประชุม.docx'))
  assert.ok(documents.every((doc) => doc.previewUrl && doc.downloadUrl && doc.previewUrl !== doc.downloadUrl))
  assert.equal(new URL(documents[0].downloadUrl!).searchParams.get('download'), 'คำสั่งงาน.pdf')
  assert.doesNotMatch(JSON.stringify(documents), /storage_path|"bucket"/)
})

test('a double-encoded Storage filename is normalized without changing the signature', async () => {
  const [file] = await mobileNotificationDocuments([{ id: 'thai', name: 'วาระประชุม.pdf', bucket: 'meeting-documents', storage_path: 'meeting/file' }],
    async (_bucket, _path, download) => `https://storage.example/signed?token=keep-signature${download ? `&download=${encodeURIComponent(encodeURIComponent(download))}` : ''}`)
  const url = new URL(file.downloadUrl!)
  assert.equal(url.searchParams.get('download'), 'วาระประชุม.pdf')
  assert.equal(url.searchParams.get('token'), 'keep-signature')
})

test('invalid links or an unavailable attachment do not hide the other documents', async () => {
  const documents = await mobileNotificationDocuments([
    null, { id: 'bad', name: 'Missing', bucket: 'task-documents', storage_path: 'missing' },
    { id: 'unknown', name: 'Unknown', bucket: 'private-secrets', storage_path: 'secret' },
    { id: 'drive', name: 'Drive', kind: 'drive', url: 'https://docs.google.com/document/d/test' },
    { id: 'unsafe', name: 'Unsafe', kind: 'drive', url: 'javascript:alert(1)' },
    { id: 'other', name: 'Other host', kind: 'drive', url: 'https://evil.example/file' },
  ], async (bucket) => { assert.equal(bucket, 'task-documents'); throw new Error('Missing object') })
  assert.equal(documents.length, 5)
  assert.equal(documents.find((doc) => doc.id === 'drive')?.previewUrl, 'https://docs.google.com/document/d/test')
  assert.equal(documents.filter((doc) => doc.error).length, 4)
  assert.ok(documents.filter((doc) => doc.error).every((doc) => !doc.previewUrl && !doc.downloadUrl))
})

test('opening Task details shows department, due time and both document actions', () => {
  const html = renderToStaticMarkup(<DeviceNotificationDetails onlineDetails canLoad
    alert={{ id: 'task', title: 'คุณได้สร้าง Task แล้ว', body: 'Summary', receivedAt: '2026-10-03T07:00:00Z', read: true }}
    details={{ entity: 'task', title: 'แผนปฏิบัติ', affiliation: 'กคน.ฝลส.', description: 'คำสั่งงานฉบับเต็ม', due_date: '2026-10-06', due_time: '09:00:00' }}
    documents={[{ id: 'file', name: 'รายงาน.pdf', kind: 'file', previewUrl: 'https://storage.example/view', downloadUrl: 'https://storage.example/download' }]} />)
  for (const text of ['ชื่องาน', 'แผนปฏิบัติ', 'หน่วยงาน / สังกัด', 'กคน.ฝลส.', 'ครบกำหนดงาน', '09:00', 'คำสั่งงานฉบับเต็ม', 'เปิดดูเอกสาร', 'ดาวน์โหลด']) assert.ok(html.includes(text), text)
  assert.ok(html.includes('href="#/device-document?notification=task&amp;file=file&amp;mode=view"'))
  assert.ok(html.includes('href="#/device-document?notification=task&amp;file=file&amp;mode=download"'))
  assert.doesNotMatch(html, /target="_blank"/)
})

test('each document action resolves a freshly loaded URL and refuses a removed or unavailable file', () => {
  const content = { details: { entity: 'task' }, documents: [{ id: 'file', name: 'PDF', kind: 'file' as const,
    previewUrl: 'https://storage.example/new-token', downloadUrl: 'https://storage.example/new-download' }], linksExpireAt: '' }
  assert.equal(deviceDocumentUrl(content, 'file'), 'https://storage.example/new-token')
  assert.equal(deviceDocumentUrl(content, 'file', true), 'https://storage.example/new-download')
  assert.match(deviceDocumentRoute('id&another=1', 'file#part'), /notification=id%26another%3D1&file=file%23part/)
  assert.throws(() => deviceDocumentUrl(content, 'deleted'))
  assert.throws(() => deviceDocumentUrl({ ...content, documents: [{ ...content.documents[0], error: 'Removed' }] }, 'file'), /Removed/)
  assert.throws(() => deviceDocumentUrl({ ...content, documents: [{ ...content.documents[0], previewUrl: 'javascript:alert(1)' }] }, 'file'))
})

test('Meeting details show start/end, department and offline messages retain their snapshot', () => {
  const alert = { id: 'meeting', title: 'คุณได้สร้าง Meeting แล้ว', body: 'Summary', receivedAt: '2026-10-03T07:00:00Z', read: true,
    details: { entity: 'meeting', title: 'ประชุมแผนงาน', affiliation: 'ฝ่ายแผนงาน', description: 'วาระประชุม', start_datetime: '2026-10-06T02:00:00Z', end_datetime: '2026-10-06T03:00:00Z', location: 'ห้อง 7' } }
  const html = renderToStaticMarkup(<DeviceNotificationDetails alert={alert} canLoad error="ไม่มีอินเทอร์เน็ต" />)
  for (const text of ['ชื่อการประชุม', 'ประชุมแผนงาน', 'ฝ่ายแผนงาน', 'เริ่มประชุม', 'สิ้นสุดประชุม', '09:00', '10:00', 'ห้อง 7', 'ไม่มีอินเทอร์เน็ต', 'โหลดใหม่']) assert.ok(html.includes(text), text)
})

test('appointment action details retain the concise historical heading and show full details and document actions', () => {
  for (const template of ['meeting_occurrence_cancelled', 'meeting_occurrence_moved']) {
    const title = template.endsWith('moved') ? 'ย้ายประชุม «แผนงาน» จากวันที่ 3 ต.ค. เป็นวันที่ 2 ต.ค. เวลา 09:00 น.'
      : 'ยกเลิกประชุม «แผนงาน» วันที่ 3 ต.ค. เวลา 09:00 น.'
    const html = renderToStaticMarkup(<DeviceNotificationDetails canLoad onlineDetails
      alert={{ id: 'action', title, body: title, receivedAt: '2026-10-04T02:00:00Z', read: true, details: { entity: 'meeting', notice_template: template } }}
      details={{ entity: 'meeting', title: 'Renamed Meeting', description: 'PRIVATE AGENDA', affiliation: 'ฝ่ายแผนงาน',
        location: 'ห้อง 7', start_datetime: '2026-11-01T00:00:00Z', end_datetime: '2026-11-01T01:00:00Z' }}
      documents={[{ id: 'file', name: 'PRIVATE DOCUMENT', kind: 'file', previewUrl: 'https://storage.test/private', downloadUrl: 'https://storage.test/download' }]} />)
    assert.ok(html.includes(title))
    assert.equal(html.split(title).length, 2)
    for (const text of ['PRIVATE AGENDA', 'PRIVATE DOCUMENT', 'Renamed Meeting', 'ฝ่ายแผนงาน', 'ห้อง 7', 'เริ่มประชุม', 'สิ้นสุดประชุม', 'เอกสารแนบ', 'เปิดดูเอกสาร', 'ดาวน์โหลด']) assert.ok(html.includes(text), text)
    assert.doesNotMatch(html, /storage\.test|แบบไม่ทำซ้ำ|ยังคงเดิม/)
    assert.match(html, /รับเมื่อ/)
  }
})
