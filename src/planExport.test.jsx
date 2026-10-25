import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { buildIndex } from './calc.js';
import { sampleTables } from './sampleData.js';
import { computePlan, editedSettings, emptyPlan } from './planner.js';
import { exportPlanPdf, exportPlanXlsx, planFileName, planWorkbookRows } from './export/planExport.js';

const plan = {
  ...emptyPlan('u_2'),
  looms: [{ fabricId: 'f_crepe', groupId: 'lg1', looms: '10' }, { fabricId: 'f_moss', groupId: 'lg2', looms: '6' }, { fabricId: 'f_crepe', groupId: 'lg2', looms: '3' }],
  sides: [{ yarnId: 'y_tpm75', typeId: 'tt1', sides: '4' }, { yarnId: 'y_tpm100', typeId: 'tt2', sides: '2' }],
  receipts: [{ yarnId: 'y_tpm75', kg: '25' }],
  settings: { 'rpm:f_crepe:lg2': 650, 'tfoEff:tt2': 75 },
};

it('builds the plan workbook rows and file names', () => {
  const idx = buildIndex(sampleTables());
  const model = computePlan(plan, idx);
  const meta = { name: 'Diwali plan', date: '2026-10-25' };
  const rows = planWorkbookRows(model, meta, editedSettings(plan, idx));
  expect(Object.keys(rows)).toEqual(['Summary', 'Looms', 'TFO', 'Received', 'Yarn consumption', 'TPM balance', 'Settings']);
  expect(rows.Looms).toHaveLength(3);
  expect(typeof rows.Looms[0].Looms).toBe('number');
  expect(rows.Settings.some((s) => s.Setting === 'Loom RPM' && s['In this plan'] === 650)).toBe(true);
  expect(rows.Settings.find((s) => s.Setting === 'TFO efficiency %' && s.For === 'M/C 13–16')['In this plan']).toBe(75);
  expect(planFileName(meta, 'pdf')).toBe('2026-10-25_tfo-plan_diwali-plan.pdf');
  expect(planFileName({ name: 'Unsaved plan', date: '2026-10-25' }, 'xlsx')).toBe('2026-10-25_tfo-plan_unsaved-plan.xlsx');
});

it('writes the PDF and the Excel file', async () => {
  const saved = [];
  URL.createObjectURL = (b) => { saved.push(b); return 'blob:x'; };
  URL.revokeObjectURL = () => {};
  const names = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { names.push(this.download); });
  const idx = buildIndex(sampleTables());
  const model = computePlan(plan, idx);
  const meta = { name: 'Diwali plan', date: '2026-10-25', unsaved: true };
  await exportPlanPdf(model, meta, editedSettings(plan, idx));
  await exportPlanXlsx(model, meta, editedSettings(plan, idx));
  expect(names).toEqual(['2026-10-25_tfo-plan_diwali-plan.pdf', '2026-10-25_tfo-plan_diwali-plan.xlsx']);
  expect(saved[0].size).toBeGreaterThan(5000);
  const out = process.env.EXPORT_OUT;
  if (out) for (let i = 0; i < saved.length; i++) fs.writeFileSync(`${out}/${names[i]}`, Buffer.from(await saved[i].arrayBuffer()));
}, 60000);
