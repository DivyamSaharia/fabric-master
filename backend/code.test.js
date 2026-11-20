// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { loadCodeGs } from './mockGas.js';
import vm from 'node:vm';
import { sampleTables } from '../src/sampleData.js';
import { sheetBackend } from '../src/api.js';
import { TABLES } from '../src/schema.js';
import { buildIndex, fabricCalc } from '../src/calc.js';

let gas;
let key;

// Every test runs twice: with the Sheets advanced service switched on (one batchGet per load) and without it.
describe.each([['one read per tab', false], ['Sheets API batchGet', true]])('Code.gs, %s', (_label, sheetsApi) => {
beforeEach(() => {
  gas = loadCodeGs({ sheetsApi });
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
    expect(crepe.sale_date).toBe('2026-10-02');
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

  it('sale date stays a date (no time), is logged as "Sale date", and a Date cell reads back as yyyy-mm-dd', () => {
    seed();
    gas.post({ action: 'batch', key, ops: [{ op: 'upsert', table: 'Fabrics', rows: [{ id: 'f_crepe', sale_date: '2026-10-09' }] }] });
    const back = gas.post({ action: 'bootstrap', key }).tables.Fabrics.find((f) => f.id === 'f_crepe');
    expect(back.sale_date).toBe('2026-10-09');
    const e = log().find((x) => x.type === 'Fabric' && x.action === 'changed');
    expect(e.details).toContain('Sale date 2026-10-02 → 2026-10-09');
    // a hand-typed date that Sheets turned into a Date still reads back date-only
    const sh = gas.ss.getSheetByName('Fabrics');
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const col = head.indexOf('sale_date') + 1;
    expect(col).toBeGreaterThan(0);
    sh.getRange(2, col).setValue(vm.runInContext("new Date('2026-09-24T00:00:00Z')", gas.ctx));
    const rows = gas.post({ action: 'bootstrap', key }).tables.Fabrics;
    expect(rows.some((f) => f.sale_date === '2026-09-24')).toBe(true);
  });

  it('the change log never goes out with the tables', () => {
    seed();
    const tables = gas.post({ action: 'bootstrap', key }).tables;
    expect(Object.keys(tables)).toEqual(Object.keys(TABLES));
    expect(gas.ss.getSheetByName('Change log')).toBeTruthy();
  });
});

describe('TFO plans (v12)', () => {
  const log = () => gas.post({ action: 'log', key }).entries;
  const plan = (over = {}) => ({ id: 'bp_1', unit_id: 'u_2', plan_date: '2026-10-25', name: 'Plan 25 Oct 2026', notes: '', summary: '{"net":-12.5}', ...over });
  const lines = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `bl_${from + i}`, plan_id: 'bp_1', kind: 'looms', ref: `f_crepe:lg1`, value: String(10 + i), sort: i + 1 }));

  it('saves a plan with its lines as text, logs "saved", replaces lines on update and deletes with its lines', () => {
    gas.post({ action: 'batch', key, ops: [{ op: 'upsert', table: 'Units', rows: [{ id: 'u_2', name: 'Unit 2' }] }] });
    let r = gas.post({ action: 'batch', key, ops: [{ op: 'upsert', table: 'TfoBalancePlans', rows: [plan()] }, { op: 'upsert', table: 'TfoBalanceLines', rows: lines(2) }] });
    expect(r.ok).toBe(true);
    let t = gas.post({ action: 'bootstrap', key }).tables;
    expect(t.TfoBalancePlans[0]).toMatchObject({ id: 'bp_1', plan_date: '2026-10-25', name: 'Plan 25 Oct 2026', created_by: 'Owner' });
    expect(t.TfoBalanceLines.map((l) => l.value)).toEqual(['10', '11']);
    expect(log()[0]).toMatchObject({ action: 'saved', type: 'TFO plan', item: 'Plan 25 Oct 2026 (2026-10-25)', details: 'Unit 2' });

    r = gas.post({ action: 'batch', key, ops: [
      { op: 'delete', table: 'TfoBalanceLines', ids: ['bl_0', 'bl_1'] },
      { op: 'upsert', table: 'TfoBalancePlans', rows: [plan({ summary: '{"net":3}' })] },
      { op: 'upsert', table: 'TfoBalanceLines', rows: lines(3, 10) },
    ] });
    expect(r.ok).toBe(true);
    t = gas.post({ action: 'bootstrap', key }).tables;
    expect(t.TfoBalanceLines).toHaveLength(3);
    expect(log()[0]).toMatchObject({ action: 'updated', type: 'TFO plan', details: 'plan inputs changed' });

    gas.post({ action: 'batch', key, ops: [{ op: 'upsert', table: 'TfoBalancePlans', rows: [plan({ name: 'Diwali plan' })] }] });
    expect(log()[0].details).toBe('Name Plan 25 Oct 2026 → Diwali plan');

    gas.post({ action: 'batch', key, ops: [{ op: 'delete', table: 'TfoBalanceLines', ids: ['bl_10', 'bl_11', 'bl_12'] }, { op: 'delete', table: 'TfoBalancePlans', ids: ['bp_1'] }] });
    t = gas.post({ action: 'bootstrap', key }).tables;
    expect(t.TfoBalancePlans).toHaveLength(0);
    expect(t.TfoBalanceLines).toHaveLength(0);
    const e = log();
    expect(e[0]).toMatchObject({ action: 'deleted', type: 'TFO plan', item: 'Diwali plan (2026-10-25)' });
    // the lines that went with the plan add no line of their own
    expect(e[1].details).toBe('Name Plan 25 Oct 2026 → Diwali plan');
  });
});

describe('sync: data version, fast loads, timing (v14)', () => {
  const fab = (id, name) => ({ op: 'upsert', table: 'Fabrics', rows: [{ id, name, reed_space_in: 64, ppi: 80 }] });

  it('moves the version on every save and says what it was before', () => {
    const b = gas.post({ action: 'bootstrap', key });
    expect(b.version).toBeTruthy();
    expect(gas.post({ action: 'version', key }).version).toBe(b.version);
    const s1 = gas.post({ action: 'batch', key, ops: [fab('f1', 'Gajji Silk')] });
    expect(s1.prev).toBe(b.version);
    expect(s1.version).not.toBe(b.version);
    expect(s1.version.charAt(0)).not.toBe('w');
    expect(gas.post({ action: 'version', key }).version).toBe(s1.version);
    const s2 = gas.post({ action: 'batch', key, ops: [fab('f1', 'Gajji Silk 2')] });
    expect(s2.prev).toBe(s1.version);
    expect(gas.post({ action: 'bootstrap', key }).version).toBe(s2.version);
  });

  it('the light check needs a key and reads no tab', () => {
    expect(gas.post({ action: 'version' }).ok).toBe(false);
    gas.post({ action: 'bootstrap', key });
    const before = gas.calls.batchGet;
    const r = gas.post({ action: 'version', key });
    expect(r.ok).toBe(true);
    expect(Object.keys(r).sort()).toEqual(['ok', 'version']);
    expect(gas.calls.batchGet).toBe(before);
  });

  it('a save that fails part-way still moves the version, so no device keeps a half-written copy', () => {
    const v0 = gas.post({ action: 'bootstrap', key }).version;
    const r = gas.post({ action: 'batch', key, ops: [fab('f1', 'Salsa'), { op: 'nonsense' }] });
    expect(r.ok).toBe(false);
    const v1 = gas.post({ action: 'version', key }).version;
    expect(v1).not.toBe(v0);
    expect(v1.charAt(0)).not.toBe('w');
  });

  it('a load that meets a save marked as being written waits for it and returns a clean version', () => {
    gas.post({ action: 'batch', key, ops: [fab('f1', 'Tissue')] });
    gas.props.DATA_VERSION = 'wcutoff123';
    const b = gas.post({ action: 'bootstrap', key });
    expect(b.ok).toBe(true);
    expect(b.tables.Fabrics.map((f) => f.id)).toEqual(['f1']);
    expect(b.version.charAt(0)).not.toBe('w');
    // a save that follows a cut-off one cannot vouch for anyone's copy
    gas.props.DATA_VERSION = 'wcutoff456';
    expect(gas.post({ action: 'batch', key, ops: [fab('f2', 'Ganesh')] }).prev).toBe('');
  });

  it('an edit typed or pasted by hand in a data tab moves the version; other tabs do not', () => {
    const v0 = gas.post({ action: 'bootstrap', key }).version;
    gas.ctx.onEdit({ range: { getSheet: () => ({ getName: () => 'Change log' }) } });
    expect(gas.post({ action: 'version', key }).version).toBe(v0);
    gas.ctx.onEdit({ range: { getSheet: () => ({ getName: () => 'PlannerLooms' }) } });
    expect(gas.post({ action: 'version', key }).version).toBe(v0);
    gas.ctx.onEdit({ range: { getSheet: () => ({ getName: () => 'Fabrics' }) } });
    expect(gas.post({ action: 'version', key }).version).not.toBe(v0);
  });

  it('a hand edit while a save is being written makes the saving device load in full', () => {
    const v0 = gas.post({ action: 'bootstrap', key }).version;
    const realUpsert = gas.ctx.upsert_;
    gas.ctx.upsert_ = (name, rows) => {
      gas.ctx.onEdit({ range: { getSheet: () => ({ getName: () => 'Fabrics' }) } }); // someone types in the Sheet mid-save
      expect(gas.props.DATA_VERSION.charAt(0)).toBe('w'); // the marker is left alone
      return realUpsert(name, rows);
    };
    const r = gas.post({ action: 'batch', key, ops: [fab('f1', 'Glass')] });
    gas.ctx.upsert_ = realUpsert;
    expect(r.ok).toBe(true);
    expect(r.prev).toBe('');
    expect(r.version).not.toBe(v0);
    // a save with no hand edit vouches as usual
    expect(gas.post({ action: 'batch', key, ops: [fab('f2', 'Tissue')] }).prev).toBe(r.version);
  });

  it('photo saves move the version but send no prev, so the next check loads the stamped fabric', () => {
    gas.post({ action: 'batch', key, ops: [fab('f1', 'Glass')] });
    const img = 'data:image/jpeg;base64,' + Buffer.from('x').toString('base64');
    const up = gas.post({ action: 'uploadPhoto', key, photo: { id: 'p1', fabric_id: 'f1' }, image: img, thumb: img });
    expect(up.ok).toBe(true);
    expect(up.version).toBeTruthy();
    expect('prev' in up).toBe(false);
    const del = gas.post({ action: 'deletePhoto', key, id: 'p1' });
    expect(del.version).not.toBe(up.version);
    expect('prev' in del).toBe(false);
  });

  it('rows pasted without an id get one once, and every device is told to load them', () => {
    gas.post({ action: 'bootstrap', key });
    const sh = gas.ss.getSheetByName('Yarns');
    sh.getRange(2, 2, 1, 3).setValues([['Pasted 75D', 'base', '']]);
    const v0 = gas.post({ action: 'version', key }).version;
    const b1 = gas.post({ action: 'bootstrap', key });
    expect(b1.tables.Yarns).toHaveLength(1);
    const id = b1.tables.Yarns[0].id;
    expect(id).toMatch(/^y_/);
    expect(b1.version).not.toBe(v0);
    const b2 = gas.post({ action: 'bootstrap', key });
    expect(b2.tables.Yarns[0].id).toBe(id);
    expect(b2.version).toBe(b1.version);
  });

  it('reads back hand-entered dates, times and numbers the same way on both read paths', () => {
    gas.post({ action: 'bootstrap', key });
    const sh = gas.ss.getSheetByName('Fabrics');
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const row = head.map(() => '');
    const put = (h, v) => { row[head.indexOf(h)] = v; };
    put('id', 'f_hand');
    put('name', 'Hand Pasted');
    put('price', 52.5);
    put('sale_date', vm.runInContext("new Date('2026-11-19T18:30:00Z')", gas.ctx)); // 20 Nov 2026, midnight in India
    put('updated_at', vm.runInContext("new Date('2026-11-20T05:00:00Z')", gas.ctx));
    sh.getRange(2, 1, 1, row.length).setValues([row]);
    const f = gas.post({ action: 'bootstrap', key }).tables.Fabrics[0];
    expect(f.price).toBe(52.5);
    expect(f.sale_date).toBe('2026-11-20');
    expect(f.updated_at).toBe('2026-11-20T05:00:00.000Z');
    expect(f.notes).toBe('');
  });

  it('logs each action and its time; only the owner can read the log', () => {
    gas.post({ action: 'bootstrap', key });
    gas.post({ action: 'version', key });
    const lines = gas.post({ action: 'perf', key }).lines;
    expect(lines.some((l) => /\|bootstrap\|\d+\|1$/.test(l))).toBe(true);
    expect(lines.some((l) => /\|version\|\d+\|1$/.test(l))).toBe(true);
    const other = gas.post({ action: 'addPerson', key, name: 'Ishaan' }).person.key;
    expect(gas.post({ action: 'perf', key: other }).ok).toBe(false);
    for (let i = 0; i < 260; i++) gas.post({ action: 'version', key });
    expect(gas.post({ action: 'perf', key }).lines.length).toBeLessThanOrEqual(200);
    expect(gas.props.PERF_LOG.length).toBeLessThan(9000);
    expect(gas.ctx.perfReport().some((l) => /^version: \d+ calls, median \d+ ms/.test(l))).toBe(true);
  });

  if (sheetsApi) {
    it('a load is one Sheets API call', () => {
      gas.post({ action: 'bootstrap', key });
      const before = gas.calls.batchGet;
      gas.post({ action: 'bootstrap', key });
      expect(gas.calls.batchGet - before).toBe(1);
    });

    it('falls back to reading tab by tab when the Sheets API call fails', () => {
      gas.post({ action: 'batch', key, ops: [fab('f1', 'Glass')] });
      gas.ctx.Sheets.Spreadsheets.Values.batchGet = () => { throw new Error('Sheets API has not been enabled'); };
      const b = gas.post({ action: 'bootstrap', key });
      expect(b.ok).toBe(true);
      expect(b.tables.Fabrics.map((f) => f.id)).toEqual(['f1']);
    });
  }
});
});
