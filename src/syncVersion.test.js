// Round 1 sync: the app against the real Code.gs (in-memory Sheet, Sheets API on). Checks that routine checks are
// light, a full load happens only when the data moved, a save costs one call, and the saved copy works offline.
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { loadCodeGs } from '../backend/mockGas.js';
import { commit, getState, init, retry, startAutoSync, sync } from './store.js';

let gas;
let key;
let offline = false;
let gate = null;
const calls = [];
const count = (action) => calls.filter((a) => a === action).length;
const fab = (id, name) => ({ op: 'upsert', table: 'Fabrics', rows: [{ id, name, reed_space_in: 64, ppi: 80 }] });
const ids = () => getState().tables.Fabrics.map((f) => f.id).sort();

beforeAll(async () => {
  gas = loadCodeGs({ sheetsApi: true });
  key = gas.ctx.setup();
  gas.post({ action: 'batch', key, ops: [fab('f1', 'Gajji Silk')] });
  global.fetch = vi.fn(async (_url, opts) => {
    if (offline) throw new TypeError('Load failed');
    const body = JSON.parse(opts.body);
    calls.push(body.action);
    const reply = gas.post(body);
    if (gate) await gate;
    return { json: async () => reply };
  });
  localStorage.clear();
  localStorage.setItem('fm.settings.v1', JSON.stringify({ mode: 'sheet', url: 'https://script.example/exec', key }));
  await init();
});

describe('sync with a data version (backend v14)', () => {
  it('first open with no copy loads in full and keeps a copy with its version', () => {
    expect(ids()).toEqual(['f1']);
    expect(count('bootstrap')).toBe(1);
    const copy = JSON.parse(localStorage.getItem('fm.cache.v1')); // jsdom has no IndexedDB: the fallback place
    expect(copy.version).toBe(gas.props.DATA_VERSION);
    expect(getState().copy.ok).toBe(true);
  });

  it('a routine check is one light call when nothing changed', async () => {
    const before = calls.length;
    await sync();
    expect(calls.slice(before)).toEqual(['version']);
    expect(getState().syncing).toBe(false);
  });

  it('loads in full once when another device saved', async () => {
    gas.post({ action: 'batch', key, ops: [fab('f2', 'Tissue Gold')] });
    const before = calls.length;
    await sync();
    expect(calls.slice(before)).toEqual(['version', 'bootstrap']);
    expect(ids()).toEqual(['f1', 'f2']);
  });

  it('loads in full once after rows were pasted by hand in the Sheet', async () => {
    const sh = gas.ss.getSheetByName('Fabrics');
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const row = head.map((h) => (h === 'name' ? 'Pasted Twill' : h === 'reed_space_in' ? 54 : ''));
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    gas.ctx.onEdit({ range: { getSheet: () => sh } });
    const before = calls.length;
    await sync();
    expect(calls.slice(before)).toEqual(['version', 'bootstrap']);
    expect(getState().tables.Fabrics.some((f) => f.name === 'Pasted Twill' && /^f_/.test(f.id))).toBe(true);
    // the id the Sheet gave it is now the version this device holds: no further load
    const again = calls.length;
    await sync();
    expect(calls.slice(again)).toEqual(['version']);
  });

  it('a save is one call, with no full load after it', async () => {
    const before = calls.length;
    await commit([fab('f3', 'Salsa Anmol')]);
    await sync();
    expect(calls.slice(before)).toEqual(['batch', 'version']);
    expect(ids()).toContain('f3');
    expect(JSON.parse(localStorage.getItem('fm.cache.v1')).tables.Fabrics.some((f) => f.id === 'f3')).toBe(true);
  });

  it('a save made while another device also saved still picks up the other save', async () => {
    gas.post({ action: 'batch', key, ops: [fab('f4', 'Rangila Twill')] }); // other device, unseen here
    const before = calls.length;
    await commit([fab('f5', 'Natural Crape')]);
    await sync();
    expect(calls.slice(before)).toEqual(['batch', 'bootstrap']);
    expect(ids()).toEqual(expect.arrayContaining(['f4', 'f5']));
  });

  it('a full load that overlaps a save does not undo it and is not repeated', async () => {
    let release;
    gate = new Promise((r) => { release = r; });
    const slow = sync({ force: true });
    gate = null;
    await commit([fab('f6', 'Glass')]);
    release();
    await slow;
    expect(ids()).toContain('f6');
    const before = calls.length;
    await sync();
    expect(calls.slice(before)).toEqual(['version']);
  });

  it('with no connection the copy stays on screen, Retry says how it went, and the app retries when the signal is back', async () => {
    offline = true;
    await sync();
    expect(getState().status.error).toMatch(/No connection/);
    expect(getState().status.lastSync).toBeTruthy(); // the banner adds "Showing the copy saved on this device…"
    expect(ids()).toContain('f6');
    const p = retry();
    expect(getState().retrying).toBe(true);
    await p;
    expect(getState().retrying).toBe(false);
    expect(getState().toast.message).toMatch(/Still no connection/);
    const stop = startAutoSync({ everyMs: 600000 });
    offline = false;
    const before = calls.length;
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(getState().status.error).toBeNull());
    expect(calls.slice(before)).toEqual(['version']);
    stop();
    await retry();
    expect(getState().toast.message).toMatch(/Connected/);
  });

  it('reloads in full every 30 minutes even when the version did not move (rows deleted by hand)', async () => {
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 60000);
    const before = calls.length;
    await sync();
    expect(calls.slice(before)).toEqual(['bootstrap']);
    spy.mockRestore();
  });

  it('opening again shows the saved copy before the Sheet answers', async () => {
    let release;
    gate = new Promise((r) => { release = r; });
    const opening = init();
    await vi.waitFor(() => expect(getState().status.loading).toBe(false));
    expect(ids()).toContain('f6');
    release();
    gate = null;
    await opening;
  });
});

describe('opening with no signal', () => {
  it('shows the saved copy at once, with the error and the time it was last checked', async () => {
    offline = true;
    await init();
    expect(getState().status.loading).toBe(false);
    expect(getState().status.error).toMatch(/No connection/);
    expect(getState().status.lastSync).toBeTruthy();
    expect(ids()).toContain('f6');
    offline = false;
    await sync();
    expect(getState().status.error).toBeNull();
  });
});

describe('an older script in the Sheet (no version call)', () => {
  it('falls back to a full load on every check, as before', async () => {
    const real = gas.ctx.route_;
    gas.ctx.route_ = (p) => (p.action === 'version' ? gas.ctx.json_({ ok: false, error: 'Unknown action' }) : real(p));
    await init();
    const before = calls.length;
    await sync();
    await sync();
    expect(calls.slice(before).filter((a) => a === 'bootstrap')).toHaveLength(2);
    gas.ctx.route_ = real;
  });
});
