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

describe('a key per person, last edited by, and the change log', () => {
  const log = () => gas.post({ action: 'log', key }).entries;
  const seed = () => {
    const t = sampleTables();
    const ops = Object.entries(t).filter(([, rows]) => rows.length).map(([table, rows]) => ({ op: 'upsert', table, rows }));
    gas.post({ action: 'batch', key, ops });
  };

  it('the setup key is the owner; the owner names himself and adds a person', () => {
    expect(gas.post({ action: 'bootstrap', key }).meta.me).toEqual({ name: 'Owner', role: 'owner' });
    gas.post({ action: 'renamePerson', key, id: 'owner', name: 'Divyam' });
    expect(gas.post({ action: 'ping', key }).me.name).toBe('Divyam');
    const r = gas.post({ action: 'addPerson', key, name: '  Ishaan  ' });
    expect(r.ok).toBe(true);
    expect(r.person).toMatchObject({ name: 'Ishaan', role: 'editor' });
    expect(r.person.key).toMatch(/^[0-9a-f]{40}$/);
    expect(r.person.key).not.toBe(key);
    const boot = gas.post({ action: 'bootstrap', key: r.person.key });
    expect(boot.ok).toBe(true);
    expect(boot.meta.me).toEqual({ name: 'Ishaan', role: 'editor' });
    expect(gas.post({ action: 'addPerson', key, name: 'ishaan' }).error).toMatch(/already on the list/);
    expect(gas.post({ action: 'people', key }).people.map((p) => p.name)).toEqual(['Divyam', 'Ishaan']);
  });

  it('only the owner can see keys or change who has access', () => {
    const ishaan = gas.post({ action: 'addPerson', key, name: 'Ishaan' }).person;
    for (const action of ['people', 'addPerson', 'renamePerson', 'removePerson']) {
      const r = gas.post({ action, key: ishaan.key, name: 'X', id: ishaan.id });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/Only the owner/);
    }
  });

  it('removing one person stops only their key', () => {
    const a = gas.post({ action: 'addPerson', key, name: 'Ishaan' }).person;
    const b = gas.post({ action: 'addPerson', key, name: 'Aman' }).person;
    gas.post({ action: 'removePerson', key, id: a.id });
    const denied = gas.post({ action: 'bootstrap', key: a.key });
    expect(denied.ok).toBe(false);
    expect(denied.code).toBe('auth');
    expect(gas.post({ action: 'bootstrap', key: b.key }).ok).toBe(true);
    expect(gas.post({ action: 'bootstrap', key }).ok).toBe(true);
    expect(gas.post({ action: 'removePerson', key, id: 'owner' }).ok).toBe(false);
    const access = log().filter((e) => e.type === 'Access').map((e) => `${e.action} ${e.item}`);
    expect(access).toEqual(['removed access Ishaan', 'gave access Aman', 'gave access Ishaan']);
  });

  it('stamps who saved, and leaves rows that did not change alone', () => {
    seed();
    const ishaan = gas.post({ action: 'addPerson', key, name: 'Ishaan' }).person;
    const before = gas.post({ action: 'bootstrap', key }).tables.Fabrics.find((f) => f.id === 'f_crepe');
    expect(before.updated_by).toBe('Owner');
    expect(before.created_by).toBe('Owner');
    // saving the same values again changes nothing
    gas.post({ action: 'batch', key: ishaan.key, ops: [{ op: 'upsert', table: 'Fabrics', rows: [{ ...before, updated_by: 'someone', updated_at: 'x' }] }] });
    const same = gas.post({ action: 'bootstrap', key }).tables.Fabrics.find((f) => f.id === 'f_crepe');
    expect(same.updated_by).toBe('Owner');
    expect(same.updated_at).toBe(before.updated_at);
    // a real change is stamped with the person's name, whatever the app sent
    const res = gas.post({ action: 'batch', key: ishaan.key, ops: [{ op: 'upsert', table: 'Fabrics', rows: [{ ...before, price: 47, updated_by: 'Divyam', created_by: 'Ishaan' }] }] });
    expect(res.ops[0].rows[0]).toMatchObject({ price: 47, updated_by: 'Ishaan', created_by: 'Owner' });
    const after = gas.post({ action: 'bootstrap', key }).tables.Fabrics.find((f) => f.id === 'f_crepe');
    expect(after).toMatchObject({ price: 47, updated_by: 'Ishaan', created_by: 'Owner' });
    const top = log()[0];
    expect(top).toMatchObject({ who: 'Ishaan', action: 'changed', type: 'Fabric', item: 'Poly Crepe 60 (RFD)', ref: 'f_crepe' });
    expect(top.details).toBe('Price 45 → 47');
    expect(top.when).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('logs one line per fabric save, with yarn lines and units under the fabric, and marks the fabric edited', () => {
    seed();
    const aman = gas.post({ action: 'addPerson', key, name: 'Aman' }).person;
    const t = gas.post({ action: 'bootstrap', key }).tables;
    const lines = t.FabricYarns.filter((l) => l.fabric_id === 'f_geo');
    const warp = lines.find((l) => l.side === 'warp');
    const res = gas.post({
      action: 'batch',
      key: aman.key,
      ops: [
        { op: 'upsert', table: 'Fabrics', rows: [t.Fabrics.find((f) => f.id === 'f_geo')] },
        { op: 'upsert', table: 'FabricYarns', rows: lines.map((l) => (l.id === warp.id ? { ...l, ends: Number(l.ends) + 100 } : l)) },
        { op: 'upsert', table: 'Assignments', rows: [{ id: 'a_new', fabric_id: 'f_geo', unit_id: 'u_caj' }] },
      ],
    });
    // the fabric row itself did not change, but it is marked as edited by Aman
    const touched = res.ops.find((o) => o.table === 'Fabrics' && o.rows[0].updated_by === 'Aman');
    expect(touched).toBeTruthy();
    const top = log()[0];
    expect(top).toMatchObject({ who: 'Aman', action: 'changed', type: 'Fabric', item: 'Georgette 60 (RFD)' });
    expect(top.details).toMatch(/^warp .+: Ends \d+ → \d+; added to Chinese AJ$/);
    expect(log().filter((e) => e.who === 'Aman')).toHaveLength(1);
  });

  it('logs adds and deletes once, not once per yarn line or unit link', () => {
    seed();
    gas.post({
      action: 'batch',
      key,
      ops: [
        { op: 'upsert', table: 'Fabrics', rows: [{ id: 'f_n', name: 'Natural Crape', reed_space_in: 52.5, ppi: 80 }] },
        { op: 'upsert', table: 'FabricYarns', rows: [{ id: 'l_n1', fabric_id: 'f_n', side: 'warp', yarn_id: 'y_tpm75', ends: 4000 }, { id: 'l_n2', fabric_id: 'f_n', side: 'weft', yarn_id: 'y_tpm75', parts: 1 }] },
        { op: 'upsert', table: 'Assignments', rows: [{ id: 'a_n', fabric_id: 'f_n', unit_id: 'u_2' }] },
      ],
    });
    expect(log()[0]).toMatchObject({ action: 'added', item: 'Natural Crape 53', details: 'added to Unit 2' });
    gas.post({ action: 'batch', key, ops: [
      { op: 'delete', table: 'FabricYarns', ids: ['l_n1', 'l_n2'] },
      { op: 'delete', table: 'Assignments', ids: ['a_n'] },
      { op: 'delete', table: 'Fabrics', ids: ['f_n'] },
    ] });
    const e = log();
    expect(e[0]).toMatchObject({ action: 'deleted', type: 'Fabric', item: 'Natural Crape 53' });
    expect(e[1].action).toBe('added');
  });

  it('deleting a unit is one line, not a line for every fabric that ran in it', () => {
    seed();
    const t = gas.post({ action: 'bootstrap', key }).tables;
    const id = 'u_caj';
    gas.post({ action: 'batch', key, ops: [
      { op: 'delete', table: 'Assignments', ids: t.Assignments.filter((a) => a.unit_id === id).map((a) => a.id) },
      { op: 'delete', table: 'Units', ids: [id] },
    ] });
    const e = log();
    expect(e[0]).toMatchObject({ action: 'deleted', type: 'Unit', item: 'Chinese AJ' });
    expect(e[1].action).toBe('added');
  });

  it('rates and photos are reported under their yarn and fabric', () => {
    seed();
    gas.post({ action: 'batch', key, ops: [{ op: 'upsert', table: 'YarnRates', rows: [{ id: 'r_new', yarn_id: 'y_fdy75', rate: 170, effective_date: '2026-10-20' }] }] });
    expect(log()[0]).toMatchObject({ action: 'changed', type: 'Yarn', details: 'new rate ₹170 from 2026-10-20' });
    const png = 'data:image/jpeg;base64,' + Buffer.from('x').toString('base64');
    gas.post({ action: 'uploadPhoto', key, photo: { id: 'p9', fabric_id: 'f_geo', is_cover: true }, image: png, thumb: png });
    expect(log()[0]).toMatchObject({ type: 'Fabric', item: 'Georgette 60 (RFD)', details: 'photo added' });
    gas.post({ action: 'deletePhoto', key, id: 'p9' });
    expect(log()[0]).toMatchObject({ type: 'Fabric', details: 'photo deleted' });
  });

  it('the change log never goes out with the tables', () => {
    seed();
    const tables = gas.post({ action: 'bootstrap', key }).tables;
    expect(Object.keys(tables)).toEqual(Object.keys(TABLES));
    expect(gas.ss.getSheetByName('Change log')).toBeTruthy();
  });
});
