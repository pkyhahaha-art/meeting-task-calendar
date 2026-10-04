import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

type Options = {
  meeting?: boolean; recipient?: 'creator' | 'primary' | 'secondary' | 'owner' | 'guest'
  inactive?: boolean; missingDevice?: boolean; changedDevice?: boolean; missingEntity?: boolean
  removed?: boolean; scoped?: boolean; legacyFirst?: boolean; missingOccurrence?: boolean
  cancelledOccurrence?: boolean; status?: string; deleted?: boolean; template?: string
  channel?: 'push' | 'email'; readError?: string; retry?: boolean
  actionPayload?: boolean
  uppercaseGuest?: boolean; missingGuestRow?: boolean
  overdue?: boolean; expiredRound?: boolean; rescheduled?: boolean; cancelledReminder?: boolean; missingReminder?: boolean
}

// Execute the actual Edge handler and local payload builder. Adapters never make
// network requests or access a user's records, credentials, or Push subscription.
function service(options: Options = {}) {
  let handler!: (request: Request) => Promise<Response>
  const recipient = 'recipient'
  const role = options.recipient ?? (options.meeting ? 'guest' : 'secondary')
  const today = new Date(Date.now() + 7 * 60 * 60_000).toISOString().slice(0, 10)
  const dueDate = new Date(Date.now() + 7 * 60 * 60_000 - 24 * 60 * 60_000).toISOString().slice(0, 10)
  const delivery = {
    id: 'delivery-1', event_id: options.meeting ? 'meeting-1' : null,
    task_id: options.meeting ? null : 'task-1',
    reminder_id: options.legacyFirst ? 'reminder-1' : null,
    task_reminder_id: options.overdue ? 'task-reminder-1' : null,
    recipient_type: role === 'creator' ? 'task_creator' : role === 'owner' ? 'owner' : role === 'guest' ? options.channel === 'email' ? 'guest' : 'registered_user' : 'task_assignee',
    recipient_reference: options.channel === 'email' ? 'recipient@example.test' : 'device-1', channel: options.channel ?? 'push',
    template_key: options.template ?? (options.overdue ? 'task_reminder' : options.meeting ? 'meeting_reminder' : 'task_updated'),
    payload: { entity: options.meeting ? 'meeting' : 'task', id: options.meeting ? 'meeting-1' : 'task-1',
      push_user_id: recipient, description: 'Private fixture', ...(options.scoped ? { occurrence_id: 'occurrence-1' } : {}),
      ...(options.overdue ? { due_date: dueDate, due_time: null, reminder_key: 'overdue',
        reminder_scheduled_at: options.expiredRound ? `${dueDate}T00:00:00+07:00` : `${today}T00:00:00+07:00` } : {}),
      ...(options.actionPayload ? { title: 'แผนงาน', original_occurrence_start: '2026-10-03T02:00:00Z', new_occurrence_start: '2026-10-02T02:00:00Z' } : {}) },
    attempt: options.retry ? 1 : 0,
  }
  let status = options.retry ? 'retry' : 'queued'
  let errorCode: unknown = null
  let errorMessage: unknown = null
  const messages: unknown[] = []
  const emails: Array<{ subject: string; htmlContent: string }> = []
  let signings = 0
  const guestScopes: unknown[] = []
  const queried: string[] = []
  const db = {
    async rpc(name: string, args?: Record<string, unknown>) {
      if (name === 'meeting_mobile_guest_users') {
        guestScopes.push(args?.target_occurrence_id)
        return { data: options.removed ? [] : [{ user_id: recipient }], error: options.readError === name ? { message: 'Temporary lookup error' } : null }
      }
      if (name === 'occurrence_guest_emails') return { data: options.removed ? [] : [{ email: 'recipient@example.test' }], error: null }
      return { data: 0, error: null }
    },
    from(table: string) {
      queried.push(table)
      let update: Record<string, unknown> | null = null
      const filters: Record<string, unknown> = {}
      const result = () => {
        if (options.readError === table && !update) return { data: null, error: { message: 'Temporary lookup error' } }
        if (update) {
          status = String(update.status ?? status)
          errorCode = update.error_code ?? errorCode
          errorMessage = update.error_message ?? errorMessage
          return { data: { id: delivery.id }, error: null }
        }
        const data = table === 'notification_deliveries' ? [delivery]
          : table === 'mobile_push_subscriptions' ? options.missingDevice ? null : {
            id: 'device-1', user_id: options.changedDevice ? 'another-user' : recipient,
            endpoint: 'https://fcm.googleapis.com/fixture', p256dh: 'fixture', auth: 'fixture',
          }
          : table === 'profiles' ? { status: options.inactive ? 'disabled' : 'active', email: 'recipient@example.test', full_name: 'ผู้จัด' }
          : table === 'tasks' ? options.missingEntity ? null : {
            creator_user_id: role === 'creator' ? recipient : 'creator',
            assignee_type: 'internal', assignee_user_id: role === 'primary' ? recipient : 'primary',
            status: options.status ?? 'pending', deleted_at: options.deleted ? '2026-10-04T00:00:00Z' : null,
            due_date: options.rescheduled ? '2099-01-01' : dueDate, due_time: null,
          }
          : table === 'task_reminders' ? options.missingReminder ? null : { status: options.cancelledReminder ? 'cancelled' : 'completed', reminder_key: 'overdue' }
          : table === 'task_internal_recipients' ? options.removed ? null : { user_id: recipient }
          : table === 'events' ? options.missingEntity ? null : {
            id: 'meeting-1', owner_user_id: role === 'owner' ? recipient : 'owner', title: 'Meeting',
            description: 'Private agenda', affiliation: 'ฝ่ายแผนงาน', location: 'ห้อง 7',
            start_datetime: options.actionPayload ? '2026-10-02T02:00:00Z' : '2099-01-01T00:00:00Z', end_datetime: '2026-10-02T03:00:00Z',
            status: options.status ?? 'scheduled', deleted_at: options.deleted ? '2026-10-04T00:00:00Z' : null,
          }
          : table === 'event_occurrences' ? options.missingOccurrence ? null : {
            id: 'occurrence-1', start_datetime: '2026-10-03T02:00:00Z', end_datetime: '2026-10-03T03:00:00Z',
            status: options.cancelledOccurrence ? 'cancelled' : 'scheduled', override_payload: options.actionPayload ? { description: 'Occurrence agenda', location: 'ห้อง 8' } : {},
          }
          : table === 'event_guests' ? options.missingGuestRow ? [] : options.actionPayload ? [{ id: 'guest-1',
            email: options.uppercaseGuest ? ' RECIPIENT@EXAMPLE.TEST ' : 'recipient@example.test', occurrence_id: options.scoped ? 'occurrence-1' : null }] : { id: 'guest-1' }
          : table === 'attachments' ? options.actionPayload ? [
            { id: 'file-1', file_name: 'วาระ.pdf', storage_path: 'owner/event/agenda.pdf', occurrence_id: options.scoped ? 'occurrence-1' : null },
            { id: 'other-file', file_name: 'WRONG OCCURRENCE', storage_path: 'owner/event/other.pdf', occurrence_id: 'occurrence-2' },
          ] : [] : table === 'guest_tokens' ? null
          : table === 'reminders' ? { occurrence_id: null }
          : ['task_attachments', 'document_links'].includes(table) ? [] : null
        return { data, error: null }
      }
      const query = {
        select() { return query }, eq(key: string, value: unknown) { filters[key] = value; return query },
        in() { return query }, is() { return query }, lte() { return query }, or() { return query }, order() { return query }, limit() { return query },
        insert() { return query },
        update(value: Record<string, unknown>) { update = value; return query },
        async maybeSingle() { return result() },
        then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve) },
      }
      return query
    },
    storage: { from() { return { async createSignedUrl(path: string) { signings++; return { data: { signedUrl: `https://storage.example/signed/${path}` }, error: null } } } } },
  }
  const source = readFileSync(new URL('../../supabase/functions/process-notification-queue/index.ts', import.meta.url), 'utf8').replace(/^import .*\n/gm, '')
  const payloadBuilder = readFileSync(new URL('../../supabase/functions/process-notification-queue/deviceNotification.ts', import.meta.url), 'utf8').replace(/export /g, '')
  const emailTemplate = readFileSync(new URL('../../supabase/functions/process-notification-queue/emailTemplate.ts', import.meta.url), 'utf8').replace(/export /g, '')
  const compiled = ts.transpileModule(`${emailTemplate}\n${payloadBuilder}\n${source}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  vm.runInNewContext(compiled, {
    URL, Request, Response, Date, JSON, TextEncoder, Uint8Array, crypto,
    createClient: () => db, webpush: {}, text: (value: unknown) => String(value ?? ''),
    subject: () => 'Fixture', html: () => '<p>Fixture</p>', internalTaskUrl: () => 'https://app.example/#/calendar', internalMeetingUrl: () => 'https://app.example/#/calendar',
    taskDocumentItems: () => [], retryDelayMinutes: () => 5,
    deliverWebPush: async (_device: unknown, message: unknown) => { messages.push(message); return { sent: true, status: 201, expired: false } },
    fetch: async (_url: unknown, init: { body: string }) => { messages.push('email'); emails.push(JSON.parse(init.body)); return new Response('accepted') },
    Deno: { env: { get: (key: string) => key === 'PUBLIC_APP_URL' ? 'https://app.example/' : key === 'SUPABASE_URL' ? 'https://database.example/' : 'unit-config' },
      serve: (callback: typeof handler) => { handler = callback } },
  })
  return {
    async run() { const response = await handler(new Request('https://worker.example', { method: 'POST', headers: { authorization: 'Bearer unit-config' } })); return { response, body: await response.json() } },
    state: () => ({ status, errorCode, errorMessage, messages, guestScopes, queried, emails, signings }),
  }
}

test('queued and retry Push never send to inactive, removed or re-paired recipients', async () => {
  for (const retry of [false, true]) for (const options of [
    { inactive: true }, { removed: true }, { missingDevice: true }, { changedDevice: true },
    { meeting: true, removed: true }, { meeting: true, scoped: true, removed: true },
    { meeting: true, legacyFirst: true, removed: true },
  ]) {
    const server = service({ ...options, retry })
    const { body } = await server.run()
    assert.equal(body.sent, 0)
    assert.equal(server.state().status, 'skipped')
    assert.equal(server.state().errorCode, 'push_recipient_unavailable')
    assert.equal(server.state().messages.length, 0)
  }
})

test('overdue Email and Push skip closed, deleted, rescheduled, cancelled and expired daily retries before issuing links', async () => {
  for (const channel of ['email', 'push'] as const) {
    for (const options of [{ status: 'completed' }, { status: 'cancelled' }, { deleted: true },
      { rescheduled: true }, { cancelledReminder: true }, { missingReminder: true }, { expiredRound: true }]) {
      const server = service({ channel, overdue: true, recipient: 'creator', retry: true, ...options })
      await server.run()
      assert.equal(server.state().status, 'skipped')
      assert.equal(server.state().errorCode, 'task_overdue_unavailable')
      assert.equal(server.state().messages.length, 0)
      assert.equal(server.state().signings, 0)
      assert.ok(!server.state().queried.includes('email_acknowledgement_tokens'))
    }
    const eligible = service({ channel, overdue: true, recipient: 'creator' })
    await eligible.run()
    assert.equal(eligible.state().status, 'sent')
    const failedLookup = service({ channel, overdue: true, recipient: 'creator', readError: 'task_reminders' })
    await failedLookup.run()
    assert.equal(failedLookup.state().status, 'retry')
    assert.equal(failedLookup.state().messages.length, 0)
  }
})

test('creator, overdue, primary/secondary assignee, owner and effective occurrence guest Push remain deliverable', async () => {
  for (const options of [
    { recipient: 'creator', template: 'task_created' }, { recipient: 'creator', template: 'task_reminder' },
    { recipient: 'creator', template: 'task_created', status: 'completed' },
    { meeting: true, recipient: 'owner', template: 'meeting_created', status: 'cancelled' },
    { recipient: 'primary' }, { recipient: 'secondary' }, { meeting: true, recipient: 'owner' },
    { meeting: true, recipient: 'guest' }, { meeting: true, scoped: true }, { meeting: true, legacyFirst: true },
  ] as Options[]) {
    const server = service(options)
    const { body } = await server.run()
    assert.equal(body.sent, 1)
    assert.equal(server.state().status, 'sent')
    assert.equal(server.state().messages.length, 1)
    if (options.scoped || options.legacyFirst) assert.deepEqual(server.state().guestScopes, ['occurrence-1'])
  }
})

test('missing, trashed, completed or cancelled items cannot send stale reminder/update Push', async () => {
  for (const options of [
    { missingEntity: true }, { deleted: true }, { status: 'completed' }, { status: 'cancelled' },
    { meeting: true, missingEntity: true }, { meeting: true, deleted: true }, { meeting: true, status: 'cancelled' },
    { meeting: true, scoped: true, missingOccurrence: true }, { meeting: true, scoped: true, cancelledOccurrence: true },
  ]) {
    const server = service(options)
    await server.run()
    assert.equal(server.state().status, 'skipped')
    assert.equal(server.state().messages.length, 0)
  }
})

test('explicit cancellation/completion notices still reach their current authorized recipient', async () => {
  for (const options of [
    { recipient: 'creator', template: 'task_cancelled', status: 'cancelled', deleted: true },
    { recipient: 'primary', template: 'task_completed', status: 'completed' },
    { meeting: true, recipient: 'owner', template: 'meeting_cancelled', status: 'cancelled', deleted: true },
    { meeting: true, scoped: true, template: 'meeting_cancelled', cancelledOccurrence: true },
  ] as Options[]) {
    const server = service(options)
    await server.run()
    assert.equal(server.state().status, 'sent')
    assert.equal(server.state().messages.length, 1)
  }
})

test('recipient lookup failures retry without sending rather than treating uncertainty as permission', async () => {
  for (const readError of ['mobile_push_subscriptions', 'profiles', 'tasks', 'task_internal_recipients', 'events', 'event_occurrences', 'meeting_mobile_guest_users']) {
    const meeting = ['events', 'event_occurrences', 'meeting_mobile_guest_users'].includes(readError)
    const server = service({ meeting, scoped: readError === 'event_occurrences', readError })
    await server.run()
    assert.equal(server.state().status, 'retry')
    assert.equal(server.state().errorCode, 'network_error')
    assert.equal(server.state().messages.length, 0)
  }
})

test('the Push eligibility guard does not change the existing email sending path', async () => {
  const server = service({ channel: 'email', recipient: 'creator', inactive: true, removed: true })
  await server.run()
  assert.equal(server.state().status, 'sent')
  assert.deepEqual(server.state().messages, ['email'])
  assert.equal(server.state().queried.includes('profiles'), false)
})

test('appointment cancellation/move reaches only current devices with a concise heading and safe meeting details', async () => {
  for (const template of ['meeting_occurrence_cancelled', 'meeting_occurrence_moved']) {
    for (const recipient of ['owner', 'guest'] as const) {
      const server = service({ meeting: true, template, recipient, actionPayload: true,
        scoped: template === 'meeting_occurrence_cancelled', cancelledOccurrence: true })
      await server.run()
      assert.equal(server.state().status, 'sent', `${template} ${recipient}: ${server.state().errorMessage}`)
      const message = server.state().messages[0] as { title: string; body: string; details: { notice_template: string } }
      assert.equal(message.title, template === 'meeting_occurrence_cancelled'
        ? 'ยกเลิกประชุม «แผนงาน» วันที่ 3 ต.ค. เวลา 09:00 น.'
        : 'ย้ายประชุม «แผนงาน» จากวันที่ 3 ต.ค. เป็นวันที่ 2 ต.ค. เวลา 09:00 น.')
      assert.equal(message.body, template === 'meeting_occurrence_cancelled'
        ? 'วันที่ 3 ต.ค. เวลา 09:00 น.'
        : 'จากวันที่ 3 ต.ค. เป็นวันที่ 2 ต.ค. เวลา 09:00 น.')
      assert.equal(message.details.notice_template, template)
      assert.match(JSON.stringify(message), /agenda|ฝ่ายแผนงาน/)
      assert.doesNotMatch(JSON.stringify(message), /token|push_user_id|storage_path/)
      assert.ok(!server.state().queried.some((table) => ['attachments', 'document_links', 'guest_tokens', 'email_acknowledgement_tokens'].includes(table)))
    }
    for (const options of [{ removed: true }, { inactive: true }, { changedDevice: true }, { missingEntity: true }, { deleted: true }, { status: 'cancelled' },
      ...(template === 'meeting_occurrence_cancelled' ? [{ missingOccurrence: true }] : [])]) {
      const server = service({ meeting: true, template, actionPayload: true, scoped: template === 'meeting_occurrence_cancelled', cancelledOccurrence: true, ...options })
      await server.run()
      assert.equal(server.state().status, 'skipped')
      assert.equal(server.state().messages.length, 0)
    }
  }
})

test('appointment emails show full meeting details and scoped documents without acknowledgement', async () => {
  for (const template of ['meeting_occurrence_cancelled', 'meeting_occurrence_moved']) {
    for (const recipient of ['owner', 'guest'] as const) {
      const cancellation = template.endsWith('cancelled')
      const server = service({ meeting: true, template, recipient, channel: 'email', actionPayload: true, scoped: cancellation, cancelledOccurrence: cancellation })
      await server.run()
      assert.equal(server.state().status, 'sent', `${template} ${recipient}: ${server.state().errorMessage}`)
      const email = server.state().emails[0]
      assert.match(email.subject, /3 ต\.ค\./)
      for (const text of ['ฝ่ายแผนงาน', cancellation ? 'Occurrence agenda' : 'Private agenda', 'วาระ.pdf', 'ผู้จัด', 'วันและเวลาสิ้นสุด']) assert.ok(email.htmlContent.includes(text), text)
      assert.doesNotMatch(email.htmlContent, /WRONG OCCURRENCE|>รับทราบ|ยังคงเดิม|แบบไม่ทำซ้ำ/)
      if (recipient === 'guest') {
        assert.equal(server.state().signings, 0)
        assert.match(email.htmlContent, /functions\/v1\/guest-event\?token=/)
        if (cancellation) assert.match(email.htmlContent, /notification_id=delivery-1/)
      } else assert.equal(server.state().signings, 1)
      assert.ok(!server.state().queried.includes('email_acknowledgement_tokens'))
    }
    const revoked = service({ meeting: true, template, channel: 'email', actionPayload: true, removed: true, scoped: template.endsWith('cancelled'), cancelledOccurrence: true })
    await revoked.run()
    assert.equal(revoked.state().status, 'skipped')
    assert.equal(revoked.state().signings, 0)
    assert.equal(revoked.state().emails.length, 0)
  }
})

test('action guest email matches normalized Gmail and never falls back to raw signed links after a membership race', async () => {
  for (const template of ['meeting_occurrence_cancelled', 'meeting_occurrence_moved']) {
    for (const missingGuestRow of [false, true]) {
      const server = service({ meeting: true, template, channel: 'email', actionPayload: true, uppercaseGuest: true,
        missingGuestRow, scoped: template.endsWith('cancelled'), cancelledOccurrence: true })
      await server.run()
      assert.equal(server.state().signings, 0)
      assert.equal(server.state().status, missingGuestRow ? 'retry' : 'sent')
      assert.equal(server.state().emails.length, missingGuestRow ? 0 : 1)
      if (!missingGuestRow) {
        assert.match(server.state().emails[0].htmlContent, /guest-event\?token=/)
        assert.doesNotMatch(server.state().emails[0].htmlContent, /storage\.example\/signed/)
      }
    }
  }
})
