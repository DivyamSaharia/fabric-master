// App state: tables, settings, connection status. Every change goes to the backend first;
// the phone only updates once the Sheet (or demo store) has accepted it.
import { useEffect, useState } from 'preact/hooks';
import { baseFabric, buildIndex, fabricLabel, num, stripRs, truthy } from './calc.js';
import { applyOps, demoBackend, sheetBackend } from './api.js';
import { local } from './storage.js';
import { emptyTables, newId, today } from './schema.js';
import { compressImage } from './photos.js';

const SETTINGS_KEY = 'fm.settings.v1';
const CACHE_KEY = 'fm.cache.v1';
const FILTERS_KEY = 'fm.savedFilters.v1';

const listeners = new Set();
let state = {
  tables: emptyTables(),
  meta: {},
  // read now, so a screen opened straight from a link (e.g. Settings) starts from the saved source
  settings: { mode: 'demo', url: '', key: '', ...(local.get(SETTINGS_KEY, {}) || {}) },
  status: { loading: true, error: null, lastSync: null },
  syncing: false,
  toast: null,
};
let backend = demoBackend();
// Bumped before and after every write, so a reload that started before a save
// can't put back the old rows when it lands after the save.
let mutationSeq = 0;
let inflight = 0;
let indexCache = { tables: null, idx: null };

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

export const getState = () => state;

export function getIndex() {
  if (indexCache.tables !== state.tables) indexCache = { tables: state.tables, idx: buildIndex(state.tables) };
  return indexCache.idx;
}

export function useStore() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return state;
}

export function toast(message, kind = 'info') {
  const id = Date.now();
  set({ toast: { id, message, kind } });
  setTimeout(() => {
    if (state.toast && state.toast.id === id) set({ toast: null });
  }, 3200);
}

function makeBackend(settings) {
  return settings.mode === 'sheet' && settings.url && settings.key ? sheetBackend(settings.url, settings.key) : demoBackend();
}

export async function init() {
  const settings = { ...state.settings, ...local.get(SETTINGS_KEY, {}) };
  backend = makeBackend(settings);
  const cached = backend.mode === 'sheet' ? local.get(CACHE_KEY) : null;
  set({ settings, tables: cached ? { ...emptyTables(), ...cached.tables } : state.tables, meta: cached ? cached.meta || {} : {}, status: { loading: true, error: null, lastSync: cached ? cached.at : null } });
  await refresh();
}

export async function refresh() {
  const seq = mutationSeq;
  const b = backend;
  inflight += 1;
  if (inflight === 1) set({ syncing: true });
  let again = false;
  try {
    const { tables, meta } = await b.bootstrap();
    if (b !== backend) {
      // data source changed while loading; the new source's own load applies
    } else if (seq !== mutationSeq) {
      again = true;
    } else {
      const at = new Date().toISOString();
      if (b.mode === 'sheet') local.set(CACHE_KEY, { tables, meta, at });
      set({ tables, meta, status: { loading: false, error: null, lastSync: at } });
    }
  } catch (e) {
    if (b === backend && e.code === 'auth') {
      // The key no longer works (wrong, or the owner removed this person): drop the saved copy too.
      local.remove(CACHE_KEY);
      set({ tables: emptyTables(), meta: {}, status: { loading: false, error: e.message, lastSync: null } });
    } else if (b === backend) set({ status: { ...state.status, loading: false, error: e.message } });
  } finally {
    inflight -= 1;
    if (inflight === 0) set({ syncing: false });
  }
  if (again) await refresh();
}

// Keeps phone and laptop in step: reloads from the Sheet when the app comes back
// into view, and every minute while it is open.
export function startAutoSync({ everyMs = 60000, staleMs = 15000 } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const stale = (ms) => {
    const t = Date.parse(state.status.lastSync || '');
    return !t || Date.now() - t >= ms;
  };
  const check = (ms) => {
    if (backend.mode !== 'sheet' || inflight > 0 || state.status.loading) return;
    if (document.visibilityState === 'hidden') return;
    if (stale(ms)) refresh();
  };
  const onWake = () => check(staleMs);
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('focus', onWake);
  window.addEventListener('online', onWake);
  const timer = setInterval(() => check(everyMs - 2000), everyMs);
  return () => {
    document.removeEventListener('visibilitychange', onWake);
    window.removeEventListener('focus', onWake);
    window.removeEventListener('online', onWake);
    clearInterval(timer);
  };
}

export async function saveSettings(settings) {
  const next = { ...state.settings, ...settings };
  local.set(SETTINGS_KEY, next);
  backend = makeBackend(next);
  set({ settings: next, tables: emptyTables(), status: { loading: true, error: null, lastSync: null } });
  if (backend.mode !== 'sheet') local.remove(CACHE_KEY);
  await refresh();
}

export async function testConnection(url, key) {
  return sheetBackend(url, key).ping();
}

export function resetDemo() {
  demoBackend().reset();
  return refresh();
}

export async function commit(ops) {
  if (!ops.length) return;
  mutationSeq += 1;
  try {
    const applied = await backend.batch(ops);
    const tables = applyOps(state.tables, applied || ops);
    if (backend.mode === 'sheet') local.set(CACHE_KEY, { tables, meta: state.meta, at: new Date().toISOString() });
    set({ tables });
  } finally {
    mutationSeq += 1;
  }
}

export const backendMode = () => backend.mode;

// Who this device is signed in as, from the Sheet: { name, role: 'owner' | 'editor' }, or null.
export const me = () => (backend.mode === 'sheet' && state.meta && state.meta.me) || null;
export const fetchLog = (limit) => backend.log(limit);
export const people = {
  list: () => backend.people(),
  add: (name) => backend.addPerson(name),
  rename: (id, name) => backend.renamePerson(id, name),
  remove: (id) => backend.removePerson(id),
};

// ---------- domain actions ----------

export async function saveFabric(fabric, lines, unitIds) {
  fabric = baseFabric(fabric);
  const idx = getIndex();
  const isNew = !fabric.id;
  const f = { ...fabric, id: fabric.id || newId('f'), created_at: fabric.created_at || new Date().toISOString() };
  const oldLines = idx.linesByFabric[f.id] || [];
  const keep = lines.map((l, i) => ({ ...l, id: l.id || newId('l'), fabric_id: f.id, sort: i + 1 }));
  const keepIds = new Set(keep.map((l) => l.id));
  const dropLines = oldLines.filter((l) => !keepIds.has(l.id)).map((l) => l.id);
  const oldAssign = idx.assignmentsByFabric[f.id] || [];
  const wanted = new Set(unitIds);
  const dropAssign = oldAssign.filter((a) => !wanted.has(a.unit_id)).map((a) => a.id);
  const have = new Set(oldAssign.map((a) => a.unit_id));
  const addAssign = [...wanted].filter((u) => !have.has(u)).map((u) => ({ id: newId('a'), fabric_id: f.id, unit_id: u }));
  const ops = [{ op: 'upsert', table: 'Fabrics', rows: [f] }, { op: 'upsert', table: 'FabricYarns', rows: keep }];
  if (dropLines.length) ops.push({ op: 'delete', table: 'FabricYarns', ids: dropLines });
  if (addAssign.length) ops.push({ op: 'upsert', table: 'Assignments', rows: addAssign });
  if (dropAssign.length) ops.push({ op: 'delete', table: 'Assignments', ids: dropAssign });
  await commit(ops);
  toast(isNew ? 'Fabric added' : 'Fabric saved');
  return f.id;
}

export async function setAssignments(fabricId, unitIds) {
  const idx = getIndex();
  const fabric = idx.fabricsById[fabricId];
  const lines = idx.linesByFabric[fabricId] || [];
  await saveFabric(fabric, lines, unitIds);
}

export async function duplicateFabric(fabricId) {
  const idx = getIndex();
  const src = idx.fabricsById[fabricId];
  const lines = (idx.linesByFabric[fabricId] || []).map(({ id, fabric_id, updated_at, updated_by, ...rest }) => rest);
  const units = (idx.assignmentsByFabric[fabricId] || []).map((a) => a.unit_id);
  const { id, created_at, updated_at, updated_by, created_by, ...rest } = src;
  return saveFabric({ ...rest, base_name: undefined, name: `${src.base_name ?? src.name} (copy)` }, lines, units);
}

// Name for a copy at a new RS: the stored name without its RS, or "(copy)" if that name + RS is taken.
function rsCopyName(fabric, oldRs, newRs, fabrics) {
  const base = stripRs(fabric.base_name ?? fabric.name, oldRs);
  const shown = fabricLabel({ name: base, reed_space_in: newRs }).toLowerCase();
  return fabrics.some((f) => String(f.name || '').trim().toLowerCase() === shown) ? `${base} (copy)` : base;
}

// What "Duplicate for new RS" will create: warp ends and greige width scale with RS;
// the sale rate is the one entered, or scaled with RS.
export function rsCopyPlan(fabricId, newRs, price) {
  const idx = getIndex();
  const fabric = idx.fabricsById[fabricId];
  const oldRs = num(fabric.reed_space_in);
  const k = oldRs ? newRs / oldRs : null;
  const oldPrice = num(fabric.price);
  const width = num(fabric.greige_width_in);
  const lines = (idx.linesByFabric[fabricId] || []).map(({ id, fabric_id, updated_at, updated_by, ...rest }) => rest);
  return {
    fabric,
    oldRs,
    price: price !== null ? price : oldPrice === null || k === null ? null : Math.round(oldPrice * k * 100) / 100,
    width: width === null || k === null ? null : Math.round(width * k * 100) / 100,
    warp: lines.filter((l) => l.side === 'warp').map((l) => ({
      name: (idx.yarnsById[l.yarn_id] || {}).name || 'Yarn',
      from: num(l.ends),
      to: num(l.ends) === null || k === null ? null : Math.round(num(l.ends) * k),
    })),
    lines: lines.map((l) => (l.side === 'warp' && num(l.ends) !== null && k !== null ? { ...l, ends: Math.round(num(l.ends) * k) } : l)),
    units: (idx.assignmentsByFabric[fabricId] || []).map((a) => a.unit_id),
    name: oldRs ? rsCopyName(fabric, oldRs, newRs, Object.values(idx.fabricsById)) : '',
  };
}

export async function duplicateForRs(fabricId, newRs, price) {
  const plan = rsCopyPlan(fabricId, newRs, price);
  const { id, created_at, updated_at, updated_by, created_by, ...rest } = plan.fabric;
  return saveFabric(
    { ...rest, base_name: undefined, name: plan.name, reed_space_in: newRs, price: plan.price ?? '', greige_width_in: plan.width ?? rest.greige_width_in ?? '' },
    plan.lines,
    plan.units,
  );
}

export async function deleteFabric(fabricId) {
  const idx = getIndex();
  const ops = [
    { op: 'delete', table: 'FabricYarns', ids: (idx.linesByFabric[fabricId] || []).map((l) => l.id) },
    { op: 'delete', table: 'Assignments', ids: (idx.assignmentsByFabric[fabricId] || []).map((a) => a.id) },
    { op: 'delete', table: 'Fabrics', ids: [fabricId] },
  ].filter((o) => o.ids.length);
  for (const p of idx.photosByFabric[fabricId] || []) await backend.deletePhoto(p);
  await commit(ops);
  if ((idx.photosByFabric[fabricId] || []).length) await refresh();
  toast('Fabric deleted');
}

export async function saveYarn(yarn, rate, rateDate) {
  const y = { ...yarn, id: yarn.id || newId('y') };
  const ops = [{ op: 'upsert', table: 'Yarns', rows: [y] }];
  if (yarn.kind !== 'tpm' && rate !== null && rate !== undefined && rate !== '') {
    const idx = getIndex();
    const date = rateDate || today();
    const existing = (idx.ratesByYarn[y.id] || []).find((r) => String(r.effective_date) === date);
    ops.push({ op: 'upsert', table: 'YarnRates', rows: [{ id: existing ? existing.id : newId('r'), yarn_id: y.id, rate: Number(rate), effective_date: date }] });
  }
  await commit(ops);
  toast(yarn.id ? 'Yarn saved' : 'Yarn added');
  return y.id;
}

export function yarnUsage(yarnId) {
  const idx = getIndex();
  const fabrics = new Set((idx.tables.FabricYarns || []).filter((l) => l.yarn_id === yarnId).map((l) => l.fabric_id));
  const tpmChildren = (idx.tables.Yarns || []).filter((y) => y.base_yarn_id === yarnId);
  return { fabrics: fabrics.size, tpmChildren: tpmChildren.length };
}

export async function deleteRates(ids) {
  if (!ids.length) return;
  await commit([{ op: 'delete', table: 'YarnRates', ids }]);
  toast(ids.length === 1 ? 'Rate deleted' : `${ids.length} rates deleted`);
}

export async function deleteYarn(yarnId) {
  const idx = getIndex();
  await commit([
    { op: 'delete', table: 'YarnRates', ids: (idx.ratesByYarn[yarnId] || []).map((r) => r.id) },
    { op: 'delete', table: 'TfoSpeeds', ids: (idx.tables.TfoSpeeds || []).filter((s) => s.yarn_id === yarnId).map((s) => s.id) },
    { op: 'delete', table: 'Yarns', ids: [yarnId] },
  ].filter((o) => o.ids.length));
  toast('Yarn deleted');
}

export async function saveUnit(unit, loomGroups, tfoTypes) {
  const idx = getIndex();
  const u = { ...unit, id: unit.id || newId('u'), has_tfo: truthy(unit.has_tfo) };
  const lg = loomGroups.map((g) => ({ ...g, id: g.id || newId('lg'), unit_id: u.id }));
  const tt = tfoTypes.filter((t) => String(t.name || '').trim()).map((t) => ({ ...t, id: t.id || newId('tt'), unit_id: u.id }));
  const dropLg = (idx.loomGroupsByUnit[u.id] || []).filter((g) => !lg.some((x) => x.id === g.id)).map((g) => g.id);
  const dropTt = (idx.tfoTypesByUnit[u.id] || []).filter((t) => !tt.some((x) => x.id === t.id)).map((t) => t.id);
  const dropSp = (idx.speedsByUnit[u.id] || []).filter((s) => dropTt.includes(s.tfo_type_id)).map((s) => s.id);
  const ops = [{ op: 'upsert', table: 'Units', rows: [u] }];
  if (lg.length) ops.push({ op: 'upsert', table: 'LoomGroups', rows: lg });
  if (tt.length) ops.push({ op: 'upsert', table: 'TfoTypes', rows: tt });
  if (dropLg.length) ops.push({ op: 'delete', table: 'LoomGroups', ids: dropLg });
  if (dropSp.length) ops.push({ op: 'delete', table: 'TfoSpeeds', ids: dropSp });
  if (dropTt.length) ops.push({ op: 'delete', table: 'TfoTypes', ids: dropTt });
  await commit(ops);
  toast(unit.id ? 'Unit saved' : 'Unit added');
  return u.id;
}

export async function deleteUnit(unitId) {
  const idx = getIndex();
  await commit([
    { op: 'delete', table: 'Assignments', ids: (idx.assignmentsByUnit[unitId] || []).map((a) => a.id) },
    { op: 'delete', table: 'TfoSpeeds', ids: (idx.speedsByUnit[unitId] || []).map((s) => s.id) },
    { op: 'delete', table: 'TfoTypes', ids: (idx.tfoTypesByUnit[unitId] || []).map((t) => t.id) },
    { op: 'delete', table: 'LoomGroups', ids: (idx.loomGroupsByUnit[unitId] || []).map((g) => g.id) },
    { op: 'delete', table: 'Units', ids: [unitId] },
  ].filter((o) => o.ids.length));
  toast('Unit deleted');
}

export async function saveSpeed(speed) {
  const idx = getIndex();
  const dupe = (idx.speedsByUnit[speed.unit_id] || []).find((s) => s.id !== speed.id && s.yarn_id === speed.yarn_id && s.tfo_type_id === speed.tfo_type_id);
  const row = { ...speed, id: speed.id || (dupe && dupe.id) || newId('sp') };
  await commit([{ op: 'upsert', table: 'TfoSpeeds', rows: [row] }]);
  toast('Speed saved');
}

export async function deleteSpeed(id) {
  await commit([{ op: 'delete', table: 'TfoSpeeds', ids: [id] }]);
  toast('Speed removed');
}

export async function addPhoto(fabricId, file) {
  const idx = getIndex();
  const existing = idx.photosByFabric[fabricId] || [];
  const image = await compressImage(file, 1600, 0.82);
  const thumb = await compressImage(file, 360, 0.72);
  const photo = { id: newId('p'), fabric_id: fabricId, caption: '', is_cover: existing.length === 0, created_at: new Date().toISOString() };
  mutationSeq += 1;
  try {
    const row = await backend.uploadPhoto({ photo, image, thumb });
    set({ tables: applyOps(state.tables, [{ op: 'upsert', table: 'Photos', rows: [row] }]) });
  } finally {
    mutationSeq += 1;
  }
  toast('Photo added');
}

export async function setCover(photo) {
  const idx = getIndex();
  const rows = (idx.photosByFabric[photo.fabric_id] || []).map((p) => ({ ...p, is_cover: p.id === photo.id }));
  await commit([{ op: 'upsert', table: 'Photos', rows }]);
  toast('Cover photo set');
}

export async function deletePhoto(photo) {
  mutationSeq += 1;
  let tables;
  try {
    await backend.deletePhoto(photo);
    tables = applyOps(state.tables, [{ op: 'delete', table: 'Photos', ids: [photo.id] }]);
    set({ tables });
  } finally {
    mutationSeq += 1;
  }
  if (truthy(photo.is_cover)) {
    const rest = buildIndex(tables).photosByFabric[photo.fabric_id] || [];
    if (rest.length) await setCover(rest[0]);
  }
  toast('Photo deleted');
}

export function setPendingShare(pending) {
  set({ pendingShare: pending });
}

export const getPhoto = (photo, size) => backend.getPhoto(photo, size);
export const saveExportToDrive = (args) => backend.saveExport(args);

export const savedFilters = {
  list: () => local.get(FILTERS_KEY, []),
  save(name, filters) {
    const list = savedFilters.list().filter((f) => f.name !== name);
    list.push({ name, filters });
    local.set(FILTERS_KEY, list);
  },
  remove(name) {
    local.set(FILTERS_KEY, savedFilters.list().filter((f) => f.name !== name));
  },
};
