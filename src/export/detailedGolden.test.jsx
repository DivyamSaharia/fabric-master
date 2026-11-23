// Writes the saved copy of the 1.29.0 Detailed share with every ₹ switch on: GOLDEN=1 npx vitest run src/export/detailedGolden.test.jsx
// It equals the 1.28.0 Detailed share except that spindle profitability moved under the TFO and spindles table.
// Detailed with every switch on must still equal it (detailedShare.test.jsx).
import { it } from 'vitest';
import fs from 'node:fs';
import { fabricCalc } from '../calc.js';
import { GOLDEN_CASES, caseIndex } from './basicGolden.test.jsx';
import { exportFabricPdfDetailed, exportFabricXlsxDetailed, setLogoForTests } from './detailed.js';
import { recordPdf, recordXlsx } from './recordShare.js';

// the Basic cases, plus a greige fabric with temporary rates
export const DETAILED_CASES = [...GOLDEN_CASES, ['f_pv', { tempRates: { y_fdy75: 125 }, tempPrices: { f_pv: 61.5 } }]];

export const DETAILED_GOLDEN = 'src/export/__golden__/detailed-1.29.0.json';

export async function detailedOutputs(id, t, money) {
  setLogoForTests(null);
  const idx = caseIndex(t);
  const f = idx.fabricsById[id];
  const c = fabricCalc(f, idx);
  const opts = money === undefined ? {} : { money };
  return {
    c,
    idx,
    f,
    pdf: await recordPdf(() => exportFabricPdfDetailed(f, c, idx, opts)),
    xlsx: await recordXlsx(() => exportFabricXlsxDetailed(f, c, idx, opts)),
  };
}

it.skipIf(!process.env.GOLDEN)('writes the golden Detailed share', async () => {
  const out = [];
  for (const [id, t] of DETAILED_CASES) {
    const o = await detailedOutputs(id, t);
    out.push({ id, pdf: o.pdf, xlsx: o.xlsx });
  }
  fs.writeFileSync(DETAILED_GOLDEN, JSON.stringify(out, null, 1));
}, 60000);
