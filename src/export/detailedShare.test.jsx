// 1.29.0: Detailed share with ₹ switches under Advanced (Realisation, Sale rate, Yarn rates, Costs, Loom realisation).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/preact';
import { DETAILED_ALL, DETAILED_GROUPS, DETAILED_NONE, detailedContains } from './detailed.js';
import { DETAILED_CASES, DETAILED_GOLDEN, detailedOutputs } from './detailedGolden.test.jsx';
import { App } from '../app.jsx';
import { resetDemo } from '../store.js';
import { resetListState } from '../listState.js';

// the 1.28.0 Detailed share, with spindle profitability moved under the TFO and spindles table (checked 23 Nov: nothing else differs)
const GOLDEN = JSON.parse(fs.readFileSync(DETAILED_GOLDEN, 'utf8'));

const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
};
const numbers = (v, out = []) => {
  if (typeof v === 'number') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => numbers(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => numbers(x, out));
  return out;
};

// any word or sign of money; "Picks per sale metre" and the "no ₹ figures" footer are not money
const MONEY_RE = /₹|price|cost|realis|profit|vatav|broker|sale|processing|transport|\brates?\b|delta|\/kg|finishing cost/i;
const NOT_MONEY = [/^Picks per sale metre$/i, /internal: no ₹ figures/i];
const moneyStrings = (out) => strings(out).map((s) => NOT_MONEY.reduce((t, re) => t.replace(re, ''), s)).filter((s) => MONEY_RE.test(s));

// what shows that a group is in the output
const MARK = {
  realisation: [/Realisation/, /Profit per pick/, /^Profit · /, /Spindle profitability/],
  sale: [/^Sale rate/, /^Sale date$/, /^VATAV$/, /Temporary sale rate used/],
  yarn: [/^Yarn rates$/, /^YARN RATES$/, /Raw material cost/, /RAW MATERIAL COST/, /Rate ₹\/kg/, /temporary yarn rates/, /latest yarn rates/, /TPM yarn costs/],
  costs: [/^RM cost/, /^RFD cost/, /Cost breakdown/, /COST BREAKDOWN/, /^Cost per pick$/, /^Profit per sale metre$/, /^Finishing cost$/],
  loom: [/Loom realisation/],
};
const has = (all, g) => all.some((s) => MARK[g].some((re) => re.test(s)));

const combos = [];
for (let n = 0; n < 32; n++) combos.push(Object.fromEntries(DETAILED_GROUPS.map((g, i) => [g, !!(n & (1 << i))])));

describe('Detailed with every switch on = the saved 1.29.0 copy, exactly', () => {
  DETAILED_CASES.forEach(([id, t], i) => {
    it(`${id}${Object.keys(t).length ? ' with temporary rates' : ''}: PDF and Excel`, async () => {
      const o = await detailedOutputs(id, t, DETAILED_ALL);
      expect(o.pdf).toEqual(GOLDEN[i].pdf);
      expect(o.xlsx).toEqual(GOLDEN[i].xlsx);
      const d = await detailedOutputs(id, t, undefined);
      expect(d.pdf).toEqual(GOLDEN[i].pdf);
      expect(d.xlsx).toEqual(GOLDEN[i].xlsx);
    });
  });
});

describe('Detailed with every switch off: no money at all', () => {
  DETAILED_CASES.forEach(([id, t]) => {
    it(`${id}${Object.keys(t).length ? ' with temporary rates' : ''}: no ₹ sign, money word or money figure`, async () => {
      const o = await detailedOutputs(id, t, DETAILED_NONE);
      expect(moneyStrings(o.pdf), 'pdf').toEqual([]);
      expect(moneyStrings(o.xlsx), 'xlsx').toEqual([]);
      const money = [o.c.price, o.c.rmCost, o.c.rfdCost, o.c.finishingCost, o.c.realisationPerM, o.c.realisationNetPerM, o.c.vatavAmount].filter((v) => v !== null && v !== 0);
      const nums = numbers(o.xlsx);
      for (const v of money) expect(nums.some((n) => Math.abs(n - Math.round(v * 100) / 100) < 0.0001), `xlsx holds ${v}`).toBe(false);
      // what has no ₹ stays
      const all = strings(o.pdf).join('\n');
      for (const re of [/Construction/, /Consumption per greige metre/, /GSM/, /How these figures are worked out/]) expect(all).toMatch(re);
      expect(all).toMatch(/internal: no ₹ figures/);
    });
  });
});

describe('each switch on its own, in every combination', () => {
  for (const [id, t] of [DETAILED_CASES[4], DETAILED_CASES[5], DETAILED_CASES[3]]) {
    it(`${id}: a group switched off is left out, a group on is in (32 combinations, PDF and Excel)`, async () => {
      const full = await detailedOutputs(id, t, DETAILED_ALL);
      for (const m of combos) {
        const o = await detailedOutputs(id, t, m);
        for (const [name, out, ref] of [['pdf', o.pdf, full.pdf], ['xlsx', o.xlsx, full.xlsx]]) {
          const s = strings(out);
          for (const g of DETAILED_GROUPS) {
            if (!has(strings(ref), g)) continue;
            expect(has(s, g), `${name} ${JSON.stringify(m)} ${g}`).toBe(m[g]);
          }
          expect(s.some((x) => /hidden|undefined|NaN/i.test(x)), name).toBe(false);
        }
      }
    }, 120000);
  }
  it('the file says what it holds', () => {
    expect(detailedContains(DETAILED_ALL)).toBe('contains costs, yarn rates and profit');
    expect(detailedContains(DETAILED_NONE)).toBe('no ₹ figures');
    expect(detailedContains({ ...DETAILED_NONE, sale: true })).toBe('contains sale rate');
    expect(detailedContains({ ...DETAILED_ALL, costs: false })).toBe('contains realisation, sale rate, yarn rates and loom realisation');
  });
});

describe('spindle profitability', () => {
  it('sits under the TFO and spindles table of a unit with TFO, and in the unit section of one without', async () => {
    const o = await detailedOutputs('f_crepe', {}, DETAILED_ALL);
    const rows = o.xlsx['Detailed report'];
    const at = (re) => rows.findIndex((r) => re.test(String(r[0])));
    const tfo = at(/^TFO AND SPINDLES · UNIT 2$/);
    const sp = at(/^TFO · SPINDLE PROFITABILITY · UNIT 2$/);
    expect(tfo).toBeGreaterThan(-1);
    expect(sp).toBeGreaterThan(tfo);
    expect(rows[sp + 1][0]).toBe('Spindle profitability');
    // Unit 2's own section no longer has the row
    const u2 = at(/^UNIT · UNIT 2$/);
    const next = rows.findIndex((r, i) => i > u2 && r.every((c) => c === ''));
    expect(rows.slice(u2, next).some((r) => r[0] === 'Spindle profitability')).toBe(false);
    // a unit with no TFO keeps it in its own section
    const aj = at(/^UNIT · CHINESE AJ$/);
    const ajEnd = rows.findIndex((r, i) => i > aj && r.every((c) => c === ''));
    expect(rows.slice(aj, ajEnd).some((r) => r[0] === 'Spindle profitability')).toBe(true);
    // Realisation off: gone from both places
    const off = await detailedOutputs('f_crepe', {}, { ...DETAILED_ALL, realisation: false });
    expect(JSON.stringify(off.xlsx).toLowerCase()).not.toMatch(/spindle profitability/);
  });
});

describe('Export sheet', () => {
  beforeAll(() => {
    window.scrollTo = () => {};
  });
  beforeEach(async () => {
    cleanup();
    localStorage.clear();
    resetListState();
    await resetDemo();
  });
  it('Detailed shows Advanced with five switches, all on; Sale rate drives the price line; reopening resets', async () => {
    window.location.hash = '#/fabric/f_crepe';
    render(<App />);
    await screen.findByText('Finishing · RFD');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText('PDF spec sheet');
    const preview = () => document.querySelector('.wa-bubble').textContent;
    expect(preview()).not.toMatch(/₹/);
    fireEvent.click(screen.getByRole('button', { name: 'Detailed' }));
    await screen.findByText('Advanced');
    expect(preview()).toMatch(/Price ₹45\.00/);
    expect(document.body.textContent).toMatch(/Every figure, with costs, yarn rates and profit/);
    expect(screen.queryByRole('button', { name: 'Loom realisation' })).toBeNull();
    fireEvent.click(screen.getByText('Advanced'));
    const names = ['Realisation', 'Sale rate', 'Yarn rates', 'Costs', 'Loom realisation'];
    for (const l of names) expect(screen.getByRole('button', { name: l }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Sale rate' }));
    await waitFor(() => expect(preview()).not.toMatch(/Price/));
    expect(screen.getAllByText('Basic text, no ₹ figures').length).toBe(2);
    expect(document.body.textContent).toMatch(/Contains ₹: realisation, yarn rates, costs, loom realisation\./);
    for (const l of ['Realisation', 'Yarn rates', 'Costs', 'Loom realisation']) fireEvent.click(screen.getByRole('button', { name: l }));
    await waitFor(() => expect(document.body.textContent).toMatch(/Every ₹ switch is off/));
    // Basic hides Advanced
    fireEvent.click(screen.getByRole('button', { name: 'Basic' }));
    await waitFor(() => expect(screen.queryByText('Advanced')).toBeNull());
    // close and open again: Basic, Advanced shut, all on
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]);
    await waitFor(() => expect(screen.queryByText('PDF spec sheet')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText('PDF spec sheet');
    expect(screen.getByRole('button', { name: 'Basic' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Detailed' }));
    fireEvent.click(await screen.findByText('Advanced'));
    for (const l of names) expect(screen.getByRole('button', { name: l }).getAttribute('aria-pressed')).toBe('true');
    expect(preview()).toMatch(/Price ₹45\.00/);
  });
});
