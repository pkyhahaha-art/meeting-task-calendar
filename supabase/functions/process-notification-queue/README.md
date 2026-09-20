# Process notification queue

Deploy this function after applying every notification migration:

```sh
supabase functions deploy process-notification-queue
supabase secrets set BREVO_API_KEY=... NOTIFICATION_SENDER_EMAIL=... NOTIFICATION_SENDER_NAME="Meeting & Task Calendar" NOTIFICATION_CRON_SECRET=...
```

Invoke it from a Supabase scheduled job every minute (Dashboard > Edge Functions > Schedules). The function first queues due Email reminders for active Meetings and pending Tasks, then claims due deliveries, sends them through the Brevo Transactional Email API, and records `sent`, `retry`, `failed`, or `deferred_quota` in `notification_deliveries`.

Brevo must have a verified sender address. Recipients may use Gmail; this integration sends transactional Email through Brevo and does not require Gmail OAuth or a Gmail password. Set the sender and API key only as Supabase Edge Function secrets, never in `.env.local` or browser variables.

Retries run after 5 and 10 minutes. A third retryable failure is recorded as `failed`; a third HTTP 429 is recorded as `deferred_quota` for Admin follow-up. A worker interrupted for more than 20 minutes is returned to the queue (or marked failed if it already used all three attempts).

The function requires a `Bearer` value matching `NOTIFICATION_CRON_SECRET`; store the matching value in Supabase Vault and use it only in the cron job header. Do not expose this secret or the service-role key in the browser or in Apps Script.
