const CONFIG = {
  endpoint: 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/reporting-export',
};

function syncMeetingTaskCalendar() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('A reporting sync is already running.');
  try { syncReportingWindow_(); } finally { lock.releaseLock(); }
}

function syncReportingWindow_() {
  const properties = PropertiesService.getScriptProperties();
  const secret = properties.getProperty('REPORTING_SYNC_SECRET');
  if (!secret) throw new Error('Set REPORTING_SYNC_SECRET in Script Properties before syncing.');
  const cursor = properties.getProperty('meetingTaskCalendarCursor') || '1970-01-01T00:00:00.000Z';
  let page = null;
  do {
    const url = `${CONFIG.endpoint}?cursor=${encodeURIComponent(cursor)}${page ? `&page=${encodeURIComponent(page)}` : ''}`;
    const response = UrlFetchApp.fetch(url, {
      method: 'get', headers: { Authorization: `Bearer ${secret}` }, muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) throw new Error(`Reporting export failed: ${response.getContentText()}`);
    const payload = JSON.parse(response.getContentText());
    upsertRows_('Users', ['id', 'employee_id', 'full_name', 'email', 'role', 'status', 'updated_at'], payload.profiles);
    upsertRows_('Audit_Log', ['id', 'actor_user_id', 'action', 'entity_type', 'entity_id', 'created_at'], payload.auditLogs);
    upsertRows_('Notification_Log', ['id', 'event_id', 'task_id', 'recipient_type', 'channel', 'template_key', 'status', 'attempt', 'error_code', 'created_at', 'sent_at', 'updated_at'], payload.notificationDeliveries);
    upsertRows_('System_Log', ['id', 'job_name', 'status', 'processed_count', 'created_at'], payload.systemLogs);
    page = payload.nextPage;
    if (payload.hasMore && !page) throw new Error('Reporting export did not provide the next page.');
    // Retry the same window after any partial sync; stable ids prevent duplicates.
    if (!page) properties.setProperty('meetingTaskCalendarCursor', payload.cursor);
  } while (page);
}

function upsertRows_(sheetName, headers, rows) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName) || SpreadsheetApp.getActive().insertSheet(sheetName);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (!rows.length) return;
  const lastRow = sheet.getLastRow();
  const existing = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues() : [];
  const byId = new Map();
  existing.forEach(([id], index) => {
    const key = String(id); const positions = byId.get(key) || [];
    positions.push(index); byId.set(key, positions);
  });
  for (const row of rows) {
    const values = headers.map((header) => row[header] ?? '');
    const positions = byId.get(String(row.id));
    if (positions) positions.forEach((position) => { existing[position] = values; });
    else { byId.set(String(row.id), [existing.length]); existing.push(values); }
  }
  const requiredRows = existing.length + 1;
  if (sheet.getMaxRows() < requiredRows) sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  sheet.getRange(2, 1, existing.length, headers.length).setValues(existing);
}

function createHourlyTrigger() {
  ScriptApp.getProjectTriggers().filter((trigger) => trigger.getHandlerFunction() === 'syncMeetingTaskCalendar')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('syncMeetingTaskCalendar').timeBased().everyHours(1).create();
}
