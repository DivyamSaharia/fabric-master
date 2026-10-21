import { it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { buildIndex } from './calc.js';
import { sampleTables } from './sampleData.js';
import { planCalc, planLines } from './planner.js';
import { exportPlanPdf, exportPlanXlsx } from './export/planExports.js';

async function run(fn) {
  const saved = [];
  const names = [];
  URL.createObjectURL = (b) => { saved.push(b); return 'blob:x'; };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { names.push(this.download); });
  const idx = buildIndex(sampleTables());
  const plan = idx.tables.TfoPlans[0];
  await fn(plan, planCalc(plan, planLines(idx, plan.id), idx));
  return { blob: saved[0], name: names[0] };
}

it('plan Excel has running yarn and loom group tabs, named by the plan date', async () => {
  const { blob, name } = await run(exportPlanXlsx);
  expect(name).toBe('2026-10-21_unit-2-tfo-plan.xlsx');
  const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
  expect(wb.SheetNames).toEqual(['Spindle balance', 'Running yarn', 'Loom groups', 'Loom plan', 'TFO sides', 'TFO machines', 'Outside yarn']);
  const running = XLSX.utils.sheet_to_json(wb.Sheets['Running yarn']);
  expect(running).toHaveLength(6);
  expect(running[0]).toMatchObject({ Yarn: '75D Polyester FDY', 'Total kg/day': 317.1 });
  expect(running.at(-1)).toMatchObject({ Yarn: 'Total', 'Total kg/day': 1071.5 });
  const groups = XLSX.utils.sheet_to_json(wb.Sheets['Loom groups']);
  expect(groups.find((g) => g['Loom group'] === 'Toyota · 280 cm · Plain')).toMatchObject({ 'Looms planned': 32, 'Looms available': 8 });
});

it('plan PDF is made', async () => {
  const { blob, name } = await run(exportPlanPdf);
  expect(name).toBe('2026-10-21_unit-2-tfo-plan.pdf');
  expect(blob.size).toBeGreaterThan(5000);
}, 30000);
