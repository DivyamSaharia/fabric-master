import { describe, it, expect } from 'vitest';
import { baseFabric, buildIndex, fabricCalc, fabricLabel, groupPanna, loomPerDay, productionForUnit, rateSources, stripRs, tfoPerSide, unitProfit, spindlesForUnit, spindleProfit, refTfoType, tfoOutput, yarnDenier, yarnRate } from './calc.js';
import { sampleTables } from './sampleData.js';

const idx = buildIndex(sampleTables());
const crepe = idx.fabricsById.f_crepe;

describe('worked example from the scope (Poly Crepe 75x75)', () => {
  const c = fabricCalc(crepe, idx);
  it('consumption and GSM', () => {
    expect(c.warpGpm).toBeCloseTo(51.0, 2);
    expect(c.weftGpm).toBeCloseTo(40.8, 2);
    expect(c.totalGpm).toBeCloseTo(91.8, 2);
    expect(c.gsm).toBeCloseTo(63.4, 1);
    expect(c.totalEnds).toBe(6000);
  });
  it('RM cost', () => {
    expect(c.rmCost).toBeCloseTo(12.872, 3);
  });
  it('RFD cost and realisation', () => {
    expect(c.g).toBeCloseTo(1 / 0.92, 6);
    expect(c.finishingCost).toBeCloseTo(8.602, 3);
    expect(c.rfdCost).toBeCloseTo(22.594, 3);
    expect(c.realisationPerM).toBeCloseTo(22.406, 3);
    expect(c.realisationPerPick).toBeCloseTo(0.2577, 4);
    expect(c.tfoClass).toBe('Weft TPM');
  });
  it('transportation adds per RFD metre, not grossed up by shrinkage', () => {
    const t = fabricCalc({ ...crepe, transport_charge: 0.5 }, idx);
    expect(t.transport).toBe(0.5);
    expect(t.finishingCost).toBeCloseTo(c.finishingCost + 0.5, 6);
    expect(t.rfdCost).toBeCloseTo(c.rfdCost + 0.5, 6);
    expect(t.realisationPerM).toBeCloseTo(c.realisationPerM - 0.5, 6);
  });
  it('VATAV comes off the selling price; brokering stays on the full price', () => {
    expect(c.vatavPct).toBe(3);
    expect(c.vatavAmount).toBeCloseTo(1.35, 6);
    expect(c.realisationNetPerM).toBeCloseTo(22.406 - 1.35, 3);
    expect(c.realisationNetPerPick).toBeCloseTo(21.056 / (80 / 0.92), 4);
    expect(c.realisationPerPick).toBeCloseTo(0.2577, 4);
  });
  it('profit per pick by unit uses realisation with VATAV', () => {
    const p = unitProfit(c, idx.unitsById.u_2);
    expect(p.profitPerPick).toBeCloseTo(0.2421 - 0.2, 4);
    expect(p.profitPerM).toBeCloseTo(3.665, 3);
  });
  it('no VATAV means both realisations match', () => {
    const c0 = fabricCalc({ ...crepe, vatav_pct: '' }, idx);
    expect(c0.realisationNetPerPick).toBeCloseTo(c0.realisationPerPick, 10);
    expect(unitProfit(c0, idx.unitsById.u_2).profitPerPick).toBeCloseTo(0.0577, 4);
  });
  it('TFO output and spindles per loom for each TFO type', () => {
    // RPM is entered already multiplied by 2
    expect(tfoOutput(18000, 2000, 90, 75)).toBeCloseTo(0.0972, 4);
    const s = spindlesForUnit(c, crepe, idx.unitsById.u_2, idx);
    expect(s).toHaveLength(2);
    expect(s[0].type.name).toBe('M/C 1–12');
    expect(s[0].total).toBeCloseTo(130.5, 1);
    expect(s[1].total).toBeCloseTo(111.9, 1);
    expect(spindlesForUnit(c, crepe, idx.unitsById.u_caj, idx)).toEqual([]);
  });
});

describe('greige realisation', () => {
  it('equals (P - RM) / PPI', () => {
    const f = { ...crepe, id: 'f_crepe', finish: 'Greige', price: 33 };
    const c = fabricCalc(f, idx);
    expect(c.realisationPerPick).toBeCloseTo((33 - 12.872) / 80, 4);
    expect(c.realisationNetPerPick).toBeCloseTo((33 * 0.97 - 12.872) / 80, 4);
    expect(c.rfdCost).toBeNull();
  });
});

describe('yarns', () => {
  it('converts Ne to denier and inherits base denier and rate for TPM yarns', () => {
    expect(yarnDenier(idx.yarnsById.y_vis30, idx)).toBeCloseTo(177.17, 2);
    expect(yarnDenier(idx.yarnsById.y_tpm75, idx)).toBe(75);
    const t = { Yarns: [{ id: 'b', kind: 'base', count: 75, count_unit: 'D' }, { id: 't', kind: 'tpm', base_yarn_id: 'b', tpm: 2000 }], YarnRates: [{ id: 'r', yarn_id: 'b', rate: 118, effective_date: '2026-10-01' }] };
    const i2 = buildIndex(t);
    // TPM rate = base rate + delta, ₹50 by default
    expect(yarnRate(i2.yarnsById.t, i2)).toEqual({ rate: 168, date: '2026-10-01', baseRate: 118, delta: 50 });
  });
  it('uses the latest rate on or before the as-of date', () => {
    const t = { Yarns: [{ id: 'b', kind: 'base', count: 75, count_unit: 'D' }], YarnRates: [{ id: 'r1', yarn_id: 'b', rate: 110, effective_date: '2026-09-01' }, { id: 'r2', yarn_id: 'b', rate: 118, effective_date: '2026-10-01' }] };
    const i2 = buildIndex(t);
    expect(yarnRate(i2.yarnsById.b, i2).rate).toBe(118);
    expect(yarnRate(i2.yarnsById.b, i2, '2026-09-15').rate).toBe(110);
  });
});

describe('TPM yarn rate is base rate plus delta', () => {
  const t = {
    Yarns: [{ id: 'b', kind: 'base', count: 60, count_unit: 'D' }, { id: 't1', kind: 'tpm', base_yarn_id: 'b', tpm: 1109 }, { id: 't2', kind: 'tpm', base_yarn_id: 'b', tpm: 1650, tpm_delta: 65 }],
    YarnRates: [{ id: 'r1', yarn_id: 'b', rate: 700, effective_date: '2026-09-01' }, { id: 'r2', yarn_id: 'b', rate: 725.25, effective_date: '2026-10-20' }, { id: 'old', yarn_id: 't1', rate: 999, effective_date: '2026-10-20' }],
  };
  const i = buildIndex(t);
  it('uses ₹50 when no delta is set, and ignores old TPM rate rows', () => {
    expect(yarnRate(i.yarnsById.t1, i).rate).toBeCloseTo(775.25, 6);
  });
  it('uses a delta changed by hand', () => {
    expect(yarnRate(i.yarnsById.t2, i).rate).toBeCloseTo(790.25, 6);
  });
  it('follows the base rate as of a date', () => {
    expect(yarnRate(i.yarnsById.t1, i, '2026-09-15').rate).toBe(750);
  });
  it('has no rate when the base yarn has none', () => {
    const j = buildIndex({ Yarns: t.Yarns, YarnRates: [] });
    expect(yarnRate(j.yarnsById.t1, j)).toBeNull();
  });
});

describe('TPM x TPM spindles add up over both TPM yarns', () => {
  it('georgette', () => {
    const geo = idx.fabricsById.f_geo;
    const c = fabricCalc(geo, idx);
    expect(c.tfoClass).toBe('TPM × TPM');
    const s = spindlesForUnit(c, geo, idx.unitsById.u_2, idx);
    expect(s[0].perYarn).toHaveLength(2);
    expect(s[0].total).toBeCloseTo(s[0].perYarn[0].spindles + s[0].perYarn[1].spindles, 6);
  });
});

describe('missing inputs', () => {
  it('reports what is missing instead of guessing', () => {
    const c = fabricCalc({ id: 'x', name: 'x' }, idx);
    expect(c.missing).toEqual(expect.arrayContaining(['pick', 'reed space', 'warp yarn', 'weft yarn', 'selling price']));
    expect(c.realisationPerPick).toBeNull();
  });
});

describe('fabric names show the RS', () => {
  it('adds the rounded RS once', () => {
    expect(fabricLabel({ name: 'Natural Crape', reed_space_in: 52.5 })).toBe('Natural Crape 53');
    expect(fabricLabel({ name: 'Gajji Silk 64', reed_space_in: 64 })).toBe('Gajji Silk 64');
    expect(fabricLabel({ name: 'Gajji Silk (copy)', reed_space_in: 73 })).toBe('Gajji Silk 73 (copy)');
    expect(fabricLabel({ name: 'Tissue', reed_space_in: '' })).toBe('Tissue');
    expect(stripRs('Natural Crape 53', 52.5)).toBe('Natural Crape');
    expect(stripRs('Poly Crepe 75', 60)).toBe('Poly Crepe 75');
  });
  it('finished (RFD) fabrics read name + RS + (RFD)', () => {
    expect(fabricLabel({ name: 'Gajji Silk', reed_space_in: 41, finish: 'RFD' })).toBe('Gajji Silk 41 (RFD)');
    expect(fabricLabel({ name: 'Organza Twill (RFD)', reed_space_in: 50, finish: 'RFD' })).toBe('Organza Twill 50 (RFD)');
    expect(fabricLabel({ name: 'Ganesh 72', reed_space_in: 72, finish: 'RFD' })).toBe('Ganesh 72 (RFD)');
    expect(fabricLabel({ name: 'Gajji Silk (copy)', reed_space_in: 64, finish: 'RFD' })).toBe('Gajji Silk 64 (RFD) (copy)');
    expect(fabricLabel({ name: 'Gajji Silk', reed_space_in: 41, finish: 'Greige' })).toBe('Gajji Silk 41');
  });
  it('index shows name + RS and keeps the stored name', () => {
    const f = idx.fabricsById.f_crepe;
    expect(f.name).toBe('Poly Crepe 60 (RFD)');
    expect(f.base_name).toBe('Poly Crepe');
    expect(baseFabric(f).name).toBe('Poly Crepe');
    expect('base_name' in baseFabric(f)).toBe(false);
  });
});

describe('single and double panna use the unit loom efficiency', () => {
  const c = fabricCalc(crepe, idx);
  it('double panna weaves two widths', () => {
    const one = loomPerDay(c, { ...crepe, loom_rpm_dp: 800 }, idx.unitsById.u_2, 1);
    const two = loomPerDay(c, { ...crepe, loom_rpm_dp: 800 }, idx.unitsById.u_2, 2);
    expect(one.mPerDay).toBeCloseTo((800 * 1440 * 0.85) / (80 * 39.37), 6);
    expect(two.mPerDay).toBeCloseTo(one.mPerDay * 2, 6);
    expect(two.warpKg).toBeCloseTo((two.mPerDay * c.warpGpm) / 1000, 6);
  });
  it('says what is missing', () => {
    expect(loomPerDay(c, crepe, idx.unitsById.u_2, 2).reason).toBe('Set double panna RPM on the fabric');
    expect(loomPerDay(c, crepe, { ...idx.unitsById.u_2, loom_eff_pct: '' }, 1).reason).toBe('Set loom efficiency on the unit');
    expect(spindlesForUnit(c, crepe, idx.unitsById.u_2, idx, 2)[0].reason).toBe('Set double panna RPM on the fabric');
  });
  it('fabric loom efficiency is no longer used', () => {
    const s = spindlesForUnit(c, { ...crepe, loom_eff_pct: 50 }, idx.unitsById.u_2, idx);
    expect(s[0].total).toBeCloseTo(130.5, 1);
  });
});

describe('fmt.date', () => {
  it('shows yyyy-mm-dd as "2 Oct 2026" and blanks as empty', async () => {
    const { fmt } = await import('./calc.js');
    expect(fmt.date('2026-10-02')).toBe('2 Oct 2026');
    expect(fmt.date('2026-09-24T00:00:00.000Z')).toBe('24 Sep 2026');
    expect(fmt.date('')).toBe('');
    expect(fmt.date(undefined)).toBe('');
    expect(fmt.date('garbage')).toBe('');
  });
});

describe('spindle profitability', () => {
  it('profit per pick at the unit ÷ single-panna spindles on the old TFO machines', () => {
    const c = fabricCalc(crepe, idx);
    const unit = idx.unitsById.u_2;
    const s = spindleProfit(c, crepe, unit, idx);
    const old = spindlesForUnit(c, crepe, unit, idx).find((x) => x.type.id === s.type.id);
    expect(s.spindles).toBeCloseTo(old.total, 6);
    expect(s.value).toBeCloseTo(unitProfit(c, unit).profitPerPick / old.total, 9);
  });
  it('prefers the type named old, else the one with most machines', () => {
    expect(refTfoType([{ id: 'n', name: 'New machines (13-16)', machines: 12 }, { id: 'o', name: 'Old machines (1-12)', machines: 4 }]).id).toBe('o');
    expect(refTfoType([{ id: 'a', name: 'A', machines: 4 }, { id: 'b', name: 'B', machines: 12 }]).id).toBe('b');
    expect(refTfoType([])).toBeNull();
  });
  it('is null for fabrics with no TPM yarn', () => {
    const plain = Object.values(idx.fabricsById).find((f) => fabricCalc(f, idx).tfoClass === 'Non-TPM');
    expect(plain).toBeTruthy();
    expect(spindleProfit(fabricCalc(plain, idx), plain, idx.unitsById.u_2, idx)).toBeNull();
  });
});

describe('rates as of an older date, per base yarn', () => {
  const t = sampleTables();
  t.YarnRates.push({ id: 'r_old', yarn_id: 'y_fdy75', rate: 100, effective_date: '2026-09-01' });
  const ix = buildIndex(t);
  const f = ix.fabricsById.f_crepe;
  const now = fabricCalc(f, ix);
  it('lists each base yarn once, newest rate first, with the TPM yarns that use it', () => {
    const src = rateSources(now, ix);
    expect(src.map((s) => s.yarn.id)).toEqual(['y_fdy75']);
    expect(src[0].dates).toEqual([{ date: '2026-10-01', rate: 118 }, { date: '2026-09-01', rate: 100 }]);
    expect(src[0].usedBy.map((y) => y.id).sort()).toEqual(['y_fdy75', 'y_tpm75']);
  });
  it('a picked date changes the base yarn and its TPM yarn (base + delta), and the realisation', () => {
    const old = fabricCalc(f, ix, null, { y_fdy75: '2026-09-01' });
    expect(old.warp[0].rate).toBe(100);
    expect(old.weft[0].rate).toBe(150);
    expect(old.rmCost).toBeLessThan(now.rmCost);
    expect(old.realisationNetPerPick).toBeGreaterThan(now.realisationNetPerPick);
    expect(yarnRate(ix.yarnsById.y_tpm75, ix, null, { y_fdy75: '2026-09-01' }).rate).toBe(150);
  });
  it('rates dated with a time still count on their day', () => {
    const t2 = sampleTables();
    t2.YarnRates = [{ id: 'x', yarn_id: 'y_fdy75', rate: 99, effective_date: '2026-09-01T00:00:00.000Z' }];
    expect(yarnRate(buildIndex(t2).yarnsById.y_fdy75, buildIndex(t2), '2026-09-01').rate).toBe(99);
  });
});

describe('production centre', () => {
  it('double panna when two reed spaces fit the reed width (+0.5 in)', () => {
    expect(groupPanna(52.5, { reed_width_cm: 280 })).toBe(2);
    expect(groupPanna(52.5, { reed_width_cm: 190 })).toBe(1);
    expect(groupPanna(60, { reed_width_cm: 280 })).toBe(1);
    expect(groupPanna(120, { reed_width_cm: 280 })).toBe(null);
  });
  it('one line per loom group the fabric fits, per loom and for all looms', () => {
    const c = fabricCalc(crepe, idx);
    const rows = productionForUnit(c, crepe, idx.unitsById.u_2, idx);
    expect(rows.map((r) => r.group.id)).toEqual(['lg1', 'lg2']);
    const m = (800 * 1440 * 0.85) / (80 * 39.37);
    expect(rows[0].panna).toBe(1);
    expect(rows[0].loom.mPerDay).toBeCloseTo(m, 6);
    expect(rows[0].loom.warpKg).toBeCloseTo((m * c.warpGpm) / 1000, 6);
    expect(rows[0].total.weftKg).toBeCloseTo((m * c.weftGpm * 24) / 1000, 6);
    const vn = idx.fabricsById.f_vn;
    expect(productionForUnit(fabricCalc(vn, idx), vn, idx.unitsById.u_2, idx).map((r) => r.group.id)).toEqual(['lg1']);
  });
});

describe('TFO output per side', () => {
  it('kg per side per day for each TPM yarn on every TFO type, RPM not doubled', () => {
    const c = fabricCalc(crepe, idx);
    const t = tfoPerSide(c, idx.unitsById.u_2, idx);
    expect(t.map((x) => x.type.id)).toEqual(['tt1', 'tt2']);
    expect(t[0].yarns[0].sides).toEqual(['weft']);
    expect(t[0].yarns[0].kgPerSide).toBeCloseTo((18000 / 2000) * 1440 * 0.9 * (75 / 9e6) * 252, 6);
    expect(t[1].yarns[0].kgPerSide).toBeCloseTo((21000 / 2000) * 1440 * 0.9 * (75 / 9e6) * 252, 6);
    expect(t[0].eff).toBe(90);
    expect(tfoPerSide(c, idx.unitsById.u_caj, idx)).toEqual([]);
  });
  it('a yarn on warp and weft is one line', () => {
    const g = idx.fabricsById.f_geo;
    const t = tfoPerSide(fabricCalc(g, idx), idx.unitsById.u_2, idx);
    expect(t[0].yarns.length).toBe(1);
    expect(t[0].yarns[0].sides).toEqual(['warp', 'weft']);
  });
});
