// Calculation engine. Pure functions over the table rows.
// Conventions (see the scope doc):
// - all counts worked in denier; Ne converted with D = 5315 / Ne
// - consumption per metre of greige fabric, shortage % included
// - cost per pick = Rs per metre per pick of PPI (conversion/m = k x PPI)
// - RFD: g = 1 / (1 - f) greige metres per RFD metre; price is per RFD metre
// - RFD finishing = processing x g + transportation (per RFD m) + brokering % of price

export const NE_TO_DENIER = 5315;
const IN_PER_M = 39.37;
const MIN_PER_DAY = 1440;

export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

const pct = (v) => (num(v) ?? 0) / 100;

export function buildIndex(tables) {
  const t = tables || {};
  const by = (rows) => Object.fromEntries((rows || []).map((r) => [r.id, r]));
  const group = (rows, key) => {
    const out = {};
    for (const r of rows || []) (out[r[key]] ||= []).push(r);
    return out;
  };
  const ratesByYarn = group(t.YarnRates, 'yarn_id');
  for (const k of Object.keys(ratesByYarn)) {
    ratesByYarn[k].sort((a, b) => String(b.effective_date || '').localeCompare(String(a.effective_date || '')));
  }
  const linesByFabric = group(t.FabricYarns, 'fabric_id');
  for (const k of Object.keys(linesByFabric)) {
    linesByFabric[k].sort((a, b) => (num(a.sort) ?? 0) - (num(b.sort) ?? 0));
  }
  const photosByFabric = group(t.Photos, 'fabric_id');
  for (const k of Object.keys(photosByFabric)) {
    photosByFabric[k].sort((a, b) => (b.is_cover === true || b.is_cover === 'TRUE') - (a.is_cover === true || a.is_cover === 'TRUE') || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  }
  return {
    tables: t,
    yarnsById: by(t.Yarns),
    unitsById: by(t.Units),
    // name shown everywhere = stored name + RS; base_name keeps the stored name
    fabricsById: by((t.Fabrics || []).map((f) => ({ ...f, base_name: f.name, name: fabricLabel(f) }))),
    ratesByYarn,
    linesByFabric,
    photosByFabric,
    assignmentsByFabric: group(t.Assignments, 'fabric_id'),
    beamsByFabric: group(t.FabricBeams || [], 'fabric_id'),
    assignmentsByUnit: group(t.Assignments, 'unit_id'),
    loomGroupsByUnit: group(t.LoomGroups, 'unit_id'),
    tfoTypesByUnit: group(t.TfoTypes, 'unit_id'),
    speedsByUnit: group(t.TfoSpeeds, 'unit_id'),
  };
}

// ---------- fabric names: stored without the RS, shown as name + RS (rounded) ----------
export const rsText = (rs) => String(Math.round(rs));

// Drops a trailing RS from a name ("Natural Crape 53" with RS 52.5 -> "Natural Crape").
export function stripRs(name, rs) {
  const n = String(name || '').trim();
  const r = num(rs);
  if (r === null) return n;
  const m = n.match(/^(.*?)\s*-?\s*(\d+(?:\.\d+)?)$/);
  return m && m[1] && (m[2] === rsText(r) || Number(m[2]) === Math.round(r)) ? m[1].trim() : n;
}

// Name + RS. Names already ending in their RS are not doubled; " (copy)" stays at the end.
// Finished (RFD) fabrics: name + RS + " (RFD)", e.g. "Gajji Silk 41 (RFD)". A stored "(RFD)" is moved to the end.
export function fabricLabel(fabric) {
  const name = String((fabric && fabric.name) || '').trim();
  const rfd = !!fabric && fabric.finish === 'RFD';
  const m = name.match(/^(.*?)((?: \(copy\))*)$/);
  let head = m[1];
  const tail = m[2];
  if (rfd) head = stripRfd(head);
  const suffix = rfd ? ' (RFD)' : '';
  const rs = num(fabric && fabric.reed_space_in);
  if (rs === null || stripRs(head, rs) !== head.trim()) return `${head}${suffix}${tail}`.trim();
  return `${head} ${rsText(rs)}${suffix}${tail}`.trim();
}

// Drops "(RFD)" from a name ("Organza Twill (RFD)" -> "Organza Twill").
export const stripRfd = (name) => String(name || '').replace(/\s*\(RFD\)\s*/gi, ' ').replace(/\s+/g, ' ').trim();

// The fabric row as stored: the shown name swapped back for the stored one.
export function baseFabric(fabric) {
  if (!fabric) return fabric;
  const { base_name, ...rest } = fabric;
  return base_name === undefined ? rest : { ...rest, name: base_name };
}

export const isTpm = (yarn) => !!yarn && yarn.kind === 'tpm';

export function baseOf(yarn, idx) {
  return isTpm(yarn) ? idx.yarnsById[yarn.base_yarn_id] || null : null;
}

export function yarnDenier(yarn, idx) {
  if (!yarn) return null;
  const c = num(yarn.count);
  if (c && c > 0) return yarn.count_unit === 'Ne' ? NE_TO_DENIER / c : c;
  const base = baseOf(yarn, idx);
  return base ? yarnDenier(base, idx) : null;
}

export function yarnCountLabel(yarn, idx) {
  if (!yarn) return '';
  const c = num(yarn.count);
  if (c && c > 0) return yarn.count_unit === 'Ne' ? `${c}s` : `${c}D`;
  const base = baseOf(yarn, idx);
  return base ? yarnCountLabel(base, idx) : '';
}

// A TPM yarn's rate is its base yarn's rate plus a delta per kg. Blank delta = the default.
export const DEFAULT_TPM_DELTA = 50;
export function tpmDelta(yarn) {
  const d = num(yarn && yarn.tpm_delta);
  return d === null ? DEFAULT_TPM_DELTA : d;
}

// Base yarn: latest rate on or before asOf (yyyy-mm-dd). TPM yarn: base yarn's rate + delta.
export function yarnRate(yarn, idx, asOf) {
  if (!yarn) return null;
  if (isTpm(yarn)) {
    const base = baseOf(yarn, idx);
    const r = base ? yarnRate(base, idx, asOf) : null;
    if (!r) return null;
    const delta = tpmDelta(yarn);
    return { rate: r.rate + delta, date: r.date, baseRate: r.rate, delta };
  }
  const rates = (idx.ratesByYarn[yarn.id] || []).filter((r) => num(r.rate) !== null && (!asOf || String(r.effective_date || '') <= asOf));
  if (rates.length) return { rate: num(rates[0].rate), date: rates[0].effective_date || '' };
  return null;
}

export const TFO_CLASSES = ['Non-TPM', 'Warp TPM', 'Weft TPM', 'TPM × TPM'];

export function fabricCalc(fabric, idx, asOf) {
  const missing = [];
  const ppi = num(fabric.ppi);
  const rs = num(fabric.reed_space_in);
  const width = num(fabric.greige_width_in);
  const sw = pct(fabric.warp_shortage_pct);
  const sf = pct(fabric.weft_shortage_pct);
  if (!ppi) missing.push('pick');
  if (!rs) missing.push('reed space');
  if (num(fabric.warp_shortage_pct) === null) missing.push('warp shortage');
  if (num(fabric.weft_shortage_pct) === null) missing.push('weft shortage');

  const lines = idx.linesByFabric[fabric.id] || [];
  const warpLines = lines.filter((l) => l.side === 'warp');
  const weftLines = lines.filter((l) => l.side === 'weft');
  if (!warpLines.length) missing.push('warp yarn');
  if (!weftLines.length) missing.push('weft yarn');

  const lineCost = (yarn, gpm) => {
    const r = yarnRate(yarn, idx, asOf);
    return { rate: r ? r.rate : null, costPerM: r && gpm !== null ? (gpm / 1000) * r.rate : null };
  };

  const warp = warpLines.map((line) => {
    const yarn = idx.yarnsById[line.yarn_id] || null;
    const denier = yarnDenier(yarn, idx);
    const ends = num(line.ends);
    const gpm = denier && ends ? (ends * denier / 9000) * (1 + sw) : null;
    return { line, yarn, denier, ends, gpm, kgPer100: gpm === null ? null : gpm / 10, ...lineCost(yarn, gpm) };
  });

  const totalParts = weftLines.reduce((s, l) => s + (num(l.parts) ?? 1), 0) || 1;
  const weft = weftLines.map((line) => {
    const yarn = idx.yarnsById[line.yarn_id] || null;
    const denier = yarnDenier(yarn, idx);
    const share = (num(line.parts) ?? 1) / totalParts;
    const gpm = denier && ppi && rs ? (ppi * rs * share * denier / 9000) * (1 + sf) : null;
    return { line, yarn, denier, share, gpm, kgPer100: gpm === null ? null : gpm / 10, ...lineCost(yarn, gpm) };
  });

  const sum = (arr, k) => (arr.length && arr.every((x) => x[k] !== null) ? arr.reduce((s, x) => s + x[k], 0) : null);
  const totalEnds = warp.length && warp.every((w) => w.ends) ? warp.reduce((s, w) => s + w.ends, 0) : null;
  const warpGpm = sum(warp, 'gpm');
  const weftGpm = sum(weft, 'gpm');
  const totalGpm = warpGpm !== null && weftGpm !== null ? warpGpm + weftGpm : null;
  const gsm = totalGpm !== null && width ? totalGpm / (width * 0.0254) : null;
  const rmCost = totalGpm !== null ? sum([...warp, ...weft], 'costPerM') : null;
  if (totalGpm !== null && rmCost === null) missing.push('yarn rate');

  const warpTpm = warp.some((w) => isTpm(w.yarn));
  const weftTpm = weft.some((w) => isTpm(w.yarn));
  const tfoClass = warpTpm && weftTpm ? 'TPM × TPM' : warpTpm ? 'Warp TPM' : weftTpm ? 'Weft TPM' : 'Non-TPM';
  const tpmLines = [...warp, ...weft].filter((x) => isTpm(x.yarn));
  const tpmValues = tpmLines.map((x) => num(x.yarn.tpm)).filter((v) => v !== null);

  const finish = fabric.finish === 'RFD' ? 'RFD' : 'Greige';
  const price = num(fabric.price);
  if (price === null) missing.push('selling price');
  let g = 1;
  let finishingCost = 0;
  let rfdCost = null;
  let transport = null;
  if (finish === 'RFD') {
    const f = pct(fabric.rfd_shortage_pct);
    if (num(fabric.rfd_shortage_pct) === null) missing.push('RFD shortage');
    g = f < 1 ? 1 / (1 - f) : null;
    const c = num(fabric.processing_charge) ?? 0;
    const b = pct(fabric.brokering_pct);
    // Transportation: Rs per RFD metre, added as is (not grossed up by shrinkage).
    transport = num(fabric.transport_charge) ?? 0;
    finishingCost = g !== null && price !== null ? c * g + transport + b * price : null;
    rfdCost = rmCost !== null && finishingCost !== null ? rmCost * g + finishingCost : null;
  }
  const rmPerSaleM = rmCost !== null && g !== null ? rmCost * g : null;
  const costPerSaleM = finish === 'RFD' ? rfdCost : rmCost;
  const realisationPerM = price !== null && costPerSaleM !== null ? price - costPerSaleM : null;
  const picksPerSaleM = ppi && g !== null ? ppi * g : null;
  const realisationPerPick = realisationPerM !== null && picksPerSaleM ? realisationPerM / picksPerSaleM : null;
  // VATAV: discount off the selling price. Blank = none. Brokering stays on the full price.
  const vatavPct = num(fabric.vatav_pct) ?? 0;
  const vatavAmount = price !== null ? price * (vatavPct / 100) : null;
  const netPrice = price !== null ? price - vatavAmount : null;
  const realisationNetPerM = realisationPerM !== null ? realisationPerM - vatavAmount : null;
  const realisationNetPerPick = realisationNetPerM !== null && picksPerSaleM ? realisationNetPerM / picksPerSaleM : null;

  const loomRpm = num(fabric.loom_rpm);
  const loomEff = num(fabric.loom_eff_pct);
  const loomMPerDay = loomRpm && loomEff && ppi ? (loomRpm * MIN_PER_DAY * (loomEff / 100)) / (ppi * IN_PER_M) : null;

  return {
    ppi, rs, width, sw, sf, warp, weft, totalEnds, warpGpm, weftGpm, totalGpm,
    kgPer100: totalGpm === null ? null : totalGpm / 10, gsm, rmCost,
    tfoClass, tpmLines, tpmMin: tpmValues.length ? Math.min(...tpmValues) : null, tpmMax: tpmValues.length ? Math.max(...tpmValues) : null,
    finish, price, g, finishingCost: finish === 'RFD' ? finishingCost : null, transport, rfdCost, rmPerSaleM,
    realisationPerM, realisationPerPick, vatavPct, vatavAmount, netPrice, realisationNetPerM, realisationNetPerPick,
    picksPerSaleM, loomMPerDay, missing,
  };
}

// Profit per pick at a unit, on realisation after VATAV.
export function unitProfit(calc, unit) {
  const k = num(unit && unit.cost_per_pick);
  if (k === null || calc.realisationNetPerPick === null) return { costPerPick: k, profitPerPick: null, profitPerM: null };
  const profitPerPick = calc.realisationNetPerPick - k;
  return { costPerPick: k, profitPerPick, profitPerM: calc.picksPerSaleM ? profitPerPick * calc.picksPerSaleM : null };
}

// kg per spindle per day. The RPM entered is already multiplied by 2 (two turns per spindle revolution),
// so it is not doubled here.
export function tfoOutput(rpm, tpm, effPct, denier) {
  const r = num(rpm), t = num(tpm), e = num(effPct), d = num(denier);
  if (!r || !t || !e || !d) return null;
  return (r / t) * MIN_PER_DAY * (e / 100) * (d / 9000000);
}

// TFO efficiency for a speed: the speed's own, else its TFO type's, else the unit's default.
export function tfoEff(speed, type, unit) {
  return num(speed && speed.efficiency) ?? num(type && type.efficiency) ?? num(unit && unit.tfo_default_eff);
}

export const truthy = (v) => v === true || v === 'TRUE' || v === 'true' || v === 1;

// Loom output per day for single (panna 1) or double (panna 2) panna.
// Uses the fabric's loom RPM for that panna and the unit's loom efficiency. Double panna weaves two widths.
export function loomPerDay(calc, fabric, unit, panna = 1) {
  const rpm = num(panna === 2 ? fabric && fabric.loom_rpm_dp : fabric && fabric.loom_rpm);
  const eff = num(unit && unit.loom_eff_pct);
  const mPerDay = rpm && eff && calc.ppi ? ((rpm * MIN_PER_DAY * (eff / 100)) / (calc.ppi * IN_PER_M)) * panna : null;
  return {
    rpm,
    eff,
    mPerDay,
    warpKg: mPerDay !== null && calc.warpGpm !== null ? (mPerDay * calc.warpGpm) / 1000 : null,
    weftKg: mPerDay !== null && calc.weftGpm !== null ? (mPerDay * calc.weftGpm) / 1000 : null,
    reason: mPerDay !== null ? null : rpm ? (eff ? 'Set the pick on the fabric' : 'Set loom efficiency on the unit') : `Set ${panna === 2 ? 'double' : 'single'} panna RPM on the fabric`,
  };
}

export function unitHasTfo(calc, unit, idx) {
  return !!(calc.tpmLines.length && unit && truthy(unit.has_tfo) && (idx.tfoTypesByUnit[unit.id] || []).length);
}

// Spindles per loom for every TFO type of the unit, for one panna. Sums over the fabric's TPM yarn lines.
export function spindlesForUnit(calc, fabric, unit, idx, panna = 1) {
  if (!unit || !truthy(unit.has_tfo) || !calc.tpmLines.length) return [];
  const loom = loomPerDay(calc, fabric, unit, panna === 2 ? 2 : 1);
  const types = idx.tfoTypesByUnit[unit.id] || [];
  const speeds = idx.speedsByUnit[unit.id] || [];
  return types.map((type) => {
    const perYarn = calc.tpmLines.map((x) => {
      const sp = speeds.find((s) => s.tfo_type_id === type.id && s.yarn_id === x.yarn.id);
      const eff = sp ? tfoEff(sp, type, unit) : null;
      const q = sp ? tfoOutput(sp.rpm, x.yarn.tpm, eff, x.denier) : null;
      const kgPerDay = loom.mPerDay !== null && x.gpm !== null ? (loom.mPerDay * x.gpm) / 1000 : null;
      return { yarn: x.yarn, side: x.line.side, speed: sp || null, q, kgPerDay, spindles: q && kgPerDay !== null ? kgPerDay / q : null };
    });
    const complete = perYarn.every((p) => p.spindles !== null);
    const reason = loom.mPerDay === null ? loom.reason : perYarn.some((p) => !p.speed) ? 'No speed set for this TFO type' : complete ? null : 'Speed incomplete';
    return { type, perYarn, total: complete ? perYarn.reduce((s, p) => s + p.spindles, 0) : null, reason };
  });
}

// TFO type used for spindle realisation: the old machines (name contains "old"),
// else the type with the most machines, else the first one.
export function refTfoType(types) {
  if (!types || !types.length) return null;
  const old = types.find((t) => /\bold\b/i.test(String(t.name || '')));
  if (old) return old;
  return types.slice().sort((a, b) => (num(b.machines) ?? -1) - (num(a.machines) ?? -1))[0];
}

// Spindle profitability at one unit: profit per pick (realisation with VATAV − the unit's cost per pick)
// ÷ spindles a single-panna loom needs per day for its TPM warp and weft, on the unit's reference TFO type.
// Null for fabrics with no TPM yarn. Profit can be negative.
export function spindleProfit(calc, fabric, unit, idx) {
  if (!calc.tpmLines.length || !unit) return null;
  if (!unitHasTfo(calc, unit, idx)) return { value: null, spindles: null, unit, type: null, reason: 'No TFO division in this unit' };
  const type = refTfoType(idx.tfoTypesByUnit[unit.id] || []);
  const s = spindlesForUnit(calc, fabric, unit, idx, 1).find((x) => x.type.id === type.id);
  const spindles = s ? s.total : null;
  const missingSpeed = s ? s.perYarn.filter((p) => !p.speed).map((p) => p.yarn.name) : [];
  const profit = unitProfit(calc, unit).profitPerPick;
  let reason = null;
  if (spindles === null) reason = missingSpeed.length ? `No TFO speed for ${missingSpeed.join(', ')}` : (s && s.reason) || 'Spindles not available';
  else if (profit === null) reason = num(unit.cost_per_pick) === null ? 'Set cost per pick on the unit' : 'Realisation not available';
  const value = spindles && profit !== null ? profit / spindles : null;
  return { value, spindles, unit, type, reason };
}

// ---------- formatting ----------
export const fmt = {
  rs: (v, dp = 2) => (v === null || v === undefined ? '—' : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`),
  // Profit per pick per spindle: small numbers, so five decimals, signed.
  spin: (v) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : '−'}₹${Math.abs(v).toFixed(5)}`),
  pick: (v) => (v === null || v === undefined ? '—' : `₹${Number(v).toFixed(3)}`),
  signedPick: (v) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : '−'}₹${Math.abs(v).toFixed(3)}`),
  n: (v, dp = 1) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })),
  rate: (v) => (v === null || v === undefined ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`),
  int: (v) => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString('en-IN')),
  // "2026-10-02" (or a date-time) → "2 Oct 2026"; blank or unreadable → ''.
  date: (v) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? '').trim());
    if (!m) return '';
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1];
    return mon ? `${Number(m[3])} ${mon} ${m[1]}` : '';
  },
};
