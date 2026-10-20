// Minimal in-memory stand-ins for the Apps Script services Code.gs uses. Test-only.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

class Range {
  constructor(sheet, row, col, rows, cols) {
    Object.assign(this, { sheet, row, col, rows, cols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const line = [];
      for (let c = 0; c < this.cols; c++) line.push(this.sheet.cell(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  setValues(v) {
    v.forEach((line, r) => line.forEach((x, c) => this.sheet.put(this.row + r, this.col + c, x)));
    return this;
  }
  setValue(x) {
    this.sheet.put(this.row, this.col, x);
    return this;
  }
  setNumberFormat() {
    this.sheet.formatCalls++;
    return this;
  }
  setFontWeight() {
    return this;
  }
}

class Sheet {
  constructor(name) {
    this.name = name;
    this.data = [];
    this.formatCalls = 0;
  }
  getName() { return this.name; }
  cell(r, c) { return (this.data[r - 1] && this.data[r - 1][c - 1] !== undefined) ? this.data[r - 1][c - 1] : ''; }
  put(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    const row = this.data[r - 1];
    while (row.length < c) row.push('');
    // mimic Sheets: an ISO date string in a non-text cell would become a Date; text format keeps strings
    row[c - 1] = v;
  }
  getRange(r, c, rows = 1, cols = 1) { return new Range(this, r, c, rows, cols); }
  getLastRow() {
    for (let i = this.data.length; i > 0; i--) if (this.data[i - 1].some((v) => v !== '' && v !== null && v !== undefined)) return i;
    return 0;
  }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.reduce((k, v, i) => (v !== '' && v !== undefined ? i + 1 : k), 0)), 0); }
  getMaxRows() { return 1000; }
  setFrozenRows() {}
  deleteRow(r) { this.data.splice(r - 1, 1); }
}

export function loadCodeGs() {
  const sheets = [new Sheet('Sheet1')];
  const props = {};
  const files = {};
  const folders = {};
  const ss = {
    getSheets: () => sheets,
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => { const s = new Sheet(n); sheets.push(s); return s; },
    deleteSheet: (s) => sheets.splice(sheets.indexOf(s), 1),
    getId: () => 'ss1',
    getName: () => 'Fabric Master DB',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/ss1',
    getSpreadsheetTimeZone: () => 'Asia/Kolkata',
  };
  const mkFolder = (name) => {
    const id = `fold_${Object.keys(folders).length + 1}`;
    const folder = {
      id, name,
      getId: () => id,
      createFolder: (n) => mkFolder(n),
      createFile: (blob) => {
        const fid = `file_${Object.keys(files).length + 1}`;
        files[fid] = { blob, trashed: false };
        return { getId: () => fid, getUrl: () => `https://drive.google.com/file/d/${fid}` };
      },
    };
    folders[id] = folder;
    return folder;
  };
  const root = mkFolder('My Drive');
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => { throw new Error('no ui in tests'); } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      formatDate: (d) => d.toISOString().slice(0, 10),
      base64Decode: (s) => [...Buffer.from(s, 'base64')],
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
      newBlob: (bytes, type, name) => ({ bytes, type, name, getBytes: () => bytes, getContentType: () => type }),
    },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ text: s, setMimeType() { return this; }, getContent() { return s; } }) },
    DriveApp: {
      getFileById: (id) => {
        if (id === 'ss1') return { getParents: () => ({ hasNext: () => true, next: () => root }) };
        const f = files[id];
        if (!f) throw new Error('no file');
        return { getBlob: () => f.blob, setTrashed: (t) => { f.trashed = t; } };
      },
      getFolderById: (id) => { if (!folders[id]) throw new Error('no folder'); return folders[id]; },
      getRootFolder: () => root,
    },
    Logger: { log() {} },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('./Code.gs', import.meta.url), 'utf8'), ctx);
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  return { ctx, ss, sheets, props, files, post };
}
