import assert from 'node:assert/strict'
import test from 'node:test'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { DeviceDocumentViewer } from './DeviceDocumentViewer'
import { PdfDocumentPreview } from './PdfDocumentPreview'

const props = { name: 'วาระประชุม.pdf', previewUrl: 'https://storage.example/preview?token=fresh', downloadUrl: 'https://storage.example/download?token=fresh' }
function viewer(download = false, name = props.name) {
  let renderer!: ReactTestRenderer
  act(() => {
    renderer = create(<MemoryRouter initialEntries={['/device-document?notification=message&file=pdf']}>
      <Routes>
        <Route path="/device-document" element={<DeviceDocumentViewer {...props} name={name} download={download} />} />
        <Route path="/device-inbox" element={<h1>กล่องแจ้งเตือน</h1>} />
      </Routes>
    </MemoryRouter>)
  })
  return renderer
}
function click(renderer: ReactTestRenderer, close: boolean) {
  const link = renderer.root.findAllByType('a').find((node) => close
    ? node.props['aria-label'] === 'ปิดเอกสารและกลับกล่องแจ้งเตือน'
    : node.props.href === '/device-inbox' && !node.props['aria-label'])!
  act(() => link.props.onClick({ button: 0, preventDefault() {}, defaultPrevented: false }))
}

test('document preview keeps return controls visible while loading and after the embedded viewer loads', () => {
  const renderer = viewer(false, 'รูปภาพ.jpg')
  assert.equal(renderer.root.findByType('iframe').props.src, props.previewUrl)
  assert.equal(renderer.root.findAllByType('a').filter((node) => node.props.href === '/device-inbox').length, 2)
  act(() => renderer.root.findByType('iframe').props.onLoad())
  assert.equal(renderer.root.findAllByType('a').filter((node) => node.props.href === '/device-inbox').length, 2)
  act(() => renderer.unmount())
})

test('PDF documents use the in-app reader and retain Close without leaving the app', () => {
  const renderer = viewer()
  assert.equal(renderer.root.findByType(PdfDocumentPreview).props.url, props.previewUrl)
  assert.equal(renderer.root.findAllByType('iframe').length, 0)
  click(renderer, true)
  assert.equal(renderer.root.findByType('h1').children.join(''), 'กล่องแจ้งเตือน')
  act(() => renderer.unmount())
})

test('Back and Close return directly to the inbox even when the viewer was opened without browser history', () => {
  for (const close of [false, true]) {
    const renderer = viewer()
    click(renderer, close)
    assert.equal(renderer.root.findByType('h1').children.join(''), 'กล่องแจ้งเตือน')
    assert.equal(renderer.root.findAllByType('iframe').length, 0)
    act(() => renderer.unmount())
  }
})

test('download requests keep the app mounted and Close returns to the inbox', () => {
  const renderer = viewer(true)
  assert.equal(renderer.root.findByType('iframe').props.src, props.downloadUrl)
  assert.ok(renderer.root.findByProps({ role: 'status' }).children.join('').includes('ส่งคำขอดาวน์โหลด'))
  click(renderer, true)
  assert.equal(renderer.root.findByType('h1').children.join(''), 'กล่องแจ้งเตือน')
  act(() => renderer.unmount())
})

test('fallback external file actions open a separate window and preserve the app return controls', () => {
  for (const download of [false, true]) {
    const renderer = viewer(download)
    const external = renderer.root.findAllByType('a').filter((node) => node.props.href.startsWith('https:'))
    assert.ok(external.length > 0)
    for (const link of external) {
      assert.equal(link.props.target, '_blank')
      assert.match(link.props.rel, /noopener/)
    }
    act(() => renderer.unmount())
  }
})
