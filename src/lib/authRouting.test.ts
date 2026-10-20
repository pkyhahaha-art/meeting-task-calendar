import assert from 'node:assert/strict'
import test from 'node:test'
import { homePathForRole } from './authRouting.js'
import * as authRouting from './authRouting.js'
import { parsePath } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

test('opens the calendar by default for every role', () => {
  assert.equal(homePathForRole(), '/calendar')
})

const recoveryUrl = (href: string) => {
  assert.ok('passwordRecoveryUrl' in authRouting, 'recovery redirects need routing before SDK initialization')
  return (authRouting as { passwordRecoveryUrl: (href: string) => string | null }).passwordRecoveryUrl(href)
}

test('raw recovery fragments reach the password form route on both deployments without losing credentials', () => {
  for (const base of ['https://pea-mtc.vercel.app/', 'https://pkyhahaha-art.github.io/meeting-task-calendar/']) {
    const fragment = '#access_token=fixture-access&refresh_token=fixture-refresh&type=recovery'
    const result = recoveryUrl(`${base}${fragment}`)!
    assert.equal(result, `${base}#/reset-password${fragment}`)
    assert.equal(parsePath(new URL(result).hash.slice(1)).pathname, '/reset-password')
    const params = new URLSearchParams(new URL(result).hash.split('#').at(-1))
    assert.equal(params.get('access_token'), 'fixture-access')
    assert.equal(params.get('refresh_token'), 'fixture-refresh')
  }
})

test('explicit reset routes keep OTP, PKCE, errors and nested credentials for the recovery page', () => {
  for (const suffix of ['#/reset-password', '#/reset-password#access_token=fixture&refresh_token=fixture&type=recovery',
    '?code=fixture-code#/reset-password', '?token_hash=fixture&type=recovery#/reset-password',
    '#/reset-password#error_description=expired', '#/reset-password?token_hash=fixture&type=recovery']) {
    const href = `https://pea-mtc.vercel.app/${suffix}`
    assert.equal(recoveryUrl(href), href)
  }
  assert.equal(recoveryUrl('https://pea-mtc.vercel.app/?token_hash=fixture&type=recovery#/login'),
    'https://pea-mtc.vercel.app/?token_hash=fixture&type=recovery#/reset-password#/login')
})

test('normal login, signup and ambiguous code callbacks keep their existing authentication handling', () => {
  for (const suffix of ['#/login', '#/calendar', '#/auth/callback', '#access_token=fixture&refresh_token=fixture&type=signup',
    '?code=fixture-code#/auth/callback', '?code=fixture-code', '?type=signup#access_token=fixture&type=recovery',
    '#/reset-password-other']) {
    assert.equal(recoveryUrl(`https://pea-mtc.vercel.app/${suffix}`), null, suffix)
  }
})

test('client startup routes recovery before initialization and prevents the SDK from consuming its fragment', () => {
  const source = readFileSync(new URL('./supabase.ts', import.meta.url), 'utf8')
    .replaceAll('import.meta.env', '({ VITE_SUPABASE_URL: "https://fixture.invalid", VITE_SUPABASE_PUBLISHABLE_KEY: "fixture" })')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const suffix of ['#access_token=fixture&refresh_token=fixture&type=recovery', '#/reset-password',
    '#/reset-password#access_token=fixture&refresh_token=fixture&type=recovery',
    '#/login', '#access_token=fixture&refresh_token=fixture&type=signup', '?code=fixture#/auth/callback']) {
    const location = { href: `https://pea-mtc.vercel.app/${suffix}` }
    let initialized = false
    vm.runInNewContext(compiled, { exports: {}, window: { location, history: {
      replaceState: (_state: unknown, _title: string, href: string) => { location.href = href },
    } }, require: (name: string) => name === './authRouting' ? authRouting : {
      createClient: (_url: string, _key: string, options: { auth: { detectSessionInUrl: boolean; persistSession: boolean; autoRefreshToken: boolean } }) => {
        const recovery = suffix.includes('recovery') || suffix.includes('/reset-password')
        assert.equal(options.auth.detectSessionInUrl, !recovery, suffix)
        assert.equal(options.auth.persistSession, true)
        assert.equal(options.auth.autoRefreshToken, true)
        if (recovery) assert.equal(parsePath(new URL(location.href).hash.slice(1)).pathname, '/reset-password')
        else assert.equal(location.href, `https://pea-mtc.vercel.app/${suffix}`)
        initialized = true
        return {}
      },
    } })
    assert.equal(initialized, true)
  }
})
