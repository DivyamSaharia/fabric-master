// @vitest-environment node
// Runs the real OCR engine on the 22 Oct 2026 planning sheet and checks every value the import uses.
// The photo (src/sheetImport.fixture.png) holds factory figures, so it is NOT in this public repo: put the
// 22 Oct sheet there to run this test; without it the test is skipped.
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PNG } from 'pngjs';
import { createWorker } from 'tesseract.js';
import { countChecks, parseSheet } from './parse.js';
import { makeOcr } from './ocrParams.js';

const FIXTURE = path.resolve('src/sheetImport.fixture.png');
const HAVE = fs.existsSync(FIXTURE);
let worker, parsed;

beforeAll(async () => {
  if (!HAVE) return;
  const png = PNG.sync.read(fs.readFileSync(FIXTURE));
  const img = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
  worker = await createWorker('eng', 1, { langPath: path.resolve('node_modules/@tesseract.js-data/eng/4.0.0_best_int'), gzip: true, cacheMethod: 'none' });
  const toInput = (ci) => {
    const p = new PNG({ width: ci.width, height: ci.height });
    p.data = Buffer.from(ci.data);
    return PNG.sync.write(p);
  };
  parsed = await parseSheet(img, makeOcr(worker, toInput));
}, 120000);

afterAll(async () => {
  if (worker) await worker.terminate();
});

const pick = (s) => s.rows.map((r) => [r.kind === 'stopped' ? 'NO PROGRAM' : r.name, r.planning, r.current, r.target]);

describe.skipIf(!HAVE)('22 Oct 2026 planning sheet', () => {
  it('finds both sizes and the columns', () => {
    expect(parsed.problems).toEqual([]);
    expect(parsed.columns.roles).toEqual({ name: 0, planning: 3, current: 8, target: 9 });
    expect(parsed.sections.map((s) => s.width)).toEqual([190, 280]);
  });

  it('reads every 190 row', () => {
    expect(pick(parsed.sections[0])).toEqual([
      ['RANGILA TWILL(5404)', 4, null, null],
      ['PASHMINA TWILL(9701)', 8, null, null],
      ['TISSUE BIG(6801)', 0, null, null],
      ['ORGANZA TWILL(4801)', 8, 1000, null],
      ['GAJI SILK(6101)', 0, null, null],
      ['NATURAL CRAPE-67(3801)', 0, null, null],
      ['NATURAL CRAPE SMALL', 10, null, null],
      ['NATURAL CRAPE-74', 2, null, null],
      ['NO PROGRAM', 8, null, null],
    ]);
  });

  it('reads every 280 row', () => {
    expect(pick(parsed.sections[1])).toEqual([
      ['SALSA ANMOL-54(5909)', 0, null, null],
      ['SALSA ANMOL-54(5902)', 4, null, null],
      ['SALSA BUTTY-54(5908)', 1, 600, null],
      ['ORGANZA TWILL(4801)', 0, null, null],
      ['RANGILA TWILL(5405)', 7, 650, 800],
      ['PASHMINA TWILL(9701)', 1, null, null],
      ['NATURAL CRAPE SMALL(3601)', 0, null, null],
      ['GAJJI SILK-41(8801)', 0, null, null],
      ['TISSUE(6402)', 0, null, null],
      ['BRIGHT SATIN-48(0402)', 3, null, null],
      ['NO PROGRAM', 16, null, null],
    ]);
  });

  it('adds up to the TOTAL rows and the 72 looms', () => {
    const c = countChecks(parsed, { 190: 40, 280: 32 });
    expect(c.sizes.map((s) => [s.sum, s.total, s.okTotal, s.okFleet])).toEqual([[40, 40, true, true], [32, 32, true, true]]);
    expect(c.grandTotal).toBe(72);
    expect(c.okGrand).toBe(true);
  });
});
