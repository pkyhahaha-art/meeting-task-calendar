# Meeting Calendar & Reminder Web App

Internal shared calendar built with React, TypeScript, Tailwind CSS, FullCalendar, and Supabase.

## Current implementation

- Gmail/Password registration with confirmation link
- Persistent Supabase session, sign-out, and password recovery
- Protected application routes and disabled-account handling
- Shared month calendar
- Create, view, edit, and move meetings to 30-day Trash
- Private Tasks for creator, assignee, and Admin
- Internal/external Task assignment, completion, recurrence settings, reminders, files, and Google Drive links
- Meeting and Task layers in the same calendar
- UI ownership rules plus database-enforced RLS
- Initial schema for recurrence, guests, attachments, reminders, delivery logs, audit logs, and system logs
- Private Storage bucket policies

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

3. Apply every SQL file in `supabase/migrations` in filename order. If the first three migrations are already installed, run only `202609190004_tasks_and_retention.sql`.

4. In Supabase Auth, enable Email/Password and Confirm Email. For local development allow `http://127.0.0.1:5173/**`. GitHub Pages redirects use `/#/auth/callback` and `/#/reset-password`.

5. Configure a custom SMTP provider before production use.

6. Run:

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

## Security notes

- Never place a `service_role` key in `VITE_*` variables or frontend code.
- Guest tokens, privileged Admin actions, notification providers, and signed guest attachment URLs belong in Edge Functions.
- The current MVP registration verifies Gmail ownership but does not independently prove employment or ownership of the submitted Employee ID.
