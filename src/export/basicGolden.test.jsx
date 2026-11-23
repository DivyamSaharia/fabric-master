// Writes the saved copy of today's (1.27.0) Basic share, before the ₹ switches: GOLDEN=1 npx vitest run src/export/basicGolden.test.jsx
import { it } from 'vitest';
import fs from 'node:fs';
import { buildIndex, fabricCalc } from '../calc.js';
import { sampleTables } from '../sampleData.js';
import { exportFabricPdf, exportFabricXlsx, whatsappText } from './exports.js';
import { recordPdf, recordXlsx } from './recordShare.js';

export const GOLDEN_CASES = [
  ['f_crepe', {}],
  ['f_pv', {}],
  ['f_geo', {}],
  ['f_vn', {}],
  // temporary yarn rate, TPM delta, sale rate and RPM on: notes are printed
  ['f_crepe', { tempRates: { y_fdy75: 125 }, tempPrices: { f_crepe: 47 }, tempDeltas: { y_tpm75: 60 }, tempRpms: { f_crepe: { sp: 900 } } }],
];

export function caseIndex(t) {
  return buildIndex(sampleTables(), t.tempRates || {}, t.tempPrices || {}, { tempDeltas: t.tempDeltas || {}, tempRpms: t.tempRpms || {} });
}

it.skipIf(!process.env.GOLDEN)('writes the golden Basic share', async () => {
  const out = [];
  for (const [id, t] of GOLDEN_CASES) {
    const idx = caseIndex(t);
    const f = idx.fabricsById[id];
    const c = fabricCalc(f, idx);
    out.push({ id, pdf: await recordPdf(() => exportFabricPdf(f, c, idx)), xlsx: await recordXlsx(() => exportFabricXlsx(f, c, idx)), text: whatsappText(f, c, idx) });
  }
  fs.writeFileSync('src/export/__golden__/basic-1.27.0.json', JSON.stringify(out, null, 1));
}, 60000);
