/**
 * Garmin Running Tracker — Apps Script API
 * Deployed as a Web App from the "Running Tracker DB" Google Sheet.
 */

function props(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function sheet(name) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }

// Columns that must stay verbatim text — otherwise Sheets parses "5:30" / "19:45" into
// time-of-day values and "2026-06-05" into Date objects. Enforced on every write.
var TEXT_COLS = {
  Logs:    ['date', 'pace'],
  Runs:    ['date', 'start_time', 'avg_pace'],
  Parkrun: ['date', 'time_mmss']
};

/** Force the text columns of a given row to plain-text format BEFORE values are written. */
function forceText(sh, rowNum, head, tabName) {
  (TEXT_COLS[tabName] || []).forEach(function (name) {
    var c = head.indexOf(name);
    if (c >= 0) sh.getRange(rowNum, c + 1).setNumberFormat('@');
  });
}

/** Read a tab into an array of objects keyed by the header row. */
function readTab(name) {
  var sh = sheet(name);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0];
  return values.slice(1).map(function (row) {
    var o = {};
    head.forEach(function (h, i) { o[h] = row[i]; });
    return o;
  });
}

/** Upsert a row by a key column. Merge: only overwrite cells present in `payload`. */
function upsertByKey(name, keyCol, payload) {
  var sh = sheet(name);
  if (!sh) return { ok: false, error: 'no such tab: ' + name };
  var head = sh.getDataRange().getValues()[0];
  var keyIdx = head.indexOf(keyCol);
  if (keyIdx < 0) return { ok: false, error: 'no such column: ' + keyCol };
  var keyVal = String(payload[keyCol]);

  // Find the existing row (data starts at sheet row 2). Skip the scan if the tab is header-only
  // — getRange() rejects a 0-row range, so an empty tab must go straight to append.
  var lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    var keyColValues = sh.getRange(2, keyIdx + 1, lastRow - 1, 1).getValues();
    for (var r = 0; r < keyColValues.length; r++) {
      if (String(keyColValues[r][0]) === keyVal) {
        var rowNum = r + 2;
        forceText(sh, rowNum, head, name);
        // Merge: write only the columns the payload actually carries; leave the rest untouched.
        head.forEach(function (h, c) {
          if (payload.hasOwnProperty(h)) sh.getRange(rowNum, c + 1).setValue(payload[h]);
        });
        return { ok: true, action: 'updated' };
      }
    }
  }
  // Not found (or header-only tab) — append below the last row. Use setValues (NOT appendRow,
  // which ignores cell formats and re-types strings) so the forced text format sticks.
  var newRow = sh.getLastRow() + 1;
  forceText(sh, newRow, head, name);
  sh.getRange(newRow, 1, 1, head.length).setValues([head.map(function (h) {
    return payload.hasOwnProperty(h) ? payload[h] : '';
  })]);
  return { ok: true, action: 'appended' };
}

function doGet(e) {
  try {
    return json({
      ok: true,
      logs: readTab('Logs'),
      runs: readTab('Runs'),
      parkrun: readTab('Parkrun'),
      settings: settingsObject()
    });
  } catch (err) { return json({ ok: false, error: String(err) }); }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.token !== props('API_TOKEN')) return json({ ok: false, error: 'unauthorized' });
    switch (body.type) {
      case 'log':     return json(upsertByKey('Logs', 'session_id', stamp(body.payload, 'updated_at')));
      case 'run':     return json(upsertByKey('Runs', 'activity_id', stamp(body.payload, 'synced_at')));
      case 'parkrun': return json(appendParkrun(body.payload));
      case 'sync':    return json(triggerSync());
      case 'setup':   return json(setupSheetFormats());
      default:        return json({ ok: false, error: 'unknown type: ' + body.type });
    }
  } catch (err) { return json({ ok: false, error: String(err) }); }
}

function stamp(payload, field) { payload[field] = new Date().toISOString(); return payload; }

function appendParkrun(p) {
  var sh = sheet('Parkrun');
  if (!sh) return { ok: false, error: 'no Parkrun tab' };
  var head = sh.getDataRange().getValues()[0];
  var newRow = sh.getLastRow() + 1;
  forceText(sh, newRow, head, 'Parkrun');
  sh.getRange(newRow, 1, 1, 3).setValues([[p.date, p.time_mmss, new Date().toISOString()]]);
  return { ok: true, action: 'appended' };
}

function settingsObject() {
  var sh = sheet('Settings');
  if (!sh) return {};
  var rows = sh.getDataRange().getValues();
  var out = {};
  for (var i = 1; i < rows.length; i++) {        // skip the key|value header
    if (rows[i][0] !== '') out[rows[i][0]] = rows[i][1];
  }
  return out;
}

/** A Logs row counts as empty if it's not done and carries no distance/pace/rpe/notes/exercises. */
function isEmptyLog(row, head) {
  function v(name) { var i = head.indexOf(name); return i < 0 ? '' : row[i]; }
  var done = v('done');
  if (done === true || String(done).toUpperCase() === 'TRUE') return false;
  return ['distance_km', 'pace', 'rpe', 'notes', 'exercises_json']
    .every(function (n) { return String(v(n)).trim() === ''; });
}

/**
 * Token-gated maintenance (call via POST {type:"setup"}). Idempotent.
 * (1) Forces date/pace/time columns to plain-text. (2) Clears test/empty rows:
 * Logs (ztest* or fully-empty), Runs (gtest*), Parkrun (2026-06-07 probe).
 */
function setupSheetFormats() {
  Object.keys(TEXT_COLS).forEach(function (tab) {
    var sh = sheet(tab);
    if (!sh) return;
    var head = sh.getDataRange().getValues()[0];
    TEXT_COLS[tab].forEach(function (name) {
      var c = head.indexOf(name);
      if (c >= 0) sh.getRange(1, c + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  });

  var removed = { Logs: 0, Runs: 0, Parkrun: 0 };
  var lsh = sheet('Logs');
  if (lsh) {
    var lv = lsh.getDataRange().getValues(), lh = lv[0];
    for (var r = lv.length - 1; r >= 1; r--) {
      if (String(lv[r][0]).indexOf('ztest') === 0 || isEmptyLog(lv[r], lh)) { lsh.deleteRow(r + 1); removed.Logs++; }
    }
  }
  var rsh = sheet('Runs');
  if (rsh) {
    var rv = rsh.getDataRange().getValues();
    for (var j = rv.length - 1; j >= 1; j--) {
      if (String(rv[j][0]).indexOf('gtest') === 0) { rsh.deleteRow(j + 1); removed.Runs++; }
    }
  }
  var psh = sheet('Parkrun');
  if (psh) {
    var pv = psh.getDataRange().getValues();
    for (var k = pv.length - 1; k >= 1; k--) {
      if (String(pv[k][0]).indexOf('2026-06-07') === 0) { psh.deleteRow(k + 1); removed.Parkrun++; }
    }
  }
  return { ok: true, action: 'setup-complete', removed: removed };
}

/** Trigger the GitHub Action immediately (the "Sync now" button). */
function triggerSync() {
  var repo = props('GITHUB_REPO'), pat = props('GITHUB_PAT');
  var url = 'https://api.github.com/repos/' + repo + '/actions/workflows/nightly-sync.yml/dispatches';
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + pat, Accept: 'application/vnd.github+json' },
    payload: JSON.stringify({ ref: 'main' }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  return { ok: code === 204, status: code };
}
