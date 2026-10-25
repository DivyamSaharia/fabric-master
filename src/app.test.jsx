import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/preact';
import { App } from './app.jsx';
import { sampleTables } from './sampleData.js';
import { whatsappText, fileName } from './export/exports.js';
import { buildIndex, fabricCalc, fmt, loomRealisationForUnit } from './calc.js';
import { computeRows, defaultFilters, sortOptions } from './screens/fabrics.jsx';
import { resetListState } from './listState.js';

beforeAll(() => {
  window.scrollTo = () => {};
  window.confirm = () => true;
});

beforeEach(() => {
  cleanup();
  localStorage.clear();
  resetListState();
});

async function open(hash) {
  window.location.hash = hash;
  render(<App />);
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

describe('every screen renders with demo data', () => {
  it('fabric list ranks by realisation per pick', async () => {
    await open('#/fabrics');
    await screen.findByText('Poly Crepe 60 (RFD)');
    // list shows realisation with VATAV, and without it underneath when VATAV is set
    expect(screen.getByText('₹0.242')).toBeTruthy();
    expect(screen.getByText(/₹0\.258\s+without/)).toBeTruthy();
    expect(screen.getByText(/Demo data on this device/)).toBeTruthy();
    const names = [...document.querySelectorAll('.fname')].map((n) => n.textContent);
    expect(names.length).toBe(5);
  });

  it('home screen carries the Hanuman logo and app name', async () => {
    await open('#/fabrics');
    await screen.findByRole('heading', { name: 'Fabric Database' });
    expect(screen.getByText('Hanuman')).toBeTruthy();
    expect(screen.getByAltText('Hanuman logo').getAttribute('src')).toBe('./logo.svg');
  });

  it('search and unit switcher narrow the list', async () => {
    await open('#/fabrics');
    await screen.findByText('Poly Crepe 60 (RFD)');
    fireEvent.input(screen.getByPlaceholderText('Search quality or yarn'), { target: { value: 'geor' } });
    await waitFor(() => expect(document.querySelectorAll('.fname').length).toBe(1));
    fireEvent.input(screen.getByPlaceholderText('Search quality or yarn'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chinese AJ' }));
    await waitFor(() => expect([...document.querySelectorAll('.fname')].map((n) => n.textContent).sort()).toEqual(['PV Plain 60', 'Poly Crepe 60 (RFD)']));
  });

  it('fabric detail shows RFD cost, profit per unit and spindles for each TFO type', async () => {
    await open('#/fabric/f_crepe');
    await screen.findByText('Finishing · RFD');
    expect(screen.getAllByText(/22\.59/).length).toBeGreaterThan(0);
    // single panna uses the fabric's RPM and the unit's loom efficiency; no double panna RPM is set
    expect(screen.getAllByText('M/C 1–12').length).toBeGreaterThan(0);
    expect(screen.getByText('130 spindles')).toBeTruthy();
    expect(screen.getByText('112 spindles')).toBeTruthy();
    expect(screen.getAllByText('Set double panna RPM on the fabric').length).toBeGreaterThan(0);
    expect(screen.getByText('+₹0.042 / pick')).toBeTruthy();
    expect(screen.getByText('Realisation without VATAV')).toBeTruthy();
    expect(screen.getByText('Realisation with VATAV')).toBeTruthy();
    expect(screen.getByText('3% · −₹1.35 / m')).toBeTruthy();
  });

  it('a TPM fabric: sale rate 4th, daily consumption per loom width, TFO per side for each type; no GSM, consumption or cost tile', async () => {
    await open('#/fabric/f_crepe');
    await screen.findByText('Sale rate');
    const tiles = [...document.querySelectorAll('.tiles .tile')];
    expect(tiles.length).toBe(10);
    expect(tiles.map((t) => t.querySelector('.t-label').textContent).join('|')).not.toMatch(/GSM|^Consumption|RM cost|RFD cost|Spindle/);
    expect(tiles[3].textContent).toContain('₹45.00');
    expect(tiles[3].textContent).toContain('per RFD metre');
    const daily = tiles.filter((t) => /Daily consumption/.test(t.textContent));
    expect(daily.map((t) => t.querySelector('.t-label').textContent)).toEqual(['Daily consumption · 190 cm', 'Daily consumption · 280 cm']);
    expect(daily[0].textContent).toContain('15.9 kg');
    expect(daily[0].textContent).toContain('12.7 kg');
    expect(daily[0].textContent).toContain('(311 m) · single panna · 800 RPM · 85% eff. · Unit 2');
    // loom realisation: one tile per loom width, after the daily consumption tiles
    const ix = buildIndex(sampleTables());
    const cc = fabricCalc(ix.fabricsById.f_crepe, ix);
    const lr = loomRealisationForUnit(cc, ix.fabricsById.f_crepe, ix.unitsById.u_2, ix);
    const loomTiles = tiles.filter((t) => /Loom realisation/.test(t.querySelector('.t-label').textContent));
    expect(loomTiles.map((t) => t.querySelector('.t-label').textContent)).toEqual(['Loom realisation · 190 cm', 'Loom realisation · 280 cm']);
    expect(tiles.indexOf(loomTiles[0])).toBe(6);
    expect(lr[0].value).toBeGreaterThan(0);
    expect(loomTiles[0].querySelector('.t-value').textContent).toBe(fmt.rs(lr[0].value, 0));
    expect(loomTiles[0].textContent).toContain('per loom per day · single panna');
    expect(loomTiles[1].querySelector('.t-value').textContent).toBe(fmt.rs(lr[1].value, 0));
    expect(tiles[8].textContent).toContain('TFO per side · M/C 1–12');
    expect(tiles[8].textContent).toContain('Weft · 75D TPM 2000 S/Z');
    expect(tiles[8].textContent).toContain('24.5 kg');
    expect(tiles[8].textContent).toContain('90% eff. assumed');
    expect(tiles[9].textContent).toContain('M/C 13–16');
    expect(tiles[9].textContent).toContain('28.6 kg');
    expect(screen.getByText('Transportation')).toBeTruthy();
    // spindle profitability is a row in the realisation section now
    expect(screen.getByText('Spindle profitability')).toBeTruthy();
    // production centre: per unit, per loom group
    expect(screen.getByText('Production centre')).toBeTruthy();
    expect(screen.getByText('24 looms · single panna · 800 RPM')).toBeTruthy();
    cleanup();
    await open('#/fabric/f_crepe/edit');
    expect(await screen.findByLabelText(/Transportation/)).toBeTruthy();
  });

  it('sale date: on the sale rate tile, as a row, in the editor, blank for new fabrics', async () => {
    await open('#/fabric/f_crepe');
    await screen.findByText('Sale rate');
    const tiles = [...document.querySelectorAll('.tiles .tile')];
    expect(tiles[3].textContent).toContain('per RFD metre · 2 Oct 2026');
    expect(screen.getByText('Sale date')).toBeTruthy();
    cleanup();
    await open('#/fabric/f_crepe/edit');
    const field = await screen.findByLabelText(/Sale date/);
    expect(field.value).toBe('2026-10-02');
    fireEvent.input(field, { target: { value: '2026-10-09' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('fm.demo.v1')).Fabrics.find((f) => f.id === 'f_crepe').sale_date).toBe('2026-10-09'));
    cleanup();
    await open('#/fabric/new');
    expect((await screen.findByLabelText(/Sale date/)).value).toBe('');
  });

  it('sale date follows a changed selling price unless set by hand', async () => {
    const { todayIst } = await import('./screens/fabrics.jsx');
    await open('#/fabric/f_crepe/edit');
    const price = await screen.findByLabelText(/Selling price/);
    const start = screen.getByLabelText(/Sale date/).value;
    fireEvent.input(price, { target: { value: '47' } });
    await waitFor(() => expect(screen.getByLabelText(/Sale date/).value).toBe(todayIst()));
    expect(screen.getByText(/today, price changed/)).toBeTruthy();
    fireEvent.input(price, { target: { value: '45' } });
    await waitFor(() => expect(screen.getByLabelText(/Sale date/).value).toBe(start));
    fireEvent.input(screen.getByLabelText(/Sale date/), { target: { value: '2026-10-05' } });
    fireEvent.input(price, { target: { value: '48' } });
    expect(screen.getByLabelText(/Sale date/).value).toBe('2026-10-05');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const f = JSON.parse(localStorage.getItem('fm.demo.v1')).Fabrics.find((x) => x.id === 'f_crepe');
      expect([String(f.price), f.sale_date]).toEqual(['48', '2026-10-05']);
    });
  });

  it('an older yarn rate picked on the fabric page changes the figures shown, not the data', async () => {
    const t = sampleTables();
    t.YarnRates.push({ id: 'r_old', yarn_id: 'y_fdy75', rate: 100, effective_date: '2026-09-01' });
    localStorage.setItem('fm.demo.v1', JSON.stringify(t));
    await open('#/fabric/f_crepe');
    await screen.findByText('Yarn rates');
    const before = document.querySelector('.tiles .tile').textContent;
    const sel = screen.getByLabelText('Rate for 75D Polyester FDY');
    expect([...sel.options].map((o) => o.textContent)).toEqual(['1 Oct 2026 · ₹118/kg (current)', '1 Sept 2026 · ₹100/kg'.replace('Sept', 'Sep')]);
    fireEvent.change(sel, { target: { value: '2026-09-01' } });
    await screen.findByText(/Showing older yarn rates/);
    expect(document.querySelector('.tiles .tile').textContent).not.toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Use current rates' }));
    await waitFor(() => expect(screen.queryByText(/Showing older yarn rates/)).toBeNull());
    expect(document.querySelector('.tiles .tile').textContent).toBe(before);
    expect(JSON.parse(localStorage.getItem('fm.demo.v1')).YarnRates.length).toBe(t.YarnRates.length);
  });

  it('edit form shows the live result and saves', async () => {
    await open('#/fabric/f_crepe/edit');
    await screen.findByText('Edit fabric');
    expect(document.querySelector('.result-bar').textContent).toContain('₹0.258');
    expect(document.querySelector('.result-bar').textContent).toContain('₹0.242');
    fireEvent.input(screen.getByLabelText('VATAV'), { target: { value: '0' } });
    await waitFor(() => expect(document.querySelector('.result-bar').textContent).not.toContain('₹0.242'));
    fireEvent.input(screen.getByLabelText('Selling price'), { target: { value: '50' } });
    await waitFor(() => expect(document.querySelector('.result-bar').textContent).not.toContain('₹0.258'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('fm.demo.v1')).Fabrics.find((f) => f.id === 'f_crepe').price).toBe('50'));
  });

  it('beam length: shown per loom group, saved from the editor, dropped when the unit is unassigned', async () => {
    await open('#/fabric/f_geo');
    await screen.findByText('Beam length');
    expect(screen.getByText('4,000 m')).toBeTruthy();
    cleanup();
    await open('#/fabric/f_geo/edit');
    await screen.findByText('Edit fabric');
    const field = screen.getAllByLabelText(/Toyota · 190 cm/)[0];
    fireEvent.input(field, { target: { value: '4500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const beams = () => JSON.parse(localStorage.getItem('fm.demo.v1')).FabricBeams;
    await waitFor(() => expect(beams().find((b) => b.fabric_id === 'f_geo').beam_length_m).toBe(4500));
  });

  it('duplicate for new RS scales ends, width and sale rate', async () => {
    localStorage.setItem('fm.demo.v1', JSON.stringify(sampleTables()));
    await open('#/fabric/f_crepe');
    fireEvent.click(await screen.findByText('Duplicate for new RS'));
    fireEvent.input(screen.getByLabelText('New RS'), { target: { value: '72' } });
    await screen.findByText('6,000 → 7,200');
    expect(screen.getByText('Poly Crepe 72 (RFD)')).toBeTruthy();
    fireEvent.click(document.querySelector('.sheet-foot button'));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('fm.demo.v1')).Fabrics.length).toBe(6));
    const db = JSON.parse(localStorage.getItem('fm.demo.v1'));
    const copy = db.Fabrics.find((f) => f.id !== 'f_crepe' && f.name === 'Poly Crepe');
    expect(copy.reed_space_in).toBe(72);
    expect(copy.price).toBe(54);
    expect(copy.greige_width_in).toBe(68.4);
    expect('base_name' in copy).toBe(false);
    expect(db.FabricYarns.find((l) => l.fabric_id === copy.id && l.side === 'warp').ends).toBe(7200);
    expect(db.Assignments.filter((a) => a.fabric_id === copy.id).length).toBe(3);
  });

  it('new fabric form', async () => {
    await open('#/fabric/new');
    await screen.findByText('New fabric');
    expect(screen.getByText('Add warp yarn')).toBeTruthy();
  });

  it('yarn lines are picked from a searchable list', async () => {
    await open('#/fabric/new');
    await screen.findByText('New fabric');
    fireEvent.click(screen.getAllByRole('button', { name: 'warp yarn' })[0]);
    const search = await screen.findByLabelText('Search warp yarn');
    const before = document.querySelectorAll('.pick-opt').length;
    expect(before).toBeGreaterThan(3);
    fireEvent.input(search, { target: { value: 'tpm 2000' } });
    await waitFor(() => expect(document.querySelectorAll('.pick-opt').length).toBeLessThan(before));
    expect([...document.querySelectorAll('.pick-opt')].every((b) => /tpm/i.test(b.textContent) && /2000/.test(b.textContent))).toBe(true);
    fireEvent.input(search, { target: { value: 'zzzz' } });
    await screen.findByText(/No match for/);
    fireEvent.input(search, { target: { value: '75D TPM 2000' } });
    await waitFor(() => expect(document.querySelectorAll('.pick-opt').length).toBe(1));
    fireEvent.click(document.querySelector('.pick-opt'));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'warp yarn' })[0].textContent).toContain('75D TPM 2000'));
  });

  it('yarn list and TPM yarn form', async () => {
    await open('#/yarns');
    await screen.findByText('75D TPM 2000 S/Z');
    expect(screen.getByText('₹168')).toBeTruthy();
    expect(screen.getAllByText('per kg · base ₹118 + ₹50').length).toBeGreaterThan(0);
    cleanup();
    await open('#/yarn/y_tpm75');
    await screen.findByText('Twist direction');
    expect(screen.getByRole('button', { name: 'S/Z' }).getAttribute('aria-pressed')).toBe('true');
    // TPM yarns ask for a delta, not a rate
    expect(screen.getByLabelText('Delta').value).toBe('50');
    expect(screen.queryByLabelText('Rate')).toBeNull();
    expect(screen.getByText('base ₹118 + delta ₹50')).toBeTruthy();
    fireEvent.input(screen.getByLabelText('Delta'), { target: { value: '60' } });
    await waitFor(() => expect(screen.getByText('base ₹118 + delta ₹60')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('fm.demo.v1')).Yarns.find((y) => y.id === 'y_tpm75').tpm_delta).toBe(60));
  });

  it('deletes a yarn rate and falls back to the older one', async () => {
    const demo = sampleTables();
    demo.YarnRates.push({ id: 'r_old', yarn_id: 'y_fdy75', rate: 110, effective_date: '2026-09-01' });
    localStorage.setItem('fm.demo.v1', JSON.stringify(demo));
    await open('#/yarn/y_fdy75');
    await screen.findByText('Rate history');
    expect(screen.getByText('From 2026-10-01 · in use')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Delete rate from 2026-10-01'));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('fm.demo.v1')).YarnRates.some((r) => r.id === 'r1')).toBe(false));
    await waitFor(() => expect(screen.getByLabelText('Rate').value).toBe('110'));
  });

  it('deletes older rates and keeps the one in use', async () => {
    const demo = sampleTables();
    demo.YarnRates.push({ id: 'r_a', yarn_id: 'y_fdy75', rate: 110, effective_date: '2026-09-01' }, { id: 'r_b', yarn_id: 'y_fdy75', rate: 105, effective_date: '2026-08-01' });
    localStorage.setItem('fm.demo.v1', JSON.stringify(demo));
    await open('#/yarn/y_fdy75');
    fireEvent.click(await screen.findByText('Delete older rates'));
    await waitFor(() => {
      const left = JSON.parse(localStorage.getItem('fm.demo.v1')).YarnRates.filter((r) => r.yarn_id === 'y_fdy75');
      expect(left.map((r) => r.id)).toEqual(['r1']);
    });
  });

  it('an edit screen opened straight from its link starts from the saved values', async () => {
    localStorage.setItem('fm.demo.v1', JSON.stringify(sampleTables()));
    window.location.hash = '#/yarn/y_fdy75';
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Rate').value).toBe('118'));
    expect(screen.getByLabelText('Count').value).toBe('75');
    cleanup();
    window.location.hash = '#/fabric/f_crepe/edit';
    render(<App />);
    // the form holds the stored name, without the RS
    await waitFor(() => expect(screen.getByLabelText('Quality name').value).toBe('Poly Crepe'));
    cleanup();
    window.location.hash = '#/unit/u_2/edit';
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Cost per pick').value).toBe('0.2'));
  });

  it('unit page shows spindle requirement for every TFO type', async () => {
    await open('#/unit/u_2');
    await screen.findByText('Spindle requirement · per loom');
    const cards = [...document.querySelectorAll('.unit-card')].map((c) => c.textContent);
    expect(cards.some((t) => t.includes('Poly Crepe 60 (RFD)') && t.includes('M/C 1–12') && t.includes('M/C 13–16'))).toBe(true);
    expect(cards.some((t) => t.includes('Georgette 60 (RFD)') && t.includes('warp') && t.includes('weft'))).toBe(true);
  });

  it('unit list, unit edit, ranking and settings', async () => {
    await open('#/units');
    await screen.findByText('Unit 2');
    cleanup();
    await open('#/unit/u_2/edit');
    await screen.findByText('TFO types');
    cleanup();
    await open('#/ranking');
    await screen.findByText('Profit · Unit 2');
    cleanup();
    await open('#/settings');
    await screen.findByText('Data source');
  });
});

describe('exports', () => {
  it('WhatsApp text carries spec and price, not costs', () => {
    const idx = buildIndex(sampleTables());
    const f = idx.fabricsById.f_crepe;
    const t = whatsappText(f, fabricCalc(f, idx), idx);
    expect(t).toContain('*Poly Crepe 60 (RFD)*');
    expect(t).toContain('Reed × Pick: 100 × 80');
    expect(t).toContain('Weft: 75D TPM 2000 S/Z (2S:2Z)');
    expect(t).toContain('Price ₹45.00 / m');
    expect(t).not.toMatch(/realisation|RM cost/i);
  });
  it('file names follow YYYY-MM-DD_descriptive-name.ext', () => {
    expect(fileName('Poly Crepe 60', 'spec', 'pdf')).toMatch(/^\d{4}-\d{2}-\d{2}_poly-crepe-60_spec\.pdf$/);
  });
});

describe('laptop layout', () => {
  let orig;
  beforeAll(() => {
    orig = window.matchMedia;
    window.matchMedia = (q) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} });
  });
  afterAll(() => {
    window.matchMedia = orig;
  });

  it('shows the sidebar instead of the tab bar, and fabrics as a sortable table', async () => {
    await open('#/fabrics');
    await screen.findByText('Fabric Database');
    expect(document.querySelector('.tabbar')).toBeNull();
    expect(document.querySelector('.sidebar').textContent).toContain('Demo data on this device');
    const names = () => [...document.querySelectorAll('.ftable tbody .tname')].map((n) => n.textContent);
    await waitFor(() => expect(names().length).toBe(5));
    // default order matches the phone list: realisation with VATAV, highest first
    const phone = computeOrder();
    expect(names()).toEqual(phone);
    fireEvent.click(screen.getByRole('button', { name: /^Quality/ }));
    await waitFor(() => expect(names()).toEqual([...phone].sort((a, b) => a.localeCompare(b))));
    fireEvent.click(screen.getByRole('button', { name: /^Quality/ }));
    await waitFor(() => expect(names()).toEqual([...phone].sort((a, b) => b.localeCompare(a))));
  });

  it('opens a fabric from the table in two columns, and Escape closes a dialog', async () => {
    await open('#/fabrics');
    await waitFor(() => expect(document.querySelectorAll('.ftable tbody tr').length).toBe(5));
    fireEvent.click(document.querySelector('.ftable tbody tr'));
    await waitFor(() => expect(document.querySelectorAll('.detail-cols > .col').length).toBe(2));
    fireEvent.click(screen.getAllByText('Export or share')[0]);
    await waitFor(() => expect(document.querySelector('.sheet')).not.toBeNull());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.sheet')).toBeNull());
  });

  it('yarns show as a table with rates', async () => {
    await open('#/yarns');
    await waitFor(() => expect(document.querySelectorAll('.ftable tbody tr').length).toBe(10));
    const row = [...document.querySelectorAll('.ftable tbody tr')].find((r) => r.textContent.includes('75D TPM 2000 S/Z'));
    expect(row.textContent).toContain('168.00');
    expect(row.textContent).toContain('base ₹118 + ₹50');
  });

  it('has a Planner item after Ranking in the sidebar', async () => {
    await open('#/fabrics');
    await screen.findByText('Fabric Database');
    const labels = [...document.querySelectorAll('.sidebar .sb-nav .sb-label')].map((n) => n.textContent);
    expect(labels).toEqual(['Fabrics', 'Yarns', 'Units', 'Ranking', 'Planner']);
  });

  it('"/" jumps to the search box', async () => {
    await open('#/fabrics');
    await screen.findByText('Fabric Database');
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(document.querySelector('input[data-search]'));
  });
});

function computeOrder() {
  const idx = buildIndex(sampleTables());
  return Object.values(idx.fabricsById)
    .map((f) => ({ name: f.name, v: fabricCalc(f, idx).realisationNetPerPick }))
    .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity))
    .map((x) => x.name);
}

describe('spindle profit sort', () => {
  it('needs a unit; lists that unit\'s TPM fabrics only, highest first; a non-TPM fabric has no tile', async () => {
    const idx = buildIndex(sampleTables());
    const unitId = 'u_2';
    const all = computeRows(idx, { unitId });
    const rows = computeRows(idx, { unitId, filters: { ...defaultFilters(), sort: 'spindle' } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(all.length);
    expect(rows.every((r) => r.calc.tfoClass !== 'Non-TPM')).toBe(true);
    const vals = rows.map((r) => r.spin.value).filter((v) => v !== null);
    expect(vals).toEqual([...vals].sort((a, b) => b - a));
    expect(computeRows(idx, { filters: { ...defaultFilters(), sort: 'spindle' } })).toHaveLength(0);
    const plain = all.find((r) => r.calc.tfoClass === 'Non-TPM');
    await open(`#/fabric/${plain.fabric.id}`);
    await screen.findByText('Sale rate');
    expect(screen.queryByText(/Spindle profitability/)).toBeNull();
    expect(screen.queryByText(/TFO per side/)).toBeNull();
    expect(document.querySelectorAll('.tiles .tile').length).toBe(6);
    cleanup();
  });
});

describe('loom realisation sort', () => {
  const idx = buildIndex(sampleTables());
  it('one sort per loom width of the selected unit; none without a unit', () => {
    expect(sortOptions(null, idx).some((o) => String(o.value).startsWith('loom:'))).toBe(false);
    expect(sortOptions(idx.unitsById.u_2, idx).filter((o) => String(o.value).startsWith('loom:')).map((o) => o.value)).toEqual(['loom:190', 'loom:280']);
    expect(sortOptions(idx.unitsById.u_caj, idx).filter((o) => String(o.value).startsWith('loom:'))).toEqual([]);
  });
  it('lists the fabrics that fit that width, highest ₹ per loom per day first, blanks last', () => {
    const unitId = 'u_2';
    for (const w of [190, 280]) {
      const rows = computeRows(idx, { unitId, filters: { ...defaultFilters(), sort: `loom:${w}` } });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.loomReal.find((x) => x.width === w).panna)).toBe(true);
      const vals = rows.map((r) => r.loomReal.find((x) => x.width === w).value);
      const firstNull = vals.findIndex((v) => v === null);
      const filled = firstNull < 0 ? vals : vals.slice(0, firstNull);
      expect(filled).toEqual([...filled].sort((a, b) => b - a));
      if (firstNull >= 0) expect(vals.slice(firstNull).every((v) => v === null)).toBe(true);
    }
    expect(computeRows(idx, { filters: { ...defaultFilters(), sort: 'loom:190' } }).length).toBe(computeRows(idx, {}).length);
  });
});

describe('loom realisation sort in the list', () => {
  it('a saved loom sort shows ₹ per loom per day on each row and survives the unit being set', async () => {
    const { saveListState } = await import('./listState.js');
    saveListState({ search: '', unitId: 'u_2', filters: { ...defaultFilters(), sort: 'loom:190' } });
    await open('#/fabrics');
    await screen.findByText('Poly Crepe 60 (RFD)');
    expect(screen.getByText('Loom realisation 190 cm ↓')).toBeTruthy();
    expect(screen.getAllByText('per loom per day · 190 cm').length).toBeGreaterThan(0);
    cleanup();
    // All units: the loom sort is not available, so the list returns to realisation per pick
    saveListState({ search: '', unitId: 'all', filters: { ...defaultFilters(), sort: 'loom:190' } });
    await open('#/fabrics');
    await screen.findByText('Poly Crepe 60 (RFD)');
    await waitFor(() => expect(screen.getByText('Realisation ↓')).toBeTruthy());
    expect(screen.queryByText('per loom per day · 190 cm')).toBeNull();
  });
});

describe('daily consumption for a fabric in no unit', () => {
  it('uses the unit with loom groups, one tile per width, and says the fabric is not assigned to it', async () => {
    const t = sampleTables();
    t.Assignments = t.Assignments.filter((x) => x.fabric_id !== 'f_crepe');
    localStorage.setItem('fm.demo.v1', JSON.stringify(t));
    await open('#/fabric/f_crepe');
    await screen.findByText('Sale rate');
    const daily = [...document.querySelectorAll('.tiles .tile.daily')];
    expect(daily.map((d) => d.querySelector('.t-label').textContent)).toEqual(['Daily consumption · 190 cm', 'Daily consumption · 280 cm']);
    expect(daily[0].textContent).toContain('Unit 2 (fabric not assigned to it)');
    expect(daily[0].textContent).toContain('15.9 kg');
    cleanup();
  });
});

describe('fabric list state sticks', () => {
  it('keeps sort, filters and search after the list is left and reopened', async () => {
    const { loadListState, saveListState, resetListState } = await import('./listState.js');
    resetListState();
    const base = loadListState(defaultFilters());
    saveListState({ ...base, search: 'crape', unitId: 'u1', filters: { ...base.filters, sort: 'gsm', weaves: ['Plain'] } });
    // new module state (as after a reload) reads it back from storage
    const again = loadListState(defaultFilters());
    expect(again.search).toBe('crape');
    expect(again.filters.sort).toBe('gsm');
    expect(again.filters.weaves).toEqual(['Plain']);
    saveListState({ search: '', unitId: 'all', filters: defaultFilters() });
    expect(loadListState(defaultFilters()).filters.sort).toBe('realisation');
    resetListState();
  });
});

describe('TFO planner', () => {
  const box = (label) => screen.getByLabelText(label);
  async function addQuality(group, name) {
    fireEvent.click(screen.getByRole('button', { name: `Add a quality to ${group}` }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}`) }));
  }

  it('adds qualities, TFO sides and a receipt, edits and resets a setting, saves and reopens a plan', async () => {
    await open('#/planner');
    await screen.findByRole('heading', { name: 'TFO planner' });
    expect(document.querySelector('.tabbar').textContent).toContain('Planner');
    // dobby fabrics only under dobby groups
    fireEvent.click(screen.getByRole('button', { name: 'Add a quality to 280 cm Plain' }));
    expect(screen.queryByRole('button', { name: /^Viscose Nylon Dobby/ })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    await addQuality('190 cm Dobby', 'Poly Crepe 60 (RFD)');
    fireEvent.input(box('Looms Poly Crepe 60 (RFD) 190 cm Dobby'), { target: { value: '10' } });
    // 800 RPM × 1440 × 85% ÷ (80 × 39.37) = 311 m per loom per day
    await screen.findByText(/311 m\/day per loom/);
    expect(screen.getByText('10 of 24 looms')).toBeTruthy();
    // 280 cm has no 280 cm RPM in master for this fabric: needs entry
    await addQuality('280 cm Plain', 'Poly Crepe 60 (RFD)');
    expect(screen.getByText(/Enter the loom RPM for Poly Crepe 60 \(RFD\) on 280 cm Plain/)).toBeTruthy();
    fireEvent.input(box('RPM Poly Crepe 60 (RFD) 280 cm Plain'), { target: { value: '650' } });
    await waitFor(() => expect(screen.queryByText(/Enter the loom RPM/)).toBeNull());
    // edit and reset the 190 cm RPM
    fireEvent.input(box('RPM Poly Crepe 60 (RFD) 190 cm Dobby'), { target: { value: '850' } });
    fireEvent.blur(box('RPM Poly Crepe 60 (RFD) 190 cm Dobby'));
    await screen.findByText('master 800');
    fireEvent.click(screen.getByText('master 800').parentElement.querySelector('button'));
    await waitFor(() => expect(screen.queryByText('master 800')).toBeNull());
    expect(box('RPM Poly Crepe 60 (RFD) 190 cm Dobby').value).toBe('800');
    // TFO sides and a receipt
    fireEvent.click(screen.getByRole('button', { name: 'Add a TPM yarn to M/C 1–12' }));
    fireEvent.click(await screen.findByRole('button', { name: '75D TPM 2000 S/Z' }));
    fireEvent.input(box('Sides 75D TPM 2000 S/Z M/C 1–12'), { target: { value: '4' } });
    expect(screen.getByText('4 of 24 sides')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add yarn received from outside' }));
    fireEvent.click(await screen.findByRole('button', { name: '75D TPM 2000 S/Z' }));
    fireEvent.input(box('kg per day 75D TPM 2000 S/Z'), { target: { value: '25' } });
    expect(screen.getAllByText('75D TPM 2000 S/Z').length).toBeGreaterThan(2);
    // save, then clear, then reopen
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.input(await screen.findByLabelText('Plan name'), { target: { value: 'Test plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    await screen.findByText('Test plan');
    fireEvent.click(screen.getByRole('button', { name: 'Clear plan' }));
    await screen.findByText('Clear the plan?');
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear plan' }).pop());
    await screen.findByText('Working plan');
    expect(screen.queryByLabelText('Looms Poly Crepe 60 (RFD) 190 cm Dobby')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Saved plans' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    await screen.findByText('Test plan');
    expect(box('Looms Poly Crepe 60 (RFD) 190 cm Dobby').value).toBe('10');
    expect(box('RPM Poly Crepe 60 (RFD) 280 cm Plain').value).toBe('650');
    expect(box('Sides 75D TPM 2000 S/Z M/C 1–12').value).toBe('4');
  });
});
