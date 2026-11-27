// 1.34.0: sale rate history per fabric (SaleRates), delete like yarn rates.
// 1.35.0: every price change is its own row (also on one date); tap a rate for its realisation at the yarn rates of its date.
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/preact';
import { App } from './app.jsx';
import { fabricCalc, fmt, unitProfit } from './calc.js';
import { clearAllTempPrices, commit, deleteFabric, deleteSaleRates, duplicateFabric, getIndex, getState, resetDemo, saveFabric, saveTempPriceToMaster, setTempPrice, todayIst } from './store.js';
import { resetListState } from './listState.js';
import { pastRateView, saleDeletePlan, saleHistory, saleSaveOps, sortSaleRows } from './saleRates.js';
import { answer } from './testUtil.js';

beforeAll(() => {
  window.scrollTo = () => {};
});

beforeEach(async () => {
  cleanup();
  localStorage.clear();
  resetListState();
  await resetDemo();
  clearAllTempPrices();
});

const rowsOf = (fid) => getState().tables.SaleRates.filter((r) => r.fabric_id === fid);
const stored = (fid) => getState().tables.Fabrics.find((f) => f.id === fid);
const lines = (fid) => getIndex().linesByFabric[fid] || [];
const units = (fid) => (getIndex().assignmentsByFabric[fid] || []).map((a) => a.unit_id);

describe('saleRates.js rules', () => {
  const rows = [
    { id: 'a', fabric_id: 'f', rate: 40, effective_date: '2026-08-01' },
    { id: 'b', fabric_id: 'f', rate: 45, effective_date: '2026-10-02' },
    { id: 'c', fabric_id: 'f', rate: 38, effective_date: '' },
  ];
  it('sorts newest first, blank dates last', () => {
    expect(sortSaleRows(rows).map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });
  it('marks the row matching price and sale date as in use', () => {
    const h = saleHistory({ id: 'f', price: 45, sale_date: '2026-10-02' }, rows);
    expect(h.map((x) => [x.id, x.inUse, x.virtual])).toEqual([['b', true, false], ['a', false, false], ['c', false, false]]);
  });
  it('a price with no matching row shows as a virtual row on top', () => {
    const h = saleHistory({ id: 'f', price: 50, sale_date: '2026-11-01' }, rows);
    expect(h[0]).toMatchObject({ rate: 50, date: '2026-11-01', inUse: true, virtual: true });
    expect(h).toHaveLength(4);
    expect(saleHistory({ id: 'f', price: '' }, [])).toEqual([]);
  });
  it('save: every price change adds a row, unchanged adds nothing, date-only moves the row', () => {
    const old = { id: 'f', price: 45, sale_date: '2026-10-02' };
    const add = saleSaveOps(old, { ...old, price: 47, sale_date: '2026-11-27' }, rows);
    expect(add[0].rows[0]).toMatchObject({ fabric_id: 'f', rate: 47, effective_date: '2026-11-27' });
    expect(add[0].rows[0].id).toMatch(/^sr_/);
    // a new price on the same date as the rate in use is a new row too (1.35.0): row b is not touched
    const same = saleSaveOps(old, { ...old, price: 46 }, rows)[0].rows[0];
    expect(same.id).not.toBe('b');
    expect(same).toMatchObject({ rate: 46, effective_date: '2026-10-02' });
    // going back to a price and date already in the history is a new row as well, so the newest row is the one in use
    const back = saleSaveOps({ id: 'f', price: 46, sale_date: '2026-10-02' }, old, rows)[0].rows[0];
    expect(back.id).not.toBe('b');
    expect(back).toMatchObject({ rate: 45, effective_date: '2026-10-02' });
    expect(saleSaveOps(old, { ...old }, rows)).toEqual([]);
    expect(saleSaveOps(old, { ...old, sale_date: '2026-10-05' }, rows)[0].rows[0]).toMatchObject({ id: 'b', rate: 45, effective_date: '2026-10-05' });
    // moving the date onto an older row's date moves the row in use; the older row is kept
    expect(saleSaveOps(old, { ...old, sale_date: '2026-08-01' }, rows)[0].rows[0]).toMatchObject({ id: 'b', rate: 45, effective_date: '2026-08-01' });
    // a new price typed with an older row's date adds a row; the older row is kept
    const typed = saleSaveOps(old, { ...old, price: 41, sale_date: '2026-08-01' }, rows)[0].rows[0];
    expect(typed.id).not.toBe('a');
    expect(typed).toMatchObject({ rate: 41, effective_date: '2026-08-01' });
    expect(saleSaveOps(old, { ...old, price: '' }, rows)).toEqual([]);
    expect(saleSaveOps(undefined, { id: 'n', price: 30, sale_date: '2026-11-27' }, [])[0].rows[0]).toMatchObject({ fabric_id: 'n', rate: 30 });
  });
  it('save on a device that has not loaded the history yet still only adds rows', () => {
    const old = { id: 'f', price: 45, sale_date: '2026-10-02' };
    const op = saleSaveOps(old, { ...old, price: 46 }, [])[0];
    expect(op.rows[0].id).toMatch(/^sr_/);
    // date-only move with no row to move: a row for the new date, or nothing when it is already there
    expect(saleSaveOps(old, { ...old, sale_date: '2026-10-05' }, [])[0].rows[0]).toMatchObject({ rate: 45, effective_date: '2026-10-05' });
    expect(saleSaveOps(old, { ...old, sale_date: '2026-10-05' }, [{ id: 'z', fabric_id: 'f', rate: 45, effective_date: '2026-10-05' }])).toEqual([]);
  });
  it('rows on one date: the one saved last is in use, and each shows when it was saved', () => {
    const day = [
      { id: 'p', fabric_id: 'f', rate: 48, effective_date: '2026-11-27', updated_at: '2026-11-27T11:11:59.000Z' },
      { id: 'q', fabric_id: 'f', rate: 49, effective_date: '2026-11-27', updated_at: '2026-11-27T11:12:35.000Z' },
      { id: 'r', fabric_id: 'f', rate: 48, effective_date: '2026-11-27', updated_at: '2026-11-27T11:13:06.000Z' },
    ];
    const h = saleHistory({ id: 'f', price: 48, sale_date: '2026-11-27' }, day);
    expect(h.map((x) => [x.id, x.inUse])).toEqual([['r', true], ['q', false], ['p', false]]);
    expect(h[0].saved).toMatch(/4:43/);
    // deleting the one in use brings back the one saved before it
    expect(saleDeletePlan({ id: 'f', price: 48, sale_date: '2026-11-27' }, day, ['r']).next).toEqual({ rate: 49, date: '2026-11-27' });
    // a single row on its date carries no saved time
    expect(saleHistory({ id: 'f', price: 45, sale_date: '2026-10-02' }, rows)[0].saved).toBe('');
  });
  it('delete: the rate in use brings back the next older one; others leave the price', () => {
    const f = { id: 'f', price: 45, sale_date: '2026-10-02' };
    const p1 = saleDeletePlan(f, rows, ['b']);
    expect(p1.next).toEqual({ rate: 40, date: '2026-08-01' });
    expect(p1.ops[1]).toEqual({ op: 'upsert', table: 'Fabrics', rows: [{ id: 'f', price: 40, sale_date: '2026-08-01' }] });
    const p2 = saleDeletePlan(f, rows, ['a']);
    expect(p2.next).toBeUndefined();
    expect(p2.ops).toHaveLength(1);
    const p3 = saleDeletePlan(f, rows, ['a', 'b', 'c']);
    expect(p3.next).toBeNull();
    expect(p3.ops[1].rows[0]).toEqual({ id: 'f', price: '', sale_date: '' });
    // a virtual row is never deleted and a price not in the history stays
    const p4 = saleDeletePlan({ id: 'f', price: 50, sale_date: '' }, rows, ['current_f', 'b']);
    expect(p4.ops).toEqual([{ op: 'delete', table: 'SaleRates', ids: ['b'] }]);
  });
});

describe('store: history follows every price save', () => {
  it('two prices saved on the same day are two rows; deleting walks back through them', async () => {
    const day = todayIst();
    await saveFabric({ ...stored('f_crepe'), price: 49, sale_date: day }, lines('f_crepe'), units('f_crepe'));
    await new Promise((r) => setTimeout(r, 5));
    await saveFabric({ ...stored('f_crepe'), price: 48, sale_date: day }, lines('f_crepe'), units('f_crepe'));
    expect(rowsOf('f_crepe').map((r) => r.rate)).toEqual([42, 45, 49, 48]);
    const h = saleHistory(stored('f_crepe'), rowsOf('f_crepe'));
    expect(h.map((x) => [x.rate, x.inUse])).toEqual([[48, true], [49, false], [45, false], [42, false]]);
    await deleteSaleRates('f_crepe', [h[0].id]);
    expect(stored('f_crepe')).toMatchObject({ price: 49, sale_date: day });
  });
  it('editor price change adds a row; deleting it restores the older price', async () => {
    const f = stored('f_crepe');
    await saveFabric({ ...f, price: 48, sale_date: '2026-11-27' }, lines('f_crepe'), units('f_crepe'));
    expect(rowsOf('f_crepe').map((r) => [r.rate, r.effective_date]).sort()).toEqual([[42, '2026-08-14'], [45, '2026-10-02'], [48, '2026-11-27']]);
    const newest = rowsOf('f_crepe').find((r) => r.rate === 48);
    await deleteSaleRates('f_crepe', [newest.id]);
    expect(stored('f_crepe')).toMatchObject({ price: 45, sale_date: '2026-10-02' });
    expect(rowsOf('f_crepe')).toHaveLength(2);
  });
  it('saving without a price change writes no history', async () => {
    const f = stored('f_crepe');
    await saveFabric({ ...f, notes: 'x' }, lines('f_crepe'), units('f_crepe'));
    expect(rowsOf('f_crepe')).toHaveLength(2);
  });
  it('temporary sale rate saved to master goes into the history dated today', async () => {
    setTempPrice('f_crepe', 50);
    await saveTempPriceToMaster('f_crepe');
    expect(rowsOf('f_crepe').some((r) => r.rate === 50 && r.effective_date === todayIst())).toBe(true);
  });
  it('a copy starts its own history; deleting a fabric deletes its history', async () => {
    const nid = await duplicateFabric('f_crepe');
    expect(rowsOf(nid).map((r) => r.rate)).toEqual([45]);
    await deleteFabric('f_crepe');
    expect(rowsOf('f_crepe')).toEqual([]);
  });
});

async function open(hash) {
  window.location.hash = hash;
  render(<App />);
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

describe('past rate view: realisation at the yarn rates of the date', () => {
  // f_crepe: warp y_fdy75, weft y_tpm75 (TPM on a base yarn). Demo yarn rates all carry one date.
  const baseOfTpm = () => getIndex().yarnsById[getIndex().yarnsById.y_tpm75.base_yarn_id];
  it('undated rate: today\u2019s yarn rates; dated before every yarn rate: earliest rates, flagged', () => {
    const idx = getIndex();
    const f = idx.fabricsById.f_crepe;
    const v0 = pastRateView(f, { rate: 42, date: '' }, idx);
    expect(v0.dated).toBe(false);
    expect(v0.changed).toBe(0);
    expect(v0.then.realisationNetPerPick).toBeCloseTo(fabricCalc({ ...f, price: 42 }, idx).realisationNetPerPick, 9);
    const v1 = pastRateView(f, { rate: 42, date: '2026-08-14' }, idx);
    expect(v1.yarns.every((y) => y.early && !y.changed)).toBe(true);
    expect(v1.then.rmCost).toBeCloseTo(v1.now.rmCost, 9);
    expect(v1.then.rmCost).not.toBeNull();
  });
  it('an older yarn rate on or before the date is used and reported as changed', async () => {
    const base = baseOfTpm();
    await commit([{ op: 'upsert', table: 'YarnRates', rows: [
      { id: 'r_old_w', yarn_id: 'y_fdy75', rate: 100, effective_date: '2026-08-01' },
      { id: 'r_mid_w', yarn_id: 'y_fdy75', rate: 109, effective_date: '2026-09-01' },
      ...(base.id === 'y_fdy75' ? [] : [{ id: 'r_old_b', yarn_id: base.id, rate: 90, effective_date: '2026-08-10' }]),
    ] }]);
    const idx = getIndex();
    const f = idx.fabricsById.f_crepe;
    const v = pastRateView(f, { rate: 42, date: '2026-08-14' }, idx);
    const w = v.yarns.find((y) => y.yarn.id === 'y_fdy75');
    expect(w).toMatchObject({ thenRate: 100, thenDate: '2026-08-01', nowRate: 118, changed: true, early: false });
    expect(v.changed).toBe(v.yarns.length);
    // same figures as the calc run as of that date, at that price
    const ref = fabricCalc({ ...f, price: 42, sale_date: '2026-08-14' }, idx, '2026-08-14');
    expect(v.then.realisationNetPerPick).toBeCloseTo(ref.realisationNetPerPick, 9);
    expect(v.then.rmCost).toBeLessThan(v.now.rmCost);
    // a date between two rates takes the earlier one: on 20 Aug the 1 Aug warp rate still applies, on 1 Sep the new one
    expect(pastRateView(f, { rate: 45, date: '2026-08-20' }, idx).yarns.find((y) => y.yarn.id === 'y_fdy75').thenRate).toBe(100);
    expect(pastRateView(f, { rate: 45, date: '2026-09-01' }, idx).yarns.find((y) => y.yarn.id === 'y_fdy75').thenRate).toBe(109);
    // by hand: cheaper warp only changes raw material cost, so realisation per m moves by exactly that
    expect((v.then.realisationPerM - 42) - (ref.realisationPerM - 42)).toBeCloseTo(0, 9);
    expect(v.now.price).toBe(45);
  });
  it('temporary rates on the device are left out', () => {
    setTempPrice('f_crepe', 60);
    const idx = getIndex();
    const v = pastRateView(idx.fabricsById.f_crepe, { rate: 42, date: '' }, idx);
    expect(v.now.price).toBe(45);
    expect(v.then.price).toBe(42);
  });
});

describe('fabric page: Sale rate history', () => {
  it('lists the history, opens a past rate on its date, and deletes like yarn rates', async () => {
    await commit([{ op: 'upsert', table: 'YarnRates', rows: [{ id: 'r_old_w', yarn_id: 'y_fdy75', rate: 100, effective_date: '2026-08-01' }] }]);
    await open('#/fabric/f_crepe');
    const sec = await waitFor(() => document.getElementById('sec-sale-rates'));
    expect(sec.textContent).toContain('in use');
    expect(sec.textContent).toContain(fmt.rs(42));
    expect(within(sec).queryByLabelText('Sale rate to view at')).toBeNull();
    const before = document.querySelector('.tile.accent .t-value').textContent;
    // tap the older rate: a sheet with realisation at ₹42 and the yarn rates of 14 Aug; the page itself stays
    fireEvent.click(within(sec).getByLabelText(`See realisation at ${fmt.rs(42)} from 14 Aug 2026`));
    const dlg = await waitFor(() => screen.getByRole('dialog'));
    const idx = getIndex();
    const at42 = fabricCalc({ ...idx.fabricsById.f_crepe, price: 42, sale_date: '2026-08-14' }, idx, '2026-08-14', pastRateView(idx.fabricsById.f_crepe, { rate: 42, date: '2026-08-14' }, idx).yarns.reduce((o, y) => (y.early ? { ...o, [y.yarn.id]: y.thenDate } : o), {}));
    expect(dlg.querySelector('.tile.accent .t-value').textContent).toBe(fmt.pick(at42.realisationNetPerPick));
    expect(dlg.querySelector('[data-past-note]').textContent).toContain('Yarn rates have changed since 14 Aug 2026 (1 of');
    expect(dlg.textContent).toContain(fmt.rate(100));
    expect(dlg.textContent).toContain(`Profit per pick at`);
    const u = idx.unitsById.u_2;
    if (unitProfit(at42, u).profitPerPick !== null) expect(dlg.textContent).toContain(fmt.pick(unitProfit(at42, u).profitPerPick));
    expect(stored('f_crepe').price).toBe(45);
    fireEvent.click(within(dlg).getAllByLabelText('Close')[0]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.querySelector('.tile.accent .t-value').textContent).toBe(before);
    // the rate in use opens too: its own date against today
    fireEvent.click(within(sec).getByLabelText(`See realisation at ${fmt.rs(45)} from 2 Oct 2026, in use`));
    const dlg2 = await waitFor(() => screen.getByRole('dialog'));
    expect(dlg2.textContent).toContain('At the yarn rates of its date, and at today’s yarn rates');
    fireEvent.click(within(dlg2).getAllByLabelText('Close')[0]);
    // delete the rate in use: ₹42 becomes the price
    fireEvent.click(within(sec).getByLabelText('Delete sale rate from 2 Oct 2026'));
    const title = await answer(true);
    expect(title).toContain(fmt.rs(45));
    await waitFor(() => expect(stored('f_crepe')).toMatchObject({ price: 42, sale_date: '2026-08-14' }));
  });
  it('a fabric with history but no price says so', async () => {
    const f = stored('f_crepe');
    await saveFabric({ ...f, price: '', sale_date: '' }, lines('f_crepe'), units('f_crepe'));
    await open('#/fabric/f_crepe');
    const sec = await waitFor(() => document.getElementById('sec-sale-rates'));
    expect(sec.textContent).toContain('No selling price set');
    // f_pv's price has no sale date, so it is not the history row: deleting that row keeps the price
    await deleteSaleRates('f_pv', ['sr3']);
    expect(stored('f_pv').price).toBe(39);
  });
  it('a temporary sale rate does not lock the history: a past rate still opens, on master figures', async () => {
    setTempPrice('f_crepe', 60);
    await open('#/fabric/f_crepe');
    const sec = await waitFor(() => document.getElementById('sec-sale-rates'));
    fireEvent.click(within(sec).getByLabelText(`See realisation at ${fmt.rs(42)} from 14 Aug 2026`));
    const dlg = await waitFor(() => screen.getByRole('dialog'));
    expect(dlg.textContent).toContain(`In use today (${fmt.rs(45)})`);
  });
  it('a price not in the history shows without a delete button', async () => {
    await open('#/fabric/f_geo');
    const sec = await waitFor(() => document.getElementById('sec-sale-rates'));
    expect(sec.textContent).toContain('not in the history');
    // only the row's own open button: no delete on a price that is not in the history
    expect(within(sec).queryAllByLabelText(/^Delete sale rate/).length).toBe(0);
  });
});
