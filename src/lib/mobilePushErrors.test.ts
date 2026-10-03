import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function mobileClient(failed: boolean) {
  const result = { data: [], error: failed ? { code: 'NETWORK_ERROR' } : null }
  const query = { select() { return this }, eq() { return this }, like() { return this }, delete() { return this },
    order: async () => result, then: (resolve: (value: typeof result) => void) => Promise.resolve(result).then(resolve) }
  const exports: { getConnectedDevices?: (id: string) => Promise<unknown[]>; deleteConnectedDevice?: (id: string) => Promise<boolean> } = {}
  vm.runInContext(ts.transpileModule(readFileSync(new URL('./mobilePush.ts', import.meta.url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
  vm.createContext({ exports, require: (name: string) => name === './supabase' ? { supabase: { from: () => query } } : {},
    console: { error: () => {} } }))
  return exports
}

test('failed device reads and disconnects reject so the UI can show error rather than false success', async () => {
  const client = mobileClient(true)
  await assert.rejects(client.getConnectedDevices!('user'), /โหลดอุปกรณ์ไม่ได้/)
  await assert.rejects(client.deleteConnectedDevice!('device'), /ยกเลิกการเชื่อมต่อไม่ได้/)
})

test('an empty successful device query remains empty and a successful disconnect still resolves', async () => {
  const client = mobileClient(false)
  assert.equal((await client.getConnectedDevices!('user')).length, 0)
  assert.equal(await client.deleteConnectedDevice!('device'), true)
})
