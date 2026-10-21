import { describe, it, expect } from 'vitest';
import { sampleTables } from './sampleData.js';
import { buildIndex } from './calc.js';
import { planCalc, planLines, planVerdict, plansOf, typeCapacity } from './planner.js';

const idxOf = (t = sampleTables()) => buildIndex(t);
const plan = { id: 'x', unit_id: 'u_2', plan_date: '2026-10-21' };

// Poly Crepe 60: PPI 80, RS 60, weft 75D TPM, weft shortage 2%, loom RPM 800; unit loom efficiency 85%.
const crepeWeftGpm = (80 * 60 * 75 / 9000) * 1.02; // 40.8 g/m
const crepeMPerLoom = (800 * 1440 * 0.85) / (80 * 39.37);
// 75D TPM 2000 on M/C 1–12: RPM 18000 (already × 2), 90%
const q75 = (18000 / 2000) * 1440 * 0.9 * (75 / 9000000);

describe('planCalc', () => {
  it('turns looms into kg/day of each TPM yarn', () => {
    const idx = idxOf();
    const pc = planCalc(plan, { looms: [{ loom_group_id: 'lg2', fabric_id: 'f_crepe', looms: 20, panna: 1 }], tfo: [], outside: [] }, idx);
    const y = pc.yarnRows.find((r) => r.yarn.id === 'y_tpm75');
    expect(pc.loomRows[0].mPerDay).toBeCloseTo(crepeMPerLoom * 20, 6);
    expect(y.demand).toBeCloseTo((crepeMPerLoom * 20 * crepeWeftGpm) / 1000, 6);
    expect(y.weft).toBeCloseTo(y.demand, 9);
    expect(y.warp).toBe(0);
    // nothing given out yet: needed at the first TFO type's speed, all of it short
    expect(y.refType).toBe('M/C 1–12');
    expect(y.required).toBeCloseTo(y.demand / q75, 6);
    expect(y.balanceSpindles).toBeCloseTo(-y.required, 6);
    expect(y.status).toBe('short');
  });

  it('takes outside yarn off before working out spindles', () => {
    const idx = idxOf();
    const looms = [{ loom_group_id: 'lg2', fabric_id: 'f_crepe', looms: 20, panna: 1 }];
    const base = planCalc(plan, { looms, tfo: [], outside: [] }, idx).yarnRows[0];
    const pc = planCalc(plan, { looms, tfo: [], outside: [{ yarn_id: 'y_tpm75', kg_per_day: 50 }] }, idx);
    const y = pc.yarnRows[0];
    expect(y.outside).toBe(50);
    expect(y.net).toBeCloseTo(base.demand - 50, 6);
    expect(y.required).toBeCloseTo((base.demand - 50) / q75, 6);
  });

  it('balances spindles given out against spindles needed', () => {
    const idx = idxOf();
    const pc = planCalc(plan, {
      looms: [{ loom_group_id: 'lg2', fabric_id: 'f_crepe', looms: 20, panna: 1 }],
      tfo: [{ tfo_type_id: 'tt1', yarn_id: 'y_tpm75', sides: 12 }],
      outside: [],
    }, idx);
    const y = pc.yarnRows[0];
    expect(y.allocSpindles).toBe(12 * 252);
    expect(y.allocKg).toBeCloseTo(12 * 252 * q75, 6);
    expect(y.balanceSpindles).toBeCloseTo(12 * 252 - y.demand / q75, 6);
    expect(y.status).toBe('surplus');
    const t1 = pc.typeUse.find((u) => u.type.id === 'tt1');
    expect(t1.sides).toBe(24);
    expect(t1.idle).toBe(12);
  });

  it('uses the given-out mix of TFO types as the output per spindle', () => {
    const idx = idxOf();
    const q75new = (21000 / 2000) * 1440 * 0.9 * (75 / 9000000);
    const pc = planCalc(plan, {
      looms: [],
      tfo: [{ tfo_type_id: 'tt1', yarn_id: 'y_tpm75', sides: 2 }, { tfo_type_id: 'tt2', yarn_id: 'y_tpm75', sides: 2 }],
      outside: [],
    }, idx);
    const y = pc.yarnRows[0];
    expect(y.qRef).toBeCloseTo((q75 + q75new) / 2, 9);
    expect(y.refType).toBe('M/C 1–12 + M/C 13–16');
    expect(y.balanceSpindles).toBeCloseTo(4 * 252, 6);
  });

  it('uses the RPM entered on the plan line and double panna RPM', () => {
    const t = sampleTables();
    Object.assign(t.Fabrics.find((f) => f.id === 'f_crepe'), { loom_rpm_dp: 600, reed_space_in: 54 });
    const idx = idxOf(t);
    const pc = planCalc(plan, {
      looms: [
        { loom_group_id: 'lg2', fabric_id: 'f_crepe', looms: 1, panna: 1, rpm: 700 },
        { loom_group_id: 'lg2', fabric_id: 'f_crepe', looms: 1, panna: 2 },
      ],
      tfo: [],
      outside: [],
    }, idx);
    expect(pc.loomRows[0].rpm).toBe(700);
    expect(pc.loomRows[0].mPerDay).toBeCloseTo((700 * 1440 * 0.85) / (80 * 39.37), 6);
    expect(pc.loomRows[1].rpm).toBe(600);
    expect(pc.loomRows[1].mPerDay).toBeCloseTo(((600 * 1440 * 0.85) / (80 * 39.37)) * 2, 6);
    // 2 × 54″ fits a 280 cm (110″) reed
    expect(pc.loomRows[1].problems).toEqual([]);
  });

  it('flags panels that do not fit the reed, dobby on plain, and over-booked looms and sides', () => {
    const idx = idxOf();
    const pc = planCalc(plan, {
      looms: [
        { loom_group_id: 'lg1', fabric_id: 'f_crepe', looms: 30, panna: 2, rpm: 600 },
        { loom_group_id: 'lg2', fabric_id: 'f_vn', looms: 2, panna: 1, rpm: 600 },
      ],
      tfo: [{ tfo_type_id: 'tt2', yarn_id: 'y_tpm75', sides: 9 }],
      outside: [],
    }, idx);
    expect(pc.loomRows[0].problems.join(' ')).toMatch(/2 × 60″ doesn't fit a 190 cm reed/);
    expect(pc.loomRows[1].problems.join(' ')).toMatch(/Dobby quality on a non-dobby loom/);
    expect(pc.issues.join(' ')).toMatch(/30 looms planned, only 24/);
    expect(pc.issues.join(' ')).toMatch(/M\/C 13–16: 9 sides given out, only 8 on 4 machines/);
  });

  it('says what is missing instead of guessing', () => {
    const t = sampleTables();
    t.TfoSpeeds = t.TfoSpeeds.filter((s) => s.yarn_id !== 'y_tpm60');
    const idx = idxOf(t);
    const pc = planCalc(plan, {
      looms: [{ loom_group_id: 'lg1', fabric_id: 'f_vn', looms: 2 }],
      tfo: [{ tfo_type_id: 'tt1', yarn_id: 'y_tpm60', sides: 1 }],
      outside: [],
    }, idx);
    expect(pc.loomRows[0].problems.join(' ')).toMatch(/No single panna RPM/);
    expect(pc.tfoRows[0].problems.join(' ')).toMatch(/No speed for 60D TPM 2400 S\/Z on M\/C 1–12/);
    const y = pc.yarnRows.find((r) => r.yarn.id === 'y_tpm60');
    expect(y.status).toBe('unknown');
    expect(planVerdict(pc).text).toBe('Data missing');
  });

  it('works out the sample plan', () => {
    const idx = idxOf();
    const p = plansOf(idx, 'u_2')[0];
    const pc = planCalc(p, planLines(idx, p.id), idx);
    expect(pc.loomRows).toHaveLength(3);
    expect(pc.totals.looms).toBe(42);
    expect(pc.totals.capSpindles).toBe(16 * 2 * 252);
    expect(pc.totals.idleSides).toBe(8);
    expect(planVerdict(pc).kind).toBe('bad');
    expect(pc.yarnRows[0].yarn.id).toBe('y_tpm60'); // most short first
  });
});

describe('TFO efficiency', () => {
  it("uses the speed's own, else the TFO type's, else the unit default", () => {
    const t = sampleTables();
    t.TfoSpeeds.forEach((sp) => { sp.efficiency = ''; });
    t.TfoTypes.find((x) => x.id === 'tt2').efficiency = 80;
    const idx = buildIndex(t);
    const lines = { looms: [], tfo: [{ tfo_type_id: 'tt1', yarn_id: 'y_tpm75', sides: 1 }, { tfo_type_id: 'tt2', yarn_id: 'y_tpm75', sides: 1 }], outside: [] };
    const pc = planCalc(plan, lines, idx);
    // tt1 has no efficiency of its own: unit default 90%. tt2: its own 80%.
    expect(pc.tfoRows[0].q).toBeCloseTo((18000 / 2000) * 1440 * 0.9 * (75 / 9000000), 9);
    expect(pc.tfoRows[1].q).toBeCloseTo((21000 / 2000) * 1440 * 0.8 * (75 / 9000000), 9);
    // a speed's own efficiency still wins
    t.TfoSpeeds.find((sp) => sp.id === 'sp2').efficiency = 95;
    const pc2 = planCalc(plan, lines, buildIndex(t));
    expect(pc2.tfoRows[1].q).toBeCloseTo((21000 / 2000) * 1440 * 0.95 * (75 / 9000000), 9);
  });
});

describe('typeCapacity', () => {
  it('has 2 sides a machine and 252 spindles a side unless set', () => {
    expect(typeCapacity({ machines: 12 })).toMatchObject({ sides: 24, spindles: 6048, perSide: 252 });
    expect(typeCapacity({ machines: 4, spindles_per_side: 240 })).toMatchObject({ sides: 8, spindles: 1920 });
    expect(typeCapacity({}).sides).toBeNull();
  });
});
