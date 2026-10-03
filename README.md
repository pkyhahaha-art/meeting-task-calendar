# Meeting Calendar & Reminder Web App

Internal shared calendar built with React, TypeScript, Tailwind CSS, FullCalendar, and Supabase.

## iPhone / iPad notification setup

Requires iOS / iPadOS 16.4 or later. After scanning the QR code in Safari, copy the pairing link, use Share → Add to Home Screen, and open the new PEA Calendar icon. Paste the link in the app and verify it before enabling notifications. The app starts at `#/pair-device` so the pairing link can be transferred without relying on shared Safari/PWA storage. QR tokens expire after 10 minutes.

The manifest, icons, and notification service worker use relative paths for GitHub Pages project hosting. Pairing requires a real Push subscription and never stores a simulated `device://` endpoint. The local test button displays a notification on the device where it is clicked. Each connected device also has a server test button; provider acceptance does not guarantee an iOS banner was displayed.

For server delivery, apply `202610020005_web_push_delivery.sql` and deploy `mobile-push` and the updated `process-notification-queue` functions. Generate one persistent VAPID key pair with `node scripts/generate-push-keys.mjs`. It writes `.env.push.local`, which is ignored by Git. Save its `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` values only in this project's Supabase Edge Function secrets. Never put the private key in Git or the frontend. Keep the existing `PUBLIC_APP_URL` and notification cron configuration.

The pairing page obtains the public key and readiness from the sender's public GET endpoint. No frontend VAPID secret or rebuild is required when server configuration is completed. POST test requests verify the user JWT, active account, device ownership and a per-device cooldown. The queue sends encrypted Web Push per device alongside existing email/LINE delivery, removes expired subscriptions, and retries transient provider errors. The existing mobile checkbox is stored in the legacy `channel_line` column. Token verification remains separate from permission requests so iOS receives a direct button gesture.

Reminder recipients are limited to the meeting owner and the task's internal assignees. Task creators also receive overdue reminders. Only enabled mobile reminders target subscribed devices belonging to those accounts; visibility of another employee's item in the shared calendar does not subscribe the viewer to its notifications.

## Current implementation

- Gmail/Password registration with confirmation link
- Persistent Supabase session, sign-out, and password recovery
- Protected application routes and disabled-account handling
- Shared month calendar
- Create, view, edit, and move meetings to 30-day Trash
- Shared Task visibility for every active employee, with creator-only editing and completion
- Multiple internal and external Task recipients together, per-recipient acknowledgement, recurrence settings, reminders, files, and Google Drive links
- Meeting and Task layers in the same calendar
- UI ownership rules plus database-enforced RLS
- Initial schema for recurrence, guests, attachments, reminders, delivery logs, audit logs, and system logs
- Private Storage bucket policies
- Revocable, single-Task links for external Task assignees
- Task recipients can open Drive links and download Task files; only creators can manage Task documents after migrations `202609260001_task_assignee_read_only_documents.sql` and `202609270002_multiple_recipients_acknowledgements.sql`
- Task and Meeting creators can remove uploaded attachments; Meeting and Task time fields use explicit 24-hour selectors
- Revocable guest Meeting links with short-lived attachment downloads
- Recurring Meeting and Task occurrence generation with hourly storage/retention cleanup
- LINE linking codes, webhook handling, and queued LINE reminders
- Admin overview for deliveries, audit events, and scheduled jobs
- Delivery status and manual retry for the Meeting owner, Task creator, and Admin

## Recent changes

- Responsive layout for mobile phones, tablets, and iPad, including the calendar, dialogs, action buttons, and cookie banner.
- Branded bilingual cookie-consent banner for signed-in users, with the system mascot and a Thai/English speech bubble.
- Inline spinner on save buttons for Meeting and Task forms. Success alerts close automatically after two seconds, without a duplicate loading alert or a manual close button.
- Meeting and Task dialogs now close after their success alert finishes. Validation errors and failed saves leave the form open for correction.
- A completed or cancelled Task cannot send a new notification. The form explains why instead of attempting to create an unusable external recipient link.
- Email acknowledgement redirects to `/#/acknowledged`, displays a button-free success alert, and closes automatically after two seconds.
- Meeting owners, Task creators, and Admin can see the latest delivery status per recipient. Creator rows identify automatic creator notifications; failed or quota-deferred deliveries can be queued for retry after migration `202609290001_notification_delivery_status.sql`.
- Recurring Meetings can now be edited for one future occurrence only. That scope permits changes to the details, location, attendees, and attachments while preserving the existing reminder schedule; the scheduled message uses the occurrence's latest saved details without creating a duplicate reminder. This requires migrations `202609290007_occurrence_specific_meeting_details.sql` through `202609290010_allow_notification_worker_read_occurrences.sql` and the deployed `process-notification-queue` and `guest-event` functions.
- Meeting notification information is grouped into one frame: scheduled reminders for the occurrence being viewed and messages sent when the Meeting was created or updated.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and set:

   ```text
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_PUBLISHABLE_KEY=...
   ```

3. Apply every SQL file in `supabase/migrations` in filename order. On an existing project, apply every migration newer than its latest installed migration, including `202609260001_task_assignee_read_only_documents.sql`, `202609270001_explicit_edit_notifications.sql`, `202609270002_multiple_recipients_acknowledgements.sql`, `202609290001_notification_delivery_status.sql`, and `202609290007_occurrence_specific_meeting_details.sql` through `202609290010_allow_notification_worker_read_occurrences.sql`.

4. In Supabase Auth, enable Email/Password and Confirm Email. For local development allow `http://127.0.0.1:5173/**`. GitHub Pages redirects use `/#/auth/callback` and `/#/reset-password`.

5. Configure a custom SMTP provider before production use.

6. Deploy the Edge Functions and configure their server-side secrets:

   ```bash
   supabase functions deploy process-notification-queue --no-verify-jwt
   supabase functions deploy email-acknowledgement --no-verify-jwt
   supabase functions deploy external-task --no-verify-jwt
   supabase functions deploy guest-event --no-verify-jwt
   supabase functions deploy line-webhook --no-verify-jwt
   supabase functions deploy reporting-export --no-verify-jwt
   supabase functions deploy scheduled-maintenance --no-verify-jwt
   ```

   `external-task` and `guest-event` use the standard Supabase server environment variables. `external-task` also needs `PUBLIC_APP_URL` to build external assignee links. The notification and maintenance functions need the cron secret; the notification function also needs Brevo settings and `PUBLIC_APP_URL` for email links. LINE needs `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN`; set its webhook to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/line-webhook`. Reporting needs a distinct `REPORTING_SYNC_SECRET`.

7. Optionally enable Cloudflare Turnstile in Supabase Auth and set `VITE_TURNSTILE_SITE_KEY` in the frontend environment. The site key is public; the Turnstile secret belongs only in Supabase Auth settings.

8. Run:

   ```bash
   npm run dev
   ```

## GitHub Pages

The app uses `HashRouter` and relative Vite assets so project Pages URLs work without a custom 404 server.

1. Add repository secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
2. Optionally add `VITE_LINE_ADD_FRIEND_URL`.
3. In GitHub repository settings, set Pages source to **GitHub Actions**.
4. Push to `main` or `master`; `.github/workflows/deploy-pages.yml` tests, builds, and deploys the site.
5. Add the resulting Pages URL patterns to Supabase Auth Redirect URLs.

## Vercel

GitHub remains the source repository. Vercel builds and serves the web application after each push to the selected production branch.

1. In Vercel, create a **New Project** and import this GitHub repository.
2. Select `main` as the production branch. Vercel detects Vite; if settings are requested, use build command `npm run build` and output directory `dist`.
3. Add these Vercel environment variables from `.env.local`:

   ```text
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_PUBLISHABLE_KEY=...
   VITE_LINE_ADD_FRIEND_URL=...
   ```

   Do not add `SUPABASE_SERVICE_ROLE_KEY`, Brevo keys, LINE channel secrets, or cron secrets to Vercel.

4. Copy the production URL, for example `https://meeting-task-calendar.vercel.app`, then set Supabase Edge Function secret `PUBLIC_APP_URL` to that value. It is used for Task, Meeting, and acknowledgement links sent in notifications.

   ```bash
   supabase secrets set PUBLIC_APP_URL=https://meeting-task-calendar.vercel.app
   ```

5. In Supabase Auth, set the Site URL to the Vercel production URL and add these redirect URLs:

   ```text
   https://meeting-task-calendar.vercel.app/#/auth/callback
   https://meeting-task-calendar.vercel.app/#/reset-password
   ```

6. Pushes to `main` automatically create a production deployment. Keep the existing GitHub Pages site available until email links sent before the migration are no longer needed.

## Google Sheets reporting

The read-only Apps Script template is in [`integrations/google-sheets`](integrations/google-sheets). It syncs safe Users, Audit, Notification, and System reporting fields hourly; it excludes tokens, recipient addresses, attachment paths, and secrets.

## Security notes

- Never place a `service_role` key in `VITE_*` variables or frontend code.
- Guest tokens, privileged Admin actions, notification providers, and signed guest attachment URLs belong in Edge Functions.
- The current MVP registration verifies Gmail ownership but does not independently prove employment or ownership of the submitted Employee ID.
