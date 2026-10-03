// Prints configuration classifications only; never emits credential values.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

let failed = false
function checkSecret(value, location) {
  const jwtRole = (token) => {
    try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role } catch { return null }
  }
  const privateMaterial = /sb_secret_[A-Za-z0-9_-]+|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(value)
    || [...value.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)].some(([token]) => jwtRole(token) === 'service_role')
  if (privateMaterial) { console.error(`FAIL: server credential detected in ${location}`); failed = true }
}

const configuration = readFileSync('.env.local', 'utf8')
const values = new Map(configuration.split(/\r?\n/).flatMap((line) => {
  const match = line.trim().match(/^(VITE_[A-Z_]+)\s*=\s*(.*)$/)
  return match ? [[match[1], match[2].replace(/^(['"])(.*)\1$/, '$2')]] : []
}))
for (const [name, value] of values) {
  checkSecret(value, name)
  console.log(`${name}: ${value ? 'present' : 'empty'}`)
}
const configuredUrl = values.get('VITE_SUPABASE_URL')
if (!configuredUrl || !URL.canParse(configuredUrl) || new URL(configuredUrl).protocol !== 'https:') {
  console.error('FAIL: VITE_SUPABASE_URL is missing or invalid'); failed = true
}
if (!values.get('VITE_SUPABASE_PUBLISHABLE_KEY') && !values.get('VITE_SUPABASE_ANON_KEY')) {
  console.error('FAIL: browser publishable/anon key is missing'); failed = true
}
function scan(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) scan(path)
    else if (/\.(?:[cm]?js|tsx?|html|json)$/.test(name)) checkSecret(readFileSync(path, 'utf8'), path)
  }
}
scan('src'); scan('dist')
console.log(failed ? 'FAIL: client configuration/security checks' : 'PASS: client configuration is present; no server credential detected in source/build')
process.exitCode = failed ? 1 : 0
