// Install alongside calendar.gs. The existing trigger delegates to syncCalendarOccurrences_.
function previewCalendarOccurrenceSync() {
  syncCalendarOccurrences_(true);
}

function syncCalendarOccurrences_(preview) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return;
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CAL_SYNC_CONFIG.configSheetName);
    if (!sheet || sheet.getLastRow() < 2) throw new Error('Calendar_Configs has no accounts.');
    const month = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM');
    const parts = month.split('-').map(Number);
    const start = new Date(month + '-01T00:00:00+07:00');
    const end = new Date(Date.UTC(parts[0], parts[1], 1) - 7 * 3600000);
    const accounts = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
    const owners = new Map();
    const calendarOwners = new Map();
    for (const row of accounts) {
      let [email, query, name, affiliation, status] = row.map(value => String(value || '').trim());
      if (status.toUpperCase() !== 'ACTIVE' && affiliation.toUpperCase() === 'ACTIVE') {
        name = query;
        query = affiliation = '';
        status = 'ACTIVE';
      }
      if (status.toUpperCase() !== 'ACTIVE' || !(email || query)) continue;
      const calendar = findCalendarAccount_(query || email, email);
      if (!calendar) throw new Error('An active calendar could not be read. Nothing was synced.');
      const id = calendar.getId();
      const owner = email.includes('@') ? email : id;
      if ((owners.has(owner) && owners.get(owner).id !== id) ||
          (calendarOwners.has(id) && calendarOwners.get(id) !== owner)) {
        throw new Error('An active calendar has conflicting ownership configuration.');
      }
      owners.set(owner, { id, name, affiliation });
      calendarOwners.set(id, owner);
    }
    if (!owners.size) throw new Error('No active calendars were read.');

    const rows = [];
    for (const [owner, calendar] of owners) {
      let pageToken;
      do {
        const options = {
          timeMin: start.toISOString(), timeMax: end.toISOString(), timeZone: 'Asia/Bangkok',
          singleEvents: true, showDeleted: false, maxResults: 2500,
        };
        if (pageToken) options.pageToken = pageToken;
        const page = calendarOccurrencePage_(calendar.id, options);
        for (const event of page.items || []) {
          if (event.status === 'cancelled') continue;
          const allDay = Boolean(event.start && event.start.date);
          const starts = calendarOccurrenceTime_(event.start);
          const ends = calendarOccurrenceTime_(event.end);
          if (!event.id || !starts || !ends) throw new Error('Google returned an incomplete appointment.');
          if (starts < start || starts >= end) continue;
          rows.push({
            google_event_id: 'gcal-v2:' + encodeURIComponent(calendar.id) + ':' + event.id,
            legacy_google_event_id: event.iCalUID || null,
            calendar_owner_email: owner, calendar_owner_name: calendar.name,
            calendar_owner_affiliation: calendar.affiliation, title: event.summary || '(ไม่มีหัวข้อ)',
            start_time: starts.toISOString(), end_time: ends.toISOString(), location: event.location || '',
            description: event.description || '', is_all_day: allDay, updated_at: new Date().toISOString(),
          });
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
    }

    const properties = PropertiesService.getScriptProperties();
    const key = properties.getProperty('SUPABASE_SERVICE_ROLE_KEY');
    if (!key) throw new Error('Supabase service key is missing.');
    const endpoint = 'https://gpcavspjxssegdqenaud.supabase.co/rest/v1/rpc/sync_google_calendar_occurrences';
    const response = UrlFetchApp.fetch(endpoint, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { apikey: key, Authorization: 'Bearer ' + key },
      payload: JSON.stringify({
        payload: rows, sync_start: start.toISOString(), sync_end: end.toISOString(),
        active_emails: Array.from(owners.keys()), preview: preview === true,
      }),
    });
    if (response.getResponseCode() !== 200) {
      const failure = JSON.parse(response.getContentText());
      throw new Error('Calendar sync RPC failed: ' + (failure.code || response.getResponseCode()));
    }
    Logger.log(response.getContentText());
    if (preview === true) return;
    const headers = ['google_event_id', 'calendar_owner_email', 'calendar_owner_name',
      'calendar_owner_affiliation', 'title', 'start_time', 'end_time', 'location',
      'description', 'is_all_day', 'updated_at'];
    const mirrorRows = rows.map(row => ({
      ...row,
      start_time: formatCalendarDate_(row.start_time),
      end_time: formatCalendarDate_(row.end_time),
      updated_at: formatCalendarDate_(row.updated_at),
      is_all_day: row.is_all_day ? 'TRUE' : 'FALSE',
    }));
    saveCalendarRowsMirror_(CAL_SYNC_CONFIG.targetSheetName, headers, mirrorRows);
    try { scanMySharedCalendars(); } catch (error) { Logger.log('Calendar discovery refresh failed.'); }
  } finally {
    lock.releaseLock();
  }
}

function calendarOccurrenceTime_(value) {
  if (!value || !(value.dateTime || value.date)) return null;
  const date = new Date(value.dateTime || value.date + 'T00:00:00+07:00');
  return Number.isFinite(date.getTime()) ? date : null;
}

function calendarOccurrencePage_(calendarId, options) {
  if (typeof Calendar !== 'undefined') return Calendar.Events.list(calendarId, options);
  const query = Object.keys(options).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(options[key])).join('&');
  const response = UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3/calendars/' +
    encodeURIComponent(calendarId) + '/events?' + query, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) throw new Error('Calendar API HTTP ' + response.getResponseCode());
  return JSON.parse(response.getContentText());
}
