import { describe, it, expect } from 'vitest';
import { sampleTables } from './sampleData.js';
import { buildIndex } from './calc.js';
import { beamRowsOf, beamSlots, planCalc, planLines, planVerdict, plansOf, typeCapacity } from './planner.js';

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
    // weft only: all three yarns have more spindles given out than needed
    expect(planVerdict(pc).kind).toBe('good');
    expect(planVerdict(pc).text).toBe('Surplus 1,077 spindles');
    expect(pc.yarnRows[0].yarn.id).toBe('y_tpm75'); // smallest balance first
    expect(pc.yarnRows[0].balanceSpindles).toBeCloseTo(115.76, 1);
    expect(pc.yarnRows[0].balanceKg).toBeCloseTo(11.25, 1);
  });
});

describe('running yarn requirement (weft only)', () => {
  it('lists only the weft yarn on the planned looms, TPM or not', () => {
    const idx = idxOf();
    const pc = planCalc(plan, { looms: [{ loom_group_id: 'lg2', fabric_id: 'f_crepe', looms: 20, panna: 1 }], tfo: [], outside: [] }, idx);
    const m = crepeMPerLoom * 20;
    const weft = pc.runningRows.find((r) => r.yarn.id === 'y_tpm75');
    expect(pc.runningRows).toHaveLength(1); // the 75D FDY warp is left out
    expect(pc.runningRows.find((r) => r.yarn.id === 'y_fdy75')).toBeUndefined();
    expect(weft.tpm).toBe(true);
    expect(weft.weft).toBeCloseTo((m * crepeWeftGpm) / 1000, 6);
    expect(weft.base.id).toBe('y_fdy75');
    expect(weft.spindles).toBeCloseTo(weft.total / q75, 6);
    expect(pc.totals.running).toBeCloseTo(weft.total, 6);
  });

  it('adds the same weft yarn from different fabrics and keeps outside yarn off the TPM net', () => {
    const idx = idxOf();
    const pc = planCalc(plan, {
      looms: [{ loom_group_id: 'lg2', fabric_id: 'f_crepe', looms: 10 }, { loom_group_id: 'lg2', fabric_id: 'f_pv', looms: 10, rpm: 600 }],
      tfo: [],
      outside: [{ yarn_id: 'y_tpm75', kg_per_day: 30 }],
    }, idx);
    const fdy = pc.runningRows.find((r) => r.yarn.id === 'y_fdy75');
    expect(fdy.weft).toBeGreaterThan(0); // PV weft
    expect(fdy.fabrics).toEqual(['PV Plain 60']);
    const tpm = pc.runningRows.find((r) => r.yarn.id === 'y_tpm75');
    expect(tpm.outside).toBe(30);
    expect(tpm.net).toBeCloseTo(tpm.total - 30, 9);
  });
});

describe('weft only, with yarn stock on hand', () => {
  const looms = [{ loom_group_id: 'lg1', fabric_id: 'f_geo', looms: 10 }];
  const run = (lines) => planCalc(plan, { outside: [], tfo: [], stock: [], looms, ...lines }, idxOf());
  const yarn60 = (lines) => run(lines).yarnRows.find((r) => r.yarn.id === 'y_tpm60');

  it('leaves warp yarn out: demand is the weft yarn only', () => {
    const pc = run({});
    const y = pc.yarnRows.find((r) => r.yarn.id === 'y_tpm60');
    const c = pc.loomRows[0].calc;
    const weftKg = c.tpmLines.filter((l) => l.line.side !== 'warp').reduce((sum, l) => sum + (pc.loomRows[0].mPerDay * l.gpm) / 1000, 0);
    const allKg = c.tpmLines.reduce((sum, l) => sum + (pc.loomRows[0].mPerDay * l.gpm) / 1000, 0);
    expect(allKg).toBeGreaterThan(weftKg); // Georgette has TPM warp too
    expect(y.demand).toBeCloseTo(weftKg, 6);
    expect(y.warp).toBeUndefined();
    expect(y.requiredWarp).toBeUndefined();
  });

  it('shows the balance in both spindles and kg/day', () => {
    const base = yarn60({});
    const y = yarn60({ tfo: [{ tfo_type_id: 'tt1', yarn_id: 'y_tpm60', sides: 2 }] });
    expect(y.balanceSpindles).toBeCloseTo(2 * 252 - base.required, 6);
    expect(y.balanceKg).toBeCloseTo(y.allocKg - y.net, 9);
    expect(y.balanceKg / y.qRef).toBeCloseTo(y.balanceSpindles, 6);
  });

  it('keeps stock out of the spindles needed and shows how many days it lasts', () => {
    const base = yarn60({});
    const y = yarn60({ stock: [{ yarn_id: 'y_tpm60', qty: 100 }], outside: [{ yarn_id: 'y_tpm60', kg_per_day: 10 }] });
    expect(y.stock).toBe(100);
    expect(y.net).toBeCloseTo(base.demand - 10, 6);
    expect(y.required).toBeCloseTo((base.demand - 10) / base.qRef, 6); // stock does not change it
    expect(y.stockDays).toBeCloseTo(100 / (base.demand - 10), 9);
    const pc = run({ stock: [{ yarn_id: 'y_tpm60', qty: 100 }] });
    expect(pc.stockYarnRows[0].days).toBeCloseTo(100 / base.demand, 9);
    // no stock: no days
    expect(base.stockDays).toBeNull();
    // outside yarn covers all the demand: the stock is not needed
    expect(yarn60({ stock: [{ yarn_id: 'y_tpm60', qty: 5 }], outside: [{ yarn_id: 'y_tpm60', kg_per_day: base.demand + 5 }] }).stockDays).toBe(Infinity);
  });

  it('flags a stock line that is not a TPM yarn', () => {
    const pc = run({ stock: [{ yarn_id: 'y_fdy75', qty: 5 }] });
    expect(pc.stockYarnRows[0].problems.join(' ')).toMatch(/not a TPM yarn/);
  });
});

describe('looms available per group', () => {
  it('counts looms planned against looms in the group', () => {
    const idx = idxOf();
    const pc = planCalc(plan, { looms: [{ loom_group_id: 'lg2', fabric_id: 'f_crepe', looms: 25 }, { loom_group_id: 'lg2', fabric_id: 'f_moss', looms: 10 }], tfo: [], outside: [] }, idx);
    const g2 = pc.groupUse.find((u) => u.group.id === 'lg2');
    const g1 = pc.groupUse.find((u) => u.group.id === 'lg1');
    expect(g2).toMatchObject({ planned: 35, have: 40, free: 5 });
    expect(g2.rows).toHaveLength(2);
    expect(g1).toMatchObject({ planned: 0, have: 24, free: 24 });
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

describe('beam length', () => {
  it('lists every loom group of the assigned units, blank when not set', () => {
    const idx = idxOf();
    const rows = beamRowsOf('f_geo', idx);
    expect(rows.map((r) => [r.group.id, r.length])).toEqual([['lg1', 4000], ['lg2', null]]);
    expect(beamRowsOf('f_moss', idx).find((r) => r.group.id === 'lg2').length).toBe(6000);
  });

  it('a dobby fabric sees dobby looms only; other fabrics share one length across plain and dobby of a width', () => {
    const t = sampleTables();
    t.LoomGroups.push({ id: 'lg3', unit_id: 'u_2', make: 'Toyota', reed_width_cm: 190, shedding: 'Plain', looms: 8 });
    const idx = idxOf(t);
    const dobby = beamSlots('Dobby', ['u_2'], idx);
    expect(dobby.map((x) => x.groupIds)).toEqual([['lg1']]);
    const plain = beamSlots('Plain', ['u_2'], idx);
    expect(plain.map((x) => x.groupIds.sort())).toEqual([['lg1', 'lg3'], ['lg2']]);
  });
});
