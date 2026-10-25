// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildIndex, fabricCalc } from './calc.js';
import {
  computePlan, emptyPlan, fitsGroup, gPerSpindleHour, groupOptions, keys, kgPerSide, linesToPlan, masterLoomRpm,
  metresPerDay, planSig, planToLines, qualities, qualityIndex, qualityLines, cleanPlan, setting, withSetting, todayIst, defaultPlanName,
} from './planner.js';

// Shaped like Weavelon 2 on 25 Oct 2026 (constructions and machines; prices are made up).
function tables() {
  return {
    Units: [{ id: 'u2', name: 'Weavelon 2', cost_per_pick: 0.21, has_tfo: true, tfo_default_eff: 85, loom_eff_pct: 93 }],
    LoomGroups: [
      { id: 'g190p', unit_id: 'u2', make: 'Toyota', reed_width_cm: 190, shedding: 'Plain', looms: 16 },
      { id: 'g190d', unit_id: 'u2', make: 'Toyota', reed_width_cm: 190, shedding: 'Dobby', looms: 24 },
      { id: 'g280p', unit_id: 'u2', make: 'Toyota', reed_width_cm: 280, shedding: 'Plain', looms: 18 },
      { id: 'g280d', unit_id: 'u2', make: 'Toyota', reed_width_cm: 280, shedding: 'Dobby', looms: 14 },
    ],
    TfoTypes: [
      { id: 'tOld', unit_id: 'u2', name: 'Old machines (1-12)', machines: 12, spindles_per_side: 252, efficiency: 80 },
      { id: 'tNew', unit_id: 'u2', name: 'New machines (13-16)', machines: 4, spindles_per_side: 252, efficiency: '' },
    ],
    Yarns: [
      { id: 'b6008', name: '60/08', kind: 'base', count: 60, count_unit: 'D' },
      { id: 'y6008', name: '60/08 1109 TPM', kind: 'tpm', base_yarn_id: 'b6008', count: 62, count_unit: 'D', tpm: 1109 },
      { id: 'b6024', name: '60/24 VISCOSE', kind: 'base', count: 60, count_unit: 'D' },
      { id: 'y1650', name: '60/24 VISCOSE 1650 TPM', kind: 'tpm', base_yarn_id: 'b6024', count: 65, count_unit: 'D', tpm: 1650 },
      { id: 'yNoCnt', name: '60/24 1650 no count', kind: 'tpm', base_yarn_id: 'b6024', tpm: 1650 },
      { id: 'sized', name: '60/24 SIZED', kind: 'base', count: 60, count_unit: 'D' },
      { id: 'vsf30', name: '30 VSF', kind: 'base', count: 30, count_unit: 'Ne' },
      { id: 'taspa', name: 'TASPA BEAM', kind: 'base' },
    ],
    YarnRates: [
      { id: 'r1', yarn_id: 'b6024', rate: 678, effective_date: '2026-10-20' },
      { id: 'r2', yarn_id: 'sized', rate: 742, effective_date: '2026-10-20' },
      { id: 'r3', yarn_id: 'b6008', rate: 725, effective_date: '2026-10-20' },
    ],
    TfoSpeeds: [
      { id: 's1', unit_id: 'u2', tfo_type_id: 'tOld', yarn_id: 'y1650', rpm: 20000 },
      { id: 's2', unit_id: 'u2', tfo_type_id: 'tNew', yarn_id: 'y1650', rpm: 18000 },
      { id: 's3', unit_id: 'u2', tfo_type_id: 'tOld', yarn_id: 'y6008', rpm: 20000 },
    ],
    Fabrics: [
      { id: 'nc53', name: 'Natural Crape', weave: 'Plain', ppi: 80, reed_space_in: 52.5, warp_shortage_pct: 10, weft_shortage_pct: 10, price: 82, finish: 'Greige', loom_rpm: 1026, loom_rpm_dp: 672, vatav_pct: 5 },
      { id: 'nc53r', name: 'Natural Crape', weave: 'Plain', ppi: 80, reed_space_in: 52.5, warp_shortage_pct: 10, weft_shortage_pct: 10, price: 99, finish: 'RFD', rfd_shortage_pct: 6.33, processing_charge: 5.25, brokering_pct: 1, transport_charge: 0.5, loom_rpm: 1026, loom_rpm_dp: 672, vatav_pct: 5 },
      { id: 'nc74', name: 'Natural Crape', weave: 'Plain', ppi: 80, reed_space_in: 74, warp_shortage_pct: 10, weft_shortage_pct: 10, price: 125, finish: 'Greige', loom_rpm: 1041 },
      { id: 'gajji', name: 'Gajji Silk', weave: 'Dobby', ppi: 76, reed_space_in: 64, price: 128, finish: 'Greige', loom_rpm: 998, loom_rpm_dp: 700 },
      { id: 'glassR', name: 'Glass', weave: 'Plain', ppi: 80, reed_space_in: 50, warp_shortage_pct: 10, weft_shortage_pct: 10, price: 75, finish: 'RFD', rfd_shortage_pct: 4.14, processing_charge: 4.25, brokering_pct: 1 },
      { id: 'cotton', name: 'Cotton Plain', weave: 'Plain', ppi: 60, reed_space_in: 54, finish: 'Greige', loom_rpm: 900, loom_eff_pct: 90 },
    ],
    FabricYarns: [
      { id: 'l1', fabric_id: 'nc53', side: 'warp', yarn_id: 'sized', ends: 7000, sort: 1 },
      { id: 'l2', fabric_id: 'nc53', side: 'weft', yarn_id: 'y1650', parts: 1, sort: 2 },
      { id: 'l3', fabric_id: 'nc53r', side: 'warp', yarn_id: 'sized', ends: 7000, sort: 1 },
      { id: 'l4', fabric_id: 'nc53r', side: 'weft', yarn_id: 'y1650', parts: 1, sort: 2 },
      { id: 'l5', fabric_id: 'nc74', side: 'warp', yarn_id: 'sized', ends: 9940, sort: 1 },
      { id: 'l6', fabric_id: 'nc74', side: 'weft', yarn_id: 'y1650', parts: 1, sort: 2 },
      { id: 'l7', fabric_id: 'gajji', side: 'warp', yarn_id: 'sized', ends: 12920, sort: 1 },
      { id: 'l8', fabric_id: 'gajji', side: 'weft', yarn_id: 'vsf30', parts: 1, sort: 2 },
      { id: 'l9', fabric_id: 'glassR', side: 'warp', yarn_id: 'y6008', ends: 4472, sort: 1 },
      { id: 'l10', fabric_id: 'glassR', side: 'weft', yarn_id: 'y6008', parts: 1, sort: 2 },
      { id: 'l11', fabric_id: 'cotton', side: 'warp', yarn_id: 'taspa', ends: 5000, sort: 1 },
      { id: 'l12', fabric_id: 'cotton', side: 'weft', yarn_id: 'vsf30', parts: '', sort: 2 },
      { id: 'l13', fabric_id: 'cotton', side: 'weft', yarn_id: 'sized', parts: 2, sort: 3 },
    ],
    Assignments: [{ id: 'a1', fabric_id: 'nc53r', unit_id: 'u2' }],
    TfoSpeedsExtra: [],
  };
}

const idx = buildIndex(tables());
const g = (id) => idx.tables.LoomGroups.find((x) => x.id === id);
const q = (id) => qualityIndex(idx).byMember[id];
const rowsOf = (m, gid) => m.groups.find((b) => b.group.id === gid).rows;

describe('check values', () => {
  it('60/08 1109 TPM (62 D), 20,000 RPM, 80% → 5.96 g per spindle per hour', () => {
    expect(gPerSpindleHour(20000, 1109, 80, 62)).toBeCloseTo(5.96, 2);
  });
  it('60/24 VISCOSE 1650 TPM (65 D), 20,000 RPM, 80%, 252 spindles → 25.4 kg per side per day', () => {
    expect(kgPerSide(20000, 1650, 80, 65, 252)).toBeCloseTo(25.41, 2);
  });
  it('Natural Crape 53 on 190 cm at 1026 RPM, 93%, 80 PPI → 436 m per loom per day', () => {
    const m = computePlan({ ...emptyPlan('u2'), looms: [{ fabricId: 'nc53', groupId: 'g190p', looms: '1' }] }, idx);
    const row = m.groups.find((b) => b.group.id === 'g190p').rows[0];
    expect(row.panna).toBe(1);
    expect(row.rpm.value).toBe(1026);
    expect(row.eff.value).toBe(93);
    expect(Math.round(row.mPerDay)).toBe(436);
    expect(metresPerDay(1026, 93, 80, 1)).toBeCloseTo(436.25, 2);
  });
});

describe('qualities and loom groups', () => {
  it('a greige fabric and its RFD copy are one quality; RFD-only stands alone', () => {
    const list = qualities(idx);
    const nc = list.find((x) => x.id === 'nc53');
    expect(nc.both).toBe(true);
    expect(nc.rfd.id).toBe('nc53r');
    expect(nc.label).toBe('Natural Crape 53');
    expect(list.find((x) => x.id === 'glassR').label).toBe('Glass 50 (RFD)');
    expect(list.some((x) => x.id === 'nc53r')).toBe(false);
  });

  it('Natural Crape 74 on 280 cm: single panna, the 280 cm RPM (not doubled), blank in master needs entry', () => {
    expect(fitsGroup(q('nc74'), g('g280p'))).toBe(true);
    expect(masterLoomRpm(q('nc74'), g('g280p'))).toBeNull();
    const m = computePlan({ ...emptyPlan('u2'), looms: [{ fabricId: 'nc74', groupId: 'g280p', looms: '2' }] }, idx);
    const row = m.groups.find((b) => b.group.id === 'g280p').rows[0];
    expect(row.panna).toBe(1);
    expect(row.rpm.missing).toBe(true);
    expect(row.mPerDay).toBeNull();
    expect(m.notes.needRpm.map((r) => r.fabricId)).toEqual(['nc74']);
    // with an RPM entered, a single panna 280 cm loom is not doubled
    const p2 = withSetting({ ...emptyPlan('u2'), looms: [{ fabricId: 'nc74', groupId: 'g280p', looms: '2' }] }, keys.rpm('nc74', 'g280p'), '700', null);
    const r2 = computePlan(p2, idx).groups.find((b) => b.group.id === 'g280p').rows[0];
    expect(r2.mPerDay).toBeCloseTo(metresPerDay(700, 93, 80, 1), 6);
  });

  it('Natural Crape 53 on 280 cm weaves double panna at loom_rpm_dp', () => {
    const m = computePlan({ ...emptyPlan('u2'), looms: [{ fabricId: 'nc53', groupId: 'g280p', looms: '1' }] }, idx);
    const row = m.groups.find((b) => b.group.id === 'g280p').rows[0];
    expect(row.panna).toBe(2);
    expect(row.rpm.value).toBe(672);
    expect(row.mPerDay).toBeCloseTo(metresPerDay(672, 93, 80, 1) * 2, 6);
  });

  it('a dobby fabric is not offered under plain groups; plain fabrics appear under both', () => {
    const list = qualities(idx);
    expect(fitsGroup(q('gajji'), g('g190p'))).toBe(false);
    expect(fitsGroup(q('gajji'), g('g190d'))).toBe(true);
    const plain = groupOptions(list, g('g190p'), idx);
    const dobby = groupOptions(list, g('g190d'), idx);
    const ids = (o) => [...o.tpm, ...o.other].map((x) => x.id);
    expect(ids(plain)).not.toContain('gajji');
    expect(ids(dobby)).toContain('gajji');
    expect(ids(dobby)).toContain('nc53');
    // TPM users come first
    expect(plain.tpm.map((x) => x.id)).toContain('nc53');
    expect(plain.other.map((x) => x.id)).toContain('cotton');
    // "Assigned to this unit only": the RFD copy's assignment counts for the quality
    expect(ids(groupOptions(list, g('g190p'), idx, { assignedOnly: true, unitId: 'u2' }))).toEqual(['nc53']);
  });

  it('loom efficiency: the fabric’s own, else the unit’s', () => {
    const m = computePlan({ ...emptyPlan('u2'), looms: [{ fabricId: 'cotton', groupId: 'g190p', looms: '1' }] }, idx);
    expect(rowsOf(m, 'g190p')[0].eff.value).toBe(90);
  });
});

describe('yarn', () => {
  it('Ne → denier with 5315 ÷ Ne; a TPM yarn with no count takes its base yarn’s denier', () => {
    const lines = qualityLines(q('gajji'), idx);
    expect(lines.find((l) => l.side === 'weft').denier).toBeCloseTo(5315 / 30, 6);
    const t = buildIndex({ ...tables(), FabricYarns: [...tables().FabricYarns, { id: 'lx', fabric_id: 'nc74', side: 'weft', yarn_id: 'yNoCnt', parts: 1, sort: 3 }] });
    const lx = qualityLines(qualityIndex(t).byMember.nc74, t).find((l) => l.line.id === 'lx');
    expect(lx.denier).toBe(60);
  });

  it('blank weft parts take the average of the others; shortage blank = 10%', () => {
    const lines = qualityLines(q('cotton'), idx);
    const vsf = lines.find((l) => l.line.id === 'l12');
    const sized = lines.find((l) => l.line.id === 'l13');
    // parts blank → 2 (average of the one given), so each weft has half the pick
    expect(vsf.gpm / (5315 / 30)).toBeCloseTo(sized.gpm / 60, 8);
    expect(sized.gpm).toBeCloseTo(((60 * 0.5 * 54 * 60) / 9000) * 1.1, 8);
  });

  it('a yarn with no usable count is listed and left out of kg', () => {
    const m = computePlan({ ...emptyPlan('u2'), looms: [{ fabricId: 'cotton', groupId: 'g190p', looms: '3' }] }, idx);
    expect(m.notes.noCount.map((y) => y.name)).toEqual(['TASPA BEAM']);
    expect(m.consumption.some((c) => c.yarn.id === 'taspa')).toBe(false);
    expect(m.consumption.find((c) => c.yarn.id === 'vsf30').weft).toBeGreaterThan(0);
  });

  it('consumption counts every yarn, TPM warp included, and balances TPM yarns in kg', () => {
    const plan = {
      ...emptyPlan('u2'),
      looms: [{ fabricId: 'nc53', groupId: 'g190p', looms: '10' }, { fabricId: 'glassR', groupId: 'g190p', looms: '2' }],
      sides: [{ yarnId: 'y1650', typeId: 'tOld', sides: '4' }],
      receipts: [{ yarnId: 'y1650', kg: '20' }],
      settings: { 'rpm:glassR:g190p': 1000 },
    };
    const m = computePlan(plan, idx);
    const nc = rowsOf(m, 'g190p')[0];
    const ncLines = qualityLines(q('nc53'), idx);
    const weft1650 = (10 * nc.mPerDay * ncLines.find((l) => l.side === 'weft').gpm) / 1000;
    const c1650 = m.consumption.find((c) => c.yarn.id === 'y1650');
    expect(c1650.weft).toBeCloseTo(weft1650, 6);
    expect(m.consumption.find((c) => c.yarn.id === 'sized').warp).toBeGreaterThan(0);
    // Glass has TPM warp: always consumption
    expect(m.consumption.find((c) => c.yarn.id === 'y6008').warp).toBeGreaterThan(0);
    const b = m.balance.find((x) => x.yarn.id === 'y1650');
    expect(b.output).toBeCloseTo(4 * kgPerSide(20000, 1650, 80, 65, 252), 6);
    expect(b.received).toBe(20);
    expect(b.balance).toBeCloseTo(b.output + 20 - weft1650, 6);
    expect(m.balance.some((x) => x.yarn.id === 'sized')).toBe(false);
    expect(m.totals.net).toBeCloseTo(m.balance.reduce((s, x) => s + x.balance, 0), 6);
  });

  it('TFO efficiency: the type’s, else the unit default; sides available = machines × 2; a yarn with no speed needs an RPM', () => {
    const m = computePlan({ ...emptyPlan('u2'), sides: [{ yarnId: 'y6008', typeId: 'tNew', sides: '2' }] }, idx);
    const neu = m.types.find((t) => t.type.id === 'tNew');
    expect(neu.eff.value).toBe(85);
    expect(neu.avail.value).toBe(8);
    expect(neu.perSide).toBe(252);
    expect(neu.rows[0].rpm.missing).toBe(true);
    expect(neu.rows[0].output).toBeNull();
    expect(m.types.find((t) => t.type.id === 'tOld').avail.value).toBe(24);
    expect(m.types.map((t) => t.type.id)).toEqual(['tOld', 'tNew']);
  });
});

describe('realisation', () => {
  it('a row’s ₹/loom/day = realisation per pick × m/day × PPI; RFD toggle uses the RFD record', () => {
    const base = { ...emptyPlan('u2'), looms: [{ fabricId: 'nc53', groupId: 'g190p', looms: '4' }] };
    const row = rowsOf(computePlan(base, idx), 'g190p')[0];
    const greige = fabricCalc(idx.fabricsById.nc53, idx);
    expect(row.soldAs).toBe('greige');
    expect(row.realPerLoom).toBeCloseTo(greige.realisationNetPerPick * row.mPerDay * 80, 6);
    const rfd = rowsOf(computePlan({ ...base, soldAs: { 'nc53:g190p': 'rfd' } }, idx), 'g190p')[0];
    const rc = fabricCalc(idx.fabricsById.nc53r, idx);
    expect(rfd.soldAs).toBe('rfd');
    expect(rfd.realPerLoom).toBeCloseTo(rc.realisationNetPerPick * rfd.mPerDay * 80, 6);
  });

  it('plant total, average per loom and average per pick weighted by output', () => {
    const plan = {
      ...emptyPlan('u2'),
      looms: [{ fabricId: 'nc53', groupId: 'g190p', looms: '4' }, { fabricId: 'nc53', groupId: 'g280p', looms: '3' }, { fabricId: 'cotton', groupId: 'g190d', looms: '5' }],
    };
    const m = computePlan(plan, idx);
    const rows = m.groups.flatMap((b) => b.rows).filter((r) => r.realPerLoom !== null);
    const total = rows.reduce((s, r) => s + r.looms * r.realPerLoom, 0);
    const looms = rows.reduce((s, r) => s + r.looms, 0);
    const picks = rows.reduce((s, r) => s + r.looms * r.mPerDay * r.ppi, 0);
    expect(m.totals.plantRealisation).toBeCloseTo(total, 6);
    expect(m.totals.avgLoomRealisation).toBeCloseTo(total / looms, 6);
    expect(m.totals.avgPerPick).toBeCloseTo(total / picks, 8);
    // cotton has no price: left out and listed
    expect(m.notes.noReal.map((r) => r.fabricId)).toEqual(['cotton']);
    expect(m.totals.looms).toBe(12);
  });
});

describe('settings and saved plans', () => {
  it('a setting equal to master is not stored; reset removes it', () => {
    let p = emptyPlan('u2');
    p = withSetting(p, keys.rpm('nc53', 'g190p'), '1026', 1026);
    expect(p.settings).toEqual({});
    p = withSetting(p, keys.rpm('nc53', 'g190p'), '1050', 1026);
    expect(p.settings).toEqual({ 'rpm:nc53:g190p': 1050 });
    expect(setting(p, keys.rpm('nc53', 'g190p'), 1026)).toMatchObject({ value: 1050, edited: true, master: 1026 });
    p = withSetting(p, keys.rpm('nc53', 'g190p'), '', 1026);
    expect(p.settings).toEqual({});
    expect(setting(p, keys.rpm('nc53', 'g190p'), 1026)).toMatchObject({ value: 1026, edited: false });
  });

  it('round-trips a plan through the lines format', () => {
    const plan = {
      ...emptyPlan('u2'),
      looms: [{ fabricId: 'nc53', groupId: 'g190p', looms: '10' }, { fabricId: 'nc74', groupId: 'g280p', looms: '' }],
      sides: [{ yarnId: 'y1650', typeId: 'tOld', sides: '6' }],
      receipts: [{ yarnId: 'y6008', kg: '12.5' }],
      settings: { 'rpm:nc74:g280p': 700, 'tfoEff:tNew': 70, 'avail:tOld': 22 },
      soldAs: { 'nc53:g190p': 'rfd' },
    };
    const lines = planToLines(plan).map((l, i) => ({ ...l, sort: i + 1, id: `bl_${i}`, plan_id: 'bp_1' }));
    expect(lines.every((l) => typeof l.value === 'string')).toBe(true);
    const back = linesToPlan('u2', lines.slice().reverse());
    expect(back).toEqual(plan);
    expect(planSig(back)).toBe(planSig(plan));
    expect(planSig({ ...plan, looms: [] })).not.toBe(planSig(plan));
  });

  it('opening a plan drops rows whose fabric, group, yarn or type is gone and moves RFD refs to the quality', () => {
    const p = cleanPlan({
      ...emptyPlan('u2'),
      looms: [{ fabricId: 'nc53r', groupId: 'g190p', looms: '3' }, { fabricId: 'gone', groupId: 'g190p', looms: '1' }, { fabricId: 'nc74', groupId: 'lg_gone', looms: '1' }],
      sides: [{ yarnId: 'y1650', typeId: 'tGone', sides: '1' }, { yarnId: 'y1650', typeId: 'tOld', sides: '1' }],
      receipts: [{ yarnId: 'nope', kg: '1' }],
    }, idx);
    expect(p.looms).toEqual([{ fabricId: 'nc53', groupId: 'g190p', looms: '3' }]);
    expect(p.sides).toEqual([{ yarnId: 'y1650', typeId: 'tOld', sides: '1' }]);
    expect(p.receipts).toEqual([]);
  });

  it('dates and names', () => {
    expect(defaultPlanName('2026-10-25')).toBe('Plan 25 Oct 2026');
    expect(todayIst(new Date('2026-10-25T20:00:00Z'))).toBe('2026-10-26');
    expect(todayIst(new Date('2026-10-25T10:00:00Z'))).toBe('2026-10-25');
  });
});
