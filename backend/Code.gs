/**
 * Fabric Master — Google Sheet backend.
 *
 * Paste this into the Sheet's Apps Script editor (Extensions > Apps Script), run setup once,
 * then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 * The app talks to the web app URL with the API key that setup shows you.
 * Every request must carry a key; without one nothing is read or written.
 * The key from setup belongs to the owner. The owner gives each other person their own key
 * from the app's Settings, so every edit carries a name and one person can be removed alone.
 * Every add, change and delete made through the app is written to the "Change log" tab.
 * Backend v14: faster sync. A data version (script property DATA_VERSION) moves on every save and on every edit made by
 *   hand in a data tab (simple onEdit trigger). The app asks for it with the light "version" action and loads the tables
 *   only when it has moved. Loads read all tabs in one Sheets API call (advanced service "Sheets", falls back to one read
 *   per tab) and no longer wait for the save lock. Each call's action and time go to PERF_LOG; run perfReport to see them.
 * Backend v13: names confirmed in the planning-sheet photo import are kept in their own spreadsheet ("Fabric Master – Sheet Names", made on the first save,
 *   next to this one in Drive), not in this workbook. Actions sheetNames and saveSheetNames. Not in the change log.
 * Backend v12: TFO planner plans (TfoBalancePlans, TfoBalanceLines); plan_date is date only. Logged as type "TFO plan".
 * Backend v11: Sale date for fabrics (Fabrics.sale_date, yyyy-mm-dd, date only).
 * Backend v10: Transportation cost head for RFD fabrics (Fabrics.transport_charge); RFD fabric names show as name + RS + (RFD).
 * Backend v9: the old TFO planner is gone (TfoPlans and Plan* tabs removed); planning is the separate TFO Planner app.
 * Backend v8: beam length per fabric and loom group (FabricBeams).
 * Backend v7: TFO plans can hold twisted yarn on hand, total kg (PlanStock). The planner is weft-only.
 * Backend v6: dated TFO plans (TfoPlans, PlanLooms, PlanTfo, PlanOutside), TFO machine counts and an efficiency per TFO type.
 */

var TABLES = {
  Yarns: ['id', 'name', 'kind', 'base_yarn_id', 'material', 'form', 'count', 'count_unit', 'filaments', 'lustre', 'tpm', 'twist', 'tpm_delta', 'notes', 'updated_at', 'updated_by'],
  YarnRates: ['id', 'yarn_id', 'rate', 'effective_date', 'updated_at', 'updated_by'],
  Units: ['id', 'name', 'type', 'cost_per_pick', 'has_tfo', 'tfo_default_eff', 'loom_eff_pct', 'notes', 'updated_at', 'updated_by'],
  LoomGroups: ['id', 'unit_id', 'make', 'reed_width_cm', 'shedding', 'looms', 'updated_at', 'updated_by'],
  TfoTypes: ['id', 'unit_id', 'name', 'machines', 'spindles_per_side', 'efficiency', 'updated_at', 'updated_by'],
  TfoSpeeds: ['id', 'unit_id', 'tfo_type_id', 'yarn_id', 'rpm', 'efficiency', 'updated_at', 'updated_by'],
  Fabrics: ['id', 'name', 'weave', 'design_note', 'end_use', 'reed', 'ppi', 'reed_space_in', 'greige_width_in', 'warp_shortage_pct', 'weft_shortage_pct', 'price', 'sale_date', 'vatav_pct', 'finish', 'rfd_shortage_pct', 'processing_charge', 'brokering_pct', 'transport_charge', 'loom_rpm', 'loom_rpm_dp', 'loom_eff_pct', 'notes', 'created_at', 'updated_at', 'updated_by', 'created_by'],
  FabricYarns: ['id', 'fabric_id', 'side', 'yarn_id', 'ends', 'parts', 'pattern', 'sort', 'updated_at', 'updated_by'],
  Assignments: ['id', 'fabric_id', 'unit_id', 'updated_at', 'updated_by'],
  FabricBeams: ['id', 'fabric_id', 'loom_group_id', 'beam_length_m', 'updated_at', 'updated_by'],
  Photos: ['id', 'fabric_id', 'file_id', 'thumb_file_id', 'caption', 'is_cover', 'created_at', 'updated_at', 'updated_by'],
  TfoBalancePlans: ['id', 'unit_id', 'plan_date', 'name', 'notes', 'summary', 'created_at', 'created_by', 'updated_at', 'updated_by'],
  TfoBalanceLines: ['id', 'plan_id', 'kind', 'ref', 'value', 'sort', 'updated_at', 'updated_by']
};

// Columns stored as numbers or TRUE/FALSE. Everything else is kept as plain text,
// so values like "2S:2Z" or "S/Z" are never turned into dates or times by Sheets.
var NUMERIC = {
  count: 1, filaments: 1, tpm: 1, tpm_delta: 1, rate: 1, cost_per_pick: 1, tfo_default_eff: 1, reed_width_cm: 1, looms: 1, rpm: 1, efficiency: 1,
  reed: 1, ppi: 1, reed_space_in: 1, greige_width_in: 1, warp_shortage_pct: 1, weft_shortage_pct: 1, price: 1, vatav_pct: 1, rfd_shortage_pct: 1,
  processing_charge: 1, brokering_pct: 1, transport_charge: 1, loom_rpm: 1, loom_rpm_dp: 1, loom_eff_pct: 1, ends: 1, parts: 1, sort: 1,
  machines: 1, spindles_per_side: 1, beam_length_m: 1
};
var BOOLEAN = { has_tfo: 1, is_cover: 1 };
var DATE_ONLY = { effective_date: 1, sale_date: 1, plan_date: 1 };

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
    key = newKey_();
    props.setProperty('API_KEY', key);
  }
  return key;
}

function newKey_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
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
  logSheet_();
  var first = ss.getSheets()[0];
  if (first && first.getName() === 'Sheet1' && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
}

var SCHEMA_VERSION = '12';

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

// The person making the current request, and the changes it made (for the change log).
var REQ_ = null;

var OWNER_ONLY = { people: 1, addPerson: 1, renamePerson: 1, removePerson: 1 };

function handle_(p) {
  REQ_ = null;
  var t0 = Date.now();
  var ok = false;
  try {
    LAST_OK_ = false;
    var out = route_(p);
    ok = LAST_OK_;
    return out;
  } finally {
    perf_(p && p.action, Date.now() - t0, ok);
  }
}

function route_(p) {
  try {
    var user = userForKey_(p.key);
    if (!user) {
      return json_({ ok: false, code: 'auth', error: 'Wrong API key, or this key no longer has access. Check it in Settings, or ask the owner of the Sheet for a new key.' });
    }
    REQ_ = { user: user, events: [], names: {}, gone: {} };
    if (OWNER_ONLY[p.action] && user.role !== 'owner') return json_({ ok: false, error: 'Only the owner can change who has access.' });
    switch (p.action) {
      case 'ping':
        return json_(Object.assign({ ok: true }, meta_()));
      case 'version':
        // the light check: no Sheet access at all, only the data version
        return json_({ ok: true, version: version_() });
      case 'bootstrap': {
        ensureReady_();
        var loaded = readFast_();
        return json_({ ok: true, tables: loaded.tables, version: loaded.version, meta: meta_() });
      }
      case 'batch': {
        ensureReady_();
        var w = writing_(function () {
          var applied = batch_(p.ops || []);
          return applied.concat(finish_());
        });
        return json_({ ok: true, ops: w.result, version: w.version, prev: w.prev });
      }
      case 'uploadPhoto': {
        ensureReady_();
        // no prev: the save also stamps the fabric's "last edited", which is not sent back, so the next check loads
        var up = uploadPhoto_(p);
        return json_({ ok: true, row: up.result, version: up.version });
      }
      case 'photo':
        return json_({ ok: true, dataUrl: photo_(p.id, p.size) });
      case 'deletePhoto': {
        var dp = deletePhoto_(p.id);
        return json_(dp ? { ok: true, version: dp.version } : { ok: true });
      }
      case 'perf':
        if (REQ_.user.role !== 'owner') return json_({ ok: false, error: 'Only the owner can see this.' });
        return json_({ ok: true, lines: perfLines_() });
      case 'saveExport':
        return json_({ ok: true, url: saveExport_(p) });
      case 'sheetNames':
        return json_({ ok: true, names: readNames_() });
      case 'saveSheetNames':
        return json_({ ok: true, names: withLock_(function () { saveNames_(p.rows); return readNames_(); }) });
      case 'log':
        return json_({ ok: true, entries: readLog_(p.limit) });
      case 'people':
        return json_({ ok: true, people: listPeople_() });
      case 'addPerson':
        return json_({ ok: true, person: withLock_(function () { return addPerson_(p.name); }) });
      case 'renamePerson':
        withLock_(function () { renamePerson_(p.id, p.name); });
        return json_({ ok: true, people: listPeople_() });
      case 'removePerson':
        withLock_(function () { removePerson_(p.id); });
        return json_({ ok: true, people: listPeople_() });
      default:
        return json_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

var LAST_OK_ = false;

function json_(obj) {
  LAST_OK_ = !!(obj && obj.ok);
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
    exportsFolderUrl: exportsId ? 'https://drive.google.com/drive/folders/' + exportsId : '',
    me: REQ_ ? { name: REQ_.user.name, role: REQ_.user.role } : null
  };
}

// ---------- people and keys ----------
// API_KEY (made by setup) is the owner's key. Everyone else is in PEOPLE with a key of their own.

function people_() {
  var raw = PropertiesService.getScriptProperties().getProperty('PEOPLE');
  try {
    var list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function savePeople_(list) {
  PropertiesService.getScriptProperties().setProperty('PEOPLE', JSON.stringify(list));
}

function ownerName_() {
  return PropertiesService.getScriptProperties().getProperty('OWNER_NAME') || 'Owner';
}

function userForKey_(key) {
  if (!key) return null;
  var ownerKey = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (ownerKey && String(key) === ownerKey) return { id: 'owner', name: ownerName_(), role: 'owner' };
  var list = people_();
  for (var i = 0; i < list.length; i++) {
    if (list[i].key && list[i].key === String(key)) return { id: list[i].id, name: list[i].name, role: 'editor' };
  }
  return null;
}

function listPeople_() {
  var out = [{ id: 'owner', name: ownerName_(), role: 'owner', key: PropertiesService.getScriptProperties().getProperty('API_KEY') || '', added_at: '' }];
  people_().forEach(function (p) {
    out.push({ id: p.id, name: p.name, role: 'editor', key: p.key, added_at: p.added_at || '' });
  });
  return out;
}

function cleanName_(name, exceptId) {
  var n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!n) throw new Error('Enter a name');
  if (n.length > 40) throw new Error('Keep the name under 40 characters');
  var taken = listPeople_().some(function (p) { return p.id !== exceptId && p.name.toLowerCase() === n.toLowerCase(); });
  if (taken) throw new Error(n + ' is already on the list');
  return n;
}

function addPerson_(name) {
  var n = cleanName_(name);
  var list = people_();
  var person = { id: 'k_' + Utilities.getUuid().replace(/-/g, '').slice(0, 10), name: n, key: newKey_(), added_at: new Date().toISOString() };
  list.push(person);
  savePeople_(list);
  appendLog_([[logTime_(), REQ_.user.name, 'gave access', 'Access', n, '', '']]);
  return { id: person.id, name: person.name, role: 'editor', key: person.key, added_at: person.added_at };
}

function renamePerson_(id, name) {
  var n = cleanName_(name, id);
  var old;
  if (id === 'owner') {
    old = ownerName_();
    PropertiesService.getScriptProperties().setProperty('OWNER_NAME', n);
  } else {
    var list = people_();
    var person = list.filter(function (p) { return p.id === id; })[0];
    if (!person) throw new Error('That person is not on the list');
    old = person.name;
    person.name = n;
    savePeople_(list);
  }
  var by = id === REQ_.user.id ? n : REQ_.user.name;
  if (old !== n) appendLog_([[logTime_(), by, 'renamed', 'Access', n, 'was ' + old, '']]);
}

function removePerson_(id) {
  if (id === 'owner') throw new Error("The owner's key can't be removed");
  var list = people_();
  var person = list.filter(function (p) { return p.id === id; })[0];
  if (!person) throw new Error('That person is not on the list');
  savePeople_(list.filter(function (p) { return p.id !== id; }));
  appendLog_([[logTime_(), REQ_.user.name, 'removed access', 'Access', person.name, '', '']]);
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

// Same value for change detection: 64 and "64", TRUE and true, a Date and its text all match.
function norm_(h, v) {
  var x = fromCell_(h, v);
  if (x === null || x === undefined) return '';
  if (NUMERIC[h] && x !== '' && isFinite(Number(x))) return String(Number(x));
  return String(x);
}

function rowObj_(head, values) {
  var obj = {};
  for (var c = 0; c < head.length; c++) if (head[c]) obj[head[c]] = fromCell_(head[c], values[c]);
  if (obj.id !== undefined && obj.id !== null) obj.id = String(obj.id);
  return obj;
}

var ID_PREFIX = { Yarns: 'y', YarnRates: 'r', Units: 'u', LoomGroups: 'lg', TfoTypes: 'tt', TfoSpeeds: 'sp', Fabrics: 'f', FabricYarns: 'l', Assignments: 'a', Photos: 'p', TfoBalancePlans: 'bp', TfoBalanceLines: 'bl' };

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

// ---------- data version and fast loads ----------
// DATA_VERSION changes whenever the tables may have changed: around every save (a value starting with "w" while a
// save is being written) and after every edit made by hand in a data tab. The app keeps the version its copy was
// loaded at, asks for it with the light "version" call, and loads all tabs only when it differs.

var TIMESTAMP = { updated_at: 1, created_at: 1 };

function newVersion_() {
  return Date.now().toString(36) + Utilities.getUuid().replace(/-/g, '').slice(0, 6);
}

function version_() {
  var props = PropertiesService.getScriptProperties();
  var v = props.getProperty('DATA_VERSION');
  if (!v) {
    v = newVersion_();
    props.setProperty('DATA_VERSION', v);
  }
  return v;
}

function setVersion_(v) {
  PropertiesService.getScriptProperties().setProperty('DATA_VERSION', v);
  return v;
}

// Runs a save under the lock. The version is marked "being written" first and moves on afterwards, even when the
// save fails part-way, so a load that overlaps a save can always tell. prev is the version before the save: a device
// whose copy was at prev knows its copy plus this save's rows is now complete.
function writing_(fn) {
  return withLock_(function () {
    var props = PropertiesService.getScriptProperties();
    var mark = props.getProperty('HAND_EDIT') || '';
    var prev = version_();
    if (prev.charAt(0) === 'w') prev = ''; // an earlier save was cut off; nobody's copy can claim to be complete
    setVersion_('w' + newVersion_());
    var version;
    try {
      var result = fn();
      version = setVersion_(newVersion_());
      // a hand edit landed while this save was running: the saving device must load in full
      if ((props.getProperty('HAND_EDIT') || '') !== mark) prev = '';
      return { result: result, version: version, prev: prev };
    } finally {
      if (!version) setVersion_(newVersion_());
    }
  });
}

// Simple trigger: a row typed or pasted into a data tab by hand moves the version, so every device loads it.
// HAND_EDIT is always moved too, so a save running at that moment tells its device to load in full (writing_).
// While a save is being written its "w" marker is left alone; the save moves the version when it ends.
// (Deleting or sorting rows by hand does not fire it; the app also reloads in full every 30 minutes for that.)
function onEdit(e) {
  try {
    var name = e && e.range ? e.range.getSheet().getName() : '';
    if (name && !TABLES[name]) return;
    PropertiesService.getScriptProperties().setProperty('HAND_EDIT', newVersion_());
    if (version_().charAt(0) !== 'w') setVersion_(newVersion_());
  } catch (err) {
    /* a missed bump only delays the next load until the 30-minute full reload */
  }
}

// Spreadsheet serial number (days since 30 Dec 1899, local time) to yyyy-mm-dd.
function serialDate_(n) {
  var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n + 1e-7) * 86400000);
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

// Spreadsheet serial number to an ISO timestamp, as a Date cell read through SpreadsheetApp would give.
function serialIso_(n) {
  var local = Math.round((n - 25569) * 86400000);
  var z = Utilities.formatDate(new Date(local), ss_().getSpreadsheetTimeZone(), 'Z'); // e.g. +0530
  var m = String(z).match(/^([+-])(\d\d)(\d\d)$/);
  var off = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000 : 0;
  return new Date(local - off).toISOString();
}

// One cell as the app expects it. api: the value came from the Sheets API (dates as serial numbers, blanks missing).
function cellIn_(h, v, api) {
  if (v === undefined || v === null) v = '';
  if (api && typeof v === 'number') {
    if (DATE_ONLY[h]) return serialDate_(v);
    if (TIMESTAMP[h]) return serialIso_(v);
  }
  return fromCell_(h, v);
}

// Rows of one tab from its values (header row first). Same rules as readTable_: blank rows skipped, rows without an
// id left out (needIds says the tab has some, so they get one under the lock).
function rowsFrom_(values, api) {
  var res = { rows: [], needIds: false };
  if (!values || values.length < 2) return res;
  var head = values[0].map(function (h) { return h === undefined || h === null ? '' : String(h); });
  var idCol = head.indexOf('id');
  for (var r = 1; r < values.length; r++) {
    var row = values[r] || [];
    var hasData = false;
    for (var k = 0; k < row.length; k++) if (row[k] !== '' && row[k] !== null && row[k] !== undefined) hasData = true;
    if (!hasData) continue;
    var obj = {};
    for (var c = 0; c < head.length; c++) if (head[c]) obj[head[c]] = cellIn_(head[c], row[c], api);
    if (obj.id !== '' && obj.id !== undefined && obj.id !== null) {
      obj.id = String(obj.id);
      res.rows.push(obj);
    } else if (idCol >= 0) res.needIds = true;
  }
  return res;
}

// Every data tab: one Sheets API call when the advanced service is on, otherwise one read per tab.
function readTablesOnce_() {
  var names = Object.keys(TABLES);
  var lists;
  var api = typeof Sheets !== 'undefined' && Sheets && Sheets.Spreadsheets && Sheets.Spreadsheets.Values;
  if (api) {
    try {
      var res = Sheets.Spreadsheets.Values.batchGet(ss_().getId(), {
        ranges: names.map(function (n) { return "'" + n.replace(/'/g, "''") + "'"; }),
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER'
      });
      var vr = (res && res.valueRanges) || [];
      lists = names.map(function (n, i) { return (vr[i] && vr[i].values) || []; });
    } catch (e) {
      console.error('batchGet failed, reading tab by tab: ' + (e && e.message));
      api = false; // e.g. the service is off or not authorised: the slower path still works
    }
  }
  if (!api) {
    lists = names.map(function (n) {
      var sh = sheet_(n);
      return sh.getLastRow() < 1 ? [] : sh.getDataRange().getValues();
    });
  }
  var out = { tables: {}, needIds: [] };
  names.forEach(function (n, i) {
    var t = rowsFrom_(lists[i], !!api);
    out.tables[n] = t.rows;
    if (t.needIds) out.needIds.push(n);
  });
  return out;
}

// A load that does not wait for saves. Reads the version before and after; if it moved (or a save was being written),
// reads again. After three tries, or when pasted rows need ids, it reads under the lock.
function readFast_() {
  for (var i = 0; i < 3; i++) {
    var v1 = version_();
    if (v1.charAt(0) !== 'w') {
      var t = readTablesOnce_();
      if (version_() === v1) {
        if (!t.needIds.length) return { tables: t.tables, version: v1 };
        break;
      }
    }
    Utilities.sleep(200 * (i + 1));
  }
  return withLock_(function () {
    var v = version_();
    if (v.charAt(0) === 'w') v = setVersion_(newVersion_()); // left over from a save that was cut off
    var t = readTablesOnce_();
    if (t.needIds.length) {
      t.needIds.forEach(function (n) { t.tables[n] = readTable_(n, true); });
      v = setVersion_(newVersion_()); // ids were written: every other device must load them
    }
    return { tables: t.tables, version: v };
  });
}

// ---------- timing log ----------
// The last 200 calls as "time|action|ms|ok" in the script property PERF_LOG. Run perfReport in the editor to see
// count, median and slowest per action.

function perf_(action, ms, ok) {
  try {
    console.log(JSON.stringify({ action: String(action || ''), ms: ms, ok: ok }));
    var props = PropertiesService.getScriptProperties();
    var lines = (props.getProperty('PERF_LOG') || '').split('\n').filter(String);
    lines.push(new Date().toISOString().slice(0, 19) + '|' + String(action || '').slice(0, 20) + '|' + ms + '|' + (ok ? 1 : 0));
    while (lines.length > 200 || lines.join('\n').length > 8500) lines.shift();
    props.setProperty('PERF_LOG', lines.join('\n'));
  } catch (e) {
    /* timing must never break a call */
  }
}

function perfLines_() {
  return (PropertiesService.getScriptProperties().getProperty('PERF_LOG') || '').split('\n').filter(String);
}

function perfReport() {
  var by = {};
  perfLines_().forEach(function (l) {
    var p = l.split('|');
    (by[p[1]] = by[p[1]] || []).push(Number(p[2]));
  });
  var out = Object.keys(by).sort().map(function (a) {
    var x = by[a].slice().sort(function (m, n) { return m - n; });
    var med = x.length % 2 ? x[(x.length - 1) / 2] : (x[x.length / 2 - 1] + x[x.length / 2]) / 2;
    return a + ': ' + x.length + ' calls, median ' + Math.round(med) + ' ms, 90th ' + x[Math.min(x.length - 1, Math.floor(x.length * 0.9))] + ' ms, slowest ' + x[x.length - 1] + ' ms';
  });
  Logger.log(out.join('\n') || 'No calls logged yet');
  return out;
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

// Columns the server fills in; never compared when deciding whether a row changed.
var STAMPS = { id: 1, updated_at: 1, updated_by: 1, created_at: 1, created_by: 1 };

function stamp_(head, values, now) {
  var at = head.indexOf('updated_at');
  var by = head.indexOf('updated_by');
  if (at >= 0) values[at] = now;
  if (by >= 0) values[by] = REQ_ ? REQ_.user.name : '';
}

// Writes rows by id. A row that comes back exactly as it is in the Sheet is left alone, so
// "last edited by" and the change log only move when something really changed.
function upsert_(name, rows) {
  var sh = sheet_(name);
  var head = headers_(sh);
  var pos = idRows_(sh, head);
  var now = new Date().toISOString();
  var createdBy = head.indexOf('created_by');
  var createdAt = head.indexOf('created_at');
  var appends = [];
  var out = [];
  rows.forEach(function (row) {
    if (!row || !row.id) throw new Error('Row without id in ' + name);
    var at = pos[String(row.id)];
    if (at === -1) return; // same id twice in one save: the first one stands
    if (at) {
      var current = sh.getRange(at, 1, 1, head.length).getValues()[0];
      var merged = head.map(function (h, i) {
        return h in row && h !== 'updated_at' && h !== 'updated_by' && h !== 'created_by' ? toCell_(h, row[h]) : current[i];
      });
      var diffs = [];
      head.forEach(function (h, i) {
        if (h && !STAMPS[h] && norm_(h, current[i]) !== norm_(h, merged[i])) diffs.push({ field: h, from: fromCell_(h, current[i]), to: fromCell_(h, merged[i]) });
      });
      if (!diffs.length) {
        out.push(rowObj_(head, current));
        return;
      }
      stamp_(head, merged, now);
      sh.getRange(at, 1, 1, head.length).setValues([merged]);
      var obj = rowObj_(head, merged);
      note_(name, 'changed', obj, diffs);
      out.push(obj);
    } else {
      var values = head.map(function (h) { return toCell_(h, row[h]); });
      stamp_(head, values, now);
      if (createdBy >= 0) values[createdBy] = REQ_ ? REQ_.user.name : '';
      if (createdAt >= 0 && values[createdAt] === '') values[createdAt] = now;
      appends.push(values);
      pos[String(row.id)] = -1;
      var added = rowObj_(head, values);
      note_(name, 'added', added, []);
      out.push(added);
    }
  });
  if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, head.length).setValues(appends);
  return out;
}

function delete_(name, ids) {
  var sh = sheet_(name);
  var head = headers_(sh);
  var pos = idRows_(sh, head);
  var rowsToDelete = (ids || []).map(function (id) { return pos[String(id)]; }).filter(function (n) { return n; });
  if (!rowsToDelete.length) return;
  var all = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues();
  rowsToDelete.forEach(function (n) { note_(name, 'deleted', rowObj_(head, all[n - 2]), []); });
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

// ---------- change log ----------
// One line per thing a person did: "Ishaan changed Natural Crape 67: Price 52 → 54; warp 75D: Ends 4000 → 4200".
// Yarn lines, unit links and photos are reported under their fabric; rates under their yarn;
// loom groups, TFO types and speeds under their unit.

var LOG_TAB = 'Change log';
var LOG_COLS = ['When', 'Who', 'Action', 'Type', 'Item', 'Details', 'Ref'];
var ROOT_OF = {
  FabricYarns: ['Fabrics', 'fabric_id'],
  Assignments: ['Fabrics', 'fabric_id'],
  FabricBeams: ['Fabrics', 'fabric_id'],
  Photos: ['Fabrics', 'fabric_id'],
  YarnRates: ['Yarns', 'yarn_id'],
  LoomGroups: ['Units', 'unit_id'],
  TfoTypes: ['Units', 'unit_id'],
  TfoSpeeds: ['Units', 'unit_id'],
  TfoBalanceLines: ['TfoBalancePlans', 'plan_id']
};
var KIND = { Fabrics: 'Fabric', Yarns: 'Yarn', Units: 'Unit', TfoBalancePlans: 'TFO plan' };
var ID_REF = { yarn_id: 'Yarns', base_yarn_id: 'Yarns', unit_id: 'Units', tfo_type_id: 'TfoTypes', fabric_id: 'Fabrics', loom_group_id: 'LoomGroups', plan_id: 'TfoBalancePlans' };
var LABELS = {
  name: 'Name', weave: 'Weave', design_note: 'Design', end_use: 'End use', reed: 'Reed', ppi: 'PPI', reed_space_in: 'RS',
  greige_width_in: 'Greige width', warp_shortage_pct: 'Warp shortage %', weft_shortage_pct: 'Weft shortage %', price: 'Price', sale_date: 'Sale date',
  vatav_pct: 'VATAV %', finish: 'Finish', rfd_shortage_pct: 'RFD shortage %', processing_charge: 'Processing charge',
  brokering_pct: 'Brokering %', transport_charge: 'Transportation', loom_rpm: 'Loom RPM', loom_rpm_dp: 'Loom RPM double panna', loom_eff_pct: 'Loom efficiency %',
  notes: 'Notes', kind: 'Kind', base_yarn_id: 'Base yarn', material: 'Material', form: 'Form', count: 'Count',
  count_unit: 'Count unit', filaments: 'Filaments', lustre: 'Lustre', tpm: 'TPM', twist: 'Twist', tpm_delta: 'TPM delta',
  beam_length_m: 'Beam length (m)', type: 'Type', cost_per_pick: 'Cost per pick', has_tfo: 'TFO', tfo_default_eff: 'TFO efficiency', side: 'Side',
  yarn_id: 'Yarn', ends: 'Ends', parts: 'Pick share', pattern: 'Pattern', rate: 'Rate', effective_date: 'From',
  make: 'Make', reed_width_cm: 'Reed width cm', shedding: 'Shedding', looms: 'Looms', rpm: 'RPM', efficiency: 'Efficiency',
  tfo_type_id: 'TFO type', unit_id: 'Unit', caption: 'Caption', is_cover: 'Cover',
  machines: 'Machines', spindles_per_side: 'Spindles per side', loom_group_id: 'Loom group', plan_date: 'Plan date'
};

function note_(table, action, row, diffs) {
  if (!REQ_) return;
  REQ_.events.push({ table: table, action: action, row: row, diffs: diffs });
  if (action === 'deleted') REQ_.gone[table + ':' + row.id] = label_(table, row);
}

function logTime_() {
  return Utilities.formatDate(new Date(), ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function logSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName(LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(LOG_TAB);
    sh.getRange(1, 1, 1, LOG_COLS.length).setValues([LOG_COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, sh.getMaxRows() - 1, LOG_COLS.length).setNumberFormat('@');
  }
  return sh;
}

function appendLog_(lines) {
  if (!lines.length) return;
  try {
    var sh = logSheet_();
    sh.getRange(sh.getLastRow() + 1, 1, lines.length, LOG_COLS.length).setValues(lines);
  } catch (e) {
    /* the save itself already went through; a missed log line must not undo it */
  }
}

function readLog_(limit) {
  var n = Math.min(Math.max(Number(limit) || 150, 1), 500);
  var sh = ss_().getSheetByName(LOG_TAB);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var start = Math.max(2, last - n + 1);
  var values = sh.getRange(start, 1, last - start + 1, LOG_COLS.length).getValues();
  return values.reverse().map(function (r) {
    var when = r[0] instanceof Date ? Utilities.formatDate(r[0], ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm:ss') : String(r[0]);
    return { when: when, who: String(r[1]), action: String(r[2]), type: String(r[3]), item: String(r[4]), details: String(r[5]), ref: String(r[6] || '') };
  });
}

// Name + RS; finished (RFD) fabrics get " (RFD)" after the RS, e.g. "Gajji Silk 41 (RFD)".
function fabricLabel_(f) {
  var rfd = f.finish === 'RFD';
  var name = String(f.name || '').trim();
  var m = name.match(/^(.*?)((?: \(copy\))*)$/);
  var head = m[1];
  var tail = m[2];
  if (rfd) head = head.replace(/\s*\(RFD\)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
  var suffix = rfd ? ' (RFD)' : '';
  var rs = Number(f.reed_space_in);
  if (f.reed_space_in === '' || f.reed_space_in === null || f.reed_space_in === undefined || !isFinite(rs)) return (head + suffix + tail).trim();
  var r = String(Math.round(rs));
  var hm = head.match(/^(.*?)\s*-?\s*(\d+(?:\.\d+)?)$/);
  if (hm && hm[1] && (hm[2] === r || Number(hm[2]) === Math.round(rs))) return (head + suffix + tail).trim();
  return (head + ' ' + r + suffix + tail).trim();
}

function label_(table, row) {
  if (!row) return '';
  if (table === 'Fabrics') return fabricLabel_(row);
  if (table === 'TfoBalancePlans') return String(row.name || 'Plan') + (row.plan_date ? ' (' + String(row.plan_date).slice(0, 10) + ')' : '');
  if (table === 'LoomGroups') return [row.make, row.reed_width_cm ? row.reed_width_cm + ' cm' : '', row.shedding].filter(function (x) { return x; }).join(' ') || 'loom group';
  return String(row.name || row.id || '');
}

function nameOf_(table, id) {
  if (id === '' || id === null || id === undefined) return '';
  var key = table + ':' + id;
  if (REQ_.gone[key]) return REQ_.gone[key];
  if (!REQ_.names[table]) {
    var map = {};
    readTable_(table).forEach(function (r) { map[r.id] = label_(table, r); });
    REQ_.names[table] = map;
  }
  return REQ_.names[table][String(id)] || '';
}

function show_(h, v) {
  if (v === '' || v === null || v === undefined) return 'blank';
  if (BOOLEAN[h]) return v ? 'Yes' : 'No';
  if (ID_REF[h]) return nameOf_(ID_REF[h], v) || String(v);
  var s = String(v);
  return s.length > 40 ? s.slice(0, 39) + '…' : s;
}

function diffText_(d) {
  if (d.field === 'sort' || d.field === 'summary' || STAMPS[d.field]) return '';
  return (LABELS[d.field] || d.field.replace(/_/g, ' ')) + ' ' + show_(d.field, d.from) + ' → ' + show_(d.field, d.to);
}

function fieldDiffs_(ev, what) {
  var parts = ev.diffs.map(diffText_).filter(String);
  return parts.length ? what + ': ' + parts.join(', ') : '';
}

function describe_(ev) {
  var r = ev.row;
  var a = ev.action;
  switch (ev.table) {
    case 'FabricYarns': {
      var line = (r.side || 'yarn') + ' ' + (nameOf_('Yarns', r.yarn_id) || 'yarn');
      if (a === 'added') return 'added ' + line;
      if (a === 'deleted') return 'removed ' + line;
      // when the yarn itself was swapped, name the line by its side only: "weft: Yarn 30s Viscose → 40D Nylon"
      var swapped = ev.diffs.some(function (d) { return d.field === 'yarn_id'; });
      return fieldDiffs_(ev, swapped ? r.side || 'yarn' : line);
    }
    case 'Assignments':
      if (a === 'added') return 'added to ' + (nameOf_('Units', r.unit_id) || 'a unit');
      if (a === 'deleted') return 'removed from ' + (nameOf_('Units', r.unit_id) || 'a unit');
      return '';
    case 'FabricBeams': {
      var fb = 'beam length on ' + (nameOf_('LoomGroups', r.loom_group_id) || 'loom group');
      if (a === 'added') return fb + (r.beam_length_m !== '' ? ' ' + r.beam_length_m + ' m' : '');
      if (a === 'deleted') return fb + ' removed';
      return fieldDiffs_(ev, fb);
    }
    case 'Photos':
      if (a === 'added') return 'photo added';
      if (a === 'deleted') return 'photo deleted';
      return ev.diffs.some(function (d) { return d.field === 'is_cover'; }) ? 'cover photo changed' : fieldDiffs_(ev, 'photo');
    case 'YarnRates': {
      var rate = 'rate ₹' + show_('rate', r.rate) + ' from ' + show_('effective_date', r.effective_date);
      if (a === 'added') return 'new ' + rate;
      if (a === 'deleted') return rate + ' deleted';
      return fieldDiffs_(ev, 'rate from ' + show_('effective_date', r.effective_date));
    }
    case 'TfoSpeeds': {
      var sp = (nameOf_('Yarns', r.yarn_id) || 'yarn') + ' on ' + (nameOf_('TfoTypes', r.tfo_type_id) || 'TFO');
      if (a === 'added') return 'speed added for ' + sp + (r.rpm !== '' ? ', RPM ' + r.rpm : '');
      if (a === 'deleted') return 'speed removed for ' + sp;
      return fieldDiffs_(ev, sp);
    }
    case 'TfoTypes':
      if (a === 'added') return 'TFO type ' + r.name + ' added';
      if (a === 'deleted') return 'TFO type ' + r.name + ' removed';
      return fieldDiffs_(ev, 'TFO type ' + r.name);
    case 'LoomGroups': {
      var lg = [r.make, r.reed_width_cm ? r.reed_width_cm + ' cm' : '', r.shedding].filter(String).join(' ') || 'loom group';
      if (a === 'added') return 'loom group added: ' + lg;
      if (a === 'deleted') return 'loom group removed: ' + lg;
      return fieldDiffs_(ev, 'loom group ' + lg);
    }
    case 'TfoBalanceLines':
      return 'plan inputs changed';
    default:
      return '';
  }
}

function uniq_(list) {
  var seen = {};
  return list.filter(function (x) {
    if (!x || seen[x]) return false;
    seen[x] = 1;
    return true;
  });
}

// Marks a fabric, yarn or unit as edited when only its yarn lines, links, photos, rates or speeds changed.
function touch_(table, id) {
  var sh = sheet_(table);
  var head = headers_(sh);
  var at = idRows_(sh, head)[String(id)];
  if (!at) return null;
  var values = sh.getRange(at, 1, 1, head.length).getValues()[0];
  stamp_(head, values, new Date().toISOString());
  sh.getRange(at, 1, 1, head.length).setValues([values]);
  return rowObj_(head, values);
}

// Writes the change log for this request. Returns extra upserts for the rows touch_ stamped,
// so the device that saved sees the new "last edited by" at once.
function finish_() {
  if (!REQ_ || !REQ_.events.length) return [];
  var events = REQ_.events;
  REQ_.events = [];
  REQ_.names = {};
  var groups = [];
  var byKey = {};
  var deleted = {};
  events.forEach(function (ev) {
    if (KIND[ev.table] && ev.action === 'deleted') deleted[ev.table + ':' + ev.row.id] = 1;
  });
  events.forEach(function (ev) {
    var link = ROOT_OF[ev.table];
    var root = link ? { table: link[0], id: String(ev.row[link[1]] || '') } : { table: ev.table, id: String(ev.row.id) };
    if (!root.id || !KIND[root.table]) return;
    var key = root.table + ':' + root.id;
    if (link && !deleted[key]) {
      // a unit link or TFO speed that went with a deleted unit or yarn is part of that delete
      var goneWith = Object.keys(ID_REF).some(function (h) { return ev.row[h] && deleted[ID_REF[h] + ':' + ev.row[h]]; });
      if (goneWith) return;
    }
    if (!byKey[key]) {
      byKey[key] = { root: root, self: null, kids: [] };
      groups.push(byKey[key]);
    }
    if (link) byKey[key].kids.push(ev);
    else byKey[key].self = ev;
  });
  var who = REQ_.user.name;
  var when = logTime_();
  var lines = [];
  var extra = [];
  groups.forEach(function (g) {
    var kind = KIND[g.root.table];
    var self = g.self;
    if (self && self.action === 'deleted') {
      lines.push([when, who, 'deleted', kind, label_(g.root.table, self.row), '', g.root.id]);
      return;
    }
    if (g.root.table === 'TfoBalancePlans') {
      // TFO plans: "saved", "updated" or "deleted", with the plan's name and date as the item.
      if (self && self.action === 'added') {
        lines.push([when, who, 'saved', kind, label_(g.root.table, self.row), nameOf_('Units', self.row.unit_id) || '', g.root.id]);
        return;
      }
      var pd = uniq_((self ? self.diffs.map(diffText_) : []).concat(g.kids.map(describe_)));
      if (!pd.length) return;
      lines.push([when, who, 'updated', kind, self ? label_(g.root.table, self.row) : nameOf_(g.root.table, g.root.id) || g.root.id, pd.join('; '), g.root.id]);
      if (!self) {
        var tp = touch_(g.root.table, g.root.id);
        if (tp) extra.push({ op: 'upsert', table: g.root.table, rows: [tp] });
      }
      return;
    }
    if (self && self.action === 'added') {
      var with_ = g.kids.filter(function (k) { return k.table === 'Assignments' || k.table === 'YarnRates'; }).map(describe_);
      lines.push([when, who, 'added', kind, label_(g.root.table, self.row), uniq_(with_).join('; '), g.root.id]);
      return;
    }
    var details = self ? self.diffs.map(diffText_) : [];
    g.kids.forEach(function (k) { details.push(describe_(k)); });
    details = uniq_(details);
    if (!details.length) return;
    lines.push([when, who, 'changed', kind, self ? label_(g.root.table, self.row) : nameOf_(g.root.table, g.root.id) || g.root.id, details.join('; '), g.root.id]);
    if (!self) {
      var touched = touch_(g.root.table, g.root.id);
      if (touched) extra.push({ op: 'upsert', table: g.root.table, rows: [touched] });
    }
  });
  appendLog_(lines);
  return extra;
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
  return writing_(function () {
    var saved = upsert_('Photos', [row])[0];
    finish_();
    return saved;
  });
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
  if (!row) return null;
  [row.file_id, row.thumb_file_id].forEach(function (fid) {
    if (!fid) return;
    try {
      DriveApp.getFileById(fid).setTrashed(true);
    } catch (e) {
      /* already gone */
    }
  });
  return writing_(function () {
    delete_('Photos', [row.id]);
    finish_();
  });
}

function saveExport_(p) {
  if (!p.name || !p.base64) throw new Error('Export file is missing');
  var folder = folder_('EXPORTS_FOLDER_ID', 'Fabric Master Exports');
  var blob = Utilities.newBlob(Utilities.base64Decode(p.base64), p.mime || 'application/octet-stream', String(p.name).replace(/[\\/]/g, '-'));
  return folder.createFile(blob).getUrl();
}

// ---------- remembered planning-sheet names ----------
// What you confirmed in the photo import ("SALSA ANMOL-54(5909)" at 280 cm = this fabric) lives in a spreadsheet of its
// own, "Fabric Master – Sheet Names", made on the first save and kept next to this Sheet in Drive. It is not a tab of
// this workbook. You can open it and fix or delete a row by hand. Everything is stored as text.

var NAMES_TAB = 'Names';
var NAMES_COLS = ['unit_id', 'width_cm', 'sheet_text', 'fabric_id', 'fabric_name', 'updated_at', 'updated_by'];

function namesSheet_(create) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_NAMES_ID');
  var book = null;
  if (id) {
    try {
      book = SpreadsheetApp.openById(id);
    } catch (e) {
      book = null;
    }
  }
  if (!book) {
    if (!create) return null;
    book = SpreadsheetApp.create('Fabric Master – Sheet Names');
    try {
      var parents = DriveApp.getFileById(ss_().getId()).getParents();
      if (parents.hasNext()) DriveApp.getFileById(book.getId()).moveTo(parents.next());
    } catch (e) {
      /* stays in My Drive; still found by its id */
    }
    props.setProperty('SHEET_NAMES_ID', book.getId());
  }
  var sh = book.getSheetByName(NAMES_TAB);
  if (!sh) {
    if (!create) return null;
    sh = book.getSheets()[0];
    sh.setName(NAMES_TAB);
  }
  if (create && sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, NAMES_COLS.length).setValues([NAMES_COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, sh.getMaxRows() - 1, NAMES_COLS.length).setNumberFormat('@');
  }
  return sh;
}

function readNames_() {
  var sh = namesSheet_(false);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getRange(2, 1, sh.getLastRow() - 1, NAMES_COLS.length).getValues();
  return values
    .filter(function (r) { return String(r[2]).trim() !== '' && String(r[3]).trim() !== ''; })
    .map(function (r) {
      return { unit_id: String(r[0]), width_cm: Number(r[1]), sheet_text: String(r[2]), fabric_id: String(r[3]), fabric_name: String(r[4]) };
    });
}

function saveNames_(rows) {
  rows = (rows || []).slice(0, 300);
  if (!rows.length) return;
  var sh = namesSheet_(true);
  var last = sh.getLastRow();
  var pos = {};
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, 3).getValues().forEach(function (r, i) {
      pos[String(r[0]) + '|' + String(r[1]) + '|' + String(r[2])] = i + 2;
    });
  }
  var now = new Date().toISOString();
  var who = REQ_ ? REQ_.user.name : '';
  var appends = [];
  rows.forEach(function (r) {
    var text = String(r.sheet_text || '').trim();
    var fid = String(r.fabric_id || '').trim();
    if (!text || !fid) return;
    var key = String(r.unit_id || '') + '|' + String(Number(r.width_cm) || '') + '|' + text;
    var line = [String(r.unit_id || ''), String(Number(r.width_cm) || ''), text, fid, String(r.fabric_name || ''), now, who];
    if (pos[key]) sh.getRange(pos[key], 1, 1, NAMES_COLS.length).setValues([line]);
    else {
      pos[key] = -1;
      appends.push(line);
    }
  });
  if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, NAMES_COLS.length).setValues(appends);
}
