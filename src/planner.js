// TFO planner. Pure functions over a dated plan and the master data.
//
// A plan says, for one unit on one date:
//   - looms: how many looms of each loom group run which fabric (single or double panna, optional RPM)
//   - TFO:   how many sides of each TFO type run which twisted (TPM) yarn
//   - outside: twisted yarn bought in, kg per day
// From that it works out, per TPM yarn:
//   demand kg/day (looms) − outside kg/day = net kg/day to twist here
//   spindles needed = net ÷ output per spindle-day
//   balance = spindles given out − spindles needed (+ surplus, − deficit)
//
// The planner is for weft only: every TFO side runs weft yarn, so warp yarn is left out of the demand.
// Yarn stock is twisted yarn on hand, total kg. It does not change the spindles needed; the plan shows
// how many days it lasts at the planned weft usage (stock ÷ net kg/day).
//
// Conventions: TFO RPM is entered already × 2 (tfoOutput does not double it). Loom efficiency is the unit's.
// TFO efficiency: the speed's own, else the TFO type's, else the unit default.
// Every TFO machine has 2 sides; each side runs one yarn quality. Spindles per side default to 252.
import { fabricCalc, isTpm, num, tfoEff, tfoOutput, truthy, yarnDenier } from './calc.js';

export const SIDES_PER_MACHINE = 2;
export const DEFAULT_SPINDLES_PER_SIDE = 252;
const IN_PER_M = 39.37;
const MIN_PER_DAY = 1440;
const CM_PER_IN = 2.54;

export const spindlesPerSide = (type) => num(type && type.spindles_per_side) ?? DEFAULT_SPINDLES_PER_SIDE;

// Sides and spindles a TFO type has in total. Null when the machine count isn't set.
export function typeCapacity(type) {
  const machines = num(type && type.machines);
  if (machines === null) return { machines: null, sides: null, spindles: null, perSide: spindlesPerSide(type) };
  const sides = machines * SIDES_PER_MACHINE;
  return { machines, sides, spindles: sides * spindlesPerSide(type), perSide: spindlesPerSide(type) };
}

export function unitHasPlanner(unit, idx) {
  return !!unit && truthy(unit.has_tfo) && (idx.tfoTypesByUnit[unit.id] || []).length > 0;
}

// Plans of a unit (or all units), newest first.
export function plansOf(idx, unitId) {
  return (idx.tables.TfoPlans || [])
    .filter((p) => !unitId || p.unit_id === unitId)
    .slice()
    .sort((a, b) => String(b.plan_date || '').localeCompare(String(a.plan_date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

// "4.2 days", or "not needed" when there is no weft to twist
export const daysText = (d) => (d === null || d === undefined ? '—' : d === Infinity ? 'no demand' : `${Math.round(d * 10) / 10} ${Math.round(d * 10) / 10 === 1 ? 'day' : 'days'}`);

const bySort = (a, b) => (num(a.sort) ?? 0) - (num(b.sort) ?? 0);

export function planLines(idx, planId) {
  const t = idx.tables;
  return {
    looms: (t.PlanLooms || []).filter((l) => l.plan_id === planId).sort(bySort),
    tfo: (t.PlanTfo || []).filter((l) => l.plan_id === planId).sort(bySort),
    outside: (t.PlanOutside || []).filter((l) => l.plan_id === planId).sort(bySort),
    stock: (t.PlanStock || []).filter((l) => l.plan_id === planId).sort(bySort),
  };
}

export const groupLabel = (g) => (g ? [g.make, num(g.reed_width_cm) ? `${num(g.reed_width_cm)} cm` : null, g.shedding].filter(Boolean).join(' · ') || 'Loom group' : 'Loom group deleted');

// The whole plan worked out. `lines` is { looms, tfo, outside } (saved rows or a draft being edited).
export function planCalc(plan, lines, idx) {
  const unit = idx.unitsById[plan.unit_id] || null;
  const types = (idx.tfoTypesByUnit[plan.unit_id] || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const speeds = idx.speedsByUnit[plan.unit_id] || [];
  const groups = idx.loomGroupsByUnit[plan.unit_id] || [];
  const issues = [];
  const unitEff = num(unit && unit.loom_eff_pct);
  if (unit && unitEff === null) issues.push('Set loom efficiency on the unit to work out loom output.');

  const stockLines = lines.stock || [];

  const calcCache = {};
  const calcOf = (f) => (calcCache[f.id] ||= fabricCalc(f, idx));

  // ---------- looms → yarn demand ----------
  const yarns = new Map();
  const yarnRow = (yarn) => {
    if (!yarns.has(yarn.id)) yarns.set(yarn.id, { yarn, demand: 0, weft: 0, demandKnown: true, fabrics: [], outside: 0, stock: 0, allocSides: 0, allocSpindles: 0, allocKg: 0, allocKnown: true, allocTypes: [] });
    return yarns.get(yarn.id);
  };

  // every weft yarn on the planned looms (TPM or not), kg/day
  const running = new Map();
  const runRow = (yarn) => {
    if (!running.has(yarn.id)) running.set(yarn.id, { yarn, weft: 0, known: true, fabrics: [] });
    return running.get(yarn.id);
  };

  const loomRows = (lines.looms || []).map((line) => {
    const fabric = idx.fabricsById[line.fabric_id] || null;
    const group = groups.find((g) => g.id === line.loom_group_id) || null;
    const looms = num(line.looms) ?? 0;
    const panna = num(line.panna) === 2 ? 2 : 1;
    const out = { line, fabric, group, looms, panna, rpm: null, mPerLoom: null, mPerDay: null, tpm: [], problems: [] };
    if (!fabric) {
      out.problems.push('Choose a fabric');
      return out;
    }
    const c = calcOf(fabric);
    out.calc = c;
    out.rpm = num(line.rpm) ?? num(panna === 2 ? fabric.loom_rpm_dp : fabric.loom_rpm);
    if (!group) out.problems.push('Choose a loom group');
    if (!looms) out.problems.push('Enter the number of looms');
    if (!out.rpm) out.problems.push(`No ${panna === 2 ? 'double' : 'single'} panna RPM on ${fabric.name}. Enter one here or on the fabric.`);
    if (!c.ppi) out.problems.push(`${fabric.name} has no pick`);
    if (group && c.rs) {
      const widthIn = num(group.reed_width_cm) ? num(group.reed_width_cm) / CM_PER_IN : null;
      if (widthIn && c.rs * panna > widthIn + 0.01) out.problems.push(`${panna === 2 ? `2 × ${Math.round(c.rs)}″` : `${Math.round(c.rs)}″`} doesn't fit a ${num(group.reed_width_cm)} cm reed (${Math.round(widthIn)}″)`);
    }
    if (group && String(fabric.weave || '').toLowerCase() === 'dobby' && String(group.shedding || '').toLowerCase() !== 'dobby') out.problems.push('Dobby quality on a non-dobby loom');
    out.mPerLoom = out.rpm && unitEff && c.ppi ? ((out.rpm * MIN_PER_DAY * (unitEff / 100)) / (c.ppi * IN_PER_M)) * panna : null;
    out.mPerDay = out.mPerLoom !== null ? out.mPerLoom * looms : null;
    const kgOf = (x) => (out.mPerDay === null || x.gpm === null ? null : (out.mPerDay * x.gpm) / 1000);
    for (const x of c.weft) {
      if (!x.yarn) continue;
      const kg = kgOf(x);
      const r = runRow(x.yarn);
      if (kg === null) r.known = false;
      else r.weft += kg;
      if (!r.fabrics.includes(fabric.name)) r.fabrics.push(fabric.name);
    }
    for (const x of c.tpmLines.filter((l) => l.line.side !== 'warp')) {
      const kg = kgOf(x);
      out.tpm.push({ yarn: x.yarn, side: x.line.side, kg });
      const y = yarnRow(x.yarn);
      if (kg === null) y.demandKnown = false;
      else {
        y.demand += kg;
        y.weft += kg;
      }
      if (!y.fabrics.includes(fabric.name)) y.fabrics.push(fabric.name);
    }
    return out;
  });

  // loom groups: looms planned vs looms on the floor
  const groupUse = groups.map((g) => {
    const planned = loomRows.filter((r) => r.group && r.group.id === g.id).reduce((s, r) => s + r.looms, 0);
    const have = num(g.looms);
    return { group: g, planned, have, free: have === null ? null : have - planned, rows: loomRows.filter((r) => r.group && r.group.id === g.id) };
  });
  for (const u of groupUse) if (u.free !== null && u.free < 0) issues.push(`${groupLabel(u.group)}: ${u.planned} looms planned, only ${u.have} on the floor.`);

  // ---------- outside yarn ----------
  const outsideRows = (lines.outside || []).map((line) => {
    const yarn = idx.yarnsById[line.yarn_id] || null;
    const kg = num(line.kg_per_day);
    if (yarn && kg !== null) yarnRow(yarn).outside += kg;
    return { line, yarn, kg, problems: yarn ? (kg === null ? ['Enter kg per day'] : []) : ['Choose a yarn'] };
  });

  // ---------- stock ----------
  const stockYarnRows = stockLines.map((line) => {
    const yarn = idx.yarnsById[line.yarn_id] || null;
    const kg = num(line.qty);
    if (yarn && kg !== null) yarnRow(yarn).stock += kg;
    const problems = yarn ? (kg === null ? ['Enter kg in stock'] : isTpm(yarn) ? [] : [`${yarn.name} is not a TPM yarn`]) : ['Choose a yarn'];
    return { line, yarn, kg, problems };
  });

  // ---------- TFO sides given out ----------
  const speedFor = (typeId, yarnId) => speeds.find((s) => s.tfo_type_id === typeId && s.yarn_id === yarnId) || null;
  const outputFor = (type, yarn) => {
    const sp = type && yarn ? speedFor(type.id, yarn.id) : null;
    if (!sp) return { speed: null, q: null };
    const eff = tfoEff(sp, type, unit);
    return { speed: sp, q: tfoOutput(sp.rpm, yarn.tpm, eff, yarnDenier(yarn, idx)) };
  };
  const tfoRows = (lines.tfo || []).map((line) => {
    const type = types.find((t) => t.id === line.tfo_type_id) || null;
    const yarn = idx.yarnsById[line.yarn_id] || null;
    const sides = num(line.sides) ?? 0;
    const perSide = spindlesPerSide(type);
    const spindles = sides * perSide;
    const { speed, q } = outputFor(type, yarn);
    const problems = [];
    if (!type) problems.push('Choose a TFO type');
    if (!yarn) problems.push('Choose a yarn');
    else if (!isTpm(yarn)) problems.push(`${yarn.name} is not a TPM yarn`);
    if (!sides) problems.push('Enter the number of sides');
    if (type && yarn && !speed) problems.push(`No speed for ${yarn.name} on ${type.name}. Add it on the unit page.`);
    else if (speed && q === null) problems.push(`Speed for ${yarn.name} on ${type.name} is incomplete`);
    const kg = q !== null ? q * spindles : null;
    if (yarn) {
      const y = yarnRow(yarn);
      y.allocSides += sides;
      y.allocSpindles += spindles;
      if (kg === null) y.allocKnown = false;
      else y.allocKg += kg;
      if (type && !y.allocTypes.includes(type.name)) y.allocTypes.push(type.name);
    }
    return { line, type, yarn, sides, perSide, spindles, speed, q, kg, problems };
  });

  const typeUse = types.map((t) => {
    const cap = typeCapacity(t);
    const used = tfoRows.filter((r) => r.type && r.type.id === t.id).reduce((s, r) => s + r.sides, 0);
    return { type: t, ...cap, used, usedSpindles: used * cap.perSide, idle: cap.sides === null ? null : cap.sides - used };
  });
  for (const u of typeUse) {
    if (u.sides === null) issues.push(`Set the number of machines for ${u.type.name} on the unit to see idle sides.`);
    else if (u.idle < 0) issues.push(`${u.type.name}: ${u.used} sides given out, only ${u.sides} on ${u.machines} machines.`);
  }

  // ---------- balance per yarn ----------
  const yarnRows = [...yarns.values()].filter((y) => isTpm(y.yarn)).map((y) => {
    const net = y.demand - y.outside;
    const stockDays = y.stock > 0 ? (net > 0 ? y.stock / net : Infinity) : null;
    // output per spindle used for "spindles needed": the mix actually given out, else the first TFO type with a speed
    let qRef = null;
    let refType = null;
    if (y.allocSpindles > 0 && y.allocKnown) {
      qRef = y.allocKg / y.allocSpindles;
      refType = y.allocTypes.join(' + ');
    } else {
      for (const t of types) {
        const { q } = outputFor(t, y.yarn);
        if (q) {
          qRef = q;
          refType = t.name;
          break;
        }
      }
    }
    const required = qRef && y.demandKnown ? Math.max(net, 0) / qRef : null;
    const balanceKg = y.demandKnown && y.allocKnown ? y.allocKg - net : null;
    const balanceSpindles = balanceKg !== null && qRef ? balanceKg / qRef : null;
    const perSide = spindlesPerSide(types.find((t) => t.name === refType) || types[0]);
    let status = 'unknown';
    if (balanceSpindles !== null) status = Math.abs(balanceSpindles) < 0.5 ? 'ok' : balanceSpindles > 0 ? 'surplus' : 'short';
    const problems = [];
    if (!y.demandKnown) problems.push('Demand incomplete: a loom line is missing data');
    if (!y.allocKnown) problems.push('Output incomplete: a TFO line has no speed');
    if (!qRef && net > 0) problems.push(`No TFO speed for ${y.yarn.name} on this unit`);
    return { ...y, net, stockDays, qRef, refType, required, balanceKg, balanceSpindles, sidesNeeded: required === null ? null : required / perSide, balanceSides: balanceSpindles === null ? null : balanceSpindles / perSide, status, problems };
  }).sort((a, b) => (a.balanceSpindles ?? Infinity) - (b.balanceSpindles ?? Infinity) || String(a.yarn.name).localeCompare(String(b.yarn.name)));

  const runningRows = [...running.values()].map((r) => {
    const total = r.weft;
    const tpm = isTpm(r.yarn);
    const sp = tpm ? yarnRows.find((y) => y.yarn.id === r.yarn.id) : null;
    const base = tpm ? idx.yarnsById[r.yarn.base_yarn_id] || null : null;
    return { ...r, total, tpm, base, outside: sp ? sp.outside : 0, stock: sp ? sp.stock : 0, stockDays: sp ? sp.stockDays : null, net: sp ? sp.net : total, spindles: sp ? sp.required : null, spindleStatus: sp ? sp.status : null, balanceSpindles: sp ? sp.balanceSpindles : null };
  }).sort((a, b) => b.total - a.total || String(a.yarn.name).localeCompare(String(b.yarn.name)));

  const known = yarnRows.filter((y) => y.balanceSpindles !== null);
  const capSpindles = typeUse.every((u) => u.spindles !== null) && typeUse.length ? typeUse.reduce((s, u) => s + u.spindles, 0) : null;
  const usedSpindles = typeUse.reduce((s, u) => s + u.usedSpindles, 0);
  const totals = {
    looms: loomRows.reduce((s, r) => s + r.looms, 0),
    running: runningRows.reduce((s, r) => s + r.total, 0),
    runningKnown: runningRows.every((r) => r.known),
    metres: loomRows.every((r) => r.mPerDay !== null || !r.looms) ? loomRows.reduce((s, r) => s + (r.mPerDay || 0), 0) : null,
    demand: yarnRows.reduce((s, y) => s + y.demand, 0),
    outside: yarnRows.reduce((s, y) => s + y.outside, 0),
    stock: yarnRows.reduce((s, y) => s + y.stock, 0),
    net: yarnRows.reduce((s, y) => s + y.net, 0),
    allocKg: yarnRows.reduce((s, y) => s + y.allocKg, 0),
    required: yarnRows.every((y) => y.required !== null) ? yarnRows.reduce((s, y) => s + y.required, 0) : null,
    deficit: known.filter((y) => y.balanceSpindles < -0.5).reduce((s, y) => s - y.balanceSpindles, 0),
    surplus: known.filter((y) => y.balanceSpindles > 0.5).reduce((s, y) => s + y.balanceSpindles, 0),
    shortYarns: known.filter((y) => y.status === 'short').length,
    unknownYarns: yarnRows.filter((y) => y.status === 'unknown').length,
    capSpindles,
    usedSpindles,
    idleSides: typeUse.every((u) => u.idle !== null) ? typeUse.reduce((s, u) => s + Math.max(u.idle, 0), 0) : null,
    idleSpindles: typeUse.every((u) => u.idle !== null) ? typeUse.reduce((s, u) => s + Math.max(u.idle, 0) * u.perSide, 0) : null,
  };

  for (const r of stockYarnRows) {
    const yr = r.yarn ? yarnRows.find((y) => y.yarn.id === r.yarn.id) : null;
    r.days = yr ? yr.stockDays : null;
  }

  const lineProblems = [...loomRows, ...tfoRows, ...outsideRows, ...stockYarnRows].filter((r) => r.problems.length).length;
  return { unit, types, groups, loomRows, tfoRows, outsideRows, stockYarnRows, groupUse, typeUse, yarnRows, runningRows, totals, issues, lineProblems };
}

// One-line verdict for lists: "Short 1,240 spindles" / "Surplus 300 spindles" / "Balanced".
export function planVerdict(pc) {
  const t = pc.totals;
  if (!pc.yarnRows.length) return { kind: 'gray', text: 'Nothing planned' };
  if (t.shortYarns) return { kind: 'bad', text: `Short ${Math.round(t.deficit).toLocaleString('en-IN')} spindles` };
  if (t.unknownYarns) return { kind: 'amber', text: 'Data missing' };
  if (t.surplus >= 0.5) return { kind: 'good', text: `Surplus ${Math.round(t.surplus).toLocaleString('en-IN')} spindles` };
  return { kind: 'good', text: 'Balanced' };
}
