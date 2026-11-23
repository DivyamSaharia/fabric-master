// Round 2: Detailed share. (The TPM temporary rate tests moved to round4.test.jsx in 1.27.0, when it was split into delta and base.)
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

describe('Detailed share', () => {
  it('model carries every section, with figures straight from the fabric calc', async () => {
    const { detailedModel, cellValue } = await import('./export/detailed.js');
    const idx = buildIndex(sampleTables());
    const f = idx.fabricsById.f_crepe;
    const c = fabricCalc(f, idx);
    const m = detailedModel(f, c, idx);
    const titles = m.sections.map((s) => s.title);
    for (const t of ['Construction', 'Yarn rates', 'Consumption per greige metre', 'Raw material cost per greige metre', 'Cost breakdown · RFD', 'Sale rate and realisation', 'Unit · Unit 2', 'Looms · Unit 2', 'Yarn-wise consumption · Unit 2', 'TFO and spindles · Unit 2', 'Unit · Chinese AJ', 'Unit · Waterjet']) expect(titles).toContain(t);
    const sale = m.sections.find((s) => s.title === 'Sale rate and realisation');
    const last = sale.rows[sale.rows.length - 1];
    expect(cellValue(last.cells[1])).toBe(Math.round(c.realisationNetPerPick * 1e4) / 1e4);
    const rates = m.sections.find((s) => s.title === 'Yarn rates').rows;
    expect(rates.map((r) => r[0])).toEqual(['75D Polyester FDY', '75D TPM 2000 S/Z']);
    expect(cellValue(rates[1][5])).toBe(168);
    expect(rates[1][6]).toMatch(/Base rate from 1 Oct 2026 \+ delta/);
    // assumptions per TFO type: RPM, efficiency, spindles per side
    const tfo = m.sections.find((s) => s.title === 'TFO and spindles · Unit 2');
    expect(tfo.rows.length).toBe(2);
    expect(cellValue(tfo.rows[0][3])).toBe(18000);
    expect(cellValue(tfo.rows[0][6])).toBe(252);
  });
  it('Excel: one sheet, numbers stored as numbers', async () => {
    const { detailedModel, detailedAoa } = await import('./export/detailed.js');
    const idx = buildIndex(sampleTables());
    const f = idx.fabricsById.f_geo;
    const aoa = detailedAoa(detailedModel(f, fabricCalc(f, idx), idx));
    expect(aoa[1][0]).toBe('Georgette 60 (RFD)');
    const row = aoa.find((r) => r[0] === 'Realisation per pick with VATAV');
    expect(typeof row[1]).toBe('number');
    expect(aoa.some((r) => r[0] === 'TFO AND SPINDLES · UNIT 2')).toBe(true);
  });
  it('builds a PDF and an Excel file for a greige fabric with no TFO and a fabric with no unit', async () => {
    const { buildDetailedPdf, buildDetailedXlsx, setLogoForTests } = await import('./export/detailed.js');
    setLogoForTests(null);
    const t = sampleTables();
    t.Assignments = t.Assignments.filter((a) => a.fabric_id !== 'f_vn');
    const idx = buildIndex(t);
    for (const id of ['f_pv', 'f_vn']) {
      const f = idx.fabricsById[id];
      const pdf = await buildDetailedPdf(f, fabricCalc(f, idx), idx);
      expect(pdf.size).toBeGreaterThan(5000);
      const xl = await buildDetailedXlsx(f, fabricCalc(f, idx), idx);
      expect(xl.size).toBeGreaterThan(3000);
    }
  }, 60000);
  it('Export sheet opens on Basic; Detailed shows only PDF and Excel, WhatsApp and Copy stay Basic', async () => {
    await open('#/fabric/f_crepe');
    await screen.findByText('Finishing · RFD');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText('PDF spec sheet');
    expect(screen.getByRole('button', { name: 'Basic' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Detailed' }));
    await screen.findByText('Detailed PDF');
    expect(screen.getByText('Detailed Excel')).toBeTruthy();
    expect(screen.queryByText('PDF spec sheet')).toBeNull();
    expect(screen.getAllByText('Basic text, no ₹ figures').length).toBe(2);
    // close and open again: back on Basic
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.queryByText('Detailed PDF')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText('PDF spec sheet');
    expect(screen.queryByText('Detailed PDF')).toBeNull();
  });
});
