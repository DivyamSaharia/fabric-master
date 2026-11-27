// 1.34.0: sale rate history per fabric (SaleRates), older sale rate picker, delete like yarn rates.
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/preact';
import { App } from './app.jsx';
import { fabricCalc, fmt } from './calc.js';
import { clearAllTempPrices, deleteFabric, deleteSaleRates, duplicateFabric, getIndex, getState, resetDemo, saveFabric, saveTempPriceToMaster, setTempPrice, todayIst } from './store.js';
import { resetListState } from './listState.js';
import { saleDeletePlan, saleHistory, saleSaveOps, sortSaleRows } from './saleRates.js';
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
  it('save: new price adds a row, same date updates it, unchanged adds nothing, date-only moves the row', () => {
    const old = { id: 'f', price: 45, sale_date: '2026-10-02' };
    const add = saleSaveOps(old, { ...old, price: 47, sale_date: '2026-11-27' }, rows);
    expect(add[0].rows[0]).toMatchObject({ fabric_id: 'f', rate: 47, effective_date: '2026-11-27' });
    expect(add[0].rows[0].id).toMatch(/^sr_/);
    expect(saleSaveOps(old, { ...old, price: 46 }, rows)[0].rows[0]).toMatchObject({ id: 'b', rate: 46 });
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

describe('fabric page: Sale rate history', () => {
  it('lists the history, views an older rate, and deletes like yarn rates', async () => {
    await open('#/fabric/f_crepe');
    const sec = await waitFor(() => document.getElementById('sec-sale-rates'));
    expect(sec.textContent).toContain('in use');
    expect(sec.textContent).toContain(fmt.rs(42));
    // view at the older rate: the page's realisation moves to the one at ₹42, nothing saved
    const at42 = fabricCalc({ ...stored('f_crepe'), price: 42, sale_date: '2026-08-14' }, getIndex());
    fireEvent.change(within(sec).getByLabelText('Sale rate to view at'), { target: { value: 'sr1' } });
    await waitFor(() => expect(document.body.textContent).toContain('Showing a past sale rate'));
    expect(document.querySelector('.tile.accent .t-value').textContent).toBe(fmt.pick(at42.realisationNetPerPick));
    expect(stored('f_crepe').price).toBe(45);
    fireEvent.click(screen.getByText('Use current rate'));
    await waitFor(() => expect(document.body.textContent).not.toContain('Showing a past sale rate'));
    // delete the rate in use: ₹42 becomes the price
    fireEvent.click(within(sec).getByLabelText('Delete sale rate from 2 Oct 2026'));
    const title = await answer(true);
    expect(title).toContain(fmt.rs(45));
    await waitFor(() => expect(stored('f_crepe')).toMatchObject({ price: 42, sale_date: '2026-08-14' }));
  });
  it('a fabric with history but no price says so and picks nothing', async () => {
    const f = stored('f_crepe');
    await saveFabric({ ...f, price: '', sale_date: '' }, lines('f_crepe'), units('f_crepe'));
    await open('#/fabric/f_crepe');
    const sec = await waitFor(() => document.getElementById('sec-sale-rates'));
    expect(sec.textContent).toContain('No selling price set');
    expect(within(sec).getByLabelText('Sale rate to view at').value).toBe('');
    // f_pv's price has no sale date, so it is not the history row: deleting that row keeps the price
    await deleteSaleRates('f_pv', ['sr3']);
    expect(stored('f_pv').price).toBe(39);
  });
  it('a temporary sale rate locks the picker', async () => {
    setTempPrice('f_crepe', 60);
    await open('#/fabric/f_crepe');
    const sec = await waitFor(() => document.getElementById('sec-sale-rates'));
    expect(within(sec).getByLabelText('Sale rate to view at').disabled).toBe(true);
  });
  it('a price not in the history shows without a delete button', async () => {
    await open('#/fabric/f_geo');
    const sec = await waitFor(() => document.getElementById('sec-sale-rates'));
    expect(sec.textContent).toContain('not in the history');
    expect(within(sec).queryAllByRole('button').length).toBe(0);
  });
});
