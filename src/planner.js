// TFO planner: one typical day at a unit. Looms per quality per loom group → yarn consumed;
// TFO sides per TPM yarn per TFO type → yarn made; plus yarn bought in → balance per TPM yarn (kg).
// Pure functions over the index (calc.buildIndex) and a plan object. Never writes master tabs.
//
// Plan (the working plan on the device, and what a saved plan holds):
//   { unitId, looms: [{ fabricId, groupId, looms }], sides: [{ yarnId, typeId, sides }],
//     receipts: [{ yarnId, kg }], settings: { key: value }, soldAs: { 'fabricId:groupId': 'rfd' } }
// settings keys: rpm:f:g, eff:f:g, tfoRpm:y:t, tfoEff:t, avail:t. Only values that differ from master are kept,
// so a setting nobody edited follows later master changes.
import { baseOf, fabricCalc, fabricLabel, groupPanna, isTpm, num, stripRfd, stripRs, tfoOutput, truthy, yarnDenier } from './calc.js';

const IN_PER_M = 39.37;
const MIN_PER_DAY = 1440;
export const DEFAULT_SHORTAGE = 10;
export const DEFAULT_SPINDLES = 252;

export const emptyPlan = (unitId = '') => ({ unitId, looms: [], sides: [], receipts: [], settings: {}, soldAs: {} });

// ---------- qualities: a greige fabric and its RFD copy share one row ----------

const lineSig = (lines) =>
  (lines || [])
    .map((l) => [l.side, l.yarn_id, num(l.ends) ?? '', num(l.parts) ?? ''].join(':'))
    .sort()
    .join('|');

// One entry per quality. A greige fabric and RFD fabrics with the same stored name, RS and yarn lines are one
// quality; the greige record is the representative (its id is the row's id). RFD-only fabrics stand alone.
export function qualities(idx) {
  const groups = new Map();
  for (const f of Object.values(idx.fabricsById)) {
    const rs = num(f.reed_space_in);
    const base = stripRs(stripRfd(f.base_name ?? f.name), rs).toLowerCase();
    const key = `${base}#${rs ?? ''}#${lineSig(idx.linesByFabric[f.id])}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const out = [];
  for (const members of groups.values()) {
    const greige = members.find((f) => f.finish !== 'RFD') || null;
    const rfd = members.find((f) => f.finish === 'RFD') || null;
    const fabric = greige || rfd;
    out.push({ id: fabric.id, fabric, greige, rfd, members, label: greige ? fabricLabel(greige) : fabricLabel(rfd), both: !!(greige && rfd) });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label, 'en', { numeric: true }));
}

// Any fabric id → its quality (a saved plan may point at the RFD copy, or at a fabric that has since got a twin).
export function qualityIndex(idx) {
  const list = qualities(idx);
  const byMember = {};
  for (const q of list) for (const m of q.members) byMember[m.id] = q;
  return { list, byMember };
}

const isDobby = (x) => String((x && (x.weave ?? x.shedding)) || '').toLowerCase() === 'dobby';

export function usesTpm(q, idx) {
  return (idx.linesByFabric[q.fabric.id] || []).some((l) => isTpm(idx.yarnsById[l.yarn_id]));
}

// A quality fits a loom group when one reed space fits its width (panna rule) and a dobby quality meets a dobby group.
export function fitsGroup(q, group) {
  if (isDobby(q.fabric) && !isDobby(group)) return false;
  return groupPanna(q.fabric.reed_space_in, group) !== null;
}

export function assignedTo(q, unitId, idx) {
  return q.members.some((m) => (idx.assignmentsByFabric[m.id] || []).some((a) => a.unit_id === unitId));
}

// Qualities offered under a loom group: those that fit, TPM users first.
export function groupOptions(list, group, idx, { assignedOnly = false, unitId = '', exclude = [] } = {}) {
  const fit = list.filter((q) => fitsGroup(q, group) && !exclude.includes(q.id) && (!assignedOnly || assignedTo(q, unitId, idx)));
  return { tpm: fit.filter((q) => usesTpm(q, idx)), other: fit.filter((q) => !usesTpm(q, idx)) };
}

// ---------- defaults from master ----------

const first = (...vals) => {
  for (const v of vals) if (v !== null && v !== undefined) return v;
  return null;
};
const fromMembers = (q, field) => first(num(q.fabric[field]), ...q.members.map((m) => num(m[field])));

// 280 cm looms run at the fabric's loom_rpm_dp (the 280 cm RPM) whether single or double panna; narrower looms at loom_rpm.
export const WIDE_LOOM_CM = 250;
export const usesWideRpm = (group) => (num(group && group.reed_width_cm) ?? 0) >= WIDE_LOOM_CM;

export function masterLoomRpm(q, group) {
  return fromMembers(q, usesWideRpm(group) ? 'loom_rpm_dp' : 'loom_rpm');
}

export function masterLoomEff(q, unit) {
  return first(fromMembers(q, 'loom_eff_pct'), num(unit && unit.loom_eff_pct));
}

export function masterTfoRpm(yarnId, typeId, idx, unitId) {
  const sp = (idx.speedsByUnit[unitId] || []).find((s) => s.yarn_id === yarnId && s.tfo_type_id === typeId);
  return sp ? num(sp.rpm) : null;
}

export const masterTfoEff = (type, unit) => first(num(type && type.efficiency), num(unit && unit.tfo_default_eff));
export const masterAvail = (type) => (num(type && type.machines) !== null ? num(type.machines) * 2 : null);
export const spindlesPerSide = (type) => num(type && type.spindles_per_side) ?? DEFAULT_SPINDLES;

export const keys = {
  rpm: (f, g) => `rpm:${f}:${g}`,
  eff: (f, g) => `eff:${f}:${g}`,
  tfoRpm: (y, t) => `tfoRpm:${y}:${t}`,
  tfoEff: (t) => `tfoEff:${t}`,
  avail: (t) => `avail:${t}`,
};

// A setting: what is used, what master says, and whether it was edited here.
export function setting(plan, key, master) {
  const has = Object.prototype.hasOwnProperty.call(plan.settings || {}, key);
  const own = has ? num(plan.settings[key]) : null;
  const value = own !== null ? own : master;
  return { key, value, master, edited: own !== null, missing: value === null };
}

// Stores only a difference from master. Blank, unreadable or equal to master removes the edit.
export function withSetting(plan, key, raw, master) {
  const settings = { ...(plan.settings || {}) };
  const v = num(raw);
  if (v === null || (master !== null && v === master)) delete settings[key];
  else settings[key] = v;
  return { ...plan, settings };
}

export function resetAll(plan) {
  return { ...plan, settings: {} };
}

// ---------- per-metre consumption ----------

const shortage = (v) => (num(v) ?? DEFAULT_SHORTAGE) / 100;

// g per metre of loom output for every yarn line of a quality (ends are per panna; weft share = parts ÷ sum,
// a blank parts takes the average of the others, one weft = all of the pick). Shortage % from the fabric, blank = 10.
export function qualityLines(q, idx) {
  const f = q.fabric;
  const ppi = num(f.ppi);
  const rs = num(f.reed_space_in);
  const sw = shortage(f.warp_shortage_pct);
  const sf = shortage(f.weft_shortage_pct);
  const lines = idx.linesByFabric[f.id] || [];
  const wefts = lines.filter((l) => l.side === 'weft');
  const given = wefts.map((l) => num(l.parts)).filter((p) => p !== null && p > 0);
  const avg = given.length ? given.reduce((s, p) => s + p, 0) / given.length : 1;
  const partsOf = (l) => {
    const p = num(l.parts);
    return p !== null && p > 0 ? p : avg;
  };
  const totalParts = wefts.reduce((s, l) => s + partsOf(l), 0) || 1;
  return lines.map((l) => {
    const yarn = idx.yarnsById[l.yarn_id] || null;
    const denier = yarnDenier(yarn, idx);
    let gpm = null;
    if (denier) {
      if (l.side === 'warp') {
        const ends = num(l.ends);
        gpm = ends ? ((ends * denier) / 9000) * (1 + sw) : null;
      } else if (ppi && rs) {
        gpm = ((ppi * (partsOf(l) / totalParts) * rs * denier) / 9000) * (1 + sf);
      }
    }
    return { line: l, side: l.side, yarn, denier, gpm, tpm: isTpm(yarn), noCount: !!yarn && !denier };
  });
}

// Metres per loom per day. A 280 cm single panna loom uses the 280 cm RPM and is not doubled.
export function metresPerDay(rpm, effPct, ppi, panna) {
  const r = num(rpm), e = num(effPct), p = num(ppi);
  if (!r || !e || !p || !panna) return null;
  return ((r * MIN_PER_DAY * (e / 100)) / (p * IN_PER_M)) * panna;
}

// kg one side makes per day: g per spindle per hour = RPM ÷ TPM × 60 × denier ÷ 9000 × eff; × 24 × spindles ÷ 1000.
// The RPM is already × 2 in the master and is never doubled again.
export function kgPerSide(rpm, tpm, effPct, denier, spindles) {
  const q = tfoOutput(rpm, tpm, effPct, denier);
  return q === null || !num(spindles) ? null : q * num(spindles);
}

export const gPerSpindleHour = (rpm, tpm, effPct, denier) => {
  const q = tfoOutput(rpm, tpm, effPct, denier);
  return q === null ? null : (q * 1000) / 24;
};

// ---------- the whole plan ----------

const add = (map, key, make) => {
  if (!map.has(key)) map.set(key, make());
  return map.get(key);
};

export function computePlan(plan, idx) {
  const unit = idx.unitsById[plan.unitId] || null;
  const unitId = unit ? unit.id : '';
  const { list, byMember } = qualityIndex(idx);
  const groups = (idx.loomGroupsByUnit[unitId] || [])
    .slice()
    .sort((a, b) => (num(a.reed_width_cm) ?? 0) - (num(b.reed_width_cm) ?? 0) || String(a.shedding || '').localeCompare(String(b.shedding || '')));
  // most machines first (Old machines (1-12) before New machines (13-16)), then by name
  const types = (idx.tfoTypesByUnit[unitId] || []).slice().sort((a, b) => (num(b.machines) ?? -1) - (num(a.machines) ?? -1) || String(a.name || '').localeCompare(String(b.name || ''), 'en', { numeric: true }));
  const yarnUse = new Map(); // yarnId → { yarn, warp, weft, used: Set }
  const notes = { needRpm: [], needEff: [], noReal: [], noCount: new Set(), needTfo: [] };
  const calcs = {};
  const calcOf = (f) => (calcs[f.id] ||= fabricCalc(f, idx));

  let loomsTotal = 0, realTotal = 0, realLooms = 0, pickOutput = 0;

  const groupBlocks = groups.map((group) => {
    const rows = [];
    for (const entry of plan.looms || []) {
      if (entry.groupId !== group.id) continue;
      const q = byMember[entry.fabricId];
      if (!q) continue; // fabric deleted since: ignored
      const fid = q.id;
      const looms = num(entry.looms) ?? 0;
      const panna = groupPanna(q.fabric.reed_space_in, group);
      const rpm = setting(plan, keys.rpm(fid, group.id), masterLoomRpm(q, group));
      const eff = setting(plan, keys.eff(fid, group.id), masterLoomEff(q, unit));
      const ppi = num(q.fabric.ppi);
      const mPerDay = panna ? metresPerDay(rpm.value, eff.value, ppi, panna) : null;
      const soldKey = `${fid}:${group.id}`;
      const soldAs = q.both ? ((plan.soldAs || {})[soldKey] === 'rfd' ? 'rfd' : 'greige') : q.greige ? 'greige' : 'rfd';
      const record = soldAs === 'rfd' ? q.rfd : q.greige;
      const calc = calcOf(record);
      const perPick = calc.realisationNetPerPick;
      const realPerLoom = mPerDay !== null && perPick !== null && ppi ? perPick * mPerDay * ppi : null;
      const lines = qualityLines(q, idx);
      let tpmKg = mPerDay === null ? null : 0;
      if (mPerDay !== null) {
        for (const x of lines) {
          if (!x.yarn) continue;
          if (x.noCount) notes.noCount.add(x.yarn.id);
          if (x.gpm === null) continue;
          const kg = (looms * mPerDay * x.gpm) / 1000;
          const u = add(yarnUse, x.yarn.id, () => ({ yarn: x.yarn, warp: 0, weft: 0, used: new Set() }));
          u[x.side === 'warp' ? 'warp' : 'weft'] += kg;
          if (looms > 0) u.used.add(q.label);
          if (x.tpm) tpmKg += kg;
        }
      } else {
        for (const x of lines) if (x.noCount) notes.noCount.add(x.yarn.id);
      }
      const row = { q, fabricId: fid, group, looms, loomsRaw: entry.looms ?? '', panna, rpm, eff, ppi, mPerDay, soldAs, soldKey, record, perPick, realPerLoom, realTotal: realPerLoom !== null ? realPerLoom * looms : null, tpmKg, tpm: usesTpm(q, idx) };
      if (rpm.missing) notes.needRpm.push(row);
      else if (eff.missing) notes.needEff.push(row);
      if (looms > 0) {
        loomsTotal += looms;
        if (realPerLoom !== null) {
          realTotal += realPerLoom * looms;
          realLooms += looms;
          pickOutput += looms * mPerDay * ppi;
        } else if (mPerDay !== null) notes.noReal.push(row);
      }
      rows.push(row);
    }
    const used = rows.reduce((s, r) => s + r.looms, 0);
    const capacity = num(group.looms);
    return { group, rows, used, capacity, over: capacity !== null && used > capacity };
  });

  const made = new Map(); // yarnId → kg/day from TFO
  const typeBlocks = types.map((type) => {
    const eff = setting(plan, keys.tfoEff(type.id), masterTfoEff(type, unit));
    const avail = setting(plan, keys.avail(type.id), masterAvail(type));
    const perSide = spindlesPerSide(type);
    const rows = [];
    for (const entry of plan.sides || []) {
      if (entry.typeId !== type.id) continue;
      const yarn = idx.yarnsById[entry.yarnId];
      if (!yarn) continue;
      const sides = num(entry.sides) ?? 0;
      const rpm = setting(plan, keys.tfoRpm(yarn.id, type.id), masterTfoRpm(yarn.id, type.id, idx, unitId));
      const denier = yarnDenier(yarn, idx);
      const perSideKg = kgPerSide(rpm.value, yarn.tpm, eff.value, denier, perSide);
      const output = perSideKg !== null ? perSideKg * sides : null;
      if (output !== null) made.set(yarn.id, (made.get(yarn.id) || 0) + output);
      const row = { yarn, sides, sidesRaw: entry.sides ?? '', rpm, denier, perSideKg, output, noCount: !denier, noTpm: !num(yarn.tpm) };
      if (rpm.missing) notes.needTfo.push({ ...row, type });
      rows.push(row);
    }
    const used = rows.reduce((s, r) => s + r.sides, 0);
    return { type, eff, avail, perSide, rows, used, over: avail.value !== null && used > avail.value };
  });

  const received = new Map();
  const receiptRows = [];
  for (const entry of plan.receipts || []) {
    const yarn = idx.yarnsById[entry.yarnId];
    if (!yarn) continue;
    const kg = num(entry.kg) ?? 0;
    received.set(yarn.id, (received.get(yarn.id) || 0) + kg);
    receiptRows.push({ yarn, kg, kgRaw: entry.kg ?? '' });
  }

  const consumption = [...yarnUse.values()]
    .map((u) => ({ yarn: u.yarn, tpm: isTpm(u.yarn), warp: u.warp, weft: u.weft, total: u.warp + u.weft, used: [...u.used].sort() }))
    .filter((u) => u.total > 0 || u.used.length)
    .sort((a, b) => b.total - a.total || String(a.yarn.name).localeCompare(String(b.yarn.name)));

  const tpmIds = new Set([...consumption.filter((c) => c.tpm).map((c) => c.yarn.id), ...made.keys(), ...received.keys()]);
  const balance = [...tpmIds]
    .map((id) => {
      const yarn = idx.yarnsById[id];
      const used = consumption.find((c) => c.yarn.id === id);
      const need = used ? used.total : 0;
      const out = made.get(id) || 0;
      const rec = received.get(id) || 0;
      return { yarn, consumption: need, output: out, received: rec, balance: out + rec - need };
    })
    .filter((b) => b.yarn && isTpm(b.yarn))
    .sort((a, b) => a.balance - b.balance || String(a.yarn.name).localeCompare(String(b.yarn.name)));

  const sum = (k) => balance.reduce((s, b) => s + b[k], 0);
  const totals = {
    tpmConsumption: sum('consumption'),
    tfoOutput: sum('output'),
    received: sum('received'),
    net: sum('balance'),
    short: balance.filter((b) => b.balance < -0.005).length,
    looms: loomsTotal,
    plantRealisation: realLooms ? realTotal : null,
    avgLoomRealisation: realLooms ? realTotal / realLooms : null,
    avgPerPick: pickOutput ? realTotal / pickOutput : null,
    realLooms,
  };

  return {
    unit,
    groups: groupBlocks,
    types: typeBlocks,
    receipts: receiptRows,
    consumption,
    balance,
    totals,
    notes: { ...notes, noCount: [...notes.noCount].map((id) => idx.yarnsById[id]).filter(Boolean) },
    qualities: list,
  };
}

// Totals kept with a saved plan, for the plans list.
export function planSummary(model) {
  const t = model.totals;
  const r = (v, dp = 2) => (v === null || v === undefined ? null : Math.round(v * 10 ** dp) / 10 ** dp);
  return { tpmConsumption: r(t.tpmConsumption, 1), tfoOutput: r(t.tfoOutput, 1), received: r(t.received, 1), net: r(t.net, 1), short: t.short, looms: t.looms, plantRealisation: r(t.plantRealisation, 0), avgLoomRealisation: r(t.avgLoomRealisation, 0), avgPerPick: r(t.avgPerPick, 4) };
}

// ---------- plan ↔ Sheet lines ----------
// TfoBalanceLines: kind looms (ref fabric:group), sides (yarn:type), receipt (yarn), setting (the setting key),
// sold_as (fabric:group → greige|rfd). Rows keep their order through the line order.

export function planToLines(plan) {
  const out = [];
  for (const r of plan.looms || []) out.push({ kind: 'looms', ref: `${r.fabricId}:${r.groupId}`, value: r.looms ?? '' });
  for (const r of plan.sides || []) out.push({ kind: 'sides', ref: `${r.yarnId}:${r.typeId}`, value: r.sides ?? '' });
  for (const r of plan.receipts || []) out.push({ kind: 'receipt', ref: r.yarnId, value: r.kg ?? '' });
  for (const [k, v] of Object.entries(plan.settings || {})) out.push({ kind: 'setting', ref: k, value: v });
  for (const [k, v] of Object.entries(plan.soldAs || {})) if (v === 'rfd') out.push({ kind: 'sold_as', ref: k, value: 'rfd' });
  return out.map((l) => ({ ...l, value: l.value === null || l.value === undefined ? '' : String(l.value) }));
}

export function linesToPlan(unitId, lines) {
  const plan = emptyPlan(unitId);
  const sorted = (lines || []).slice().sort((a, b) => (num(a.sort) ?? 0) - (num(b.sort) ?? 0));
  for (const l of sorted) {
    const ref = String(l.ref || '');
    const value = l.value === null || l.value === undefined ? '' : String(l.value);
    if (l.kind === 'looms') {
      const [fabricId, groupId] = ref.split(':');
      if (fabricId && groupId) plan.looms.push({ fabricId, groupId, looms: value });
    } else if (l.kind === 'sides') {
      const [yarnId, typeId] = ref.split(':');
      if (yarnId && typeId) plan.sides.push({ yarnId, typeId, sides: value });
    } else if (l.kind === 'receipt') {
      if (ref) plan.receipts.push({ yarnId: ref, kg: value });
    } else if (l.kind === 'setting') {
      if (ref && num(value) !== null) plan.settings[ref] = num(value);
    } else if (l.kind === 'sold_as') {
      if (ref && value === 'rfd') plan.soldAs[ref] = 'rfd';
    }
  }
  return plan;
}

// A saved plan's inputs, ready to open, with rows that point at deleted fabrics, yarns, loom groups or
// TFO types left out. A row that points at an RFD copy moves to its greige quality.
export function cleanPlan(plan, idx) {
  const { byMember } = qualityIndex(idx);
  const groupOk = (g) => (idx.loomGroupsByUnit[plan.unitId] || []).some((x) => x.id === g);
  const typeOk = (t) => (idx.tfoTypesByUnit[plan.unitId] || []).some((x) => x.id === t);
  const looms = [];
  for (const r of plan.looms || []) {
    const q = byMember[r.fabricId];
    if (!q || !groupOk(r.groupId) || looms.some((x) => x.fabricId === q.id && x.groupId === r.groupId)) continue;
    looms.push({ ...r, fabricId: q.id });
  }
  return {
    ...plan,
    looms,
    sides: (plan.sides || []).filter((r) => idx.yarnsById[r.yarnId] && typeOk(r.typeId)),
    receipts: (plan.receipts || []).filter((r) => idx.yarnsById[r.yarnId]),
  };
}

// Same inputs? (unsaved-changes marker)
export function planSig(plan) {
  const p = plan || emptyPlan();
  const lines = planToLines(p).map((l) => `${l.kind}|${l.ref}|${l.value}`);
  return `${p.unitId}#${lines.join('\n')}`;
}

// TPM yarns a unit can twist (for the TFO and received-from-outside pickers), base yarn name for the group hint.
export function tpmYarns(idx) {
  return Object.values(idx.yarnsById)
    .filter(isTpm)
    .map((y) => ({ yarn: y, base: baseOf(y, idx) }))
    .sort((a, b) => String(a.yarn.name).localeCompare(String(b.yarn.name), 'en', { numeric: true }));
}

export const tfoUnits = (idx) => Object.values(idx.unitsById).filter((u) => truthy(u.has_tfo)).sort((a, b) => String(a.name).localeCompare(String(b.name)));

// "Plan 25 Oct 2026" from 2026-10-25.
export function defaultPlanName(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date || ''));
  if (!m) return 'Plan';
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1];
  return `Plan ${Number(m[3])} ${mon} ${m[1]}`;
}

// Today in India (Asia/Kolkata), yyyy-mm-dd, whatever the device's time zone.
export function todayIst(now = new Date()) {
  const t = new Date(now.getTime() + 330 * 60000);
  return t.toISOString().slice(0, 10);
}

export const groupLabel = (g) => [num(g && g.reed_width_cm) !== null ? `${num(g.reed_width_cm)} cm` : '', (g && g.shedding) || ''].filter(Boolean).join(' ') || 'Loom group';

// Every edited setting of a plan with the master value it replaces (exports, settings sheet).
export function editedSettings(plan, idx) {
  const unit = idx.unitsById[plan.unitId] || null;
  const { byMember } = qualityIndex(idx);
  const groupOf = (id) => (idx.loomGroupsByUnit[plan.unitId] || []).find((g) => g.id === id);
  const typeOf = (id) => (idx.tfoTypesByUnit[plan.unitId] || []).find((t) => t.id === id);
  const out = [];
  for (const [key, value] of Object.entries(plan.settings || {})) {
    const [kind, a, b] = key.split(':');
    if (kind === 'rpm' || kind === 'eff') {
      const q = byMember[a], g = groupOf(b);
      if (!q || !g) continue;
      out.push({ key, what: kind === 'rpm' ? 'Loom RPM' : 'Loom efficiency %', item: `${q.label} · ${groupLabel(g)}`, value, master: kind === 'rpm' ? masterLoomRpm(q, g) : masterLoomEff(q, unit) });
    } else if (kind === 'tfoRpm') {
      const y = idx.yarnsById[a], t = typeOf(b);
      if (!y || !t) continue;
      out.push({ key, what: 'TFO RPM', item: `${y.name} · ${t.name}`, value, master: masterTfoRpm(a, b, idx, plan.unitId) });
    } else if (kind === 'tfoEff' || kind === 'avail') {
      const t = typeOf(a);
      if (!t) continue;
      out.push({ key, what: kind === 'tfoEff' ? 'TFO efficiency %' : 'Sides available', item: t.name, value, master: kind === 'tfoEff' ? masterTfoEff(t, unit) : masterAvail(t) });
    }
  }
  return out;
}
