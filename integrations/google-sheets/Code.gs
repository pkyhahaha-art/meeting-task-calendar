const CONFIG = {
  endpoint: 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/reporting-export',
  secret: 'SET_REPORTING_SYNC_SECRET_HERE',
};

function syncMeetingTaskCalendar() {
  const properties = PropertiesService.getScriptProperties();
  const cursor = properties.getProperty('meetingTaskCalendarCursor') || '1970-01-01T00:00:00.000Z';
  const response = UrlFetchApp.fetch(`${CONFIG.endpoint}?cursor=${encodeURIComponent(cursor)}`, {
    method: 'get',
    headers: { Authorization: `Bearer ${CONFIG.secret}` },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) throw new Error(`Reporting export failed: ${response.getContentText()}`);
  const payload = JSON.parse(response.getContentText());
  appendRows_('Users', ['id', 'employee_id', 'full_name', 'email', 'role', 'status', 'updated_at'], payload.profiles);
  appendRows_('Audit_Log', ['id', 'actor_user_id', 'action', 'entity_type', 'entity_id', 'created_at'], payload.auditLogs);
  appendRows_('Notification_Log', ['id', 'event_id', 'task_id', 'recipient_type', 'channel', 'template_key', 'status', 'attempt', 'error_code', 'created_at', 'sent_at'], payload.notificationDeliveries);
  appendRows_('System_Log', ['id', 'job_name', 'status', 'processed_count', 'created_at'], payload.systemLogs);
  properties.setProperty('meetingTaskCalendarCursor', payload.cursor);
}

function appendRows_(sheetName, headers, rows) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName) || SpreadsheetApp.getActive().insertSheet(sheetName);
  if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  if (!rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length)
    .setValues(rows.map((row) => headers.map((header) => row[header] ?? '')));
}

function createHourlyTrigger() {
  ScriptApp.getProjectTriggers().filter((trigger) => trigger.getHandlerFunction() === 'syncMeetingTaskCalendar')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('syncMeetingTaskCalendar').timeBased().everyHours(1).create();
}
