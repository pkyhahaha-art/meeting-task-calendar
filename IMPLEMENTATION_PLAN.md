# Architecture & Implementation Plan
## Meeting Calendar & Reminder Web App

**Plan version:** 1.0  
**Based on PRD:** 1.1 Draft  
**Status:** Approved — implementation in progress  
**Target:** Approximately 50 internal users, free-tier services only

**Approved:** 19 September 2026  

**สถานะที่บันทึก ณ 28 กันยายน 2026:** ปรับหน้า Calendar, banner 2D และ popup ตามธีม PEA แล้ว แก้ระบบรับทราบจากอีเมลและ deploy backend ขึ้น production แล้ว ส่วน frontend ให้ตรวจผล GitHub Pages workflow หลัง push รอบนี้

## Current Progress

- Foundation, Auth, Meeting/Task calendar, recurrence, reminders, external Task links, guest links, Admin screens, and notification workers are implemented in code.
- A Supabase production project is linked. On 26 September 2026, the deployed `external-task` function passed a CORS preflight with `x-client-info`; external-assignee notifications in the preceding seven days included 43 provider-accepted deliveries. These checks do not prove that every recipient link opened successfully.
- On 28 September 2026, migration `202609280001_atomic_email_acknowledgement.sql` was applied to production. `email-acknowledgement` and `process-notification-queue` were deployed without JWT verification. A previously failing Gmail acknowledgement link returned `303` to the public `/acknowledged` route after the fix, and both the token and recipient acknowledgement timestamps were verified in production.
- Task links now use server-side `PUBLIC_APP_URL`; assignees have read-only document access. Creators can delete Task and Meeting attachments, and forms use explicit 24-hour time selection. Task email Drive links open directly.
- Edit forms offer save silently or save with notification. The migrations defer edit emails until recipients, attachments, and Drive links are saved, add mixed multi-recipient Tasks and per-recipient acknowledgements, and enforce creator-only editing/completion. Live acceptance testing with real recipient accounts remains open.
- The acknowledgement button in each recipient email uses a dedicated action URL. The action now runs atomically in PostgreSQL, redirects successful requests to the public `/acknowledged` route, and includes a fallback acknowledgement link in newly generated emails. Opening the ordinary detail URL does not change status. Calendar forms refresh recipient badges while open.
- The Task recipient form uses compact tabs for self, internal employees, and external Gmail recipients. Switching tabs preserves selections across all three groups; multiple recipients remain supported.
- Email cards contain a direct acknowledgement action plus a fallback link for Gmail/Outlook clients. The scoped acknowledgement Function records only the matching recipient. Cards list Google Drive links only when the creator entered them in the form.
- Remaining acceptance work is tracked in `OPEN_ISSUES.md`, including production end-to-end verification, external token expiry, shared Task visibility, Meeting Drive links, and notification formats.

## Latest Handoff — 28 September 2026

- Calendar UI: the desktop banner is compact and uses the 2D artwork at `ภาพประกอบUI/PEA Calendar Banner 2D.png`, based on `ภาพประกอบUI/Screenshot 2026-09-28 173307.png`. The mascot speech bubble reads “นัดง่าย / งานราบรื่น / ไปด้วยกัน”. The full month calendar is visible without its own scrollbar; the right summary cards may scroll.
- Popup UI: global SweetAlert dialogs and the custom confirmation dialog use the PEA purple/amber theme, mascot artwork, visible shadows, and a larger speech-bubble tail. Delete confirmations use the danger variant. Overflow rules prevent the mascot and speech tail from being clipped or hidden behind actions.
- Email acknowledgement: the previous direct multi-step Data API update produced `500 EDGE_FUNCTION_ERROR` for a real guest token. Migration `202609280001_atomic_email_acknowledgement.sql` moves token validation, recipient acknowledgement, and token consumption into one security-definer transaction. The Edge Function now redirects success to `https://pkyhahaha-art.github.io/meeting-task-calendar#/acknowledged`.
- Production status: the migration and both affected Edge Functions are already deployed. The supplied failing token was retested successfully and is now consumed/acknowledged. Future notification emails include a new-tab action and a fallback link.
- Verification completed locally: 32 tests pass; TypeScript typecheck, ESLint, production build, and `git diff --check` pass. Vite still reports the existing advisory that the main JavaScript chunk exceeds 500 kB.
- Next session: verify the GitHub Actions Pages deployment for this commit, then perform visual acceptance in Gmail and on desktop/mobile. Continue the broader real-recipient acceptance items in `OPEN_ISSUES.md`.

---

# 1. Confirmed Product Decisions

- A user registers with Full Name, unique Employee ID, Gmail, Password, and Confirm Password.
- Supabase sends a Gmail verification link. The account cannot sign in until the link is opened.
- Sign-in uses verified Gmail + Password. SMS OTP, Google Login, and LINE Login are not used.
- No employee master list and no per-user Admin approval are required for the MVP.
- Gmail verification proves control of the Email address, but does not independently prove employment or ownership of the claimed Employee ID. This limitation is accepted for the MVP.
- All signed-in users can view all events and their attachments.
- Only the Meeting creator can edit/delete the event and manage its attachments.
- The owner may optionally add participant/guest Gmail addresses.
- A guest receives an Email reminder with a secure read-only link and can open it immediately without an account, sign-in, or OTP.
- LINE is an optional personal reminder channel connected after sign-in.
- The MVP must stay within free tiers and must never enable automatic paid overage.

---

# 2. Selected Technology Stack

## Frontend

- React + TypeScript + Vite
- Tailwind CSS
- FullCalendar
- React Router
- i18next for Thai/English UI
- React Hook Form + Zod for form validation
- Supabase JavaScript client

## Backend

- Supabase Auth: Email/Password, Confirm Email, password recovery, persistent sessions
- Supabase PostgreSQL: operational data and logs
- Supabase RLS: database authorization
- Supabase Storage: private `meeting-documents` bucket
- Supabase Edge Functions: privileged operations, guest access, notifications, LINE webhook, Admin actions
- Supabase Cron (`pg_cron` + `pg_net`): reminder, recurrence, cleanup, and log-retention jobs
- Supabase Vault: server-side secrets used by scheduled jobs

## External Free-Tier Services

- Brevo Free SMTP for Supabase confirmation/reset emails
- Brevo transactional Email API for meeting reminders
- LINE Official Account + Messaging API for personal reminders
- Google Apps Script + Google Sheets for hourly reporting sync
- Cloudflare Pages Free for frontend hosting

## Development and Quality

- ESLint + Prettier
- Vitest + React Testing Library
- Playwright for critical end-to-end flows
- Supabase SQL migrations and seed data
- RLS/security policy tests

---

# 3. High-Level Architecture

```text
Browser / Mobile Browser
        |
        v
Cloudflare Pages (React Web App)
        |
        +----------------------+
        |                      |
        v                      v
Supabase Auth             Supabase API
Email/Password            PostgreSQL + RLS
        |                      |
        |                      +--> Private Storage
        |                      |
        |                      +--> Edge Functions
        |                              |
        |                              +--> Brevo Email
        |                              +--> LINE Messaging API
        |                              +--> Guest read-only endpoint
        |
        +--> Brevo SMTP verification/reset Email

Supabase Cron
   +--> reminder processor every 5 minutes
   +--> recurring occurrence generator every day
   +--> expired-event cleanup every hour
   +--> 90-day log cleanup every day

Google Apps Script (hourly)
   +--> read reporting data from a restricted Supabase endpoint
   +--> write Users / Audit_Log / Notification_Log / System_Log sheets
```

---

# 4. Authentication Design

## Registration

1. Validate Full Name, Employee ID, Gmail, Password, and Confirm Password.
2. Normalize Gmail to lowercase and trim whitespace.
3. Reserve unique Employee ID and unique Gmail.
4. Create the Supabase Auth user with Email Confirmation enabled.
5. Create a linked profile containing no password data.
6. Send the confirmation link through Brevo SMTP.
7. Redirect the confirmed user to the sign-in page.

Password hashes and authentication credentials remain inside Supabase Auth. The application database never stores raw passwords or password hashes.

## Sign-in and Session

- Sign in with verified Gmail + Password.
- Supabase persists the session in the browser and refreshes access tokens.
- Unverified accounts cannot sign in.
- Sign out clears the Supabase and local application session.
- Password recovery sends a time-limited link to the registered Gmail.

## Abuse Protection

- CAPTCHA on registration, sign-in after repeated failures, and password recovery.
- Rate limits for registration, resend-confirmation, sign-in, and recovery.
- Generic errors where detailed errors would reveal whether an account exists.
- Employee ID and Email uniqueness enforced by database constraints, not only UI validation.

## Admin Reset

- Admin-only Edge Function performs the reset.
- Revoke active sessions.
- Trigger a verified password-reset/recovery flow.
- Preserve profile, Employee ID, LINE link, events, attachments, and logs.
- Record the action in Audit Log.

---

# 5. Data Model

## Core Tables

### `profiles`

- `id` UUID, references Auth user
- `employee_id` unique
- `full_name`
- `email` unique
- `email_verified_at`
- `line_user_id` nullable, unique
- `line_connected_at` nullable
- `role`: `user | admin`
- `ui_language`: `th | en`
- `status`: `active | disabled`
- timestamps

### `events`

Series master or one-time event definition:

- owner, title, description, location
- base start/end and all-day flag
- timezone, fixed to `Asia/Bangkok` in MVP
- recurrence rule and recurrence end condition
- status
- timestamps

### `event_occurrences`

Materialized occurrences used by the calendar, reminders, and retention:

- event/series ID
- occurrence start/end
- effective title/description/location
- override state
- status and purge time
- timestamps

A one-time event also has one occurrence. Recurring events are generated in a rolling 12-month window.

### `event_guests`

- event ID
- normalized guest Email
- active/revoked state
- timestamps

### `guest_tokens`

- guest and event/occurrence scope
- SHA-256 token hash only
- expiration and revocation timestamps
- last accessed timestamp

### `attachments`

- event/series/occurrence scope
- file metadata and private Storage path
- owner/uploader
- timestamps

### `reminders`

- occurrence ID
- offset value/unit
- Email/LINE channel flags
- scheduled time
- processing status
- idempotency key

### `notification_deliveries`

One row per recipient, channel, and reminder:

- recipient type and destination reference
- attempt count
- scheduled/sent timestamps
- queued, processing, sent, retry, failed, or skipped status
- provider response reference and sanitized error

### `audit_logs`

- actor, action, entity, metadata, and timestamp
- append-only through controlled database/server operations

### `system_logs`

- scheduled job name
- run ID, status, counts, sanitized error, and timestamp

---

# 6. Permission and RLS Model

## Authenticated Users

- Read active events and occurrences created by any active user.
- Read active Tasks created by any active user.
- Read attachment metadata and private files for visible events.
- Create events owned by themselves.
- Update/delete only their own events and occurrences.
- Upload/replace/delete only attachments belonging to their own events.
- Read/update only safe fields of their own profile.
- Cannot read Admin-only logs or secrets.

Task visibility rule:

- every active registered employee may view active Task details;
- only the Task creator may edit Task details or change the assignee;
- only the creator may update Task completion status; assigned employees may acknowledge their own assignment;
- Admin may read active Tasks; editing, deletion, and completion belong to the Task creator.

## Admin

- Read users, delivery status, and logs.
- Disable/reset accounts.
- Inspect and delete any event.
- Cannot retrieve raw passwords, service-role key, SMTP secret, or LINE token.

## Guests

- No database session and no direct database/storage access.
- Send the token to a guest Edge Function.
- The function hashes and validates the token, checks revocation/expiry, and returns only the scoped read-only event data.
- Attachment clicks receive short-lived signed Storage URLs generated server-side.
- Guest tokens cannot list other events or Storage objects.

---

# 7. Calendar and Recurrence

## Calendar Defaults

- Month view on desktop.
- Responsive list/month experience on small screens.
- Week starts Monday.
- 24-hour time.
- `Asia/Bangkok` timezone.
- All-day reminder reference time: 09:00.
- Event with no end time uses its start time as the effective end.
- Single-day all-day event ends at the end of that calendar day.

## Recurrence

- RFC 5545-style recurrence rules stored in the event master.
- Daily, weekdays, every N days, weekly selected weekdays, monthly by date, monthly by ordinal weekday, and yearly.
- End options: never, on date, or after N occurrences.
- For a monthly day that does not exist, skip that month.
- Generate occurrences 12 months ahead and extend the window daily.
- Single-occurrence edit creates/updates an occurrence override.
- Entire-series edit updates the master and rebuilds unsent future occurrences/reminders.
- Already-sent notification history is never rewritten.

---

# 8. Attachment Process

- Private bucket: `meeting-documents`.
- Up to 5 files per event, 10 MB per file.
- Allow PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, JPG/JPEG, and PNG.
- Validate extension, MIME type, size, and count before upload and again server-side where applicable.
- Use generated Storage paths rather than trusting the original file name.
- Authenticated users receive access through RLS-controlled downloads.
- Guests receive short-lived signed URLs only after guest-token validation.
- Cleanup deletes Storage objects through the Storage API before deleting attachment metadata.

---

# 9. Email and Guest Process

## Registered User Emails

- Supabase Auth confirmation and password-reset messages use Brevo SMTP.
- Meeting reminders use the Brevo transactional API from an Edge Function.

## Guest Reminder

1. Owner adds an optional participant Gmail.
2. System normalizes and stores the Email.
3. Each reminder produces an Email delivery for each active guest.
4. Email contains event summary and the guest's unique read-only link.
5. Clicking the link opens the event immediately without OTP or sign-in.
6. Attachment access uses short-lived signed URLs.
7. Removing the guest, deleting/cancelling the event, or automatic purge revokes the link.

Anyone receiving a forwarded guest link can open it. This tradeoff is documented in the UI near the guest field.

---

# 10. LINE Connection and Reminder Process

## One-Time Connection

1. Signed-in user opens Profile and selects `เชื่อมต่อ LINE`.
2. System creates a short-lived, single-use linking code.
3. UI shows the LINE OA QR code and a button/deep link that opens the Bot with the code.
4. User adds the Bot and sends/confirms the code.
5. LINE webhook receives the user's LINE User ID and linking code.
6. Server links that LINE User ID to the signed-in profile.
7. Bot sends the Thai welcome Flex Message.

This links LINE for notifications without using LINE as the application sign-in method.

## Sending

- Only registered users with a connected LINE account can receive LINE reminders.
- A guest Gmail that is not a registered, linked user receives Email only.
- Disconnected/blocked/quota-exhausted LINE delivery is skipped or failed with a specific log reason.
- Email continues if it was also selected and its quota is available.

---

# 11. Scheduled Jobs and Idempotency

## Reminder Processor — Every 5 Minutes

- Claim due delivery rows atomically.
- Use a unique idempotency key per reminder + recipient + channel.
- Send Email or LINE.
- Record success or schedule retries after 5, 15, and 30 minutes.
- Stop after three retries and expose failure to Admin.

## Occurrence Generator — Daily

- Maintain a rolling 12-month occurrence window.
- Avoid duplicates with unique occurrence constraints.
- Create reminder schedules for new occurrences.

## Event Cleanup — Hourly

- Find occurrences whose effective end was at least 72 hours ago.
- Delete occurrence-specific files and operational reminder jobs.
- Revoke guest access when the event/series is fully deleted.
- Remove event data when no retained occurrence remains.
- Preserve Audit and Notification Logs.

## Log Cleanup — Daily

- Delete Audit, Notification, and System Logs older than 90 days.
- Record aggregate cleanup results without recreating expired personal data.

## Google Sheets Sync — Hourly

- One-way reporting sync only.
- Incremental cursor based on timestamp plus stable ID.
- Sync Users, Audit Log, Notification Log, and System Log.
- Do not sync raw secrets, guest tokens, full attachment paths, or password-related data.

---

# 12. Free-Tier Guardrails

- No SMS integration.
- No automatic paid upgrade or overage.
- Admin dashboard shows Storage, Email, and LINE quota warnings where APIs expose usage.
- If one notification channel reaches quota, continue through the other selected channel.
- Attachment limits are enforced to protect the 1 GB Supabase Free Storage allowance.
- Purging after 72 hours reduces Storage growth.
- The UI clearly states when a free-provider limit prevents delivery.

Known operational limits:

- Free projects have no production uptime SLA and may be paused after inactivity.
- Supabase Free does not include automatic downloadable database backups.
- Free Email and LINE quotas can delay or prevent reminders during high volume.
- The system will be designed so providers can be upgraded later without changing the user workflow.

---

# 13. Implementation Phases

## Phase 1 — Project Foundation

- Scaffold React/TypeScript application.
- Configure Tailwind, routing, localization, linting, tests, and environment validation.
- Add local `.env.example`; never commit secrets.
- Create Supabase migration structure.

**Exit check:** app builds, tests run, Thai/English shell renders, and environment errors are understandable.

## Phase 2 — Database, Auth, and Security

- Create schema, enums, constraints, indexes, triggers, and seed Admin mechanism.
- Implement RLS and Storage policies.
- Build registration, Email confirmation callback, sign-in/out, recovery, and protected routes.
- Add CAPTCHA/rate-limit integration points.

**Exit check:** unverified users cannot sign in; normal users cannot mutate another user's data; secrets are server-only.

## Phase 3 — Calendar and Event CRUD

- Build responsive calendar and event detail/form dialogs.
- Implement one-time events, all-day, optional end, shared visibility, owner controls, search, and filters.

**Exit check:** all active users see events; only owner/Admin-authorized operations succeed at both UI and database layers.

## Phase 4 — Recurrence

- Add repeat UI and dynamic labels.
- Implement occurrence generation and single/series edit/delete.
- Add reminder recalculation behavior.

**Exit check:** recurrence edge cases and duplicate prevention pass automated tests.

## Phase 5 — Attachments and Guest Access

- Add private uploads and owner management.
- Add guest Emails, per-guest tokens, public read-only guest page, and signed attachment downloads.

**Exit check:** expired/revoked tokens fail; guests cannot enumerate data; attachment limits are enforced.

## Phase 6 — Email and LINE Notifications

- Configure Email templates and reminder sender.
- Build LINE linking webhook and Flex Messages.
- Implement retries, idempotency, logs, and quota failure handling.

**Exit check:** duplicate job execution does not duplicate delivery; failures follow the 5/15/30-minute policy.

## Phase 7 — Admin, Retention, and Reporting

- Build Admin users/events/logs/delivery screens.
- Implement account reset and event administration.
- Implement hourly cleanup, 90-day log cleanup, and Google Sheets sync.

**Exit check:** Admin operations are audited; files and guest links are removed during purge; reporting is one-way.

## Phase 8 — Hardening and Deployment

- Responsive and accessibility QA.
- Full end-to-end acceptance suite.
- Security review of RLS, guest tokens, file access, webhooks, and secrets.
- Production build and Cloudflare Pages deployment documentation.
- User/Admin setup guide.

**Exit check:** every PRD acceptance criterion has evidence from an automated test or documented manual test.

---

# 14. External Setup Needed During Implementation

The application can be scaffolded before these are available, but live integrations require:

- Supabase project URL and client-safe publishable/anon key
- server-side Supabase service-role secret stored only in function/platform secrets
- Brevo SMTP/API credentials and verified sender
- LINE OA Channel ID/Secret/Access Token and webhook configuration
- Google Sheet and Apps Script owner account
- organization logo and brand color values
- first Admin Employee ID/Gmail

Secrets must be entered into platform secret settings, never pasted into source files or committed to Git.

---

# 15. Approval Gate

Implementation starts only after the product owner explicitly approves this plan.

Approval phrase:

```text
อนุมัติแผน เริ่มพัฒนาได้
```
