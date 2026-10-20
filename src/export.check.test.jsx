import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { buildIndex, fabricCalc } from './calc.js';
import { sampleTables } from './sampleData.js';
import { exportFabricPdf, exportFabricXlsx, exportListXlsx } from './export/exports.js';
import { computeRows } from './screens/fabrics.jsx';

const OUT = process.env.EXPORT_OUT;
it.skipIf(!OUT)('writes sample exports', async () => {
  const saved = [];
  URL.createObjectURL = (b) => { saved.push(b); return 'blob:x'; };
  URL.revokeObjectURL = () => {};
  const names = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { names.push(this.download); });
  const idx = buildIndex(sampleTables());
  for (const id of ['f_crepe', 'f_pv']) {
    const f = idx.fabricsById[id];
    await exportFabricPdf(f, fabricCalc(f, idx), idx);
  }
  const f = idx.fabricsById.f_crepe;
  await exportFabricXlsx(f, fabricCalc(f, idx), idx);
  await exportListXlsx(computeRows(idx), idx, idx.unitsById.u_2);
  expect(saved.length).toBe(4);
  for (let i = 0; i < saved.length; i++) fs.writeFileSync(`${OUT}/${names[i]}`, Buffer.from(await saved[i].arrayBuffer()));
}, 60000);
