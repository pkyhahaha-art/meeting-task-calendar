import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

test('the real email worker signs uploaded Task documents and emits clickable links for every recipient type', async () => {
  const root = '../../supabase/functions/process-notification-queue/'
  const source = ['emailTemplate.ts', 'taskLink.ts', 'taskDocuments.ts', 'index.ts'].map((file) =>
    readFileSync(new URL(root + file, import.meta.url), 'utf8').replace(/^import .*\n/gm, '').replace(/export /g, '')).join('\n')
  let signings = 0
  const db = {
    from(table: string) {
      return { select() { return this }, eq() { return this }, async order() {
        return { error: null, data: table === 'task_attachments' ? [{ file_name: 'เอกสาร.pdf', file_size: 1234, storage_path: 'private/task.pdf' }]
          : [{ display_name: 'Drive', url: 'https://drive.google.com/file/d/example' }] }
      } }
    },
    storage: { from(bucket: string) { return { async createSignedUrl(path: string, seconds: number) {
      assert.equal(bucket, 'task-documents'); assert.equal(path, 'private/task.pdf'); assert.equal(seconds, 604800); signings++
      return { error: null, data: { signedUrl: 'https://storage.example/document?token=signed' } }
    } } } },
  }
  const context = vm.createContext({ URL, Date, JSON, console, createClient: () => db,
    Deno: { serve: () => {}, env: { get: (key: string) => key === 'PUBLIC_APP_URL' ? 'https://example.github.io/calendar/' : 'local-config' } } })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context)
  const enrich = vm.runInContext('payloadWithTaskDocuments', context)
  const render = vm.runInContext('html', context)
  for (const recipient_type of ['task_creator', 'task_assignee', 'external_assignee']) {
    const enriched = await enrich({ channel: 'email', recipient_type }, { entity: 'task', id: 'task', external_url: 'https://example.com/external-task?token=recipient' })
    const markup = render('task_updated', enriched)
    assert.match(markup, /href="https:\/\/storage.example\/document\?token=signed"[^>]*>เอกสาร.pdf<\/a>/)
    assert.doesNotMatch(markup, /private\/task.pdf|storage_path/)
  }
  assert.equal(signings, 3)
})
