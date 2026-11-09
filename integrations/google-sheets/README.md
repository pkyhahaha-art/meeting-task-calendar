# Google Sheets reporting

1. Create a Google Sheet and open **Extensions → Apps Script**.
2. Paste `Code.gs`, replace `YOUR_PROJECT_REF`, then save.
3. In **Project Settings → Script properties**, add `REPORTING_SYNC_SECRET` with the same value configured as the Supabase Edge Function secret.
4. Run `syncMeetingTaskCalendar` once to grant permission and create the four tabs.
5. Run `createHourlyTrigger` once to enable hourly sync.

Set `REPORTING_SYNC_SECRET` only as a Supabase Edge Function secret. The export deliberately omits guest tokens, recipient email addresses, attachment paths, passwords, and other secrets.

When updating an existing integration, replace the Apps Script with the current `Code.gs`; keep its endpoint and Script Properties. It follows every page in a fixed export window and updates rows by `id`, including delivery status changes. A failed or timed-out run keeps the previous cursor and can be retried without appending duplicate rows. Existing duplicate rows are retained and updated together; this upgrade does not delete historical spreadsheet data.

The endpoint continues accepting the previous timestamp cursor. Large responses also return a continuation in the `cursor` field, so older scripts can advance to the next page on their next run. Updating `Code.gs` is still required for immediate multi-page sync and updating existing delivery rows instead of appending them.


## Google Calendar appointment import

The bound Apps Script in production contains a separate `calendar.gs` that
resolves active calendars from `Calendar_Configs` and mirrors their monthly
appointments to `Meetings_From_Google`. Install `calendar-occurrences.sql` on
the project that already has the four-argument `sync_google_calendar_events`
RPC, then append `CalendarOccurrences.gs` to that bound script. It reuses
`CAL_SYNC_CONFIG`, `findCalendarAccount_`, `saveCalendarRowsMirror_`,
`formatCalendarDate_`, and `scanMySharedCalendars`.

Run `previewCalendarOccurrenceSync` first. It reads the actual snapshot and
rolls back all database changes. Once the counts are reviewed, replace the
body of `syncGoogleCalendarToSheet` with `return syncCalendarOccurrences_(false);`
to reuse the installed trigger. Use the existing Script Property for the
Supabase service key. The Google Calendar API must be available to the script;
the code uses the advanced Calendar service if enabled, or the existing
Google OAuth token for the REST API.

The import uses Bangkok month boundaries and submits only after all configured
calendars and pages have been read. A successful empty snapshot can remove
appointments. A failed or ambiguous snapshot leaves the database unchanged.
Each appointment uses a calendar-scoped Calendar API event ID. The migration
preserves the PEA row ID when an old iCalUID and appointment time can be matched
unambiguously.

Run the script fixtures with `node --test integrations/google-sheets/calendar-occurrences.test.cjs`.
