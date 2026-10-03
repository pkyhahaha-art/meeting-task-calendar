import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

test('paired-device flow hides QR until Add, closes after pairing, and restores QR after the final disconnect', async () => {
  const require = createRequire(import.meta.url)
  let devices = [{ id: 'phone-1', device_name: 'iPhone', created_at: '2026-10-03T00:00:00Z', user_agent: 'iPhone' }]
  let checked = false
  let tokens = 0
  let disconnected = ''
  const exports: Record<string, () => React.ReactElement> = {}
  const source = readFileSync(new URL('./MobilePushPage.tsx', import.meta.url), 'utf8').replaceAll('import.meta.env', '({ VITE_SUPABASE_URL: "https://project.example" })')
  const mocks: Record<string, unknown> = {
    react: React,
    '@tanstack/react-query': {
      useQuery: ({ queryKey }: { queryKey: string[] }) => queryKey[0] === 'mobile-push-devices'
        ? { data: devices, isSuccess: true, isFetchedAfterMount: checked, refetch: async () => {} }
        : { data: { ready: true }, isFetching: false },
      useQueryClient: () => ({ invalidateQueries: async () => {} }),
      useMutation: () => ({ isPending: false, mutateAsync: async (id: string) => { disconnected = id; devices = devices.filter((device) => device.id !== id) } }),
    },
    '../auth/AuthProvider': { useAuth: () => ({ user: { id: 'owner' } }) },
    '../i18n/LanguageProvider': { useLanguage: () => ({ text: (thai: string) => thai }) },
    '../components/ConfirmDialogProvider': { useConfirm: () => async () => true },
    '../lib/appUrl': { appUrl: (value: string) => `https://app.example/#/${value}` },
    '../lib/mobilePushConfig': { loadMobilePushConfig: async () => ({ ready: true }) },
    '../lib/mobilePush': { createPairingToken: async () => { tokens++; return { token: `test-${tokens}`, expiresAt: new Date(Date.now() + 600000) } } },
    '../components/MobileConnectionGuide': { MobileConnectionGuide: () => <details><summary>วิธีเชื่อมต่อ</summary></details> },
  }
  const context = vm.createContext({ exports, console, Date, setInterval, clearInterval, setTimeout,
    window: { location: { hostname: 'app.example', origin: 'https://app.example' } }, localStorage: { getItem: () => '' },
    require: (name: string) => name.endsWith('.jpg') ? 'mascot.jpg' : mocks[name] || require(name) })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, context)
  const Page = exports.MobilePushPage
  let renderer!: ReactTestRenderer
  const update = async () => { await act(async () => { renderer.update(<Page />) }) }
  const hasQr = () => renderer.root.findAllByType('h2').some((node) => node.children.includes('สแกน QR Code เพื่อเชื่อมต่อ'))
  const button = (name: string) => renderer.root.findAllByType('button').find((node) => node.children.includes(name))!
  await act(async () => { renderer = create(<Page />) })
  assert.equal(tokens, 0)
  checked = true; await update()
  assert.equal(hasQr(), false)
  assert.equal(tokens, 0)
  await act(async () => button('เชื่อมต่ออุปกรณ์เพิ่ม').props.onClick())
  assert.equal(hasQr(), true)
  assert.equal(tokens, 1)
  devices.push({ ...devices[0], id: 'phone-2', device_name: 'Android' }); await update()
  assert.equal(hasQr(), false)
  await act(async () => renderer.root.findAllByProps({ 'aria-label': 'ยกเลิกการเชื่อมต่อ' })[0].props.onClick())
  await update()
  assert.equal(disconnected, 'phone-1')
  assert.equal(hasQr(), false)
  await act(async () => renderer.root.findAllByProps({ 'aria-label': 'ยกเลิกการเชื่อมต่อ' })[0].props.onClick())
  await update()
  assert.equal(devices.length, 0)
  assert.equal(hasQr(), true)
  assert.equal(tokens, 2)
  // The removed standalone test card must not duplicate device actions.
  assert.equal(renderer.root.findAllByType('h3').some((node) => node.children.includes('ทดสอบการแจ้งเตือน')), false)
  act(() => renderer.unmount())
})
