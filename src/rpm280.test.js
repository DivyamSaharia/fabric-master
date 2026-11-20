// 1.26.1: on 280 cm looms the fabric's loom_rpm_dp (the 280 cm RPM) is used whether single or double panna.
// Fixture = live Fabric Master DB rows of the affected fabrics on 20 Nov 2026 (Weavelon 2 and 1).
import { describe, it, expect } from 'vitest';
import { buildIndex, fabricCalc, loomPerDay, loomRealisationForUnit, productionForUnit, spindleProfit, spindlesForUnit } from './calc.js';
import tables from './rpm280.fixture.json';

const idx = buildIndex(tables);
const W2 = idx.unitsById.u_mvdwlskosl2i;
const W1 = idx.unitsById.u_mvopm5i5fj4q;
const fab = (id) => idx.fabricsById[id];
const prod = (id, unit = W2) => {
  const f = fab(id);
  const c = fabricCalc(f, idx);
  return { f, c, rows: productionForUnit(c, f, unit, idx), real: loomRealisationForUnit(c, f, unit, idx) };
};
const row = (rows, width, shed) => rows.find((r) => Number(r.group.reed_width_cm) === width && r.group.shedding === shed);

describe('280 cm single panna uses the 280 cm RPM', () => {
  it('Gajji Silk 64: 280 cm at 700 RPM, 190 cm still at 998', () => {
    const { rows, real } = prod('f_mvgig63tfc5n');
    const w280 = row(rows, 280, 'Dobby');
    expect(w280.panna).toBe(1);
    expect(w280.loom.rpm).toBe(700);
    expect(w280.loom.mPerDay).toBeCloseTo(313.3, 1);
    expect(w280.loom.warpKg).toBeCloseTo(29.68, 2);
    expect(w280.loom.weftKg).toBeCloseTo(11.18, 2);
    expect(real.find((r) => r.width === 280).value).toBeCloseTo(11417, -1);
    const w190 = row(rows, 190, 'Dobby');
    expect(w190.loom.rpm).toBe(998);
    expect(w190.loom.mPerDay).toBeCloseTo(446.7, 1);
    expect(real.find((r) => r.width === 190).value).toBeCloseTo(16278, -1);
  });
  it('Gajji Silk 64 (RFD): 280 cm loom realisation 11,184', () => {
    const { real } = prod('f_mvia19e0ckof');
    expect(real.find((r) => r.width === 280).value).toBeCloseTo(11184, -1);
    expect(real.find((r) => r.width === 280).loom.rpm).toBe(700);
  });
  it('no 280 cm RPM in master: 280 cm figures blank and ask for it; 190 cm unchanged', () => {
    for (const id of ['f_mvgig63pg5i3', 'f_mvgig63xrhbj', 'f_mvgig6450w8e', 'f_mvgig64mgmi8', 'f_mvgne94s8x05', 'f_mvw81fbe6iqv', 'f_mvrtgxn7ogk5']) {
      const { rows, real } = prod(id);
      for (const r of rows.filter((x) => Number(x.group.reed_width_cm) === 280)) {
        expect(r.panna).toBe(1);
        expect(r.loom.mPerDay).toBeNull();
        expect(r.loom.reason).toBe('Set double panna RPM on the fabric (used on 280 cm looms)');
      }
      const r280 = real.find((r) => r.width === 280);
      expect(r280.value).toBeNull();
      expect(r280.reason).toBe('Set double panna RPM on the fabric (used on 280 cm looms)');
      const r190 = rows.find((x) => Number(x.group.reed_width_cm) === 190);
      expect(r190.loom.rpm).toBe(Number(fab(id).loom_rpm));
      expect(r190.loom.mPerDay).not.toBeNull();
    }
  });
  it('Natural Crape 67 on 190 cm: 1041 RPM, 442.6 m/day (unchanged)', () => {
    const { rows } = prod('f_mvgig63pg5i3');
    expect(row(rows, 190, 'Plain').loom.mPerDay).toBeCloseTo(442.6, 1);
  });
  it('double panna on 280 cm is unchanged: 280 cm RPM, two widths', () => {
    const f = { ...fab('f_mvgig63tfc5n'), reed_space_in: '50' };
    const c = fabricCalc(f, idx);
    const r = row(productionForUnit(c, f, W2, idx), 280, 'Dobby');
    expect(r.panna).toBe(2);
    expect(r.loom.rpm).toBe(700);
    expect(r.loom.mPerDay).toBeCloseTo((700 * 1440 * 0.93 * 2) / (76 * 39.37), 6);
  });
  it('Weavelon 1 210 cm loom (< 250 cm) uses the single panna RPM', () => {
    const { rows } = prod('f_mvrtgxn7ogk5', W1);
    const r = rows.find((x) => Number(x.group.reed_width_cm) === 210);
    expect(r.panna).toBe(1);
    expect(r.loom.rpm).toBe(900);
  });
});

describe('places with no loom width keep single = loom_rpm, double = loom_rpm_dp', () => {
  it('loomPerDay without a width', () => {
    const f = fab('f_mvgig63tfc5n');
    const c = fabricCalc(f, idx);
    expect(loomPerDay(c, f, W2, 1).rpm).toBe(998);
    expect(loomPerDay(c, f, W2, 2).rpm).toBe(700);
    expect(loomPerDay(c, fab('f_mvgig63pg5i3'), W2, 2).reason).toBe('Set double panna RPM on the fabric');
  });
  it('spindles and spindle profitability (single panna) still use the single panna RPM', () => {
    const f = fab('f_mvgig63pg5i3');
    const c = fabricCalc(f, idx);
    const old = spindlesForUnit(c, f, W2, idx, 1).find((s) => /Old/.test(s.type.name));
    expect(Math.round(old.total)).toBe(187);
    expect(spindleProfit(c, f, W2, idx).spindles).toBeCloseTo(old.total, 6);
  });
});
