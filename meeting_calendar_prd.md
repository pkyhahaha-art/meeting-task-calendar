# Product Requirements Document (PRD)
## Meeting Calendar & Reminder Web App

**Version:** 1.2 Draft  
**Status:** Ready for Agent Review / Pre-Implementation Clarification  
**Primary Backend:** Supabase  
**Primary UI:** Responsive Web App  
**Primary Users:** Internal employees (~50 users)

---

> ## MANDATORY INSTRUCTION FOR AI / CODING AGENT
>
> **GRILL ME FIRST.**
>
> Read this PRD completely before coding.
>
> Before implementation, ask only the remaining high-impact clarification questions that materially affect:
> - architecture
> - authentication
> - permissions
> - recurrence behavior
> - notification behavior
> - file handling
> - admin controls
> - retention
> - deployment
>
> Do **not** re-ask questions already answered in this PRD.
>
> Do **not** begin implementation until:
> 1. remaining questions are answered,
> 2. you summarize the final implementation plan,
> 3. I explicitly approve the plan.
>
> If a minor implementation detail is not specified and does not affect product behavior, choose a reasonable default and document it instead of asking unnecessary questions.

---

# 1. Product Summary

Build a modern internal **Meeting Calendar Web App** inspired by Google Calendar.

The system is intended for approximately **50 internal employees**.

Users should be able to:

- register with Full Name + Employee ID + Gmail + Password
- confirm the registration through a verification link sent to Gmail
- sign in with verified Gmail + Password
- remain signed in on the same browser until they sign out
- view all meetings/events created by all users
- create and manage their own events
- view, but not edit, events created by others
- attach meeting documents
- set multiple reminders
- receive reminders by Email/Gmail and/or LINE
- create recurring events
- create personal Tasks or assign Tasks to a registered employee or external Email assignee
- optionally link follow-up Tasks to a Meeting/Event
- mark assigned Tasks as completed without deleting their history
- share event details and attachments with email guests
- use Thai or English UI
- retain logs for audit purposes

The product should feel:

- professional
- modern
- calm and easy to use
- corporate
- not cluttered
- optimized for desktop and mobile

---

# 2. Product Goals

## 2.1 Primary Goals

1. Provide a shared organizational calendar for meetings.
2. Allow every employee to see all scheduled events.
3. Allow only the event owner to edit/delete their own event.
4. Support meeting reminders through Email and LINE.
5. Support file attachments with secure access.
6. Support recurring events similar to Google Calendar.
7. Operate the MVP using free-tier services only, with no paid SMS service or automatic paid overage.
8. Keep the system simple enough for a small internal user base.
9. Separate Meetings from Tasks while allowing optional follow-up links between them.
10. Preserve completed Task history without cluttering the active calendar.

## 2.2 Secondary Goals

- provide Admin visibility into users, logs, and account state
- synchronize reporting/log data to Google Sheets
- preserve past Meetings as searchable history while cleaning up only items intentionally moved to Trash
- support guest access through secure event links

---

# 3. Non-Goals / Out of Scope for MVP

The following are not required unless explicitly added later:

- LINE Mini App
- LINE Group notification
- meeting room reservation enforcement
- attendance tracking
- meeting minutes workflow
- approval workflow
- department-level permissions
- Google Calendar two-way sync
- public calendar
- chat/comment system
- Task subtasks/checklists
- complex role hierarchy beyond User/Admin

---

# 4. Target Users

## 4.1 User Population

Approximately **50 internal employees**.

## 4.2 User Types

### Standard User

Can:

- sign in
- view all events
- view all event attachments
- create events
- edit/delete own events
- configure reminders
- connect LINE
- use the verified Gmail registered with the account
- create recurring events
- create Tasks for themselves or assign Tasks to a registered employee or external Email assignee
- update completion status of Tasks assigned to them
- view completed Task history according to the final visibility policy

Cannot:

- edit/delete events owned by other users
- reset other users
- access Admin-only logs and controls

### Admin

Can:

- view all users
- reset user accounts
- force sign-out on reset
- view Audit Logs
- view Notification Logs
- view System Logs
- delete other users' events
- view Email verification status
- view LINE connection status
- review send success/failure status
- inspect and administratively remove Tasks when required

Admin must not be able to view sensitive secrets in plain text.

---

# 5. Authentication & Identity

## 5.1 Primary Identity

The system should treat the user profile as the canonical account.

The profile should be anchored by:

- internal Profile/User ID
- Employee ID

Gmail is the authentication identity. LINE User ID is a linked notification channel, not a separate account.

## 5.2 Registration

Users must create an account before signing in.

Required registration fields:

- Full Name
- Employee ID
- Gmail address
- Password
- Confirm Password

Flow:

```text
Enter Full Name + Employee ID + Gmail + Password
→ Validate fields and confirm that Employee ID and Gmail are not already registered
→ Create an unverified Supabase Auth account
→ Send a verification link to Gmail
→ User clicks the verification link
→ Mark Email as verified
→ Allow Sign In
```

Registration does not require a preloaded employee master list or individual Admin approval.

Known MVP limitation:

- Gmail verification proves control of the Email address but does not independently prove employment or ownership of the claimed Employee ID.
- Employee ID must be unique and is assigned to the first verified account that registers it.
- Admin may reset or disable an account if an Employee ID is claimed incorrectly.

## 5.3 Sign In and Password Recovery

Flow:

```text
Verified Gmail
+
Password
→ Sign In
→ Create/Restore persistent session
```

Users who forget their password may request a password-reset link sent to their verified Gmail.

SMS OTP, Google Login, and LINE Login are not used in the MVP. LINE remains a notification channel that users may connect after signing in.

## 5.4 Persistent Session

After successful login:

- browser should remember the session
- user should be able to reopen the Web App without signing in again
- session persists until:
  - user signs out
  - Admin resets account
  - session is explicitly revoked
  - browser data/session is cleared
  - security policy invalidates the session

Use Supabase session persistence rather than inventing a custom insecure cookie system.

## 5.5 Gmail Verification Rules

- account access is disabled until the Gmail verification link has been opened successfully
- Email notification is available after Gmail verification
- changing the registered Gmail requires a controlled verification flow
- password reset links are sent only to the registered Gmail

## 5.6 Reset Account

Admin Reset Account must:

- sign user out immediately from all active sessions/devices
- reset/revoke authentication linkage as required
- preserve:
  - Employee ID
  - LINE User ID
  - events
  - attachments
  - calendar data
  - profile history
- allow the user to set a new password through a verified password-reset flow afterward

Admin Reset Account must **not disconnect LINE**.

---

# 6. Profile

Suggested profile fields:

- id
- employee_id
- full_name
- email
- email_verified
- line_user_id
- line_connected
- preferred_ui_language
- role
- status
- created_at
- updated_at

Users may:

- request a verified Gmail change through a controlled flow
- connect/disconnect LINE
- switch UI language

Changing an already-linked identity should require Admin Reset or a controlled verified flow.

---

# 7. Calendar Experience

## 7.1 Calendar Style

Use Google Calendar as the UX reference.

Do not copy every Google Calendar feature.

## 7.2 Visibility

All users can:

- see all events from all users
- open event details
- view event attachments

Only the event owner can:

- edit
- delete
- replace attachments
- modify recurrence
- modify reminders

Admin can delete any event.

## 7.3 Week Start

Calendar week starts on **Monday**.

## 7.4 Date Format

Thai UI:

```text
30 ก.ย. 2026
```

English UI:

```text
30 Sep 2026
```

Database values should still use ISO date/time formats.

## 7.5 Time Format

Use **24-hour time**.

Examples:

```text
09:30
16:00
```

## 7.6 Task Display on Calendar

- show a timed Task at its due-time position on the calendar
- show a Task with a due date but no due time in the all-day row
- display a checkbox and a visually distinct Task icon/style
- show only Tasks for which the current user is the creator or internal assignee; Admin may view Tasks through authorized Admin views
- external assignees do not have calendar access
- provide a calendar-layer toggle to show or hide Tasks
- hide completed Tasks by default
- provide `Show completed Tasks` as an optional view setting
- completing a Task updates its calendar appearance immediately
- Meetings and Tasks remain visually distinguishable even when displayed on the same calendar

---

# 8. Meeting/Event and Task Models

The product has two distinct primary objects:

- **Meeting/Event** for scheduled meetings, participants, locations, recurrence, and attachments
- **Task** for work that must be completed, assigned, tracked, and closed

Meetings and Tasks may be linked, but the link is optional.

## 8.1 Required Event Fields

- Event ID
- Owner User ID
- Title
- Start Date
- Start Time
- End Date (optional)
- End Time (optional)
- All-day flag
- Location / Meeting Room
- Description / Work Details
- Recurrence Rule
- Reminder configuration
- Email notification setting
- LINE notification setting
- Created At
- Updated At

## 8.2 Description

Use one resizable multiline textarea.

It should support:

- long text
- multiple lines
- manual resize where appropriate
- readable formatting

## 8.3 Location

Location / Meeting Room is a free-text field.

## 8.4 Start / End Behavior

Start date is required.

Start time is required unless All-day is enabled.

End date is optional.

End time is optional.

If event spans multiple days:

- calendar displays a continuous event bar/timeline from start to end
- event color should remain visually consistent across the range

Reminder timing is calculated from the **event start date/time**.

## 8.5 Task Model

A Task may be created as a standalone item or as follow-up work from a Meeting/Event.

Task and Meeting/Event remain separate records even when linked.

## 8.6 Required Task Fields

- Task ID
- Creator User ID
- Assignee Type (`INTERNAL` or `EXTERNAL`)
- Assignee User ID (required for internal assignee)
- External Assignee Email (required for external assignee)
- Linked Event ID (optional)
- Title
- Description (optional)
- Due Date
- Due Time (optional)
- Status
- Reminder configuration
- Email notification setting
- LINE notification setting
- Completed At (optional)
- Deleted At (optional)
- Created At
- Updated At
- Recurrence Rule (optional)
- Recurrence Series ID (optional)

## 8.7 Task Assignment and Ownership

- a user may create a Task for themselves
- a user may assign a Task to another registered employee
- a user may assign a Task to an external Gmail address that does not have a system account
- only one assignee is required per Task in the MVP
- the Task becomes active immediately after it is saved successfully
- the assignee does not need to accept or reject the assignment
- a Task is visible only to its creator, its assignee, and Admin
- the Task creator controls the Task details and may change the assignee
- the assignee may mark the Task completed or reopen it
- the creator may also mark the Task completed or reopen it
- Admin may administratively remove a Task

### External Assignee

An external assignee is an Email address that does not currently belong to a verified system account.

External assignee behavior:

- receives Task messages through Gmail only
- does not have access to the application calendar
- does not have access to other Meetings, Tasks, employees, or Admin pages
- opens only the assigned Task through a unique secure link
- may view that Task's details and authorized attachments
- may mark that Task completed only after a confirmation step
- completing the Task immediately notifies the Task creator
- cannot connect or receive LINE notifications without a registered system profile
- if the same Gmail later becomes a verified system account, existing assigned Tasks may be linked to that account after verified-email matching

## 8.8 Meeting and Task Relationship

- one Meeting/Event may have multiple linked follow-up Tasks
- one Task may link to zero or one source Meeting/Event
- the Meeting detail view shows linked Tasks and completion progress, such as `2/5 completed`, only when the current user is authorized to read those Tasks
- users who can view the Meeting but are unrelated to its linked Tasks must not see Task titles, details, counts, or status
- the Task detail view provides a link back to its source Meeting/Event when available
- changing the Meeting date/time does not automatically change Task due dates
- deleting a Meeting does not automatically delete its linked Tasks
- if the source Meeting no longer exists, the Task remains and indicates that its source Meeting was removed

## 8.9 Task Completion and History

- active Tasks use status `PENDING`
- completed Tasks use status `COMPLETED`
- completing a Task records `completed_at`
- completed Tasks are not automatically deleted
- completed Tasks are hidden from the default active view
- users may enable `Show completed Tasks` to view history
- completing a Task cancels all of its remaining unsent reminders
- reopening a Task may recreate only future reminders based on its current due date/time

## 8.10 Task Deletion

- normal user deletion uses soft delete by setting `deleted_at`
- when the creator deletes/cancels a Task, notify the current assignee immediately
- internal assignee receives the cancellation through Gmail and LINE when connected
- external assignee receives the cancellation through Gmail only
- cancellation notification includes Task title, creator name, and cancellation status without a usable Task link
- cancel all remaining unsent reminders immediately
- revoke any external Task token immediately
- soft-deleted Tasks remain in Trash for 30 days
- after 30 days in Trash, the Task may be permanently deleted automatically
- Task completion is not the same as deletion
- Audit Logs remain subject to the general log-retention policy

## 8.11 Recurring Tasks

Task recurrence is optional.

Supported patterns:

- daily
- every weekday
- weekly on selected weekday(s)
- monthly
- yearly
- custom every N days, weeks, months, or years
- optional recurrence end date

Recurring Task behavior:

- show only the current active occurrence by default
- create the next occurrence only after the current occurrence is completed
- calculate the next due date from the recurrence rule, not from the actual completion date
- do not create overlapping overdue occurrences while the current occurrence remains incomplete
- copy title, description, assignee, linked Meeting when still valid, documents/Drive links, and reminder configuration to the next occurrence
- send the normal assignment notification when the next occurrence is created
- each occurrence has its own completion status and Notification Logs
- completing one occurrence does not mark the entire series completed
- ending the series prevents creation of future occurrences but preserves completed history
- for an external assignee, issue a new scoped token and Email for each new occurrence

### Edit Recurring Task

Provide two choices:

- `Edit this occurrence`
- `Edit entire series`

If editing only this occurrence:

- update only the current active occurrence
- keep the series template unchanged
- the next occurrence returns to the series template values
- recalculate reminders only for the current occurrence

If editing the entire series:

- update the current active occurrence and the template used for future occurrences
- do not modify completed historical occurrences
- recalculate reminders for the current occurrence
- future occurrences use the updated title, description, assignee, documents, due-time pattern, reminders, and recurrence rule

### Delete Recurring Task

Provide two choices:

- `Delete this occurrence`
- `Delete entire series`

If deleting only this occurrence:

- soft-delete the current occurrence into Trash
- cancel its unsent reminders and revoke its external token
- preserve its Audit and Notification Logs
- advance the series to the next scheduled occurrence

If deleting the entire series:

- soft-delete the current occurrence into Trash
- stop the recurrence series and prevent future occurrences
- cancel unsent reminders and revoke external tokens
- preserve completed historical occurrences and logs
- permanently delete the soft-deleted current occurrence after 30 days if not restored

---

# 9. All-Day Events

Support an **All-day** option similar to Google Calendar.

When enabled:

- time inputs may be hidden/disabled
- event is displayed as an all-day calendar event
- reminders should still calculate relative to event start according to final default time policy

---

# 10. Recurring Events

## 10.1 Repeat Options

Repeat options should dynamically adapt to the selected start date.

Example concept:

```text
ไม่เกิดซ้ำ
รายวัน
รายสัปดาห์ ใน วันอังคาร
รายเดือน ตามตำแหน่งวันในเดือน
รายปี ในวันที่ที่เลือก
ทุกวันธรรมดา
กำหนดเอง...
```

The wording should adapt to the chosen start date.

## 10.2 Custom Repeat

Should support reasonable patterns such as:

- every N days
- every N weeks
- selected weekdays
- monthly
- yearly
- custom end condition

## 10.3 Edit Recurring Event

Only 2 options are required:

- แก้เฉพาะครั้งนี้
- แก้ทั้งชุด

### Edit Single Occurrence

If selecting "แก้เฉพาะครั้งนี้":

- only that occurrence is changed
- reminders recalculate only for that occurrence
- other occurrences remain unchanged
- attachment changes apply only to that occurrence

### Edit Entire Series

If selecting "แก้ทั้งชุด":

- update all occurrences still present in the database
- includes past occurrences retained in Meeting history
- update recurrence-related data
- attachment replacement applies to the entire series

## 10.4 Delete Recurring Event

Only 2 options are required:

- ลบเฉพาะครั้งนี้
- ลบทั้งชุด

### Delete Single Occurrence

- remove occurrence from calendar immediately
- record a soft-deleted occurrence override in Trash
- cancel its future reminders
- keep Audit Log
- retain occurrence-specific attachments during the 30-day Trash period
- permanently delete occurrence-specific attachments if the occurrence is not restored within 30 days

### Delete Entire Series

- remove all series occurrences from the active calendar immediately
- soft-delete both future and past occurrences into Trash
- cancel all future reminders
- retain series attachments during the 30-day Trash period
- permanently delete the series and attachments if not restored within 30 days
- keep Audit Log

---

# 11. Event Attachments

Meeting/Event and Task both support two document sources:

- file upload to Supabase Storage
- Google Drive / Google Workspace document link

## 11.1 Storage

Use **Supabase Storage**.

Recommended bucket:

```text
meeting-documents
```

Bucket should be private.

## 11.2 Attachment Limits

Per Meeting/Event or Task:

1. multiple files allowed
2. maximum **10 MB per file**
3. maximum **5 files per Event**
4. supported:
   - PDF
   - DOC / DOCX
   - XLS / XLSX
   - PPT / PPTX
   - JPG / JPEG
   - PNG
5. validate before upload
6. show clear error if file is too large or unsupported

## 11.3 Google Drive Document Links

The document section provides two actions:

- `Upload file`
- `Add Google Drive link`

Drive-link behavior:

- creator enters a display name and pastes a Google Drive or Google Workspace document URL
- accept supported URLs from Google Drive, Docs, Sheets, and Slides
- store only the display name and URL; do not copy the Drive file
- allow up to 10 Drive links per Meeting/Event or Task
- open links in a new browser tab
- do not use Google Drive API, Google OAuth, or Apps Script for MVP document links
- the creator is responsible for granting Drive access to the intended Gmail addresses
- recommend sharing to specific recipient Gmail addresses instead of `Anyone with the link`
- the application cannot guarantee or automatically verify Drive permissions in the MVP
- removing the link or permanently deleting the Meeting/Task removes only the saved URL from this application
- never delete or modify the original file in Google Drive

## 11.4 Attachment and Document-Link Access

All authenticated users may:

- view/open/download Meeting documents according to Meeting visibility rules

Only owner may:

- upload, replace, or delete Meeting documents and Drive links

For Task documents:

- Task creator may upload, replace, or delete files and Drive links
- internal Task assignee may view, open, and download
- external Task assignee may view, open, and download only through the valid Task link
- internal and external assignees cannot upload, replace, or delete Task documents in the MVP
- access to a Drive link still depends on permissions configured by the Drive file owner

## 11.5 Recurring Event Attachments

Default:

- recurring series shares one attachment set

If "แก้เฉพาะครั้งนี้":

- occurrence may have its own attachment changes

If "แก้ทั้งชุด":

- new attachment set replaces the series attachment set

---

# 12. Email Guests

Event owner may add external or internal Email addresses as guests.

Guests do not need to be registered system users.

## 12.1 Guest Notification

Guests receive Email reminders.

## 12.2 Guest Link

Email should include a secure read-only guest link.

The guest can open the link and view the event immediately without registering, signing in, or entering an Email OTP.

Security behavior:

- generate a unique, cryptographically random token for each guest Email
- store only the token hash in the database
- do not expose guest pages to search engine indexing
- revoke the token when the guest is removed or the event is deleted
- anyone possessing a forwarded guest link may open it; this is an accepted usability tradeoff for the MVP

Guest can:

- view event details
- view authorized attachments

Guest cannot:

- edit event
- delete event
- alter reminders
- modify attachments

## 12.3 Guest Link Expiry

Past Meetings are retained, so a guest link is not deleted merely because the Meeting has ended.

- expire the guest link automatically 30 days after the Meeting end date/time
- for a Meeting without an end date/time, calculate expiry from its start date/time
- the Meeting owner may issue and Email a new guest link after expiry when continued access is required
- revoke the guest link immediately when the guest is removed
- revoke the guest link immediately when the Meeting is cancelled or moved to Trash
- if a Meeting is restored from Trash, issue new guest tokens rather than restoring revoked tokens

---

# 13. Reminder System

## 13.1 Multiple Reminder Offsets

One Event may have multiple reminder timings.

Examples:

- 1 month before
- 1 week before
- 3 days before
- 1 day before

Custom reminder may be added later if practical.

## 13.2 Reminder Reference

All reminder offsets calculate from:

**Event Start Date/Time**

## 13.3 Channels

Owner may choose:

- Email only
- LINE only
- Email + LINE
- none

If both Email and LINE are selected:

- every selected reminder offset sends through both channels

Example:

```text
3 days before → Email + LINE
1 day before  → Email + LINE
```

## 13.4 Reminder Recalculation

If event start date/time changes:

- cancel old unsent reminders
- recalculate all future reminders automatically
- do not resend reminders already sent
- keep sent logs

For single occurrence edit:

- recalculate only that occurrence

For series edit:

- recalculate affected series reminders accordingly

## 13.5 Event Cancellation / Delete

If event is manually deleted/cancelled:

- remove from calendar immediately
- cancel all unsent reminders
- move the event to Trash using soft delete
- retain attachments during the 30-day Trash period
- invalidate guest links
- keep Audit Log

If the event is restored from Trash:

- restore it to the calendar
- do not resend reminder occurrences whose scheduled time has already passed
- issue new guest tokens when guest access is required

When the 30-day Trash period ends:

- permanently delete the event and its recurrence data
- permanently delete its attachments and attachment metadata
- permanently remove operational notification jobs

## 13.6 Task Reminders

Task reminders calculate from the Task due date/time.

Supported MVP reminder choices:

- at the due time
- 1 hour before
- 1 day before (default)
- 3 days before
- when overdue

The creator may select Email, LINE, both, or none according to the assignee's available notification channels.

### Assignment Notifications

When a Task is assigned to another employee:

- notify the new assignee immediately after the Task is saved successfully
- send by Email/Gmail
- also send by LINE when an internal assignee has connected LINE
- external assignees receive Gmail only
- include Task title, creator name, description summary, due date/time, and a secure link to open the Task
- when the assignee changes, notify the new assignee immediately
- when the assignee changes, immediately notify the previous assignee that they were removed from the Task
- remove the previous internal assignee's Task access immediately
- revoke the previous external assignee's Task token immediately
- notify a previous internal assignee by Gmail and LINE when connected
- notify a previous external assignee by Gmail only
- include Task title and creator name in the removal notification, but do not include a usable Task link after access is revoked
- do not send an assignment notification for a self-assigned Task
- record every delivery attempt and result in Notification Logs

### Task Update Notifications

After the creator saves an important Task change, notify the current assignee immediately.

Important changes include:

- title
- description or work instructions
- due date or due time
- linked source Meeting
- document upload, removal, or Google Drive link change

Notification behavior:

- internal assignee receives Gmail and LINE when connected
- external assignee receives Gmail only
- include a concise summary of what changed and a link to the Task
- combine all fields changed in one save operation into one notification per channel
- minor formatting or typo-only edits do not require a notification when no material Task information changes
- recalculate unsent reminders when the due date/time changes
- record delivery attempts and results in Notification Logs

### External Task Link

- generate a unique cryptographically random token for each external Task assignment
- store only the token hash in the database
- scope the token to exactly one Task
- allow read-only access to Task details and authorized attachments
- allow only the specific `mark completed` action after an explicit confirmation screen
- do not expose the external Task page to search engine indexing
- revoke the token when the external assignee changes or the Task is permanently deleted
- keep the token valid while the Task remains active
- after the Task is completed, keep the token available for 30 days and then expire it automatically
- revoke the token immediately when the assignee changes or the Task is deleted, including soft delete
- if the creator reopens the Task before token expiry, the same valid assignment link may become active again
- if the Task is reopened after token expiry, issue a new token and send a new assignment Email
- possession of a forwarded link may allow another person to view or complete the Task; this is an accepted usability tradeoff for the MVP

If no due time is supplied, use **09:00 local time (Asia/Bangkok)** as the Task reminder reference time.

When a Task is completed:

- cancel all remaining unsent Task reminders
- keep already-sent Notification Logs
- notify the Task creator once by Email/Gmail
- also notify the Task creator by LINE when the creator has connected LINE
- if the creator and assignee are the same user, do not send a duplicate completion notification
- record completion-notification success or failure in Notification Logs

When a completed Task is reopened:

- recreate only reminder occurrences that are still in the future
- do not resend reminders whose scheduled time has already passed

### Overdue Task Notifications

A Task is overdue when its due date/time has passed and it is still `PENDING`.

For an overdue Task:

- notify both the assignee and the Task creator
- send at **09:00 local time (Asia/Bangkok)**
- send once per day
- send for a maximum of 3 days
- use Email/Gmail and LINE when each recipient has the corresponding channel available
- stop overdue notifications immediately when the Task is completed, rescheduled to a future due date/time, soft-deleted, or permanently deleted
- if creator and assignee are the same user, send only one notification per channel per day
- record every delivery attempt and result in Notification Logs

---

# 14. LINE Integration

## 14.1 Scope

LINE is used for **personal notification only**.

Do not support LINE Group notification in MVP.

## 14.2 LINE Bot

Use one LINE OA/Bot for the whole system.

Each user may:

- Add Friend via QR
- connect their LINE User ID to their profile

## 14.3 LINE Connection Flow

From Web App:

```text
User clicks "เชื่อม LINE"
→ if not friend yet, show QR / Add Friend option
→ user adds Bot
→ system links LINE User ID to current profile
→ show popup "เชื่อมต่อสำเร็จ"
→ LINE Bot sends welcome Flex Message
```

## 14.4 LINE Welcome Flex Message

After successful linking, Bot sends Thai Flex Message containing:

- connection success
- user name
- employee ID
- short explanation that this LINE will receive meeting reminders
- optional button to open Web App

## 14.5 Disconnect LINE

If user disconnects LINE:

- remove LINE User ID from profile
- disable LINE notification
- preserve all events
- preserve Email
- preserve logs

If an event expects LINE notification while LINE is disconnected:

- skip LINE send
- log the issue

## 14.6 LINE Notification Language

LINE notifications are **Thai only**.

---

# 15. Email Notification

Email notifications are **Thai only**.

## 15.1 Provider

Use **Brevo Free** as the MVP transactional Email and custom SMTP provider.

- configure Brevo custom SMTP for Supabase Auth Email
- send application notifications through a server-side Edge Function/provider API or SMTP
- never expose Brevo credentials in frontend code, Google Sheets, or Apps Script cells
- do not attach a paid plan or enable automatic paid overage
- treat the current free allowance as a maximum of 300 Email sends per day, subject to provider policy changes
- make the daily limit configurable without a code deployment

## 15.2 Sender Identity Without Organizational DNS

The organization has its own domain, but this application must operate without changing or depending on organizational DNS.

- do not request organizational domain credentials or DNS changes for the MVP
- use the compliant Brevo-managed sender domain/address that Brevo provides or substitutes for an unauthenticated free sender
- use a clear From display name such as the team or application name
- configure a dedicated team Gmail address as the monitored Reply-To address
- keep Brevo SMTP/API credentials only in Supabase server-side secrets
- accept that the visible sender address may use a Brevo domain and may look less organizationally branded
- test delivery to Gmail and spam folders before launch
- allow migration to an authenticated organizational subdomain later as an optional enhancement, not an MVP dependency

Email should contain:

- event title
- start date/time
- end date/time if present
- location
- description summary
- reminder timing context
- guest/event detail link
- attachment links where appropriate

The account Gmail is verified during registration, so Email notification is available to every active registered user.

Use a production-capable free-tier SMTP provider. The application must monitor provider quotas and must not automatically incur paid overage.

## 15.3 Email Quota Policy

- warn Admin when daily usage reaches 80% of the configured allowance
- prioritize account verification and password-reset Email over ordinary reminders
- prioritize assignment, cancellation, and security-related Email over non-urgent reminder Email
- when the free quota is exhausted, mark non-critical messages `DEFERRED_QUOTA`
- retry deferred messages on the next quota day only when they are still relevant
- do not send stale reminders after their usefulness has passed
- continue LINE delivery when selected and available even if Email is deferred
- record quota deferral, retry, success, and failure in Notification Logs
- show current daily usage and remaining allowance in the Admin delivery-status view

---

# 16. Retry Policy

If Email or LINE sending fails:

Retry automatically:

1. retry after 5 minutes
2. retry after 15 minutes
3. retry after 30 minutes

Maximum retries: **3**

If still failing:

- mark notification as `FAILED`
- write error to Notification Log
- sync failure to Google Sheets
- make failure visible to Admin

If a free-tier Email or LINE quota is exhausted:

- do not purchase or trigger paid overage automatically
- mark the affected delivery as deferred or failed with a quota-specific reason
- continue sending through any other selected channel that still has available quota
- show current quota/usage information to Admin where the provider API makes it available
- never automatically upgrade Brevo, purchase credits, or enable paid overage

---

# 17. Meeting, Task, and Log Retention

## 17.1 Past Meeting History

When event ends:

- retain the Meeting/Event as history
- display past Meetings with a visually faded style
- do not treat a past Meeting as a completed Task
- do not automatically delete the Meeting or its attachments
- keep linked Tasks connected to the source Meeting

## 17.2 Meeting Trash and Permanent Deletion

When an owner or Admin deletes a Meeting:

- move the Meeting to Trash using soft delete
- remove it from the active calendar immediately
- cancel unsent reminders
- revoke guest links immediately
- retain the Meeting and its attachments in Trash for 30 days
- allow restore during the 30-day Trash period

After 30 days in Trash, permanently delete:

- Meeting/Event record
- recurrence occurrence data tied to the Meeting
- operational notification jobs
- attachments from Supabase Storage
- attachment metadata
- guest link/token records

Permanent Meeting deletion must not delete:

- User Profile
- Email
- LINE User ID
- unrelated Meetings
- linked Tasks
- Audit Log
- Notification Log

## 17.3 Logs Retention

Audit Log and Notification Log are retained for:

**90 days**

After 90 days:

- auto-delete old logs

## 17.4 Task Retention

- completed Tasks are retained as work history
- completed Tasks are hidden from the active view by default, not deleted
- a completed Task may be reopened
- deleted Tasks remain in Trash for 30 days
- permanently delete Tasks after 30 days in Trash
- Task attachments, if added later, must follow the Task's permanent-deletion lifecycle

---

# 18. Audit Logging

Recommended audit actions:

- LOGIN_SUCCESS
- LOGIN_FAILED
- EMAIL_VERIFICATION_SENT
- EMAIL_VERIFIED
- PASSWORD_RESET_REQUESTED
- ACCOUNT_RESET
- SESSION_REVOKED
- LINE_CONNECTED
- LINE_DISCONNECTED
- EVENT_CREATED
- EVENT_UPDATED
- EVENT_DELETED
- SERIES_UPDATED
- SERIES_DELETED
- OCCURRENCE_UPDATED
- OCCURRENCE_DELETED
- ATTACHMENT_UPLOADED
- ATTACHMENT_REPLACED
- ATTACHMENT_DELETED
- EMAIL_SENT
- EMAIL_FAILED
- LINE_SENT
- LINE_FAILED
- AUTO_PURGE
- ADMIN_DELETE
- TASK_CREATED
- TASK_UPDATED
- TASK_ASSIGNED
- TASK_EXTERNAL_LINK_OPENED
- TASK_EXTERNAL_COMPLETION_CONFIRMED
- TASK_COMPLETED
- TASK_COMPLETION_NOTIFICATION_SENT
- TASK_COMPLETION_NOTIFICATION_FAILED
- TASK_REOPENED
- TASK_SOFT_DELETED
- TASK_RESTORED
- TASK_PURGED

Audit Logs retained for 90 days.

---

# 19. Google Sheets Sync

Supabase is the primary source of truth.

Google Sheets is for reporting/log visibility only.

## 19.1 Sync Direction

```text
Supabase → Google Sheets
```

One-way only.

Do not push Sheet edits back into Supabase.

## 19.2 Sync Frequency

Every **1 hour**.

Use incremental sync.

## 19.3 Suggested Sheets

- Users
- Audit_Log
- Notification_Log
- System_Log

Optional summary sheets may be added later.

## 19.4 Events

Do not sync full event operational data by default.

If needed, sync only summary/reporting data.

---

# 20. Admin Console

Admin area should include:

## Users

- list all users
- search users
- view Employee ID
- view Email status
- view LINE connection status
- view account status
- Reset Account

## Logs

- Audit Log
- Notification Log
- System Log
- filter by user/date/status/channel

## Event Administration

- search all events
- inspect event details
- delete any event
- view owner

## Task Administration

- search Tasks
- inspect Task details, creator, and assignee
- filter by status and due date
- administratively remove a Task

## Delivery Status

- Email success/failure
- LINE success/failure
- retry state
- last error

---

# 21. Google Sheets Reporting

Admin should be able to inspect synchronized reports without modifying application state.

Sheets are read/report oriented.

Possible use cases:

- operational review
- simple reporting
- audit review
- notification delivery checks

---

# 22. UI / UX

## 22.1 Visual Direction

Corporate modern style:

- professional
- comfortable
- clean
- calm
- minimal clutter
- modern but not flashy
- strong information hierarchy
- calendar-centered

Use organizational branding as accent rather than heavy full-screen colors.

## 22.2 Components

Use:

- clear navigation
- modern cards
- modal/dialog forms
- responsive calendar
- resizable textarea
- loading states
- success/error toasts
- confirmation dialogs
- clear disabled states
- concise helper text

## 22.3 Responsive Design

Support:

- Desktop
- Tablet
- Mobile

Mobile experience must remain usable without horizontal scrolling.

---

# 23. Localization

UI supports:

- ไทย
- English

User can switch language.

Remember selected UI language.

The following remain Thai-only:

- Email notification
- LINE notification

User-generated content is not auto-translated.

---

# 24. Supabase Architecture

Use Supabase for:

- Auth
- PostgreSQL
- RLS
- Storage
- session management
- server-side logic where practical
- scheduled processing
- secure API operations

Possible supporting services:

- Edge Functions
- Cron / pg_cron
- external SMTP/email provider

---

# 25. Suggested Database Tables

## `profiles`

- id
- employee_id
- full_name
- email
- email_verified
- line_user_id
- line_connected
- role
- ui_language
- status
- created_at
- updated_at

## `events`

- id
- owner_user_id
- title
- description
- start_datetime
- end_datetime
- all_day
- location
- recurrence_rule
- recurrence_series_id
- status
- created_at
- updated_at
- deleted_at (nullable)

## `tasks`

- id
- creator_user_id
- assignee_type
- assignee_user_id (nullable)
- external_assignee_email (nullable)
- linked_event_id (nullable)
- title
- description
- due_date
- due_time (nullable)
- status
- completed_at (nullable)
- deleted_at (nullable)
- created_at
- updated_at
- recurrence_rule (nullable)
- recurrence_series_id (nullable)
- recurrence_end_at (nullable)

## `external_task_tokens`

- id
- task_id
- external_email
- token_hash
- expires_at
- revoked_at
- created_at

## `event_occurrence_overrides`

For single-occurrence edits/deletes.

Suggested fields:

- id
- series_id
- occurrence_datetime
- override_type
- override_payload
- deleted
- created_at
- updated_at

## `event_guests`

- id
- event_id / series_id
- email
- guest_token_id
- created_at

## `attachments`

- id
- entity_type (`EVENT` or `TASK`)
- event_id / series_id / occurrence_id / task_id
- file_name
- mime_type
- file_size
- storage_path
- scope
- uploaded_by
- uploaded_at

## `document_links`

- id
- entity_type (`EVENT` or `TASK`)
- event_id / series_id / occurrence_id / task_id
- display_name
- url
- provider (`GOOGLE_DRIVE`)
- added_by
- created_at

## `reminders`

- id
- event_id / occurrence_id
- task_id (nullable)
- offset_type
- offset_value
- scheduled_at
- channel_email
- channel_line
- status

## `notification_logs`

- id
- reminder_id
- event_id
- recipient_type
- recipient
- channel
- attempt
- scheduled_at
- sent_at
- status
- error_message
- created_at

## `audit_logs`

- id
- user_id
- action
- entity_type
- entity_id
- metadata
- created_at

## `guest_tokens`

- id
- event_id
- token_hash
- expires_at
- revoked_at
- created_at

---

# 26. Security Requirements

Use Supabase RLS.

Rules should enforce:

- everyone authenticated can read events
- everyone authenticated can read attachments
- only owner can update/delete own event
- Admin can delete any event
- Task creator can update Task details and change the assignee
- Task creator or assignee can complete or reopen the Task
- only the Task creator, Task assignee, and Admin can read the Task
- users cannot read or update unrelated Tasks
- Admin can administratively remove any Task
- external Task tokens grant access only to their single assigned Task and authorized attachments
- external Task tokens allow only the confirmed completion action and no general Task edits
- user can only modify own profile linkage
- guest links are read-only
- guest token access is scoped to a single event
- document-link visibility follows the same authorization rules as its parent Meeting or Task
- external users receive no broader access merely because a document link exists
- guest link expires with event deletion
- service-role secrets stay server-side
- LINE Channel Access Token stays server-side
- SMTP credentials stay server-side

Do not expose secrets in frontend JavaScript.

---

# 27. Error Handling

Handle clearly:

- invalid Employee ID
- invalid Email
- Employee ID already registered
- Gmail already registered
- Email verification link expired or invalid
- password does not meet the security policy
- password confirmation does not match
- password reset link expired or invalid
- session expired
- Email unavailable
- LINE not linked
- unsupported file
- invalid or unsupported Google Drive document URL
- file too large
- upload failed
- event save failed
- Task save failed
- invalid Task assignee
- invalid, expired, or revoked external Task link
- unauthorized Task update
- unauthorized edit
- guest link expired
- reminder send failed
- Supabase failure
- Sheets sync failure

User-facing errors should be understandable.

Technical details should go to logs.

---

# 28. Main User Flow

```text
Open Web App
↓
Existing Session?
├─ Yes → Calendar
└─ No
   ↓
Existing Account?
   ├─ Yes → Sign In with verified Gmail + Password
   └─ No
      ↓
      Register with Full Name + Employee ID + Gmail + Password
      ↓
      Open verification link sent to Gmail
↓
Persist Session
↓
Calendar
↓
Create Event
↓
Set Date / Time / All-day
↓
Set Repeat
↓
Add Location
↓
Add Description
↓
Add Guest Emails (optional)
↓
Upload Attachments
↓
Choose Reminder Offsets
↓
Choose Email / LINE
↓
If LINE selected and not connected
   → Connect LINE / QR Add Friend
↓
Save
↓
Supabase stores data
↓
Scheduled reminders send
↓
Logs recorded
↓
Event ends
↓
Retain as Meeting history and show with faded styling
↓
Owner/Admin may move Meeting to Trash
↓
30-day Trash period
↓
Permanently delete Meeting and files if not restored
↓
Keep logs for 90 days
```

Task flow:

```text
Create Task
↓
Choose self, another registered employee, or an external Gmail assignee
↓
Optionally link a source Meeting/Event
↓
Set due date/time and reminder channels
↓
Assignee receives assignment/reminder notifications
↓
Creator or assignee marks Task completed
↓
Cancel remaining reminders
↓
Hide from active view and retain in completed history
```

---

# 29. MVP Acceptance Criteria

MVP is considered complete when all of the following work:

1. Register with Full Name + unique Employee ID + Gmail + Password
2. Confirm registration through a Gmail verification link
3. Block sign-in until Gmail is verified
4. Sign in with verified Gmail + Password
5. Password reset through verified Gmail
6. Persistent session
7. Sign out
8. Admin Reset Account with forced sign-out
9. Shared calendar
10. Everyone can view all events
11. Only owner can edit/delete own event
12. Admin can delete any event
13. Create Event
14. Start/End date-time
15. All-day
16. Location
17. Resizable description textarea
18. Recurrence
19. Dynamic repeat labels based on selected date
20. Edit single occurrence
21. Edit entire series
22. Delete single occurrence
23. Delete entire series
24. Multiple reminder offsets
25. Reminder recalculation after date changes
26. Email notification
27. LINE personal notification
28. LINE connect/disconnect
29. LINE welcome Flex Message
30. Optional participant/guest Gmail addresses
31. Guest read-only link opens directly without account, sign-in, or OTP
32. Guest attachment access
33. Unique revocable guest token per guest Email
34. Multiple attachments
35. 10 MB/file limit
36. 5 files/Event limit
37. Retry notification 3 times
38. Notification Log
39. Audit Log
40. Retain past Meetings as history without automatic deletion
41. Retain Logs for 90 days
42. Hourly Supabase → Google Sheets sync
43. Thai/English UI
44. Thai-only Email/LINE messages
45. Responsive desktop/mobile UI
46. RLS permissions enforced
47. Create standalone Task
48. Create follow-up Task from a Meeting/Event
49. Assign Task to self or one registered employee
50. Creator can edit Task details and change assignee
51. Creator or assignee can complete/reopen Task
52. Task supports due date and optional due time
53. Task reminders support due time, 1 hour, 1 day, 3 days, and overdue
54. Completing a Task cancels future reminders
55. Completed Tasks remain in history and are hidden from the active view by default
56. Show/hide completed Tasks
57. Soft-delete Task to Trash
58. Permanently purge Task after 30 days in Trash
59. Meeting detail shows linked Task progress
60. Deleting a Meeting does not delete linked Tasks
61. Task is visible only to its creator, assignee, and Admin
62. Completing an assigned Task notifies its creator by Gmail and by LINE when connected
63. Self-assigned Tasks do not generate duplicate completion notifications
64. An overdue pending Task notifies both creator and assignee at 09:00 for up to 3 days
65. Completing, rescheduling, or deleting an overdue Task stops its remaining overdue notifications
66. A newly assigned or reassigned Task immediately notifies the assignee by Gmail and by LINE when connected
67. Assignment notification includes creator, Task summary, due date/time, and a link to the Task
68. External Gmail assignee can open only the assigned Task and its authorized attachments
69. External assignee cannot access the calendar or other system data
70. External assignee can mark the Task completed only after an explicit confirmation
71. External completion immediately notifies the Task creator
72. External assignment tokens are unique, hashed, scoped, and revocable
73. External Task link remains valid while active and expires 30 days after completion
74. Reassignment or Task deletion immediately revokes the external Task link
75. Past Meetings display with faded styling and retain their attachments
76. Deleting a Meeting moves it to Trash and revokes guest links immediately
77. Meeting may be restored during a 30-day Trash period
78. Meeting and attachments are permanently deleted after 30 days in Trash
79. External Meeting guest link expires 30 days after the Meeting ends
80. Meeting owner can issue a new guest link after expiry
81. Meeting and Task support Supabase file uploads and Google Drive document links
82. Creator controls Task documents; assignees have view/download access only
83. Removing a Drive link never deletes or changes the original Drive file
84. Drive permissions remain controlled by the Drive file owner
85. Task becomes active immediately without an accept/reject step
86. Important Task changes immediately notify the current assignee
87. One save operation produces one consolidated update notification per selected channel
88. Reassignment immediately notifies and removes access from the previous assignee
89. Reassignment immediately notifies the new assignee and revokes any previous external token
90. Deleting/cancelling a Task immediately notifies the assignee and cancels remaining reminders
91. Deleting/cancelling a Task immediately revokes its external access token
92. Task supports daily, weekday, weekly, monthly, yearly, and custom recurrence
93. Completing a recurring Task occurrence creates its next occurrence
94. An incomplete occurrence prevents overlapping future occurrences
95. Each recurring Task occurrence keeps separate status and notification history
96. Recurring Task edit supports this occurrence or entire series
97. Recurring Task delete supports this occurrence or entire series
98. Editing an entire Task series does not rewrite completed historical occurrences
99. Timed Tasks appear at their due time and date-only Tasks appear in the all-day row
100. Users can show/hide their authorized Task layer and completed Tasks

---

# 30. Remaining TBD / Agent Clarification

Only ask if not already determined during implementation review:

- exact From display name and dedicated Gmail Reply-To address
- exact Supabase deployment project configuration
- exact all-day reminder reference time
- exact custom recurrence UI depth
- exact organization branding colors/logo
- exact host/deployment domain
- exact admin assignment method

These are implementation-level items and should not trigger re-questioning of already confirmed product behavior.

---

# 31. Implementation Gate

Do not code immediately.

Required sequence:

```text
1. Read PRD
2. Identify only unresolved high-impact items
3. GRILL ME FIRST on those remaining items
4. Summarize final decisions
5. Produce architecture + implementation plan
6. Wait for explicit approval
7. Begin implementation
```

---

# 32. Final Product Principle

The system should be:

- simple
- easy to learn
- familiar to Google Calendar users
- secure enough for internal organizational use
- low-cost
- maintainable
- responsive
- visually professional
- not over-engineered
