# Google Sheets reporting

1. Create a Google Sheet and open **Extensions → Apps Script**.
2. Paste `Code.gs`, replace `YOUR_PROJECT_REF`, then save.
3. In **Project Settings → Script properties**, add `REPORTING_SYNC_SECRET` with the same value configured as the Supabase Edge Function secret.
4. Run `syncMeetingTaskCalendar` once to grant permission and create the four tabs.
5. Run `createHourlyTrigger` once to enable hourly sync.

Set `REPORTING_SYNC_SECRET` only as a Supabase Edge Function secret. The export deliberately omits guest tokens, recipient email addresses, attachment paths, passwords, and other secrets.

When updating an existing integration, replace the Apps Script with the current `Code.gs`; keep its endpoint and Script Properties. It follows every page in a fixed export window and updates rows by `id`, including delivery status changes. A failed or timed-out run keeps the previous cursor and can be retried without appending duplicate rows. Existing duplicate rows are retained and updated together; this upgrade does not delete historical spreadsheet data.

The endpoint continues accepting the previous timestamp cursor. Large responses also return a continuation in the `cursor` field, so older scripts can advance to the next page on their next run. Updating `Code.gs` is still required for immediate multi-page sync and updating existing delivery rows instead of appending them.
