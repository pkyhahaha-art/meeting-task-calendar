import { writeFileSync, existsSync } from 'node:fs'
import webpush from 'web-push'

const file = '.env.push.local'
if (existsSync(file)) throw new Error(`${file} already exists; keep the existing key pair.`)
const keys = webpush.generateVAPIDKeys()
writeFileSync(file, `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=https://pkyhahaha-art.github.io/meeting-task-calendar/\n`, { mode: 0o600 })
console.log(`VAPID keys saved to ignored file ${file}. Upload only to this project's Supabase Edge Function secrets. Keep the private key out of Git and the frontend.`)
