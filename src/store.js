// App state: tables, settings, connection status. Every change goes to the backend first;
// the phone only updates once the Sheet (or demo store) has accepted it.
import { useEffect, useState } from 'preact/hooks';
import { baseFabric, buildIndex, fabricLabel, fmt, isTpm, num, stripRs, tpmDelta, truthy } from './calc.js';
import { applyOps, demoBackend, sheetBackend } from './api.js';
import { keepStorage, local, savedCopy } from './storage.js';
import { emptyTables, newId, today } from './schema.js';
import { saleDeletePlan, saleSaveOps } from './saleRates.js';
import { compressImage } from './photos.js';

const SETTINGS_KEY = 'fm.settings.v1';
// when this device last confirmed its copy is up to date (a light check, no full load)
const CHECKED_KEY = 'fm.cache.checked.v1';
// Edits made by hand that the Sheet's edit trigger can't see (deleting or sorting rows) show up within this time.
const FULL_EVERY_MS = 30 * 60000;
const FILTERS_KEY = 'fm.savedFilters.v1';
const TEMP_RATES_KEY = 'fm.tempRates.v1';
const TEMP_PRICES_KEY = 'fm.tempPrices.v1';
const TEMP_DELTAS_KEY = 'fm.tempDeltas.v1';
const TEMP_RPMS_KEY = 'fm.tempRpms.v1';

const listeners = new Set();
function readTempRates(key = TEMP_RATES_KEY) {
  const raw = local.get(key, {});
  const out = {};
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    const n = num(v);
    if (n !== null && n > 0) out[k] = n;
  }
  return out;
}

// Temporary TPM deltas: { tpmYarnId: delta }; zero is allowed.
function readTempDeltas() {
  const raw = local.get(TEMP_DELTAS_KEY, {});
  const out = {};
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    const n = num(v);
    if (n !== null && n >= 0) out[k] = n;
  }
  return out;
}

// Temporary loom RPMs: { fabricId: { sp, dp } }, either may be missing.
function readTempRpms() {
  const raw = local.get(TEMP_RPMS_KEY, {});
  const out = {};
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (!v || typeof v !== 'object') continue;
    const e = {};
    for (const w of ['sp', 'dp']) {
      const n = num(v[w]);
      if (n !== null && n > 0) e[w] = n;
    }
    if (Object.keys(e).length) out[k] = e;
  }
  return out;
}

let state = {
  tables: emptyTables(),
  meta: {},
  // read now, so a screen opened straight from a link (e.g. Settings) starts from the saved source
  settings: { mode: 'demo', url: '', key: '', ...(local.get(SETTINGS_KEY, {}) || {}) },
  // temporary yarn rates, this device only: { yarnId: rate }. Never sent to the Sheet.
  tempRates: readTempRates(),
  // temporary sale rates, this device only: { fabricId: price }. Never sent to the Sheet.
  tempPrices: readTempRates(TEMP_PRICES_KEY),
  // temporary TPM deltas { tpmYarnId: delta } and loom RPMs { fabricId: { sp, dp } }, this device only.
  tempDeltas: readTempDeltas(),
  tempRpms: readTempRpms(),
  status: { loading: true, error: null, lastSync: null },
  syncing: false,
  // Retry pressed and still trying
  retrying: false,
  // the copy kept on this device: { ok, at, where, error }
  copy: null,
  toast: null,
};
let backend = demoBackend();
// Bumped before and after every write, so a reload that started before a save
// can't put back the old rows when it lands after the save.
let mutationSeq = 0;
let inflight = 0;
let checking = 0;
// Data version (from the Sheet) that state.tables is complete at, or null when the next check must load in full.
let known = null;
// The script in the Sheet is older than v14 (no "version" call): every check is a full load, as before.
let legacy = false;
let lastFull = 0;
let indexCache = { tables: null, temp: null, tp: null, td: null, tr: null, idx: null };

function set(patch) {
  state = { ...state, ...patch };
  if (patch.tables) migrateTpmTemps();
  listeners.forEach((fn) => fn(state));
}

// Before 1.27.0 a temporary rate typed on a TPM yarn was its whole rate. Once the yarns are known, each such rate R
// becomes a temporary delta R − base rate in use (the base yarn's temporary rate, else its latest master rate), so
// the TPM yarn keeps showing R. With no base rate it is dropped. Runs only while such a rate is left.
function migrateTpmTemps() {
  const yarns = Object.fromEntries((state.tables.Yarns || []).map((y) => [y.id, y]));
  const old = Object.keys(state.tempRates).filter((id) => isTpm(yarns[id]));
  if (!old.length) return;
  const rates = { ...state.tempRates };
  const deltas = { ...state.tempDeltas };
  for (const id of old) {
    const baseId = yarns[id].base_yarn_id;
    const masters = (state.tables.YarnRates || []).filter((r) => r.yarn_id === baseId && num(r.rate) !== null)
      .sort((a, b) => String(b.effective_date || '').localeCompare(String(a.effective_date || '')));
    const b = num(rates[baseId]) ?? (masters.length ? num(masters[0].rate) : null);
    if (b !== null && !(id in deltas)) deltas[id] = Math.max(0, Math.round((rates[id] - b) * 100) / 100);
    delete rates[id];
  }
  if (Object.keys(rates).length) local.set(TEMP_RATES_KEY, rates);
  else local.remove(TEMP_RATES_KEY);
  if (Object.keys(deltas).length) local.set(TEMP_DELTAS_KEY, deltas);
  else local.remove(TEMP_DELTAS_KEY);
  state = { ...state, tempRates: rates, tempDeltas: deltas };
}

export const getState = () => state;

export function getIndex() {
  if (indexCache.tables !== state.tables || indexCache.temp !== state.tempRates || indexCache.tp !== state.tempPrices || indexCache.td !== state.tempDeltas || indexCache.tr !== state.tempRpms) {
    indexCache = { tables: state.tables, temp: state.tempRates, tp: state.tempPrices, td: state.tempDeltas, tr: state.tempRpms, idx: buildIndex(state.tables, state.tempRates, state.tempPrices, { tempDeltas: state.tempDeltas, tempRpms: state.tempRpms }) };
  }
  return indexCache.idx;
}

// ---------- temporary yarn rates (this device only) ----------
// Keyed by yarn id. A base yarn's temporary rate moves every TPM yarn on it (base + delta). A TPM yarn's temporary
// rate is typed as its two parts: a temporary delta (tempDeltas) and the base yarn's temporary rate (see calc.yarnRate).
function writeTempRates(next) {
  if (Object.keys(next).length) local.set(TEMP_RATES_KEY, next);
  else local.remove(TEMP_RATES_KEY);
  set({ tempRates: next });
}

export function setTempRate(yarnId, rate) {
  const n = num(rate);
  if (n === null || n <= 0) return false;
  writeTempRates({ ...state.tempRates, [yarnId]: n });
  return true;
}

export function clearTempRate(yarnId) {
  if (!(yarnId in state.tempRates)) return;
  const next = { ...state.tempRates };
  delete next[yarnId];
  writeTempRates(next);
}

function writeTempDeltas(next) {
  if (Object.keys(next).length) local.set(TEMP_DELTAS_KEY, next);
  else local.remove(TEMP_DELTAS_KEY);
  set({ tempDeltas: next });
}

// Temporary delta on a TPM yarn: zero or more.
export function setTempDelta(yarnId, delta) {
  const n = num(delta);
  if (n === null || n < 0) return false;
  writeTempDeltas({ ...state.tempDeltas, [yarnId]: Math.round(n * 100) / 100 });
  return true;
}

export function clearTempDelta(yarnId) {
  if (!(yarnId in state.tempDeltas)) return;
  const next = { ...state.tempDeltas };
  delete next[yarnId];
  writeTempDeltas(next);
}

export function clearAllTempRates() {
  if (Object.keys(state.tempRates).length) writeTempRates({});
  if (Object.keys(state.tempDeltas).length) writeTempDeltas({});
}

// Latest master (Sheet) rate of a base yarn, ignoring temporary rates, or null.
function latestMasterRate(idx, yarnId) {
  const rates = (idx.ratesByYarn[yarnId] || []).filter((r) => num(r.rate) !== null);
  return rates.length ? num(rates[0].rate) : null;
}

// Temporary yarn rates whose yarn still exists: base yarns as [{ yarn, rate, masterRate }], and TPM yarns with a
// temporary delta as { yarn, tpm: true, base, tempDelta, delta (master), baseTemp, masterBase, rate, masterRate }.
// A TPM yarn's rate = (base temporary rate, else master) + temporary delta; masterRate = master base + master delta.
export function activeTempRates() {
  const idx = getIndex();
  const bases = Object.entries(state.tempRates)
    .map(([id, rate]) => ({ yarn: idx.yarnsById[id], rate }))
    .filter((x) => x.yarn && !isTpm(x.yarn))
    .map((x) => ({ ...x, masterRate: latestMasterRate(idx, x.yarn.id) }));
  const tpms = Object.entries(state.tempDeltas)
    .map(([id, tempDelta]) => ({ yarn: idx.yarnsById[id], tempDelta }))
    .filter((x) => x.yarn && isTpm(x.yarn))
    .map((x) => {
      const base = idx.yarnsById[x.yarn.base_yarn_id] || null;
      const masterBase = base ? latestMasterRate(idx, base.id) : null;
      const baseTemp = base ? num(state.tempRates[base.id]) : null;
      const delta = tpmDelta(x.yarn);
      const b = baseTemp ?? masterBase;
      return { ...x, tpm: true, base, delta, masterBase, baseTemp, rate: b === null ? null : b + x.tempDelta, masterRate: masterBase === null ? null : masterBase + delta };
    });
  return [...bases, ...tpms].sort((a, b) => String(a.yarn.name).localeCompare(String(b.yarn.name)));
}

const round2 = (v) => Math.round(v * 100) / 100;

// What a base rate change reaches: the base yarn, every TPM yarn made from it, and every fabric using any of them.
export function baseImpact(baseId, idx = getIndex()) {
  const tpm = (idx.tables.Yarns || []).filter((y) => isTpm(y) && y.base_yarn_id === baseId);
  const ids = new Set([baseId, ...tpm.map((y) => y.id)]);
  const fabrics = new Set((idx.tables.FabricYarns || []).filter((l) => ids.has(l.yarn_id) && idx.fabricsById[l.fabric_id]).map((l) => l.fabric_id));
  return { yarns: ids.size, tpmYarns: tpm.length, fabrics: fabrics.size };
}

// Fabrics using one yarn.
export function yarnFabricCount(yarnId, idx = getIndex()) {
  return new Set((idx.tables.FabricYarns || []).filter((l) => l.yarn_id === yarnId && idx.fabricsById[l.fabric_id]).map((l) => l.fabric_id)).size;
}

// Save to master for a TPM yarn's temporary rate: what is typed is what is saved.
//   temporary delta → the TPM yarn's delta in the yarn master
//   temporary base rate (on its base yarn) → a new dated base rate, today; only with withBase
// Returns { ok, error, yarn, base, oldBase, oldDelta, newBase, newDelta, saveDelta, saveBase, impact, replacesToday }.
export function tpmSavePlan(tpmId, withBase = true, idx = getIndex()) {
  const yarn = idx.yarnsById[tpmId];
  if (!yarn || !isTpm(yarn)) return { ok: false, error: 'Not a TPM yarn' };
  const base = idx.yarnsById[yarn.base_yarn_id] || null;
  const td = num(state.tempDeltas[tpmId]);
  const tb = base ? num(state.tempRates[base.id]) : null;
  const saveDelta = td !== null;
  const saveBase = !!withBase && tb !== null;
  const oldBase = base ? latestMasterRate(idx, base.id) : null;
  const oldDelta = tpmDelta(yarn);
  const out = { yarn, base, oldBase, oldDelta, newBase: saveBase ? round2(tb) : oldBase, newDelta: saveDelta ? round2(td) : oldDelta, saveDelta, saveBase, baseTemp: tb };
  if (!saveDelta && !saveBase) return { ...out, ok: false, error: 'Nothing temporary to save on this TPM yarn' };
  if (!base && saveBase) return { ...out, ok: false, error: 'This TPM yarn has no base yarn' };
  out.impact = saveBase ? baseImpact(base.id, idx) : { yarns: 1, tpmYarns: 1, fabrics: yarnFabricCount(tpmId, idx) };
  if (saveBase) {
    const t = (idx.ratesByYarn[base.id] || []).find((r) => String(r.effective_date).slice(0, 10) === today());
    out.replacesToday = t ? num(t.rate) : null;
  }
  return { ...out, ok: true };
}

// Writes the plan above in one save: the TPM yarn's delta and/or a dated base rate for today. Then what was saved
// stops being temporary: the TPM yarn's temporary delta, and the base yarn's temporary rate when it was saved.
export async function saveTpmTempToMaster(tpmId, withBase = true) {
  const idx = getIndex();
  const plan = tpmSavePlan(tpmId, withBase, idx);
  if (!plan.ok) throw new Error(plan.error);
  const ops = [];
  if (plan.saveDelta) ops.push({ op: 'upsert', table: 'Yarns', rows: [{ ...plan.yarn, tpm_delta: plan.newDelta }] });
  if (plan.saveBase) {
    const date = today();
    const existing = (idx.ratesByYarn[plan.base.id] || []).find((r) => String(r.effective_date).slice(0, 10) === date);
    ops.push({ op: 'upsert', table: 'YarnRates', rows: [{ id: existing ? existing.id : newId('r'), yarn_id: plan.base.id, rate: plan.newBase, effective_date: date }] });
  }
  await commit(ops);
  if (plan.saveDelta) clearTempDelta(tpmId);
  if (plan.saveBase) clearTempRate(plan.base.id);
  toast(plan.saveDelta && plan.saveBase ? 'Base rate and delta saved' : plan.saveBase ? 'Base rate saved' : 'Delta saved');
  return plan;
}

// Makes a temporary rate the real one: a new dated rate in the yarn master, then the temporary rate is dropped.
export async function saveTempRateToMaster(yarnId) {
  const idx = getIndex();
  const yarn = idx.yarnsById[yarnId];
  const rate = state.tempRates[yarnId];
  if (!yarn || !rate) return;
  await saveYarn(yarn, rate, today());
  clearTempRate(yarnId);
}

// ---------- temporary sale rates (this device only) ----------
function writeTempPrices(next) {
  if (Object.keys(next).length) local.set(TEMP_PRICES_KEY, next);
  else local.remove(TEMP_PRICES_KEY);
  set({ tempPrices: next });
}

export function setTempPrice(fabricId, price) {
  const n = num(price);
  if (n === null || n <= 0) return false;
  writeTempPrices({ ...state.tempPrices, [fabricId]: Math.round(n * 100) / 100 });
  return true;
}

export function clearTempPrice(fabricId) {
  if (!(fabricId in state.tempPrices)) return;
  const next = { ...state.tempPrices };
  delete next[fabricId];
  writeTempPrices(next);
}

export function clearAllTempPrices() {
  if (Object.keys(state.tempPrices).length) writeTempPrices({});
}

// Temporary sale rates whose fabric still exists, as [{ fabric, price, masterPrice }].
export function activeTempPrices() {
  const idx = getIndex();
  return Object.entries(state.tempPrices)
    .map(([id, price]) => ({ fabric: idx.fabricsById[id], price }))
    .filter((x) => x.fabric)
    .map((x) => ({ ...x, masterPrice: num(x.fabric.price) }))
    .sort((a, b) => String(a.fabric.name).localeCompare(String(b.fabric.name)));
}

// ---------- temporary loom RPMs (this device only) ----------
// { fabricId: { sp, dp } }: single panna (loom_rpm, 190 cm) and double panna (loom_rpm_dp, 280 cm) RPM to try.
// Used by every fabric figure (calc.fabricCalc → loomPerDay), not by the Planner.
function writeTempRpms(next) {
  if (Object.keys(next).length) local.set(TEMP_RPMS_KEY, next);
  else local.remove(TEMP_RPMS_KEY);
  set({ tempRpms: next });
}

// which: 'sp' or 'dp'. A blank or zero value clears that one.
export function setTempRpm(fabricId, which, rpm) {
  const n = num(rpm);
  if (n === null || n <= 0) return false;
  writeTempRpms({ ...state.tempRpms, [fabricId]: { ...(state.tempRpms[fabricId] || {}), [which]: Math.round(n) } });
  return true;
}

// which: 'sp', 'dp', or nothing for both.
export function clearTempRpm(fabricId, which) {
  const cur = state.tempRpms[fabricId];
  if (!cur) return;
  const e = { ...cur };
  if (which) delete e[which];
  const next = { ...state.tempRpms };
  if (!which || !Object.keys(e).length) delete next[fabricId];
  else next[fabricId] = e;
  writeTempRpms(next);
}

export function clearAllTempRpms() {
  if (Object.keys(state.tempRpms).length) writeTempRpms({});
}

// Temporary loom RPMs whose fabric still exists, as [{ fabric, sp, dp, masterSp, masterDp }] (sp/dp null when not set).
export function activeTempRpms() {
  const idx = getIndex();
  return Object.entries(state.tempRpms)
    .map(([id, v]) => ({ fabric: idx.fabricsById[id], sp: num(v.sp), dp: num(v.dp) }))
    .filter((x) => x.fabric && (x.sp !== null || x.dp !== null))
    .map((x) => ({ ...x, masterSp: num(x.fabric.loom_rpm), masterDp: num(x.fabric.loom_rpm_dp) }))
    .sort((a, b) => String(a.fabric.name).localeCompare(String(b.fabric.name)));
}

// Makes the temporary RPMs the fabric's master RPMs (only the ones typed), then drops them.
export async function saveTempRpmToMaster(fabricId) {
  const idx = getIndex();
  const fabric = idx.fabricsById[fabricId];
  const t = state.tempRpms[fabricId];
  if (!fabric || !t) return;
  const lines = idx.linesByFabric[fabricId] || [];
  const units = (idx.assignmentsByFabric[fabricId] || []).map((a) => a.unit_id);
  const row = { ...fabric };
  if (num(t.sp) !== null) row.loom_rpm = num(t.sp);
  if (num(t.dp) !== null) row.loom_rpm_dp = num(t.dp);
  await saveFabric(row, lines, units);
  clearTempRpm(fabricId);
  toast('Loom RPM saved');
}

// Sale date for a price saved today: India time, whatever the device clock's zone.
export const todayIst = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

// Makes a temporary sale rate the fabric's selling price, with today's sale date, then drops it.
export async function saveTempPriceToMaster(fabricId) {
  const idx = getIndex();
  const fabric = idx.fabricsById[fabricId];
  const price = state.tempPrices[fabricId];
  if (!fabric || !price) return;
  const lines = idx.linesByFabric[fabricId] || [];
  const units = (idx.assignmentsByFabric[fabricId] || []).map((a) => a.unit_id);
  await saveFabric({ ...fabric, price, sale_date: todayIst() }, lines, units);
  clearTempPrice(fabricId);
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

// A save on any device answers with the data version before and after it. If this device's copy was complete at
// "before", it is complete at "after" once the save's own rows are applied; otherwise the next check loads in full.
function noteWrite({ version, prev }) {
  known = prev && known && prev === known ? version : null;
}

function makeBackend(settings) {
  return settings.mode === 'sheet' && settings.url && settings.key ? sheetBackend(settings.url, settings.key, { onWrite: noteWrite }) : demoBackend();
}

function resetSync() {
  known = null;
  legacy = false;
  lastFull = 0;
}

async function keepCopy(tables, meta, version) {
  const at = new Date().toISOString();
  const r = await savedCopy.set({ tables, meta, at, version: version || null });
  set({ copy: { ...r, at: r.ok ? at : state.copy && state.copy.ok ? state.copy.at : null } });
}

const later = (a, b) => (!a ? b || null : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b);

export async function init() {
  const settings = { ...state.settings, ...local.get(SETTINGS_KEY, {}) };
  backend = makeBackend(settings);
  resetSync();
  const b = backend;
  set({ settings, status: { loading: true, error: null, lastSync: null } });
  const cached = b.mode === 'sheet' ? await savedCopy.get() : null;
  if (b !== backend) return; // Settings changed while the copy was being read
  if (cached) {
    known = cached.version || null;
    lastFull = Date.parse(cached.at) || 0;
  }
  const seen = cached ? later(cached.at, local.get(CHECKED_KEY)) : null;
  set({
    settings,
    tables: cached ? { ...emptyTables(), ...cached.tables } : state.tables,
    meta: cached ? cached.meta || {} : {},
    status: { loading: !cached, error: null, lastSync: seen },
    copy: cached ? { ok: true, at: cached.at } : null,
  });
  if (b.mode === 'sheet') keepStorage();
  await sync();
}

// Full load of every tab. Shows "Syncing…" while it runs.
export async function refresh() {
  const seq = mutationSeq;
  const b = backend;
  inflight += 1;
  if (inflight === 1) set({ syncing: true });
  let again = false;
  try {
    const { tables, meta, version } = await b.bootstrap();
    if (b !== backend) {
      // data source changed while loading; the new source's own load applies
    } else if (seq !== mutationSeq) {
      // a save landed while this was loading; its rows are already in. A light check decides whether more is needed.
      again = true;
    } else {
      const at = new Date().toISOString();
      known = version || null;
      lastFull = Date.now();
      set({ tables, meta, status: { loading: false, error: null, lastSync: at } });
      if (b.mode === 'sheet') {
        local.set(CHECKED_KEY, at);
        await keepCopy(tables, meta, known);
      }
    }
  } catch (e) {
    if (b === backend && e.code === 'auth') {
      // The key no longer works (wrong, or the owner removed this person): drop the saved copy too.
      resetSync();
      await savedCopy.remove();
      set({ tables: emptyTables(), meta: {}, copy: null, status: { loading: false, error: e.message, lastSync: null } });
    } else if (b === backend) set({ status: { ...state.status, loading: false, error: e.message } });
  } finally {
    inflight -= 1;
    if (inflight === 0) set({ syncing: false });
  }
  if (again) await sync();
}

// The routine check: asks the Sheet for its data version (a light call) and loads in full only when it moved,
// when this device has no complete copy, every 30 minutes, or when forced. No spinner for the light call.
export async function sync({ force = false } = {}) {
  const b = backend;
  if (b.mode !== 'sheet' || force || legacy || !known || Date.now() - lastFull >= FULL_EVERY_MS) return refresh();
  const seq = mutationSeq;
  checking += 1;
  let v;
  try {
    v = await b.version();
  } catch (e) {
    if (b !== backend) return;
    if (/Unknown action/.test(e.message || '')) {
      legacy = true; // the script in the Sheet is older than v14
      return refresh();
    }
    if (e.code === 'auth') return refresh();
    set({ status: { ...state.status, loading: false, error: e.message } });
    return;
  } finally {
    checking -= 1;
  }
  if (b !== backend || seq !== mutationSeq) return; // a save landed meanwhile; the next check decides
  if (v && v === known) {
    const at = new Date().toISOString();
    local.set(CHECKED_KEY, at);
    set({ status: { loading: false, error: null, lastSync: at } });
    return;
  }
  return refresh();
}

// The Retry button: shows that it is trying, then says how it went.
export async function retry() {
  if (state.retrying) return;
  set({ retrying: true });
  try {
    await sync();
  } finally {
    set({ retrying: false });
  }
  if (state.status.error) toast('Still no connection to your Google Sheet. The app will try again by itself when the signal is back.', 'error');
  else toast('Connected. Your data is up to date.');
}

// Keeps phone and laptop in step: reloads from the Sheet when the app comes back
// into view, and every minute while it is open.
export function startAutoSync({ everyMs = 60000, staleMs = 15000 } = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const stale = (ms) => {
    const t = Date.parse(state.status.lastSync || '');
    return !t || Date.now() - t >= ms;
  };
  const busy = () => backend.mode !== 'sheet' || inflight > 0 || checking > 0 || state.retrying || document.visibilityState === 'hidden';
  const check = (ms) => {
    if (busy() || (state.status.loading && !state.status.error)) return;
    if (stale(ms)) sync();
  };
  const onWake = () => check(staleMs);
  // the signal is back: try at once rather than at the next minute
  const onOnline = () => {
    if (!busy()) sync();
  };
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('focus', onWake);
  window.addEventListener('online', onOnline);
  const timer = setInterval(() => check(everyMs - 2000), everyMs);
  return () => {
    document.removeEventListener('visibilitychange', onWake);
    window.removeEventListener('focus', onWake);
    window.removeEventListener('online', onOnline);
    clearInterval(timer);
  };
}

export async function saveSettings(settings) {
  const prev = state.settings;
  const next = { ...state.settings, ...settings };
  local.set(SETTINGS_KEY, next);
  backend = makeBackend(next);
  resetSync();
  set({ settings: next, tables: emptyTables(), copy: null, status: { loading: true, error: null, lastSync: null } });
  // a copy from another Sheet or key must never show up for this one
  if (backend.mode !== 'sheet' || prev.url !== next.url || prev.key !== next.key) {
    local.remove(CHECKED_KEY);
    await savedCopy.remove();
  }
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
    let applied;
    try {
      applied = await backend.batch(ops);
    } catch (e) {
      // Beam lengths need backend v8; an older script in the Sheet doesn't know the FabricBeams tab.
      if (/Unknown table FabricBeams/.test(e.message || '')) throw new Error('The script in your Google Sheet is an older version. Update it to save beam lengths.');
      if (/Unknown table TfoBalance/.test(e.message || '')) throw new Error('The script in your Google Sheet is an older version. Update it to save TFO plans.');
      if (/Unknown table SaleRates/.test(e.message || '')) throw new Error('The script in your Google Sheet is an older version. Update it to save sale rate history.');
      throw e;
    }
    const tables = applyOps(state.tables, applied || ops);
    set({ tables });
    // no full load after a save: the Sheet sent back the saved rows, and noteWrite has kept the version
    if (backend.mode === 'sheet') await keepCopy(tables, state.meta, known);
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

// beams: optional [{ loom_group_id, beam_length_m }]. Left out = keep as is (except for units the fabric no longer has).
export async function saveFabric(fabric, lines, unitIds, beams) {
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
  // a new price or sale date goes into the sale rate history
  ops.push(...saleSaveOps(isNew ? undefined : (idx.tables.Fabrics || []).find((x) => x.id === f.id), f, idx.saleRatesByFabric[f.id] || []));
  if (dropLines.length) ops.push({ op: 'delete', table: 'FabricYarns', ids: dropLines });
  if (addAssign.length) ops.push({ op: 'upsert', table: 'Assignments', rows: addAssign });
  if (dropAssign.length) ops.push({ op: 'delete', table: 'Assignments', ids: dropAssign });
  const wantedGroups = new Set([...wanted].flatMap((u) => (idx.loomGroupsByUnit[u] || []).map((g) => g.id)));
  const oldBeams = idx.beamsByFabric[f.id] || [];
  if (beams === undefined) {
    const dropB = oldBeams.filter((b) => !wantedGroups.has(b.loom_group_id)).map((b) => b.id);
    if (dropB.length) ops.push({ op: 'delete', table: 'FabricBeams', ids: dropB });
  } else {
    const want = beams.filter((b) => wantedGroups.has(b.loom_group_id) && num(b.beam_length_m) !== null);
    const rows = want.map((b) => {
      const old = oldBeams.find((o) => o.loom_group_id === b.loom_group_id);
      return { id: old ? old.id : newId('fb'), fabric_id: f.id, loom_group_id: b.loom_group_id, beam_length_m: num(b.beam_length_m) };
    });
    const keepB = new Set(rows.map((r) => r.id));
    const dropB = oldBeams.filter((b) => !keepB.has(b.id)).map((b) => b.id);
    if (rows.length) ops.push({ op: 'upsert', table: 'FabricBeams', rows });
    if (dropB.length) ops.push({ op: 'delete', table: 'FabricBeams', ids: dropB });
  }
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
  const beams = (idx.beamsByFabric[fabricId] || []).map((b) => ({ loom_group_id: b.loom_group_id, beam_length_m: b.beam_length_m }));
  const { id, created_at, updated_at, updated_by, created_by, ...rest } = src;
  return saveFabric({ ...rest, base_name: undefined, name: `${src.base_name ?? src.name} (copy)` }, lines, units, beams);
}

// Name for a copy at a new RS: the stored name without its RS, or "(copy)" if that name + RS is taken.
function rsCopyName(fabric, oldRs, newRs, fabrics) {
  const base = stripRs(fabric.base_name ?? fabric.name, oldRs);
  const shown = fabricLabel({ name: base, reed_space_in: newRs, finish: fabric.finish }).toLowerCase();
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
    beams: (idx.beamsByFabric[fabricId] || []).map((b) => ({ loom_group_id: b.loom_group_id, beam_length_m: b.beam_length_m })),
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
    plan.beams,
  );
}

export async function deleteFabric(fabricId) {
  const idx = getIndex();
  const ops = [
    { op: 'delete', table: 'FabricYarns', ids: (idx.linesByFabric[fabricId] || []).map((l) => l.id) },
    { op: 'delete', table: 'Assignments', ids: (idx.assignmentsByFabric[fabricId] || []).map((a) => a.id) },
    { op: 'delete', table: 'FabricBeams', ids: (idx.beamsByFabric[fabricId] || []).map((b) => b.id) },
    { op: 'delete', table: 'SaleRates', ids: (idx.saleRatesByFabric[fabricId] || []).map((r) => r.id) },
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

// Deletes sale rate history rows. Deleting the rate in use brings back the next older one (price and sale date).
export async function deleteSaleRates(fabricId, ids) {
  const idx = getIndex();
  const fabric = (idx.tables.Fabrics || []).find((x) => x.id === fabricId);
  if (!fabric) return;
  const plan = saleDeletePlan(fabric, idx.saleRatesByFabric[fabricId] || [], ids);
  if (!plan.ops.length) return;
  await commit(plan.ops);
  const n = plan.ops[0].ids.length;
  toast(n === 1 ? 'Sale rate deleted' : `${n} sale rates deleted`);
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
  const dropFb = (idx.tables.FabricBeams || []).filter((b) => dropLg.includes(b.loom_group_id)).map((b) => b.id);
  if (dropFb.length) ops.push({ op: 'delete', table: 'FabricBeams', ids: dropFb });
  await commit(ops);
  toast(unit.id ? 'Unit saved' : 'Unit added');
  return u.id;
}

export async function deleteUnit(unitId) {
  const idx = getIndex();
  await commit([
    { op: 'delete', table: 'Assignments', ids: (idx.assignmentsByUnit[unitId] || []).map((a) => a.id) },
    { op: 'delete', table: 'FabricBeams', ids: (idx.tables.FabricBeams || []).filter((b) => (idx.loomGroupsByUnit[unitId] || []).some((g) => g.id === b.loom_group_id)).map((b) => b.id) },
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

// ---------- TFO plans ----------
// A saved plan is a TfoBalancePlans row plus its inputs as TfoBalanceLines (planner.planToLines).
// Saving writes the plan row and replaces its lines in one call.
export async function savePlan({ id, unitId, date, name, notes, lines, summary }) {
  const idx = getIndex();
  const planId = id || newId('bp');
  const old = (idx.tables.TfoBalanceLines || []).filter((l) => l.plan_id === planId).map((l) => l.id);
  const prev = id ? (idx.tables.TfoBalancePlans || []).find((p) => p.id === id) : null;
  const row = { id: planId, unit_id: unitId, plan_date: date, name, notes: notes ?? (prev ? prev.notes || '' : ''), summary: JSON.stringify(summary || {}) };
  if (!prev) row.created_at = new Date().toISOString();
  const rows = lines.map((l, i) => ({ id: newId('bl'), plan_id: planId, kind: l.kind, ref: l.ref, value: l.value, sort: i + 1 }));
  const ops = [];
  if (old.length) ops.push({ op: 'delete', table: 'TfoBalanceLines', ids: old });
  ops.push({ op: 'upsert', table: 'TfoBalancePlans', rows: [row] });
  if (rows.length) ops.push({ op: 'upsert', table: 'TfoBalanceLines', rows });
  await commit(ops);
  toast(prev ? 'Plan updated' : 'Plan saved');
  return planId;
}

export async function deletePlan(id) {
  const idx = getIndex();
  const lines = (idx.tables.TfoBalanceLines || []).filter((l) => l.plan_id === id).map((l) => l.id);
  const ops = [];
  if (lines.length) ops.push({ op: 'delete', table: 'TfoBalanceLines', ids: lines });
  ops.push({ op: 'delete', table: 'TfoBalancePlans', ids: [id] });
  await commit(ops);
  toast('Plan deleted');
}

export async function duplicatePlan(id) {
  const idx = getIndex();
  const src = (idx.tables.TfoBalancePlans || []).find((p) => p.id === id);
  if (!src) return null;
  const lines = (idx.tables.TfoBalanceLines || []).filter((l) => l.plan_id === id).sort((a, b) => (num(a.sort) ?? 0) - (num(b.sort) ?? 0));
  let summary = {};
  try { summary = JSON.parse(src.summary || '{}'); } catch { summary = {}; }
  return savePlan({ unitId: src.unit_id, date: String(src.plan_date || '').slice(0, 10), name: `${src.name || 'Plan'} (copy)`, notes: src.notes || '', lines, summary });
}

// ---------- planning sheet photo import ----------
// What an import teaches the app: article codes for fabrics that had none (into the design note, as the master
// writes them, e.g. "Bright Satin-48 (0402)") and sheet names you confirmed. The names are not in the app's own
// Sheet: they live in a spreadsheet of their own ("Fabric Master – Sheet Names"), kept by the backend script.
const NAMES_CACHE = 'fm.sheetNames.cache.v1';
let namesList = null;

// Confirmed sheet names for a unit. Falls back to the last copy on this phone when the Sheet can't be reached.
export async function loadSheetNames(unitId) {
  try {
    namesList = await backend.sheetNames();
    local.set(NAMES_CACHE, namesList);
  } catch {
    namesList = namesList || local.get(NAMES_CACHE, []) || [];
  }
  return namesList.filter((a) => !a.unit_id || a.unit_id === unitId);
}

export async function saveImportMemory({ unitId, aliases = [], codes = [] }) {
  const tidy = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').replace(/\s*\(\s*/g, '(').replace(/\s*\)\s*/g, ')').trim();
  // codes first: they are part of the Fabrics table, so they are kept even if the names can't be saved
  if (codes.length) await commit([{ op: 'upsert', table: 'Fabrics', rows: codes.map((c) => ({ id: c.fabricId, design_note: c.design_note })) }]);
  if (!aliases.length) return;
  const known = namesList || local.get(NAMES_CACHE, []) || [];
  const rows = [];
  for (const a of aliases) {
    const text = tidy(a.text);
    const old = known.find((x) => x.unit_id === unitId && Number(x.width_cm) === Number(a.width) && tidy(x.sheet_text) === text);
    if (old && old.fabric_id === a.fabricId) continue;
    if (rows.some((r) => Number(r.width_cm) === Number(a.width) && r.sheet_text === text)) continue;
    rows.push({ unit_id: unitId, width_cm: Number(a.width), sheet_text: text, fabric_id: a.fabricId, fabric_name: a.fabricName || '' });
  }
  if (!rows.length) return;
  try {
    namesList = await backend.saveSheetNames(rows);
    local.set(NAMES_CACHE, namesList);
  } catch (e) {
    if (/Unknown action/.test(e.message || '')) throw new Error('The script in your Google Sheet is an older version. Update it to remember sheet names.');
    throw e;
  }
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
