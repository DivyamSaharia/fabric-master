/**
 * Fabric Master — Google Sheet backend.
 *
 * Paste this into the Sheet's Apps Script editor (Extensions > Apps Script), run setup once,
 * then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 * The app talks to the web app URL with the API key that setup shows you.
 * Every request must carry that key; without it nothing is read or written.
 */

var TABLES = {
  Yarns: ['id', 'name', 'kind', 'base_yarn_id', 'material', 'form', 'count', 'count_unit', 'filaments', 'lustre', 'tpm', 'twist', 'tpm_delta', 'notes', 'updated_at'],
  YarnRates: ['id', 'yarn_id', 'rate', 'effective_date', 'updated_at'],
  Units: ['id', 'name', 'type', 'cost_per_pick', 'has_tfo', 'tfo_default_eff', 'loom_eff_pct', 'notes', 'updated_at'],
  LoomGroups: ['id', 'unit_id', 'make', 'reed_width_cm', 'shedding', 'looms', 'updated_at'],
  TfoTypes: ['id', 'unit_id', 'name', 'updated_at'],
  TfoSpeeds: ['id', 'unit_id', 'tfo_type_id', 'yarn_id', 'rpm', 'efficiency', 'updated_at'],
  Fabrics: ['id', 'name', 'weave', 'design_note', 'end_use', 'reed', 'ppi', 'reed_space_in', 'greige_width_in', 'warp_shortage_pct', 'weft_shortage_pct', 'price', 'vatav_pct', 'finish', 'rfd_shortage_pct', 'processing_charge', 'brokering_pct', 'loom_rpm', 'loom_rpm_dp', 'loom_eff_pct', 'notes', 'created_at', 'updated_at'],
  FabricYarns: ['id', 'fabric_id', 'side', 'yarn_id', 'ends', 'parts', 'pattern', 'sort', 'updated_at'],
  Assignments: ['id', 'fabric_id', 'unit_id', 'updated_at'],
  Photos: ['id', 'fabric_id', 'file_id', 'thumb_file_id', 'caption', 'is_cover', 'created_at', 'updated_at']
};

// Columns stored as numbers or TRUE/FALSE. Everything else is kept as plain text,
// so values like "2S:2Z" or "S/Z" are never turned into dates or times by Sheets.
var NUMERIC = {
  count: 1, filaments: 1, tpm: 1, tpm_delta: 1, rate: 1, cost_per_pick: 1, tfo_default_eff: 1, reed_width_cm: 1, looms: 1, rpm: 1, efficiency: 1,
  reed: 1, ppi: 1, reed_space_in: 1, greige_width_in: 1, warp_shortage_pct: 1, weft_shortage_pct: 1, price: 1, vatav_pct: 1, rfd_shortage_pct: 1,
  processing_charge: 1, brokering_pct: 1, loom_rpm: 1, loom_rpm_dp: 1, loom_eff_pct: 1, ends: 1, parts: 1, sort: 1
};
var BOOLEAN = { has_tfo: 1, is_cover: 1 };
var DATE_ONLY = { effective_date: 1 };

// ---------- menu and one-time setup ----------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Fabric Master').addItem('Set up / show API key', 'setup').addToUi();
}

function setup() {
  ensureSheets_();
  folder_('PHOTOS_FOLDER_ID', 'Fabric Master Photos');
  folder_('EXPORTS_FOLDER_ID', 'Fabric Master Exports');
  var key = apiKey_();
  var msg = 'Tabs, photo and export folders are ready.\n\nAPI key (paste it into the app\'s Settings):\n\n' + key +
    '\n\nNext: Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone. Copy the web app URL into the app too.';
  try {
    SpreadsheetApp.getUi().alert('Fabric Master', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    Logger.log(msg);
  }
  return key;
}

function apiKey_() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('API_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    props.setProperty('API_KEY', key);
  }
  return key;
}

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheets_() {
  var ss = ss_();
  Object.keys(TABLES).forEach(function (name) {
    var cols = TABLES[name];
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    var width = Math.max(cols.length, sh.getLastColumn(), 1);
    var head = sh.getRange(1, 1, 1, width).getValues()[0];
    var missing = cols.filter(function (c) { return head.indexOf(c) === -1; });
    if (sh.getLastRow() === 0 || head.join('') === '') {
      sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    } else if (missing.length) {
      var last = sh.getLastColumn();
      sh.getRange(1, last + 1, 1, missing.length).setValues([missing]);
    }
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold');
    sh.setFrozenRows(1);
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    headers.forEach(function (h, i) {
      if (!NUMERIC[h] && !BOOLEAN[h]) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
  });
  var first = ss.getSheets()[0];
  if (first && first.getName() === 'Sheet1' && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
}

var SCHEMA_VERSION = '4';

// Cheap check on every load; the full tab and format setup runs only when something is missing.
function ensureReady_() {
  var props = PropertiesService.getScriptProperties();
  var names = ss_().getSheets().map(function (s) { return s.getName(); });
  var allThere = Object.keys(TABLES).every(function (n) { return names.indexOf(n) !== -1; });
  if (!allThere || props.getProperty('SCHEMA_VERSION') !== SCHEMA_VERSION) {
    ensureSheets_();
    props.setProperty('SCHEMA_VERSION', SCHEMA_VERSION);
  }
}

function folder_(prop, name) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(prop);
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (e) {
      /* recreate below */
    }
  }
  var parents = DriveApp.getFileById(ss_().getId()).getParents();
  var parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var folder = parent.createFolder(name);
  props.setProperty(prop, folder.getId());
  return folder;
}

// ---------- web app ----------

function doGet(e) {
  return handle_((e && e.parameter) || {});
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Bad request' });
  }
  return handle_(body);
}

function handle_(p) {
  try {
    if (!p.key || p.key !== PropertiesService.getScriptProperties().getProperty('API_KEY')) {
      return json_({ ok: false, error: 'Wrong API key. Copy it again from the Sheet menu: Fabric Master > Set up / show API key.' });
    }
    switch (p.action) {
      case 'ping':
        return json_(Object.assign({ ok: true }, meta_()));
      case 'bootstrap':
        ensureReady_();
        return json_({ ok: true, tables: withLock_(readAll_), meta: meta_() });
      case 'batch':
        return json_({ ok: true, ops: withLock_(function () { return batch_(p.ops || []); }) });
      case 'uploadPhoto':
        return json_({ ok: true, row: uploadPhoto_(p) });
      case 'photo':
        return json_({ ok: true, dataUrl: photo_(p.id, p.size) });
      case 'deletePhoto':
        deletePhoto_(p.id);
        return json_({ ok: true });
      case 'saveExport':
        return json_({ ok: true, url: saveExport_(p) });
      default:
        return json_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function meta_() {
  var ss = ss_();
  var props = PropertiesService.getScriptProperties();
  var photos = props.getProperty('PHOTOS_FOLDER_ID');
  var exportsId = props.getProperty('EXPORTS_FOLDER_ID');
  return {
    spreadsheetName: ss.getName(),
    spreadsheetUrl: ss.getUrl(),
    photosFolderUrl: photos ? 'https://drive.google.com/drive/folders/' + photos : '',
    exportsFolderUrl: exportsId ? 'https://drive.google.com/drive/folders/' + exportsId : ''
  };
}

// ---------- tables ----------

function sheet_(name) {
  if (!TABLES[name]) throw new Error('Unknown table ' + name);
  var sh = ss_().getSheetByName(name);
  if (!sh) {
    ensureSheets_();
    sh = ss_().getSheetByName(name);
  }
  return sh;
}

function headers_(sh) {
  return sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
}

function fromCell_(h, v) {
  if (v instanceof Date) {
    return DATE_ONLY[h] ? Utilities.formatDate(v, ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd') : v.toISOString();
  }
  if (BOOLEAN[h]) return v === true || String(v).toUpperCase() === 'TRUE';
  return v;
}

function toCell_(h, v) {
  if (v === null || v === undefined) return '';
  if (BOOLEAN[h]) return v === true || String(v).toUpperCase() === 'TRUE';
  if (NUMERIC[h]) {
    if (v === '') return '';
    var n = Number(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : String(v);
  }
  return String(v);
}

var ID_PREFIX = { Yarns: 'y', YarnRates: 'r', Units: 'u', LoomGroups: 'lg', TfoTypes: 'tt', TfoSpeeds: 'sp', Fabrics: 'f', FabricYarns: 'l', Assignments: 'a', Photos: 'p' };

// Reads a tab. Rows pasted in by hand without an id get one, so bulk import is just a paste.
function readTable_(name, fillIds) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var head = headers_(sh);
  var idCol = head.indexOf('id');
  var values = sh.getRange(2, 1, last - 1, head.length).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var hasData = row.some(function (v) { return v !== '' && v !== null; });
    if (!hasData) continue;
    if ((row[idCol] === '' || row[idCol] === null) && fillIds && idCol >= 0) {
      row[idCol] = ID_PREFIX[name] + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
      sh.getRange(r + 2, idCol + 1).setValue(row[idCol]);
    }
    var obj = {};
    for (var c = 0; c < head.length; c++) if (head[c]) obj[head[c]] = fromCell_(head[c], row[c]);
    if (obj.id !== '' && obj.id !== undefined && obj.id !== null) {
      obj.id = String(obj.id);
      out.push(obj);
    }
  }
  return out;
}

function readAll_() {
  var t = {};
  Object.keys(TABLES).forEach(function (n) { t[n] = readTable_(n, true); });
  return t;
}

function idRows_(sh, head) {
  var map = {};
  var last = sh.getLastRow();
  if (last < 2) return map;
  var idCol = head.indexOf('id') + 1;
  var ids = sh.getRange(2, idCol, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (ids[i][0] !== '') map[String(ids[i][0])] = i + 2;
  return map;
}

function upsert_(name, rows) {
  var sh = sheet_(name);
  var head = headers_(sh);
  var pos = idRows_(sh, head);
  var now = new Date().toISOString();
  var appends = [];
  var out = [];
  rows.forEach(function (row) {
    if (!row || !row.id) throw new Error('Row without id in ' + name);
    var r = Object.assign({}, row, { updated_at: now });
    var at = pos[String(r.id)];
    if (at) {
      var current = sh.getRange(at, 1, 1, head.length).getValues()[0];
      var merged = head.map(function (h, i) { return h in r ? toCell_(h, r[h]) : current[i]; });
      sh.getRange(at, 1, 1, head.length).setValues([merged]);
    } else {
      appends.push(head.map(function (h) { return toCell_(h, r[h]); }));
      pos[String(r.id)] = -1;
    }
    out.push(r);
  });
  if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, head.length).setValues(appends);
  return out;
}

function delete_(name, ids) {
  var sh = sheet_(name);
  var head = headers_(sh);
  var pos = idRows_(sh, head);
  var rowsToDelete = (ids || []).map(function (id) { return pos[String(id)]; }).filter(function (n) { return n; });
  rowsToDelete.sort(function (a, b) { return b - a; }).forEach(function (n) { sh.deleteRow(n); });
}

function batch_(ops) {
  var applied = [];
  ops.forEach(function (op) {
    if (op.op === 'upsert') applied.push({ op: 'upsert', table: op.table, rows: upsert_(op.table, op.rows || []) });
    else if (op.op === 'delete') {
      delete_(op.table, op.ids || []);
      applied.push({ op: 'delete', table: op.table, ids: op.ids || [] });
    } else throw new Error('Unknown op ' + op.op);
  });
  return applied;
}

// ---------- photos and exports ----------

function decode_(dataUrl, name) {
  var m = String(dataUrl || '').match(/^data:([^;]+);base64,(.*)$/);
  if (!m) throw new Error('Photo data is missing');
  return Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name);
}

function uploadPhoto_(p) {
  var photo = p.photo || {};
  if (!photo.id || !photo.fabric_id) throw new Error('Photo needs an id and a fabric');
  var folder = folder_('PHOTOS_FOLDER_ID', 'Fabric Master Photos');
  var full = folder.createFile(decode_(p.image, photo.fabric_id + '_' + photo.id + '.jpg'));
  var thumb = folder.createFile(decode_(p.thumb, photo.fabric_id + '_' + photo.id + '_thumb.jpg'));
  var row = Object.assign({}, photo, { file_id: full.getId(), thumb_file_id: thumb.getId() });
  return withLock_(function () { return upsert_('Photos', [row])[0]; });
}

function photoRow_(id) {
  var rows = readTable_('Photos');
  for (var i = 0; i < rows.length; i++) if (rows[i].id === String(id)) return rows[i];
  return null;
}

function photo_(id, size) {
  var row = photoRow_(id);
  if (!row) throw new Error('Photo not found');
  var fileId = size === 'thumb' && row.thumb_file_id ? row.thumb_file_id : row.file_id;
  var blob = DriveApp.getFileById(fileId).getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

function deletePhoto_(id) {
  var row = photoRow_(id);
  if (!row) return;
  [row.file_id, row.thumb_file_id].forEach(function (fid) {
    if (!fid) return;
    try {
      DriveApp.getFileById(fid).setTrashed(true);
    } catch (e) {
      /* already gone */
    }
  });
  withLock_(function () { delete_('Photos', [row.id]); });
}

function saveExport_(p) {
  if (!p.name || !p.base64) throw new Error('Export file is missing');
  var folder = folder_('EXPORTS_FOLDER_ID', 'Fabric Master Exports');
  var blob = Utilities.newBlob(Utilities.base64Decode(p.base64), p.mime || 'application/octet-stream', String(p.name).replace(/[\\/]/g, '-'));
  return folder.createFile(blob).getUrl();
}
