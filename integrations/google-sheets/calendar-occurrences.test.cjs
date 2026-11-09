const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, 'CalendarOccurrences.gs'), 'utf8');

function run({ preview = true, failPage = false, empty = false } = {}) {
  const requests = [];
  const mirrors = [];
  const event = (id, day, iCalUID = 'shared-series') => ({
    id, iCalUID, summary: 'Same title',
    start: { date: '2026-11-' + day }, end: { date: '2026-11-' + (day + 1) },
  });
  const context = vm.createContext({
    CAL_SYNC_CONFIG: { configSheetName: 'Calendar_Configs', targetSheetName: 'Meetings_From_Google' },
    Calendar: { Events: { list: (id, options) => {
      assert.equal(id, 'cal@example.invalid');
      assert.equal(options.singleEvents, true);
      assert.equal(options.timeMin, '2026-10-31T17:00:00.000Z');
      assert.equal(options.timeMax, '2026-11-30T17:00:00.000Z');
      if (empty) return {};
      if (!options.pageToken) return { items: [event('first', 10)], nextPageToken: 'next' };
      if (failPage) throw new Error('Page failed');
      return { items: [event('second', 11), event('unrelated', 12, 'other'), { status: 'cancelled' }] };
    } } },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => ({
      getLastRow: () => 2,
      getRange: () => ({ getValues: () => [['cal@example.invalid', '', 'Calendar', '', 'ACTIVE']] }),
    }) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'synthetic-credential' }) },
    Utilities: { formatDate: () => '2026-11' },
    findCalendarAccount_: () => ({ getId: () => 'cal@example.invalid' }),
    formatCalendarDate_: value => value,
    saveCalendarRowsMirror_: (...args) => mirrors.push(args),
    scanMySharedCalendars: () => {},
    Logger: { log: () => {} },
    UrlFetchApp: { fetch: (_, options) => {
      requests.push(JSON.parse(options.payload));
      return { getResponseCode: () => 200, getContentText: () => '{}' };
    } },
  });
  vm.runInContext(script, context);
  let error;
  try { vm.runInContext('syncCalendarOccurrences_(' + preview + ')', context); }
  catch (caught) { error = caught; }
  return { requests, mirrors, error };
}

test('reads every page and preserves separate same-title and recurring appointments', () => {
  const { requests, mirrors, error } = run();
  assert.ifError(error);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].preview, true);
  assert.equal(mirrors.length, 0);
  const rows = requests[0].payload;
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(row => row.google_event_id)).size, 3);
  assert.equal(rows[0].start_time, '2026-11-09T17:00:00.000Z');
});

test('never submits a partial snapshot after a failed page', () => {
  const { requests, mirrors, error } = run({ failPage: true, preview: false });
  assert.match(error.message, /Page failed/);
  assert.equal(requests.length, 0);
  assert.equal(mirrors.length, 0);
});

test('submits a successfully read empty calendar so deleted appointments disappear', () => {
  const { requests, mirrors, error } = run({ empty: true, preview: false });
  assert.ifError(error);
  assert.deepEqual(requests[0].payload, []);
  assert.deepEqual(requests[0].active_emails, ['cal@example.invalid']);
  assert.equal(mirrors.length, 1);
});
