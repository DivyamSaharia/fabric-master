// Round 2: temporary rate typed on a TPM yarn, and its three Save to master choices.
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/preact';
import { App } from './app.jsx';
import { buildIndex, fabricCalc, yarnRate } from './calc.js';
import { sampleTables } from './sampleData.js';
import { baseImpact, clearAllTempRates, getIndex, getState, resetDemo, saveTpmTempToMaster, setTempRate, tpmSavePlan } from './store.js';
import { resetListState } from './listState.js';
import { local } from './storage.js';
import { today } from './schema.js';

beforeAll(() => {
  window.scrollTo = () => {};
  window.confirm = () => true;
});

beforeEach(async () => {
  cleanup();
  localStorage.clear();
  resetListState();
  await resetDemo();
  clearAllTempRates();
});

async function open(hash) {
  window.location.hash = hash;
  render(<App />);
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

const clearTemps = async () => clearAllTempRates();

describe('calc: temporary rate on a TPM yarn', () => {
  const t = sampleTables();
  const tpm = t.Yarns.find((y) => y.id === 'y_tpm75');
  it('is the whole rate, over base + delta and over a temporary base rate', () => {
    expect(yarnRate(tpm, buildIndex(t)).rate).toBe(168); // 118 + 50
    expect(yarnRate(tpm, buildIndex(t, { y_fdy75: 130 })).rate).toBe(180); // temp base + delta
    const r = yarnRate(tpm, buildIndex(t, { y_fdy75: 130, y_tpm75: 200 }));
    expect(r).toMatchObject({ rate: 200, temp: true, tpmTemp: true, masterRate: 168, masterBaseRate: 118, masterDelta: 50 });
  });
  it('moves only fabrics using that TPM yarn; the base yarn keeps its rate elsewhere', () => {
    const idx = buildIndex(t, { y_tpm75: 200 });
    const crepe = fabricCalc(idx.fabricsById.f_crepe, idx);
    expect(crepe.weft[0].rate).toBe(200);
    expect(crepe.weft[0].temp).toBe(true);
    expect(crepe.warp[0].rate).toBe(118); // 75D FDY warp: untouched
    const pv = fabricCalc(idx.fabricsById.f_pv, idx);
    expect(pv.weft[0].rate).toBe(118);
    // cost moves by exactly the rate difference × weft kg
    const base = fabricCalc(buildIndex(t).fabricsById.f_crepe, buildIndex(t));
    expect(crepe.rmCost - base.rmCost).toBeCloseTo((crepe.weft[0].gpm / 1000) * (200 - 168), 9);
  });
});

describe('Save to master: the three choices', () => {
  it('plans delta only, base only and both, with what each reaches', async () => {
    await clearTemps();
    setTempRate('y_tpm75', 180);
    const d = tpmSavePlan('y_tpm75', 'delta');
    expect(d).toMatchObject({ ok: true, oldBase: 118, oldDelta: 50, newBase: 118, newDelta: 62 });
    expect(d.impact).toEqual({ yarns: 1, tpmYarns: 1, fabrics: 1 });
    const b = tpmSavePlan('y_tpm75', 'base');
    expect(b).toMatchObject({ ok: true, newBase: 130, newDelta: 50 });
    // 75D FDY + 75D TPM; Poly Crepe (both) and PV Plain (FDY weft)
    expect(b.impact).toEqual({ yarns: 2, tpmYarns: 1, fabrics: 2 });
    expect(baseImpact('y_fdy75')).toEqual(b.impact);
    const both = tpmSavePlan('y_tpm75', 'both', '125');
    expect(both).toMatchObject({ ok: true, newBase: 125, newDelta: 55 });
    expect(tpmSavePlan('y_tpm75', 'both', '').ok).toBe(false);
    expect(tpmSavePlan('y_tpm75', 'both', '190').error).toMatch(/below zero/);
  });
  it('refuses a negative delta and a base rate of zero or less', async () => {
    await clearTemps();
    setTempRate('y_tpm75', 100);
    expect(tpmSavePlan('y_tpm75', 'delta').error).toMatch(/below zero/);
    expect(tpmSavePlan('y_tpm75', 'base')).toMatchObject({ ok: true, newBase: 50 });
    setTempRate('y_tpm75', 40);
    expect(tpmSavePlan('y_tpm75', 'base').error).toMatch(/₹0 or less/);
  });
  it('delta only: writes the delta, keeps the base rate and the base yarn\'s temporary rate', async () => {
    await clearTemps();
    setTempRate('y_fdy75', 130);
    setTempRate('y_tpm75', 180);
    const rates = JSON.stringify(getState().tables.YarnRates);
    await saveTpmTempToMaster('y_tpm75', 'delta');
    expect(getIndex().yarnsById.y_tpm75.tpm_delta).toBe(62);
    expect(JSON.stringify(getState().tables.YarnRates)).toBe(rates);
    expect(getState().tempRates).toEqual({ y_fdy75: 130 });
    // master now 118 + 62 = 180
    expect(yarnRate(getIndex().yarnsById.y_tpm75, { ...getIndex(), tempRates: {} }).rate).toBe(180);
  });
  it('base only: a new base rate dated today, delta kept, both temporary rates removed', async () => {
    await clearTemps();
    setTempRate('y_fdy75', 130);
    setTempRate('y_tpm75', 180);
    await saveTpmTempToMaster('y_tpm75', 'base');
    const idx = getIndex();
    expect(idx.ratesByYarn.y_fdy75[0]).toMatchObject({ rate: 130, effective_date: today() });
    expect(Number(idx.yarnsById.y_tpm75.tpm_delta)).toBe(50);
    expect(getState().tempRates).toEqual({});
    expect(yarnRate(idx.yarnsById.y_tpm75, idx).rate).toBe(180);
    expect(yarnRate(idx.yarnsById.y_fdy75, idx).rate).toBe(130);
  });
  it('both: the typed base rate and the remainder as delta, in one save', async () => {
    await clearTemps();
    setTempRate('y_tpm75', 180);
    await saveTpmTempToMaster('y_tpm75', 'both', '125');
    const idx = getIndex();
    expect(idx.ratesByYarn.y_fdy75[0]).toMatchObject({ rate: 125, effective_date: today() });
    expect(idx.yarnsById.y_tpm75.tpm_delta).toBe(55);
    expect(yarnRate(idx.yarnsById.y_tpm75, idx).rate).toBe(180);
    expect(getState().tempRates).toEqual({});
  });
  it('a base rate already dated today is replaced, not doubled', async () => {
    await clearTemps();
    setTempRate('y_tpm75', 180);
    await saveTpmTempToMaster('y_tpm75', 'base');
    setTempRate('y_tpm75', 190);
    await saveTpmTempToMaster('y_tpm75', 'base');
    const todays = getIndex().ratesByYarn.y_fdy75.filter((r) => String(r.effective_date).slice(0, 10) === today());
    expect(todays.length).toBe(1);
    expect(todays[0].rate).toBe(140);
  });
});

describe('screens', () => {
  it('fabric page: typed on the TPM yarn, then saved to master from the strip with the count shown', async () => {
    await clearTemps();
    await open('#/fabric/f_crepe');
    await screen.findByText('Finishing · RFD');
    const input = screen.getByLabelText('Temporary rate for 75D TPM 2000 S/Z');
    expect(input.getAttribute('placeholder')).toBe('168');
    fireEvent.input(input, { target: { value: '180' } });
    fireEvent.blur(input);
    await waitFor(() => expect(document.querySelector('.temp-strip').textContent).toMatch(/1 temporary yarn rate active/));
    expect(document.querySelector('.temp-note').textContent).toMatch(/75D TPM 2000 S\/Z ₹180\/kg/);
    expect(document.body.textContent).toMatch(/₹180\/kg \(temp\)/);
    expect(local.get('fm.tempRates.v1')).toEqual({ y_tpm75: 180 });
    fireEvent.click(document.querySelector('.temp-strip'));
    await screen.findByText('Temporary rates');
    expect(document.body.textContent).toMatch(/TPM yarn · master ₹118 \+ ₹50 = ₹168\/kg/);
    fireEvent.click(screen.getByRole('button', { name: 'Save to master' }));
    await screen.findByText('What to change in the master');
    expect(document.body.textContent).toMatch(/Only 75D TPM 2000 S\/Z changes, in 1 fabric/);
    fireEvent.click(screen.getByRole('button', { name: 'Base only' }));
    await waitFor(() => expect(document.body.textContent).toMatch(/moves 2 yarns \(75D Polyester FDY and 1 TPM yarn made from it\) and 2 fabrics, for everyone/));
    fireEvent.click(screen.getByRole('button', { name: 'Both' }));
    fireEvent.input(screen.getByLabelText('New rate · 75D Polyester FDY'), { target: { value: '200' } });
    await waitFor(() => expect(document.body.textContent).toMatch(/delta would be below zero/));
    fireEvent.input(screen.getByLabelText('New rate · 75D Polyester FDY'), { target: { value: '126' } });
    await waitFor(() => expect(document.body.textContent).toMatch(/was ₹50/));
    const saveBtns = screen.getAllByRole('button', { name: 'Save to master' });
    fireEvent.click(saveBtns[saveBtns.length - 1]);
    await waitFor(() => expect(document.querySelector('.temp-strip')).toBeNull());
    expect(getIndex().ratesByYarn.y_fdy75[0].rate).toBe(126);
    expect(getIndex().yarnsById.y_tpm75.tpm_delta).toBe(54);
  });
  it('yarn list and the TPM yarn page show it as temporary', async () => {
    await clearTemps();
    setTempRate('y_tpm75', 180);
    await open('#/yarn/y_tpm75');
    await screen.findByText('Temporary rate');
    expect(document.body.textContent).toMatch(/typed on this TPM yarn/);
    window.location.hash = '#/yarns';
    await waitFor(() => expect(document.body.textContent).toMatch(/temporary, master ₹168/));
  });
});
