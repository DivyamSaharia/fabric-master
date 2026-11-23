// 1.28.0: fabric share Basic (no money) and the money switches of its builders. Since 1.29.0 the app sends Basic
// with no money only; the Includes ₹ share is gone (its switches are on Detailed: detailedShare.test.jsx).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/preact';
import { fabricCalc } from '../calc.js';
import { ALL_MONEY, MONEY_GROUPS, NO_MONEY, exportFabricPdf, exportFabricXlsx, whatsappText } from './exports.js';
import { recordPdf, recordXlsx } from './recordShare.js';
import { GOLDEN_CASES, caseIndex } from './basicGolden.test.jsx';
import { App } from '../app.jsx';
import { resetDemo } from '../store.js';
import { resetListState } from '../listState.js';

const GOLDEN = JSON.parse(fs.readFileSync('src/export/__golden__/basic-1.31.0.json', 'utf8'));

async function outputs(id, t, money) {
  const idx = caseIndex(t);
  const f = idx.fabricsById[id];
  const c = fabricCalc(f, idx);
  return {
    c,
    pdf: await recordPdf(() => exportFabricPdf(f, c, idx, { money })),
    xlsx: await recordXlsx(() => exportFabricXlsx(f, c, idx, { money })),
    text: whatsappText(f, c, idx, money),
  };
}

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

// any word or sign of money
const MONEY_RE = /₹|price|cost|realis|profit|vatav|broker|sale|processing|transport|\brates?\b|delta|\/kg/i;
// what shows that a group is in the output
const MARK = {
  realisation: [/Realisation/, /Profit \/ pick/, /Profit ₹\/pick/],
  sale: [/^VATAV$/, /Selling price/, /Sale date/, /No VATAV/, /VATAV \d/, /VATAV %/, /VATAV ₹\/m/, /^Price /, /Price basis/, /temporary sale rate/i],
  yarn: [/Rate ₹\/kg/, /Rate basis/, /temporary yarn rates/, /^₹\/m$/],
  costs: [/^RM cost$/, /RM cost \(/, /RM cost ₹/, /RM cost per/, /^RFD cost/, /RM ₹/, /Processing/, /Transportation/, /Brokering/, /Finishing cost/, /Cost \/ pick/, /Cost ₹\/pick/, /Cost\/pick/, /Profit \/ m/, /Profit ₹\/m/],
};
const has = (all, g) => all.some((s) => MARK[g].some((re) => re.test(s)));

const combos = [];
for (let n = 0; n < 16; n++) combos.push(Object.fromEntries(MONEY_GROUPS.map((g, i) => [g, !!(n & (1 << i))])));

describe('Builders with every switch on = the saved 1.31.0 copy, exactly', () => {
  GOLDEN_CASES.forEach(([id, t], i) => {
    it(`${id}${Object.keys(t).length ? ' with temporary rates' : ''}: PDF, Excel and WhatsApp/Copy text`, async () => {
      const o = await outputs(id, t, ALL_MONEY);
      expect(o.pdf).toEqual(GOLDEN[i].pdf);
      expect(o.xlsx).toEqual(GOLDEN[i].xlsx);
      expect(o.text).toBe(GOLDEN[i].text);
      // no options at all is the same as all on
      const d = await outputs(id, t, undefined);
      expect(d.pdf).toEqual(GOLDEN[i].pdf);
    });
  });
});

describe('Basic: no money at all', () => {
  GOLDEN_CASES.forEach(([id, t]) => {
    it(`${id}${Object.keys(t).length ? ' with temporary rates' : ''}: no ₹ sign, money word or money figure in any output`, async () => {
      const o = await outputs(id, t, NO_MONEY);
      for (const [name, out] of [['pdf', o.pdf], ['xlsx', o.xlsx], ['text', o.text]]) {
        const bad = strings(out).filter((s) => MONEY_RE.test(s));
        expect(bad, name).toEqual([]);
      }
      const money = [o.c.price, o.c.rmCost, o.c.rfdCost, o.c.finishingCost, o.c.realisationPerM, o.c.realisationNetPerM, o.c.vatavAmount].filter((v) => v !== null && v !== 0);
      const nums = numbers(o.xlsx);
      for (const v of money) expect(nums.some((n) => Math.abs(n - v) < 0.006), `xlsx holds ${v}`).toBe(false);
      // what has no ₹ stays
      const all = strings(o.pdf).join('\n');
      expect(all).toMatch(/Construction/);
      expect(all).toMatch(/Warp and weft/);
      expect(all).toMatch(/GSM/);
      expect(strings(o.xlsx).join('\n')).toMatch(/Total g\/m/);
      expect(o.text).toMatch(/Reed × Pick/);
    });
  });
});

describe('each switch on its own, in every combination, on every output', () => {
  for (const [id, t] of [GOLDEN_CASES[4], GOLDEN_CASES[1]]) {
    it(`${id}: a group switched off is left out, a group on is in (16 combinations)`, async () => {
      const full = await outputs(id, t, ALL_MONEY);
      for (const m of combos) {
        const o = await outputs(id, t, m);
        for (const [name, out, ref] of [['pdf', o.pdf, full.pdf], ['xlsx', o.xlsx, full.xlsx], ['text', o.text, full.text]]) {
          const s = strings(out);
          for (const g of MONEY_GROUPS) {
            if (!has(strings(ref), g)) continue; // this output never had it
            expect(has(s, g), `${name} ${JSON.stringify(m)} ${g}`).toBe(m[g]);
          }
          // no blanks or "hidden" labels left behind
          expect(s.some((x) => /hidden/i.test(x)), name).toBe(false);
        }
      }
    }, 60000);
  }
  it('Yarn rates off drops the temporary yarn note; Sale rate off drops the temporary sale note; the RPM note stays', async () => {
    const [id, t] = GOLDEN_CASES[4];
    const y = strings((await outputs(id, t, { ...ALL_MONEY, yarn: false })).pdf).join(' ');
    expect(y).not.toMatch(/temporary yarn rates/);
    expect(y).toMatch(/Temporary sale rate used/);
    expect(y).toMatch(/Temporary loom RPM used/);
    const s = strings((await outputs(id, t, { ...ALL_MONEY, sale: false })).pdf).join(' ');
    expect(s).toMatch(/temporary yarn rates/);
    expect(s).not.toMatch(/Temporary sale rate used/);
    const n = strings((await outputs(id, t, NO_MONEY)).pdf).join(' ');
    expect(n).toMatch(/Temporary loom RPM used/);
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
  it('has two kinds only: Basic with no ₹ and no Advanced, and Detailed', async () => {
    window.location.hash = '#/fabric/f_crepe';
    render(<App />);
    await screen.findByText('Finishing · RFD');
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await screen.findByText('PDF spec sheet');
    expect(screen.getByRole('button', { name: 'Basic' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Includes ₹' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^(Basic|Detailed)$/ }).length).toBe(2);
    expect(document.querySelector('.wa-bubble').textContent).not.toMatch(/₹/);
    expect(screen.queryByText('Advanced')).toBeNull();
  });
});
