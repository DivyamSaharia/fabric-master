// 1.27.0: temporary TPM rate as delta + base, temporary loom RPM, TPM production per spindle and machine,
// laptop jump buttons, and the search with favourites, recent and keys.
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/preact';
import { App } from './app.jsx';
import { buildIndex, fabricCalc, loomPerDay, tfoOutput, yarnRate } from './calc.js';
import { sampleTables } from './sampleData.js';
import {
  activeTempRates, activeTempRpms, clearAllTempRates, clearAllTempRpms, getIndex, getState, resetDemo, saveTempRpmToMaster, saveTpmTempToMaster,
  setTempDelta, setTempRate, setTempRpm, tpmSavePlan,
} from './store.js';
import { resetListState } from './listState.js';
import { local } from './storage.js';
import { today } from './schema.js';
import { tpmProductionRows } from './screens/yarns.jsx';
import { buildSearchIndex, searchPlaces } from './search.js';

beforeAll(() => {
  window.scrollTo = () => {};
});

beforeEach(async () => {
  cleanup();
  localStorage.clear();
  resetListState();
  await resetDemo();
  clearAllTempRates();
  clearAllTempRpms();
});

async function open(hash) {
  window.location.hash = hash;
  render(<App />);
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

describe('calc: temporary TPM rate = base + delta, each part temporary or master', () => {
  const t = sampleTables();
  const tpm = t.Yarns.find((y) => y.id === 'y_tpm75');
  it('a temporary delta, a temporary base, or both', () => {
    expect(yarnRate(tpm, buildIndex(t)).rate).toBe(168); // 118 + 50
    expect(yarnRate(tpm, buildIndex(t, {}, {}, { tempDeltas: { y_tpm75: 62 } }))).toMatchObject({ rate: 180, temp: true, tempDelta: true, tempBase: false, masterRate: 168, masterDelta: 50, masterBaseRate: 118 });
    expect(yarnRate(tpm, buildIndex(t, { y_fdy75: 130 }))).toMatchObject({ rate: 180, temp: true, tempBase: true, tempDelta: false, masterRate: 168 });
    expect(yarnRate(tpm, buildIndex(t, { y_fdy75: 130 }, {}, { tempDeltas: { y_tpm75: 0 } })).rate).toBe(130); // zero delta allowed
  });
  it('a temporary delta moves only fabrics using that TPM yarn', () => {
    const idx = buildIndex(t, {}, {}, { tempDeltas: { y_tpm75: 62 } });
    const crepe = fabricCalc(idx.fabricsById.f_crepe, idx);
    expect(crepe.weft[0].rate).toBe(180);
    expect(crepe.weft[0].temp).toBe(true);
    expect(crepe.warp[0].rate).toBe(118);
    expect(fabricCalc(idx.fabricsById.f_pv, idx).weft[0].rate).toBe(118);
  });
});

describe('Save to master: saves what was typed', () => {
  it('delta only', async () => {
    setTempDelta('y_tpm75', 62);
    const p = tpmSavePlan('y_tpm75');
    expect(p).toMatchObject({ ok: true, saveDelta: true, saveBase: false, newDelta: 62, oldDelta: 50, newBase: 118 });
    expect(p.impact).toEqual({ yarns: 1, tpmYarns: 1, fabrics: 1 });
    const rates = JSON.stringify(getState().tables.YarnRates);
    await saveTpmTempToMaster('y_tpm75');
    expect(getIndex().yarnsById.y_tpm75.tpm_delta).toBe(62);
    expect(JSON.stringify(getState().tables.YarnRates)).toBe(rates);
    expect(getState().tempDeltas).toEqual({});
  });
  it('base and delta together, base dated today, both temporary parts removed', async () => {
    setTempRate('y_fdy75', 125);
    setTempDelta('y_tpm75', 55);
    const p = tpmSavePlan('y_tpm75');
    expect(p).toMatchObject({ ok: true, saveDelta: true, saveBase: true, newBase: 125, newDelta: 55, replacesToday: null });
    expect(p.impact).toEqual({ yarns: 2, tpmYarns: 1, fabrics: 2 });
    await saveTpmTempToMaster('y_tpm75');
    const idx = getIndex();
    expect(idx.ratesByYarn.y_fdy75[0]).toMatchObject({ rate: 125, effective_date: today() });
    expect(idx.yarnsById.y_tpm75.tpm_delta).toBe(55);
    expect(yarnRate(idx.yarnsById.y_tpm75, idx).rate).toBe(180);
    expect(getState().tempRates).toEqual({});
    expect(getState().tempDeltas).toEqual({});
    // a second base save today replaces today's rate
    setTempRate('y_fdy75', 126);
    setTempDelta('y_tpm75', 55);
    expect(tpmSavePlan('y_tpm75').replacesToday).toBe(125);
    await saveTpmTempToMaster('y_tpm75');
    expect(getIndex().ratesByYarn.y_fdy75.filter((r) => String(r.effective_date).slice(0, 10) === today()).length).toBe(1);
  });
  it('refuses a negative delta and nothing to save', () => {
    expect(setTempDelta('y_tpm75', -1)).toBe(false);
    expect(setTempDelta('y_tpm75', 0)).toBe(true);
    clearAllTempRates();
    expect(tpmSavePlan('y_tpm75').ok).toBe(false);
  });
  it('an old whole TPM rate on this device becomes a delta when the data loads', async () => {
    // an old whole TPM rate left on the device; the next load of the tables turns it into a delta
    setTempRate('y_tpm75', 180);
    setTempRate('y_fdy75', 120);
    await resetDemo();
    expect(getState().tempRates).toEqual({ y_fdy75: 120 });
    expect(getState().tempDeltas).toEqual({ y_tpm75: 60 });
    expect(yarnRate(getIndex().yarnsById.y_tpm75, getIndex()).rate).toBe(180);
  });
  it('the panel lists a TPM delta with its base and master', () => {
    setTempDelta('y_tpm75', 62);
    const item = activeTempRates().find((x) => x.yarn.id === 'y_tpm75');
    expect(item).toMatchObject({ tpm: true, tempDelta: 62, delta: 50, masterBase: 118, baseTemp: null, rate: 180, masterRate: 168 });
  });
});

describe('screens: TPM rate typed as delta and base', () => {
  it('fabric page: two boxes, then Save to master from the strip', async () => {
    await open('#/fabric/f_crepe');
    await screen.findByText('Finishing · RFD');
    const delta = screen.getByLabelText('Temporary delta for 75D TPM 2000 S/Z');
    expect(delta.getAttribute('placeholder')).toBe('50');
    const base = screen.getByLabelText('Temporary base rate for 75D TPM 2000 S/Z (75D Polyester FDY)');
    expect(base.getAttribute('placeholder')).toBe('118');
    fireEvent.input(delta, { target: { value: '62' } });
    fireEvent.blur(delta);
    await waitFor(() => expect(document.querySelector('.temp-strip').textContent).toMatch(/1 temporary yarn rate active/));
    expect(document.querySelector('.temp-note').textContent).toMatch(/75D TPM 2000 S\/Z delta ₹62\/kg/);
    expect(document.body.textContent).toMatch(/₹118 \+ ₹62 = ₹180\/kg \(temp\)/);
    expect(local.get('fm.tempDeltas.v1')).toEqual({ y_tpm75: 62 });
    fireEvent.click(document.querySelector('.temp-strip'));
    await screen.findByText('Temporary rates');
    fireEvent.click(screen.getByRole('button', { name: 'Save to master' }));
    await waitFor(() => expect(document.body.textContent).toMatch(/For everyone: only 75D TPM 2000 S\/Z changes, in 1 fabric/));
    const btns = screen.getAllByRole('button', { name: 'Save to master' });
    fireEvent.click(btns[btns.length - 1]);
    await waitFor(() => expect(document.querySelector('.temp-strip')).toBeNull());
    expect(getIndex().yarnsById.y_tpm75.tpm_delta).toBe(62);
  });
  it('the TPM yarn page shows a temporary delta and the yarn list says so', async () => {
    setTempDelta('y_tpm75', 62);
    await open('#/yarn/y_tpm75');
    await screen.findByText('Temporary delta');
    window.location.hash = '#/yarns';
    await waitFor(() => expect(document.body.textContent).toMatch(/base ₹118 \+ ₹62 \(temp\), master ₹168/));
  });
  it('Detailed share marks a temporary delta', async () => {
    const { detailedModel } = await import('./export/detailed.js');
    const idx = buildIndex(sampleTables(), {}, {}, { tempDeltas: { y_tpm75: 62 } });
    const f = idx.fabricsById.f_crepe;
    const m = detailedModel(f, fabricCalc(f, idx), idx);
    const rates = m.sections.find((s) => s.title === 'Yarn rates').rows;
    expect(rates[1][6]).toMatch(/temporary delta \(master ₹50\)/);
    expect(m.notes[m.notes.length - 1]).toMatch(/75D TPM 2000 S\/Z delta 62\.00\/kg/);
  });
});

describe('temporary loom RPM', () => {
  const t = sampleTables();
  it('beats the master RPM in every fabric figure; a fabric without one is unchanged', () => {
    const idx0 = buildIndex(t);
    const idx = buildIndex(t, {}, {}, { tempRpms: { f_crepe: { sp: 900 } } });
    const f = idx.fabricsById.f_crepe;
    const c = fabricCalc(f, idx);
    expect(c).toMatchObject({ rpmSp: 900, rpmTempSp: true, rpmTempDp: false, rpmTemp: true, masterRpmSp: num(f.loom_rpm) });
    const u = Object.values(idx.unitsById)[0];
    const l = loomPerDay(c, f, u, 1, 190);
    expect(l.rpm).toBe(900);
    expect(l.rpmTemp).toBe(true);
    expect(loomPerDay(fabricCalc(f, idx0), f, u, 1, 190).rpm).toBe(num(f.loom_rpm));
    // double panna (280 cm) is untouched until typed
    expect(loomPerDay(c, f, u, 1, 280).rpm).toBe(num(f.loom_rpm_dp));
    const pv = idx.fabricsById.f_pv;
    expect(fabricCalc(pv, idx).rpmTemp).toBe(false);
  });
  it('the Planner keeps its own RPM', async () => {
    const { masterLoomRpm, qualities } = await import('./planner.js');
    setTempRpm('f_crepe', 'sp', 900);
    const q = qualities(getIndex()).find((x) => x.members.some((m) => m.id === 'f_crepe'));
    expect(masterLoomRpm(q, { reed_width_cm: 190 })).toBe(num(getIndex().fabricsById.f_crepe.loom_rpm));
  });
  it('save to master writes only the RPM typed, then drops it', async () => {
    const before = getIndex().fabricsById.f_crepe;
    setTempRpm('f_crepe', 'dp', 750);
    expect(activeTempRpms()).toMatchObject([{ sp: null, dp: 750 }]);
    await saveTempRpmToMaster('f_crepe');
    const after = getIndex().fabricsById.f_crepe;
    expect(num(after.loom_rpm_dp)).toBe(750);
    expect(num(after.loom_rpm)).toBe(num(before.loom_rpm));
    expect(after.base_name).toBe(before.base_name);
    expect(getState().tempRpms).toEqual({});
  });
  it('fabric page: type an RPM, see the change, reset', async () => {
    await open('#/fabric/f_crepe');
    await screen.findByText('Try a loom RPM');
    const sp = screen.getByLabelText(`Temporary single panna RPM for ${getIndex().fabricsById.f_crepe.name}`);
    fireEvent.input(sp, { target: { value: '900' } });
    fireEvent.blur(sp);
    await waitFor(() => expect(document.querySelector('.temp-strip').textContent).toMatch(/1 temporary loom RPM active/));
    expect(document.body.textContent).toMatch(/Using a temporary loom RPM on this device: single panna 900/);
    expect(document.body.textContent).toMatch(/vs master/);
    const dp = screen.getByLabelText(`Temporary double panna RPM for ${getIndex().fabricsById.f_crepe.name}`);
    expect(dp.getAttribute('placeholder')).toBe('—');
    fireEvent.input(dp, { target: { value: '700' } });
    fireEvent.blur(dp);
    await waitFor(() => expect(document.body.textContent).toMatch(/single panna 900 \(master 800\), double panna 700 \(master not set\)/));
    fireEvent.click(screen.getByRole('button', { name: 'Reset to master' }));
    await waitFor(() => expect(document.querySelector('.temp-strip')).toBeNull());
  });
});

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

describe('TPM yarn production per spindle and machine', () => {
  it('one row per TFO type of every unit with a speed, same formula as the spindle requirement', () => {
    const idx = buildIndex(sampleTables());
    const y = idx.yarnsById.y_tpm75;
    const list = tpmProductionRows(y, idx);
    expect(list.length).toBeGreaterThan(0);
    for (const { unit, rows } of list) {
      for (const r of rows.filter((x) => x.speed)) {
        const type = r.type;
        const eff = num(r.speed.efficiency) ?? num(type.efficiency) ?? num(unit.tfo_default_eff);
        const q = tfoOutput(r.speed.rpm, y.tpm, eff, 75);
        expect(r.perSpindle).toBeCloseTo(q, 9);
        expect(r.perMachine).toBeCloseTo(q * (num(type.spindles_per_side) ?? 252) * 2, 9);
      }
    }
  });
  it('shows on the TPM yarn page', async () => {
    await open('#/yarn/y_tpm75');
    await screen.findByText('Production per spindle and machine · kg per day');
    expect(document.body.textContent).toMatch(/kg per machine/);
  });
});

describe('search', () => {
  it('finds tabs, fabrics, yarns, units and Guide topics; all words must match', () => {
    const idx = getIndex();
    const items = buildSearchIndex(idx, null);
    const kinds = new Set(items.map((x) => x.kind));
    for (const k of ['Tab', 'Fabric', 'Yarn', 'Unit', 'Guide']) expect(kinds.has(k)).toBe(true);
    const r = searchPlaces(items, 'tpm 75');
    expect(r[0].label).toMatch(/75D TPM/);
    expect(searchPlaces(items, 'zzzz').length).toBe(0);
    expect(searchPlaces(items, 'fabric crepe').every((x) => x.kind === 'Fabric')).toBe(true);
    expect(searchPlaces(items, 'yarn ').every((x) => x.kind === 'Yarn')).toBe(true);
  });
  it('sections of the open fabric page are found', () => {
    const items = buildSearchIndex(getIndex(), 'f_crepe');
    expect(searchPlaces(items, 'construction').some((x) => x.kind === 'On this page')).toBe(true);
  });
  it('/ opens the search; typing and Enter opens the place; it then shows in Recent', async () => {
    await open('#/fabrics');
    fireEvent.keyDown(window, { key: '/' });
    const box = await screen.findByLabelText('Search the app');
    fireEvent.input(box, { target: { value: 'ranking' } });
    await waitFor(() => expect(document.querySelector('.gs-results').textContent).toMatch(/Ranking/));
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(window.location.hash).toBe('#/ranking'));
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await screen.findByText('Recent');
    expect(document.querySelector('.gs-panel').textContent).toMatch(/Ranking/);
    fireEvent.keyDown(screen.getByLabelText('Search the app'), { key: 'Escape' });
  });
  it('number keys open the tabs', async () => {
    await open('#/fabrics');
    fireEvent.keyDown(window, { key: '2' });
    await waitFor(() => expect(window.location.hash).toBe('#/yarns'));
    fireEvent.keyDown(window, { key: '5' });
    await waitFor(() => expect(window.location.hash).toBe('#/planner'));
  });
  it('g then f opens the search on fabrics', async () => {
    await open('#/yarns');
    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'f' });
    const box = await screen.findByLabelText('Search the app');
    expect(box.value).toBe('fabric ');
  });
});

