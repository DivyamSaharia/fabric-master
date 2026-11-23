import { it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { buildIndex, fabricCalc } from './calc.js';
import { sampleTables } from './sampleData.js';
import { NO_MONEY, exportFabricPdf, exportFabricXlsx, exportListXlsx, setLogoForTests } from './export/exports.js';
import { computeRows } from './screens/fabrics.jsx';

const OUT = process.env.EXPORT_OUT;
it.skipIf(!OUT)('writes sample exports', async () => {
  const saved = [];
  URL.createObjectURL = (b) => { saved.push(b); return 'blob:x'; };
  URL.revokeObjectURL = () => {};
  const names = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { names.push(this.download); });
  setLogoForTests(`data:image/png;base64,${fs.readFileSync('public/icon-192.png').toString('base64')}`);
  const idx = buildIndex(sampleTables());
  // Basic as the app sends it (no ₹); f_vn also without a greige width (GSM on reed space, 1.31.0)
  for (const id of ['f_crepe', 'f_pv']) {
    const f = idx.fabricsById[id];
    await exportFabricPdf(f, fabricCalc(f, idx), idx, { money: NO_MONEY });
  }
  const nw = { ...idx.fabricsById.f_vn, name: 'Viscose Nylon Dobby no width', greige_width_in: '' };
  await exportFabricPdf(nw, fabricCalc(nw, idx), idx, { money: NO_MONEY });
  const f = idx.fabricsById.f_crepe;
  await exportFabricXlsx(f, fabricCalc(f, idx), idx, { money: NO_MONEY });
  await exportListXlsx(computeRows(idx), idx, idx.unitsById.u_2);
  expect(saved.length).toBe(5);
  for (let i = 0; i < saved.length; i++) fs.writeFileSync(`${OUT}/${names[i]}`, Buffer.from(await saved[i].arrayBuffer()));
}, 60000);

it.skipIf(!OUT)('writes sample Detailed exports', async () => {
  const { buildDetailedPdf, buildDetailedXlsx, setLogoForTests } = await import('./export/detailed.js');
  setLogoForTests(`data:image/png;base64,${fs.readFileSync('public/icon-192.png').toString('base64')}`);
  const idx = buildIndex(sampleTables());
  for (const id of ['f_crepe', 'f_geo']) {
    const f = idx.fabricsById[id];
    const c = fabricCalc(f, idx);
    fs.writeFileSync(`${OUT}/sample_${id}_detailed.pdf`, Buffer.from(await (await buildDetailedPdf(f, c, idx)).arrayBuffer()));
    fs.writeFileSync(`${OUT}/sample_${id}_detailed.xlsx`, Buffer.from(await (await buildDetailedXlsx(f, c, idx)).arrayBuffer()));
  }
  // 1.29.0: Detailed with ₹ switches off (all off, and Costs + Loom realisation off)
  const f = idx.fabricsById.f_crepe;
  const c = fabricCalc(f, idx);
  const none = { realisation: false, sale: false, yarn: false, costs: false, loom: false };
  fs.writeFileSync(`${OUT}/sample_f_crepe_detailed_no-money.pdf`, Buffer.from(await (await buildDetailedPdf(f, c, idx, none)).arrayBuffer()));
  fs.writeFileSync(`${OUT}/sample_f_crepe_detailed_no-units.pdf`, Buffer.from(await (await buildDetailedPdf(f, c, idx, { units: false })).arrayBuffer()));
  fs.writeFileSync(`${OUT}/sample_f_crepe_detailed_no-costs-no-loom.pdf`, Buffer.from(await (await buildDetailedPdf(f, c, idx, { costs: false, loom: false })).arrayBuffer()));
}, 60000);
