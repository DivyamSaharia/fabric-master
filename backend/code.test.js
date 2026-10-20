// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { loadCodeGs } from './mockGas.js';
import { sampleTables } from '../src/sampleData.js';
import { sheetBackend } from '../src/api.js';
import { TABLES } from '../src/schema.js';
import { buildIndex, fabricCalc } from '../src/calc.js';

let gas;
let key;
beforeEach(() => {
  gas = loadCodeGs();
  key = gas.ctx.setup();
});

describe('Code.gs', () => {
  it('rejects requests without the right key', () => {
    expect(gas.post({ action: 'bootstrap' }).ok).toBe(false);
    expect(gas.post({ action: 'bootstrap', key: 'nope' }).error).toMatch(/Wrong API key/);
  });

  it('creates every tab with the same columns as the app', () => {
    const r = gas.post({ action: 'bootstrap', key });
    expect(r.ok).toBe(true);
    for (const [name, cols] of Object.entries(TABLES)) {
      const sh = gas.ss.getSheetByName(name);
      expect(sh).toBeTruthy();
      expect(sh.getRange(1, 1, 1, cols.length).getValues()[0]).toEqual(cols);
    }
    expect(gas.ss.getSheetByName('Sheet1')).toBeNull();
    expect(r.meta.spreadsheetName).toBe('Fabric Master DB');
  });

  it('keeps the slow formatting to the first load', () => {
    gas.post({ action: 'bootstrap', key });
    const calls = gas.ss.getSheetByName('Fabrics').formatCalls;
    gas.post({ action: 'bootstrap', key });
    expect(gas.ss.getSheetByName('Fabrics').formatCalls).toBe(calls);
  });

  it('round-trips the sample data with types intact', () => {
    const t = sampleTables();
    const ops = Object.entries(t).filter(([, rows]) => rows.length).map(([table, rows]) => ({ op: 'upsert', table, rows }));
    const res = gas.post({ action: 'batch', key, ops });
    expect(res.ok).toBe(true);
    const back = gas.post({ action: 'bootstrap', key }).tables;
    expect(back.Fabrics).toHaveLength(5);
    const crepe = back.Fabrics.find((f) => f.id === 'f_crepe');
    expect(crepe.ppi).toBe(80);
    expect(crepe.finish).toBe('RFD');
    expect(back.FabricYarns.find((l) => l.id === 'l2').pattern).toBe('2S:2Z');
    expect(back.Yarns.find((y) => y.id === 'y_tpm75').twist).toBe('S/Z');
    expect(back.Units.find((u) => u.id === 'u_2').has_tfo).toBe(true);
    expect(back.Units.find((u) => u.id === 'u_caj').has_tfo).toBe(false);
    expect(back.YarnRates.find((r) => r.id === 'r1').effective_date).toBe('2026-10-01');
    // the same realisation comes out of the Sheet copy
    const idx = buildIndex(back);
    expect(fabricCalc(idx.fabricsById.f_crepe, idx).realisationPerPick).toBeCloseTo(0.2577, 4);
  });

  it('updates in place, merges partial rows, and deletes', () => {
    gas.post({ action: 'batch', key, ops: [{ op: 'upsert', table: 'Units', rows: [{ id: 'u1', name: 'A', cost_per_pick: 0.2, has_tfo: true }] }] });
    gas.post({ action: 'batch', key, ops: [{ op: 'upsert', table: 'Units', rows: [{ id: 'u1', cost_per_pick: 0.21 }] }] });
    let units = gas.post({ action: 'bootstrap', key }).tables.Units;
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ id: 'u1', name: 'A', cost_per_pick: 0.21, has_tfo: true });
    gas.post({ action: 'batch', key, ops: [{ op: 'delete', table: 'Units', ids: ['u1'] }] });
    units = gas.post({ action: 'bootstrap', key }).tables.Units;
    expect(units).toHaveLength(0);
  });

  it('gives an id to rows pasted in by hand', () => {
    gas.post({ action: 'bootstrap', key });
    const sh = gas.ss.getSheetByName('Yarns');
    sh.getRange(2, 2, 1, 1).setValues([['80D Polyester FDY']]);
    const yarns = gas.post({ action: 'bootstrap', key }).tables.Yarns;
    expect(yarns).toHaveLength(1);
    expect(yarns[0].id).toMatch(/^y_/);
    expect(sh.getRange(2, 1).getValues()[0][0]).toBe(yarns[0].id);
  });

  it('stores photos and exports in Drive, and trashes photos on delete', () => {
    const png = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg').toString('base64');
    const up = gas.post({ action: 'uploadPhoto', key, photo: { id: 'p1', fabric_id: 'f_crepe', is_cover: true }, image: png, thumb: png });
    expect(up.ok).toBe(true);
    expect(up.row.file_id).toMatch(/^file_/);
    const got = gas.post({ action: 'photo', key, id: 'p1', size: 'thumb' });
    expect(got.dataUrl).toBe(png);
    gas.post({ action: 'deletePhoto', key, id: 'p1' });
    expect(gas.files[up.row.file_id].trashed).toBe(true);
    expect(gas.post({ action: 'bootstrap', key }).tables.Photos).toHaveLength(0);
    const ex = gas.post({ action: 'saveExport', key, name: '2026-10-18_x.pdf', mime: 'application/pdf', base64: Buffer.from('%PDF').toString('base64') });
    expect(ex.url).toMatch(/drive\.google\.com/);
  });
});

describe('the app talks to Code.gs', () => {
  it('sheetBackend works end to end through fetch', async () => {
    globalThis.fetch = async (url, init) => ({ json: async () => gas.post(JSON.parse(init.body)) });
    const api = sheetBackend('https://script.google.com/macros/s/x/exec', key);
    expect((await api.ping()).spreadsheetName).toBe('Fabric Master DB');
    const applied = await api.batch([{ op: 'upsert', table: 'Yarns', rows: [{ id: 'y1', name: '75D', kind: 'base', count: 75, count_unit: 'D' }] }]);
    expect(applied[0].rows[0].updated_at).toBeTruthy();
    const { tables } = await api.bootstrap();
    expect(tables.Yarns[0]).toMatchObject({ id: 'y1', name: '75D', count: 75 });
    await expect(sheetBackend('https://x', 'bad').bootstrap()).rejects.toThrow(/Wrong API key/);
  });
});
