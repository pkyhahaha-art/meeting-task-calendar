# Google Sheets reporting

1. Create a Google Sheet and open **Extensions → Apps Script**.
2. Paste `Code.gs`, replace `YOUR_PROJECT_REF`, then save.
3. In **Project Settings → Script properties**, add `REPORTING_SYNC_SECRET` with the same value configured as the Supabase Edge Function secret.
4. Run `syncMeetingTaskCalendar` once to grant permission and create the four tabs.
5. Run `createHourlyTrigger` once to enable hourly sync.

Set `REPORTING_SYNC_SECRET` only as a Supabase Edge Function secret. The export deliberately omits guest tokens, recipient email addresses, attachment paths, passwords, and other secrets.
