// Two backends with the same interface:
// - demo: data kept on this phone (localStorage + IndexedDB), seeded with sample data
// - sheet: your Google Sheet through the Apps Script web app in backend/Code.gs
import { local, blobs } from './storage.js';
import { sampleTables } from './sampleData.js';
import { emptyTables, TABLE_NAMES } from './schema.js';

const DEMO_KEY = 'fm.demo.v1';
const NAMES_KEY = 'fm.sheetNames.v1';

// Merge confirmed planning-sheet names into a list (same unit + width + text replaces).
export function mergeNames(list, rows) {
  const out = [...list];
  const k = (r) => `${r.unit_id}|${Number(r.width_cm)}|${r.sheet_text}`;
  for (const r of rows) {
    const at = out.findIndex((x) => k(x) === k(r));
    const row = { unit_id: r.unit_id, width_cm: Number(r.width_cm), sheet_text: r.sheet_text, fabric_id: r.fabric_id, fabric_name: r.fabric_name || '' };
    if (at >= 0) out[at] = row;
    else out.push(row);
  }
  return out;
}

export function applyOps(tables, ops) {
  const next = { ...tables };
  for (const op of ops) {
    const rows = next[op.table] ? [...next[op.table]] : [];
    if (op.op === 'upsert') {
      const pos = new Map(rows.map((r, i) => [r.id, i]));
      for (const row of op.rows) {
        if (pos.has(row.id)) rows[pos.get(row.id)] = { ...rows[pos.get(row.id)], ...row };
        else {
          pos.set(row.id, rows.length);
          rows.push(row);
        }
      }
    } else if (op.op === 'delete') {
      const ids = new Set(op.ids);
      for (let i = rows.length - 1; i >= 0; i--) if (ids.has(rows[i].id)) rows.splice(i, 1);
    }
    next[op.table] = rows;
  }
  return next;
}

function stamp(ops) {
  const ts = new Date().toISOString();
  return ops.map((op) => (op.op === 'upsert' ? { ...op, rows: op.rows.map((r) => ({ ...r, updated_at: ts })) } : op));
}

async function notInDemo() {
  throw new Error('Connect your Google Sheet first.');
}

export function demoBackend() {
  const read = () => {
    const t = local.get(DEMO_KEY);
    if (t) return { ...emptyTables(), ...t };
    const seeded = { ...emptyTables(), ...sampleTables() };
    local.set(DEMO_KEY, seeded);
    return seeded;
  };
  return {
    mode: 'demo',
    async ping() {
      return { ok: true };
    },
    async bootstrap() {
      return { tables: read(), meta: {} };
    },
    async batch(ops) {
      const stamped = stamp(ops);
      local.set(DEMO_KEY, applyOps(read(), stamped));
      return stamped;
    },
    async uploadPhoto({ photo, image, thumb }) {
      await blobs.set(`full:${photo.id}`, image);
      await blobs.set(`thumb:${photo.id}`, thumb);
      const row = { ...photo, file_id: `local:${photo.id}`, thumb_file_id: `local:${photo.id}` };
      const [op] = await this.batch([{ op: 'upsert', table: 'Photos', rows: [row] }]);
      return op.rows[0];
    },
    async getPhoto(photo, size) {
      return blobs.get(`${size}:${photo.id}`);
    },
    async deletePhoto(photo) {
      await blobs.remove(`full:${photo.id}`);
      await blobs.remove(`thumb:${photo.id}`);
      await this.batch([{ op: 'delete', table: 'Photos', ids: [photo.id] }]);
    },
    async saveExport() {
      return null;
    },
    async log() {
      return [];
    },
    // Names confirmed in the planning-sheet photo import; kept on this phone in demo mode.
    async sheetNames() {
      return local.get(NAMES_KEY, []) || [];
    },
    async saveSheetNames(rows) {
      const next = mergeNames(local.get(NAMES_KEY, []) || [], rows);
      local.set(NAMES_KEY, next);
      return next;
    },
    people: notInDemo,
    addPerson: notInDemo,
    renamePerson: notInDemo,
    removePerson: notInDemo,
    reset() {
      local.remove(DEMO_KEY);
    },
  };
}

export function sheetBackend(url, key) {
  async function call(action, payload = {}) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        // text/plain keeps this a "simple" request, so Apps Script needs no CORS preflight
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ key, action, ...payload }),
        redirect: 'follow',
      });
    } catch {
      throw new Error('No connection to your Google Sheet. Check the signal and try again.');
    }
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error('The Sheet sent an unexpected reply. Check the web app URL in Settings.');
    }
    if (!data.ok) {
      const err = new Error(data.error || 'The Sheet refused the request.');
      // 'auth': the key is wrong or its access was removed
      if (data.code) err.code = data.code;
      throw err;
    }
    return data;
  }
  return {
    mode: 'sheet',
    ping: () => call('ping'),
    async bootstrap() {
      const data = await call('bootstrap');
      const tables = { ...emptyTables() };
      for (const t of TABLE_NAMES) tables[t] = data.tables[t] || [];
      return { tables, meta: data.meta || {} };
    },
    async batch(ops) {
      const data = await call('batch', { ops });
      return data.ops;
    },
    async uploadPhoto({ photo, image, thumb }) {
      const data = await call('uploadPhoto', { photo, image, thumb });
      await blobs.set(`full:${data.row.id}`, image);
      await blobs.set(`thumb:${data.row.id}`, thumb);
      return data.row;
    },
    async getPhoto(photo, size) {
      const cacheKey = `${size}:${photo.id}`;
      const cached = await blobs.get(cacheKey);
      if (cached) return cached;
      const data = await call('photo', { id: photo.id, size });
      if (data.dataUrl) await blobs.set(cacheKey, data.dataUrl);
      return data.dataUrl || null;
    },
    async deletePhoto(photo) {
      await call('deletePhoto', { id: photo.id });
      await blobs.remove(`full:${photo.id}`);
      await blobs.remove(`thumb:${photo.id}`);
    },
    async saveExport({ name, mime, base64 }) {
      const data = await call('saveExport', { name, mime, base64 });
      return data.url || null;
    },
    // Change log, newest first: { when, who, action, type, item, details, ref }
    async log(limit = 200) {
      const data = await call('log', { limit });
      return data.entries || [];
    },
    // Names confirmed in the photo import, kept in their own spreadsheet ("Fabric Master – Sheet Names").
    async sheetNames() {
      return (await call('sheetNames')).names || [];
    },
    async saveSheetNames(rows) {
      return (await call('saveSheetNames', { rows })).names || [];
    },
    // Owner only: everyone with a key, and adding, renaming or removing a person.
    async people() {
      return (await call('people')).people || [];
    },
    async addPerson(name) {
      return (await call('addPerson', { name })).person;
    },
    async renamePerson(id, name) {
      return (await call('renamePerson', { id, name })).people || [];
    },
    async removePerson(id) {
      return (await call('removePerson', { id })).people || [];
    },
  };
}
