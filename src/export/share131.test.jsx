// 1.31.0: Basic keeps key figures, Construction and Warp and weft only; GSM on reed space when there is no greige
// width (shared files only); Detailed drops Picks per sale metre and gets a sixth switch, Unit-wise.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/preact';
import { fabricCalc } from '../calc.js';
import { NO_MONEY, exportFabricPdf, exportFabricXlsx, shareGsm, whatsappText } from './exports.js';
import { DETAILED_ALL, detailedContains, detailedModel } from './detailed.js';
import { recordPdf, recordXlsx } from './recordShare.js';
import { GOLDEN_CASES, caseIndex } from './basicGolden.test.jsx';
import { DETAILED_CASES, detailedOutputs } from './detailedGolden.test.jsx';
import { App } from '../app.jsx';
import { resetDemo } from '../store.js';
import { resetListState } from '../listState.js';

const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
};

describe('Basic: construction and warp and weft only', () => {
  GOLDEN_CASES.forEach(([id, t]) => {
    it(`${id}: no Units or Beam length in the PDF or Excel`, async () => {
      const idx = caseIndex(t);
      const f = idx.fabricsById[id];
      const c = fabricCalc(f, idx);
      const pdf = strings(await recordPdf(() => exportFabricPdf(f, c, idx, { money: NO_MONEY })));
      const xlsx = await recordXlsx(() => exportFabricXlsx(f, c, idx, { money: NO_MONEY }));
      for (const bad of ['Units', 'Unit', 'Beam length', 'Loom group', 'Per loom · single / double panna']) expect(pdf).not.toContain(bad);
      expect(pdf.some((s) => /spindles|kg\/day/.test(s))).toBe(false);
      expect(pdf).toContain('Construction');
      expect(pdf).toContain('Warp and weft');
      expect(Object.keys(xlsx)).toEqual(['Summary', 'Warp and weft']);
      const fields = xlsx.Summary.map((r) => r[0]);
      for (const k of ['Units', 'Loom RPM single panna', 'Loom RPM double panna']) expect(fields).not.toContain(k);
      expect(fields).toContain('GSM');
    });
  });
});

describe('GSM on reed space when there is no greige width', () => {
  const noWidth = () => {
    const idx = caseIndex({});
    const f = { ...idx.fabricsById.f_vn, greige_width_in: '' };
    const c = fabricCalc(f, idx);
    return { idx, f, c };
  };
  it('worked out on reed space and labelled in every Basic format; calc.gsm itself stays blank', async () => {
    const { idx, f, c } = noWidth();
    expect(c.gsm).toBeNull();
    const want = c.totalGpm / (c.rs * 0.0254);
    expect(c.gsmReed).toBeCloseTo(want, 9);
    const g = shareGsm(c);
    expect(g).toMatchObject({ onReed: true, label: 'GSM (on reed space)' });
    const pdf = strings(await recordPdf(() => exportFabricPdf(f, c, idx, { money: NO_MONEY })));
    expect(pdf).toContain('GSM (ON REED SPACE)');
    expect(pdf).toContain(want.toFixed(1));
    expect(pdf.join(' ')).toMatch(/GSM is an estimate on reed space/);
    const xlsx = await recordXlsx(() => exportFabricXlsx(f, c, idx, { money: NO_MONEY }));
    const row = Object.fromEntries(xlsx.Summary.slice(1).map((r) => [r[0], r[1]]));
    expect(row.GSM).toBeCloseTo(want, 1);
    expect(row['GSM basis']).toMatch(/Reed space/);
    expect(whatsappText(f, c, idx, NO_MONEY)).toMatch(new RegExp(`GSM ${want.toFixed(1)} \\(on reed space\\)`));
    const d = detailedModel(f, c, idx, DETAILED_ALL);
    expect(d.figures.find((x) => /GSM/.test(x.label))).toMatchObject({ label: 'GSM (on reed space)', value: want.toFixed(1) });
    expect(d.notes.join(' ')).toMatch(/on reed space because no greige width is set/);
  });
  it('with a greige width set, nothing changes', () => {
    const idx = caseIndex({});
    const c = fabricCalc(idx.fabricsById.f_vn, idx);
    expect(c.gsmReed).toBeNull();
    expect(shareGsm(c)).toMatchObject({ value: c.gsm, onReed: false, label: 'GSM (estimate)' });
  });
  it('with neither width nor reed space, GSM stays blank', () => {
    const idx = caseIndex({});
    const c = fabricCalc({ ...idx.fabricsById.f_vn, greige_width_in: '', reed_space_in: '' }, idx);
    expect(shareGsm(c).value).toBeNull();
  });
});

describe('Detailed: no Picks per sale metre; Unit-wise switch', () => {
  DETAILED_CASES.forEach(([id, t]) => {
    it(`${id}${Object.keys(t).length ? ' with temporary rates' : ''}: Unit-wise off leaves out everything tied to a unit, nothing else`, async () => {
      const on = await detailedOutputs(id, t, DETAILED_ALL);
      const off = await detailedOutputs(id, t, { ...DETAILED_ALL, units: false });
      const m = detailedModel(on.f, on.c, on.idx, { ...DETAILED_ALL, units: false });
      const titles = m.sections.map((s) => s.title);
      expect(titles.some((x) => /^(Unit|Looms|Yarn-wise consumption|TFO and spindles|TFO · spindle profitability) ·/.test(x) || x === 'Units')).toBe(false);
      expect(m.figures.some((x) => /^Profit ·|^Loom realisation/.test(x.label))).toBe(false);
      expect(m.notes.join(' ')).not.toMatch(/Loom metres per day|TFO kg per spindle|Loom realisation =|Profit per pick =/);
      const all = [...strings(off.pdf), ...strings(off.xlsx)];
      expect(titles).not.toContain('Beam length');
      expect(m.sections.find((s) => s.title === 'Construction').rows.some((r) => /Loom RPM/.test(r[0]))).toBe(false);
      for (const re of [/Loom efficiency/, /Cost per pick/, /Spindle profitability/, /Spindles · single panna/, /Loom realisation/, /Picks per sale metre/]) expect(all.some((s) => re.test(s)), String(re)).toBe(false);
      // the unit-free sections are the same as with Unit-wise on
      const mOn = detailedModel(on.f, on.c, on.idx, DETAILED_ALL);
      const keep = mOn.sections.filter((s) => (!/ · /.test(s.title) || /^Cost breakdown/.test(s.title)) && !['Beam length', 'Construction'].includes(s.title));
      expect(m.sections.filter((s) => keep.some((k) => k.title === s.title))).toEqual(keep);
      const con = (x) => x.sections.find((s) => s.title === 'Construction').rows;
      expect(con(m)).toEqual(con(mOn).filter((r) => !/Loom RPM/.test(r[0])));
      expect(strings(on.pdf).some((s) => /Picks per sale metre/.test(s))).toBe(false);
    });
  });
  it('Sale rate and Realisation off: no empty sale section', () => {
    const [id, t] = DETAILED_CASES[1];
    const idx = caseIndex(t);
    const f = idx.fabricsById[id];
    const m = detailedModel(f, fabricCalc(f, idx), idx, { ...DETAILED_ALL, sale: false, realisation: false, costs: false });
    expect(m.sections.every((s) => s.rows.length)).toBe(true);
    expect(m.sections.map((s) => s.title)).not.toContain('Picks per sale metre');
  });
  it('contains line: loom realisation is not in the file with Unit-wise off', () => {
    expect(detailedContains({ ...DETAILED_ALL, units: false })).toBe('contains realisation, sale rate, yarn rates and costs');
    expect(detailedContains(DETAILED_ALL)).toBe('contains costs, yarn rates and profit');
  });
});

describe('Export sheet: Unit-wise is the sixth switch', () => {
  beforeAll(() => {
    window.scrollTo = () => {};
  });
  beforeEach(async () => {
    cleanup();
    localStorage.clear();
    resetListState();
    await resetDemo();
  });
  it('folded label counts six; footer says no unit-wise figures', async () => {
    window.location.hash = '#/fabric/f_crepe';
    render(<App />);
    await screen.findByText('Finishing · RFD');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText('PDF spec sheet');
    fireEvent.click(screen.getByRole('button', { name: 'Detailed' }));
    fireEvent.click(await screen.findByText('Advanced'));
    fireEvent.click(screen.getByRole('button', { name: 'Unit-wise' }));
    await waitFor(() => expect(document.body.textContent).toMatch(/Contains ₹: realisation, sale rate, yarn rates, costs\. No unit-wise figures\./));
    fireEvent.click(screen.getByText('Advanced'));
    await screen.findByText('5 of 6 on');
  });
});
