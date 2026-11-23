import { fmt, isTpm, num, yarnCountLabel, yarnDenier, yarnRate, baseOf } from './calc.js';

export function yarnShort(yarn, idx) {
  if (!yarn) return '?';
  const c = yarnCountLabel(yarn, idx);
  return `${c || yarn.name}${isTpm(yarn) ? ' TPM' : ''}`;
}

export function sideLabel(lines, idx) {
  if (!lines.length) return '—';
  return lines.map((x) => yarnShort(x.yarn, idx)).join(' + ');
}

export function constructionLine(fabric, calc, idx) {
  const reed = num(fabric.reed);
  const rp = reed ? `${reed} × ${calc.ppi ?? '—'}` : `PPI ${calc.ppi ?? '—'}`;
  return `${rp} · ${sideLabel(calc.warp, idx)} × ${sideLabel(calc.weft, idx)}`;
}

export function yarnSub(yarn, idx) {
  if (!yarn) return '';
  if (isTpm(yarn)) {
    const base = baseOf(yarn, idx);
    return [base ? `From ${base.name}` : 'Base not set', yarn.tpm ? `${yarn.tpm} TPM` : null, yarn.twist || null].filter(Boolean).join(' · ');
  }
  const d = yarnDenier(yarn, idx);
  return [yarn.material, yarn.form, yarnCountLabel(yarn, idx), yarn.count_unit === 'Ne' && d ? `≈${fmt.n(d, 0)}D` : null].filter(Boolean).join(' · ');
}

// Yarn list (phone): the rate and "per kg" on the right; how the rate is made (base + delta, temporary,
// master) goes on the left under the name, so the description keeps its width (B15).
export function rateLabel(yarn, idx) {
  const r = yarnRate(yarn, idx);
  if (!r) return { value: '—', sub: 'No rate', basis: '' };
  if (r.delta !== undefined) return { value: fmt.rate(r.rate), temp: !!r.temp, sub: 'per kg', basis: `base ${fmt.rate(r.baseRate)}${r.tempBase ? ' (temp)' : ''} + ${fmt.rate(r.delta)}${r.tempDelta ? ' (temp)' : ''}${r.temp && r.masterRate !== null && r.masterRate !== undefined ? `, master ${fmt.rate(r.masterRate)}` : ''}` };
  if (r.temp) return { value: fmt.rate(r.rate), temp: true, sub: 'per kg', basis: r.masterRate === null ? 'temporary' : `temporary, master ${fmt.rate(r.masterRate)}` };
  return { value: fmt.rate(r.rate), sub: 'per kg', basis: '' };
}

export function yarnOptions(idx) {
  const yarns = Object.values(idx.yarnsById).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const base = yarns.filter((y) => !isTpm(y));
  const tpm = yarns.filter((y) => isTpm(y));
  const out = [];
  if (base.length) out.push({ group: 'Base yarns', options: base.map((y) => ({ value: y.id, label: y.name })) });
  if (tpm.length) out.push({ group: 'TPM yarns', options: tpm.map((y) => ({ value: y.id, label: y.name })) });
  return out;
}

export function unitsOf(fabricId, idx) {
  return (idx.assignmentsByFabric[fabricId] || []).map((a) => idx.unitsById[a.unit_id]).filter(Boolean);
}
