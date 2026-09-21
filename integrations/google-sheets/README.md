# Google Sheets reporting

1. Create a Google Sheet and open **Extensions → Apps Script**.
2. Paste `Code.gs`, replace `YOUR_PROJECT_REF` and `SET_REPORTING_SYNC_SECRET_HERE`, then save.
3. Run `syncMeetingTaskCalendar` once to grant permission and create the four tabs.
4. Run `createHourlyTrigger` once to enable hourly sync.

Set `REPORTING_SYNC_SECRET` only as a Supabase Edge Function secret. The export deliberately omits guest tokens, recipient email addresses, attachment paths, passwords, and other secrets.
