import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { buildIndex } from './calc.js';
import { sampleTables } from './sampleData.js';
import { computePlan, emptyPlan } from './planner.js';
import { exportPlanPdf, exportPlanXlsx, planFileName, planWorkbookRows } from './export/planExport.js';

const plan = {
  ...emptyPlan('u_2'),
  looms: [{ fabricId: 'f_crepe', groupId: 'lg1', looms: '10' }, { fabricId: 'f_moss', groupId: 'lg2', looms: '6' }, { fabricId: 'f_crepe', groupId: 'lg2', looms: '3' }],
  sides: [{ yarnId: 'y_tpm75', typeId: 'tt1', sides: '4' }, { yarnId: 'y_tpm100', typeId: 'tt2', sides: '2' }],
  receipts: [{ yarnId: 'y_tpm75', kg: '25' }],
  settings: { 'rpm:f_crepe:lg2': 650, 'tfoEff:tt2': 75 },
};

const MONEY = /₹|realis|per pick/i;

it('builds the plan workbook rows and file names', () => {
  const idx = buildIndex(sampleTables());
  const model = computePlan(plan, idx);
  const meta = { name: 'Diwali plan', date: '2026-10-25' };
  const rows = planWorkbookRows(model, meta);
  expect(Object.keys(rows)).toEqual(['Summary', 'Looms', 'TFO', 'Received', 'Yarn consumption', 'TPM balance']);
  expect(rows.Looms).toHaveLength(3);
  expect(typeof rows.Looms[0].Looms).toBe('number');
  expect(rows.Looms.find((x) => x.RPM === 650)).toBeTruthy();
  expect(planFileName(meta, 'pdf')).toBe('2026-10-25_tfo-plan_diwali-plan.pdf');
  expect(planFileName(meta, 'pdf', false)).toBe('2026-10-25_tfo-plan_diwali-plan_no-revenue.pdf');
  expect(planFileName({ name: 'Unsaved plan', date: '2026-10-25' }, 'xlsx')).toBe('2026-10-25_tfo-plan_unsaved-plan.xlsx');
});

it('never shows edited markers, with or without revenue', () => {
  const idx = buildIndex(sampleTables());
  const model = computePlan(plan, idx);
  for (const money of [true, false]) {
    const text = JSON.stringify(planWorkbookRows(model, { name: 'x', date: '2026-10-25' }, { money }));
    expect(text).not.toMatch(/edited/i);
  }
});

it('leaves out every rupee figure without revenue', () => {
  const idx = buildIndex(sampleTables());
  const model = computePlan(plan, idx);
  const meta = { name: 'x', date: '2026-10-25' };
  const full = planWorkbookRows(model, meta, { money: true });
  expect(JSON.stringify(full)).toMatch(MONEY);
  const bare = planWorkbookRows(model, meta, { money: false });
  expect(JSON.stringify(bare)).not.toMatch(MONEY);
  expect(bare.Looms[0]).not.toHaveProperty('₹/loom/day');
  expect(bare.Summary.map((r) => r.Field).some((f) => MONEY.test(f))).toBe(false);
});

it('writes the PDF and the Excel file, full and without revenue', async () => {
  const saved = [];
  URL.createObjectURL = (b) => { saved.push(b); return 'blob:x'; };
  URL.revokeObjectURL = () => {};
  const names = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { names.push(this.download); });
  const idx = buildIndex(sampleTables());
  const model = computePlan(plan, idx);
  const meta = { name: 'Diwali plan', date: '2026-10-25', unsaved: true };
  await exportPlanPdf(model, meta);
  await exportPlanXlsx(model, meta);
  await exportPlanPdf(model, meta, { money: false });
  await exportPlanXlsx(model, meta, { money: false });
  expect(names).toEqual([
    '2026-10-25_tfo-plan_diwali-plan.pdf', '2026-10-25_tfo-plan_diwali-plan.xlsx',
    '2026-10-25_tfo-plan_diwali-plan_no-revenue.pdf', '2026-10-25_tfo-plan_diwali-plan_no-revenue.xlsx',
  ]);
  expect(saved[0].size).toBeGreaterThan(5000);
  const out = process.env.EXPORT_OUT;
  if (out) for (let i = 0; i < saved.length; i++) fs.writeFileSync(`${out}/${names[i]}`, Buffer.from(await saved[i].arrayBuffer()));
}, 90000);
