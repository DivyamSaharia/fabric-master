// Detailed fabric share: one model, drawn as a PDF and written as a one-sheet Excel file.
// Everything comes from the same calc the fabric page uses (calc.js); nothing is worked out differently here.
// Cells are plain strings, or { t, v }: t is the text the PDF prints, v the value Excel stores (numbers as numbers).
import {
  fmt, isTpm, loomRealisationForUnit, num, productionForUnit, spindleProfit, spindlesForUnit, tfoPerSide,
  tpmDelta, unitHasTfo, unitProfit, yarnRate,
} from '../calc.js';
import { unitsOf } from '../describe.js';
import { beamRowsOf, slotLabel } from '../machines.js';
import { today } from '../schema.js';
import { deliver, fileName, preloadExports, tempRatesText, writeBook } from './exports.js';

const round = (v, dp) => (v === null || v === undefined ? '' : Math.round(v * 10 ** dp) / 10 ** dp);
// u: the unit Excel shows beside a number in label/value rows (tables carry it in the column heading)
const cell = (t, v, u = '') => ({ t, v, u });
const N = (v, dp = 1, unit = '') => (v === null || v === undefined ? cell('—', '') : cell(`${fmt.n(v, dp)}${unit}`, round(v, dp), unit.trim()));
const I = (v, unit = '') => (v === null || v === undefined ? cell('—', '') : cell(`${fmt.int(v)}${unit}`, Math.round(v), unit.trim()));
const R = (v, dp = 2, unit = '') => (v === null || v === undefined ? cell('—', '') : cell(`${fmt.rs(v, dp)}${unit}`, round(v, dp), `₹${unit}`));
const PK = (v) => (v === null || v === undefined ? cell('—', '') : cell(`${fmt.pick(v)} / pick`, round(v, 4), '₹ / pick'));
const SP = (v) => (v === null || v === undefined ? cell('—', '') : cell(`${fmt.signedPick(v)} / pick`, round(v, 4), '₹ / pick'));
const PCT = (v) => (num(v) === null ? cell('—', '') : cell(`${fmt.n(num(v), num(v) % 1 ? 1 : 0)}%`, num(v), '%'));
export const cellText = (c) => (c && typeof c === 'object' ? c.t : c === null || c === undefined ? '' : String(c));
// The PDF font has no "÷" glyph (jsPDF drops the rest of the line after it), so the PDF writes "/".
const pdfText = (c) => cellText(c).replace(/÷/g, '/');
export const cellValue = (c) => (c && typeof c === 'object' ? c.v : c === null || c === undefined ? '' : c);

// Rate used for one yarn and where it comes from.
function rateRow(yarn, idx) {
  const r = yarnRate(yarn, idx);
  const tpm = isTpm(yarn);
  const base = tpm ? idx.yarnsById[yarn.base_yarn_id] : null;
  if (!r) return [yarn.name, tpm ? 'TPM' : 'Base', base ? base.name : '—', '—', tpm ? R(tpmDelta(yarn)) : '—', '—', 'No rate'];
  if (r.tpmTemp) {
    return [yarn.name, 'TPM', base ? base.name : '—', '—', '—', R(r.rate), `Temporary, typed on the TPM yarn (master ${r.masterRate === null ? 'not set' : fmt.rate(r.masterRate)})`];
  }
  if (tpm) {
    return [yarn.name, 'TPM', base ? base.name : '—', R(r.baseRate), R(r.delta), R(r.rate), r.temp ? `Temporary base rate (master ${r.masterBaseRate === null || r.masterBaseRate === undefined ? 'not set' : fmt.rate(r.masterBaseRate)}) + delta` : `Base rate from ${fmt.date(r.date) || '—'} + delta`];
  }
  return [yarn.name, 'Base', '—', R(r.rate), '—', R(r.rate), r.temp ? `Temporary (master ${r.masterRate === null ? 'not set' : fmt.rate(r.masterRate)})` : `Master, from ${fmt.date(r.date) || '—'}`];
}

export function detailedModel(fabric, calc, idx) {
  const rfd = calc.finish === 'RFD';
  const per = rfd ? 'RFD m' : 'm';
  const units = unitsOf(fabric.id, idx);
  const sections = [];
  const pctTxt = (v) => (num(v) === null ? '—' : `${num(v)}%`);

  // key figures (first unit with a cost per pick for profit; first loom width for loom realisation)
  const costUnit = units.find((u) => num(u.cost_per_pick) !== null) || null;
  const profit = costUnit ? unitProfit(calc, costUnit) : null;
  const loomUnit = units.find((u) => (idx.loomGroupsByUnit[u.id] || []).length) || null;
  const firstLoom = loomUnit ? loomRealisationForUnit(calc, fabric, loomUnit, idx).find((x) => x.value !== null) || null : null;
  const figures = [
    { label: 'Realisation with VATAV', value: `${fmt.pick(calc.realisationNetPerPick)} / pick`, v: round(calc.realisationNetPerPick, 4), u: '₹ / pick', sub: `${fmt.rs(calc.realisationNetPerM)} / ${per}`, accent: true },
    { label: 'Without VATAV', value: `${fmt.pick(calc.realisationPerPick)} / pick`, v: round(calc.realisationPerPick, 4), u: '₹ / pick', sub: `${fmt.rs(calc.realisationPerM)} / ${per}` },
    { label: 'Sale rate', value: `${fmt.rs(calc.price)} / ${per}`, v: round(calc.price, 2), u: `₹ / ${per}`, sub: calc.priceTemp ? `temporary · master ${calc.masterPrice === null ? 'not set' : fmt.rs(calc.masterPrice)}` : fmt.date(fabric.sale_date) ? `sale date ${fmt.date(fabric.sale_date)}` : 'no sale date' },
    { label: rfd ? 'RFD cost' : 'RM cost', value: `${fmt.rs(rfd ? calc.rfdCost : calc.rmCost)} / ${per}`, v: round(rfd ? calc.rfdCost : calc.rmCost, 2), u: `₹ / ${per}`, sub: rfd ? `RM ${fmt.rs(calc.rmPerSaleM)} + finishing ${fmt.rs(calc.finishingCost)}` : 'shortage included' },
    ...(profit ? [{ label: `Profit · ${costUnit.name}`, value: `${fmt.signedPick(profit.profitPerPick)} / pick`, v: round(profit.profitPerPick, 4), u: '₹ / pick', sub: `cost ${fmt.pick(profit.costPerPick)} / pick` }] : []),
    ...(firstLoom ? [{ label: `Loom realisation · ${fmt.int(firstLoom.width)} cm`, value: `${fmt.rs(firstLoom.value, 0)} / day`, v: round(firstLoom.value, 0), u: '₹ / loom / day', sub: `${loomUnit.name} · ${firstLoom.panna === 2 ? 'double' : 'single'} panna` }] : []),
    { label: 'GSM (estimate)', value: fmt.n(calc.gsm, 1), v: round(calc.gsm, 1), u: 'g/m²', sub: `${fmt.n(calc.totalGpm, 1)} g/m · ${fmt.n(calc.kgPer100, 2)} kg/100 m` },
  ];

  sections.push({
    title: 'Construction',
    kind: 'kv',
    rows: [
      ['Reed', fabric.reed || '—'],
      ['Pick (PPI)', calc.ppi === null ? '—' : I(calc.ppi)],
      ['Total ends', I(calc.totalEnds)],
      ['Reed space', calc.rs ? N(calc.rs, calc.rs % 1 ? 1 : 0, '″') : '—'],
      ['Greige width', calc.width ? N(calc.width, calc.width % 1 ? 1 : 0, '″') : '—'],
      ['Weave', [fabric.weave, fabric.design_note].filter(Boolean).join(' · ') || '—'],
      ['Warp shortage', PCT(fabric.warp_shortage_pct)],
      ['Weft shortage', PCT(fabric.weft_shortage_pct)],
      ['Loom RPM · single panna', num(fabric.loom_rpm) ? I(num(fabric.loom_rpm)) : '—'],
      ['Loom RPM · double panna', num(fabric.loom_rpm_dp) ? I(num(fabric.loom_rpm_dp)) : '—'],
      ['Finish', calc.finish],
      ['TFO class', calc.tfoClass],
      ...(fabric.end_use ? [['End use', fabric.end_use]] : []),
    ],
  });

  // yarn rates: one row per yarn, in warp then weft order
  const seen = new Set();
  const rateRows = [];
  for (const x of [...calc.warp, ...calc.weft]) {
    if (!x.yarn || seen.has(x.yarn.id)) continue;
    seen.add(x.yarn.id);
    rateRows.push(rateRow(x.yarn, idx));
  }
  sections.push({
    title: 'Yarn rates',
    kind: 'table',
    head: ['Yarn', 'Type', 'Base yarn', 'Base ₹/kg', 'Delta ₹/kg', 'Rate used ₹/kg', 'Basis'],
    align: { 3: 'right', 4: 'right', 5: 'right' },
    widths: { 6: 52 },
    rows: rateRows,
  });

  const lines = [...calc.warp, ...calc.weft];
  sections.push({
    title: 'Consumption per greige metre',
    note: 'Shortage included.',
    kind: 'table',
    head: ['Side', 'Yarn', 'Denier', 'Ends', 'Pick share %', 'g/m', 'kg/100 m'],
    align: { 2: 'right', 3: 'right', 4: 'right', 5: 'right', 6: 'right' },
    rows: [
      ...lines.map((x) => [
        x.line.side === 'warp' ? 'Warp' : 'Weft',
        `${x.yarn ? x.yarn.name : '—'}${x.line.pattern ? ` (${x.line.pattern})` : ''}`,
        N(x.denier, 1),
        x.line.side === 'warp' ? I(x.ends) : '',
        x.line.side === 'weft' ? N((x.share || 0) * 100, 1, '%') : '',
        N(x.gpm, 2),
        N(x.kgPer100, 3),
      ]),
      { total: true, cells: ['Total', '', '', '', '', N(calc.totalGpm, 2), N(calc.kgPer100, 3)] },
    ],
  });

  sections.push({
    title: 'Raw material cost per greige metre',
    kind: 'table',
    head: ['Side', 'Yarn', 'kg/m', 'Rate ₹/kg', '₹/m'],
    align: { 2: 'right', 3: 'right', 4: 'right' },
    rows: [
      ...lines.map((x) => [
        x.line.side === 'warp' ? 'Warp' : 'Weft',
        x.yarn ? x.yarn.name : '—',
        x.gpm === null ? cell('—', '') : N(x.gpm / 1000, 5),
        x.rate === null ? cell('—', '') : cell(`${fmt.n(x.rate, 2)}${x.temp ? ' (temp)' : ''}`, round(x.rate, 2)),
        R(x.costPerM),
      ]),
      { total: true, cells: ['RM cost', '', '', '', R(calc.rmCost)] },
    ],
  });

  const g = calc.g;
  const brokering = rfd ? (num(fabric.brokering_pct) ?? 0) : 0;
  sections.push({
    title: rfd ? 'Cost breakdown · RFD' : 'Cost breakdown · greige',
    kind: 'kv',
    single: true,
    rows: rfd
      ? [
          ['RM cost per greige m', R(calc.rmCost, 2, ' / m')],
          ['RFD shortage', PCT(fabric.rfd_shortage_pct)],
          ['Greige m per RFD m', N(g, 4), '1 ÷ (1 − RFD shortage)'],
          ['RM cost per RFD m', R(calc.rmPerSaleM, 2, ' / RFD m'), 'RM cost × greige m per RFD m'],
          ['Processing', R(g !== null ? (num(fabric.processing_charge) ?? 0) * g : null, 2, ' / RFD m'), `${fmt.rs(num(fabric.processing_charge) ?? 0)} per greige m × ${fmt.n(g, 4)}`],
          ['Transportation', R(calc.transport, 2, ' / RFD m'), 'per RFD m, as is'],
          ['Brokering', R(calc.price !== null ? (brokering / 100) * calc.price : null, 2, ' / RFD m'), `${brokering}% of the sale rate`],
          ['Finishing cost', R(calc.finishingCost, 2, ' / RFD m'), 'processing + transportation + brokering'],
          { total: true, cells: ['RFD cost', R(calc.rfdCost, 2, ' / RFD m'), 'RM per RFD m + finishing'] },
        ]
      : [
          { total: true, cells: ['RM cost (shortage included)', R(calc.rmCost, 2, ' / m'), 'the whole cost for greige'] },
        ],
  });

  sections.push({
    title: 'Sale rate and realisation',
    kind: 'kv',
    single: true,
    rows: [
      ['Sale rate', R(calc.price, 2, ` / ${per}`), calc.priceTemp ? `temporary on this device · master ${calc.masterPrice === null ? 'not set' : fmt.rs(calc.masterPrice)}` : ''],
      ['Sale date', fmt.date(fabric.sale_date) || '—'],
      [rfd ? 'RFD cost' : 'RM cost', R(rfd ? calc.rfdCost : calc.rmCost, 2, ` / ${per}`)],
      ['Realisation without VATAV', R(calc.realisationPerM, 2, ` / ${per}`), 'sale rate − cost'],
      ['Picks per sale metre', N(calc.picksPerSaleM, 2), rfd ? 'PPI × greige m per RFD m' : 'PPI'],
      ['Realisation per pick without VATAV', PK(calc.realisationPerPick)],
      ['VATAV', calc.vatavPct ? cell(`${fmt.n(calc.vatavPct, calc.vatavPct % 1 ? 1 : 0)}% · −${fmt.rs(calc.vatavAmount)} / ${per}`, round(calc.vatavAmount, 2), `₹ / ${per} (VATAV ${fmt.n(calc.vatavPct, calc.vatavPct % 1 ? 1 : 0)}%)`) : cell('None', 0), calc.vatavPct ? '₹ off the sale rate' : ''],
      ['Realisation with VATAV', R(calc.realisationNetPerM, 2, ` / ${per}`)],
      { total: true, cells: ['Realisation per pick with VATAV', PK(calc.realisationNetPerPick)] },
    ],
  });

  // per unit: profit, looms per width, yarn-wise kg, TFO and spindles
  for (const u of units) {
    const p = unitProfit(calc, u);
    const widths = loomRealisationForUnit(calc, fabric, u, idx);
    const prod = productionForUnit(calc, fabric, u, idx);
    const kv = [
      ['Cost per pick', p.costPerPick === null ? '—' : cell(`${fmt.pick(p.costPerPick)} / pick`, round(p.costPerPick, 4), '₹ / pick')],
      ['Profit per pick (with VATAV)', SP(p.profitPerPick), 'realisation per pick with VATAV − cost per pick'],
      ['Profit per sale metre', R(p.profitPerM, 2, ` / ${per}`)],
      ['Loom efficiency', PCT(u.loom_eff_pct), 'set on the unit'],
    ];
    const sp = spindleProfit(calc, fabric, u, idx);
    if (sp && sp.value !== null) kv.push(['Spindle profitability', cell(fmt.spin(sp.value), round(sp.value, 6), '₹ / pick / spindle'), `per pick per spindle: profit per pick ÷ ${fmt.int(sp.spindles)} spindles a single panna loom needs on ${sp.type.name}`]);
    else if (sp) kv.push(['Spindle profitability', '—', sp.reason || '']);
    sections.push({ title: `Unit · ${u.name}`, kind: 'kv', single: true, rows: kv, unitStart: true });

    if (widths.length) {
      sections.push({
        title: `Looms · ${u.name}`,
        note: 'Per loom per day.',
        kind: 'table',
        head: ['Loom width', 'Loom type', 'Panna', 'RPM', 'Efficiency %', 'm/day', 'Warp kg', 'Weft kg', 'Loom realisation ₹/day'],
        align: { 3: 'right', 4: 'right', 5: 'right', 6: 'right', 7: 'right', 8: 'right' },
        rows: widths.map((w) => {
          const gs = prod.filter((x) => num(x.group.reed_width_cm) === w.width).map((x) => x.group.shedding || 'Plain');
          const l = w.loom;
          return [
            w.width ? `${fmt.int(w.width)} cm` : '—',
            [...new Set(gs)].join(', '),
            w.panna === 2 ? 'Double' : w.panna === 1 ? 'Single' : '—',
            l && l.rpm ? I(l.rpm) : '—',
            l ? PCT(l.eff) : '—',
            l ? I(l.mPerDay) : cell(w.reason || '—', ''),
            l ? N(l.warpKg, 1) : '—',
            l ? N(l.weftKg, 1) : '—',
            w.value === null ? cell(w.reason || '—', '') : R(w.value, 0, ' / day'),
          ];
        }),
      });
      const byWidth = widths.map((w) => prod.find((x) => num(x.group.reed_width_cm) === w.width));
      const yarnKeys = [];
      for (const x of byWidth) for (const y of (x && x.yarns) || []) if (!yarnKeys.some((k) => k.side === y.side && k.yarn.id === y.yarn.id)) yarnKeys.push(y);
      if (yarnKeys.length) {
        sections.push({
          title: `Yarn-wise consumption · ${u.name}`,
          note: 'kg per loom per day, shortage included.',
          kind: 'table',
          head: ['Side', 'Yarn', ...widths.map((w) => `${fmt.int(w.width)} cm`)],
          align: Object.fromEntries(widths.map((_, i) => [i + 2, 'right'])),
          rows: yarnKeys.map((k) => [
            k.side === 'warp' ? 'Warp' : 'Weft',
            k.yarn.name,
            ...byWidth.map((x) => {
              const y = x && (x.yarns || []).find((o) => o.side === k.side && o.yarn.id === k.yarn.id);
              return N(y ? y.kg : null, 1);
            }),
          ]),
        });
      }
    }

    if (unitHasTfo(calc, u, idx)) {
      const per = tfoPerSide(calc, u, idx);
      const s1 = spindlesForUnit(calc, fabric, u, idx, 1);
      const s2 = spindlesForUnit(calc, fabric, u, idx, 2);
      const spin = (list, typeId, yarnId) => {
        const s = list.find((x) => x.type.id === typeId);
        const parts = s ? s.perYarn.filter((p) => p.yarn.id === yarnId) : [];
        return parts.length && parts.every((p) => p.spindles !== null) ? parts.reduce((a, p) => a + p.spindles, 0) : null;
      };
      const rows = [];
      for (const t of per) {
        for (const y of t.yarns) {
          rows.push([
            t.type.name,
            y.yarn.name,
            y.sides.map((x) => (x === 'warp' ? 'Warp' : 'Weft')).join(' + '),
            y.rpm === null ? '—' : I(y.rpm),
            I(num(y.yarn.tpm)),
            PCT(y.eff),
            I(t.perSide),
            y.kgPerSide === null ? cell(y.reason || '—', '') : N(y.kgPerSide, 1),
            I(spin(s1, t.type.id, y.yarn.id)),
            I(spin(s2, t.type.id, y.yarn.id)),
          ]);
        }
        if (t.yarns.length > 1) {
          const a = s1.find((x) => x.type.id === t.type.id);
          const b = s2.find((x) => x.type.id === t.type.id);
          rows.push({ total: true, cells: [t.type.name, 'All TPM yarns', '', '', '', '', '', '', I(a ? a.total : null), I(b ? b.total : null)] });
        }
      }
      sections.push({
        title: `TFO and spindles · ${u.name}`,
        note: 'TFO RPM as stored (already × 2). kg per side per day. Spindles one loom needs per day.',
        kind: 'table',
        head: ['TFO type', 'TPM yarn', 'Side', 'TFO RPM', 'TPM', 'TFO eff. %', 'Spindles / side', 'kg / side', 'Spindles · single panna', 'Spindles · double panna'],
        align: { 3: 'right', 4: 'right', 5: 'right', 6: 'right', 7: 'right', 8: 'right', 9: 'right' },
        rows,
      });
    }
  }
  if (!units.length) sections.push({ title: 'Units', kind: 'kv', single: true, rows: [['Units', 'Not assigned to any unit yet: no profit, loom or spindle figures']] });

  const beams = beamRowsOf(fabric.id, idx);
  if (beams.length) {
    sections.push({
      title: 'Beam length',
      kind: 'table',
      head: ['Unit', 'Loom group', 'Beam length m'],
      align: { 2: 'right' },
      rows: beams.map((b) => [b.unit.name, slotLabel(b), b.length === null ? 'Not set' : N(b.length, 0, ' m')]),
    });
  }

  const notes = [
    `Consumption: warp g/m = ends × denier ÷ 9000 × (1 + warp shortage); weft g/m = PPI × reed space × pick share × denier ÷ 9000 × (1 + weft shortage). Shortage here: warp ${pctTxt(fabric.warp_shortage_pct)}, weft ${pctTxt(fabric.weft_shortage_pct)}.`,
    'A TPM yarn costs its base yarn rate plus its delta, unless a temporary rate is typed on the TPM yarn itself.',
    `Realisation per pick = (sale rate − ${rfd ? 'RFD cost' : 'RM cost'}) ÷ picks per sale metre; with VATAV, the VATAV amount is also taken off.${rfd ? ' RFD cost = RM cost × greige m per RFD m + processing × greige m per RFD m + transportation + brokering % × sale rate.' : ''}`,
    'Loom metres per day = RPM × 1440 × loom efficiency ÷ (PPI × 39.37) × panna. Looms narrower than 250 cm use the fabric\'s single panna RPM; 280 cm looms use its double panna RPM (the 280 cm RPM), single or double panna, and single panna is not doubled. Loom efficiency is the unit\'s. Double panna where two reed spaces fit the loom\'s reed width (÷ 2.54, + 0.5″).',
    'Loom realisation = realisation per pick with VATAV × metres per loom per day × PPI. Profit per pick = realisation per pick with VATAV − the unit\'s cost per pick.',
    ...(calc.tpmLines.length ? ['TFO kg per spindle per day = TFO RPM ÷ TPM × 1440 × TFO efficiency × denier ÷ 9,000,000; the RPM is stored already × 2. kg per side = per spindle × spindles per side (252). Spindles per loom = TPM kg a loom uses per day ÷ kg per spindle per day. Spindle profitability = profit per pick ÷ spindles a single panna loom needs on the old TFO machines.'] : []),
    'Figures use the latest yarn rates.',
    ...(tempRatesText(idx) ? [tempRatesText(idx)] : []),
  ];

  return {
    title: fabric.name || 'Fabric',
    subtitle: [fabric.weave, fabric.design_note, fabric.end_use, calc.finish, calc.tfoClass].filter(Boolean).join(' · '),
    date: today(),
    figures,
    sections,
    notes,
    tempText: tempRatesText(idx),
  };
}

// ---------- PDF ----------
let logoData;
async function loadLogo() {
  if (logoData !== undefined) return logoData;
  try {
    const res = await fetch('./icon-192.png');
    if (!res.ok) throw new Error('no logo');
    const blob = await res.blob();
    logoData = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('no logo'));
      r.readAsDataURL(blob);
    });
  } catch {
    logoData = null;
  }
  return logoData;
}
export const setLogoForTests = (data) => { logoData = data; };

export async function buildDetailedPdf(fabric, calc, idx) {
  const { jsPDF, autoTable, font } = await preloadExports();
  const m = detailedModel(fabric, calc, idx);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.addFileToVFS('DejaVuSans.ttf', font.DEJAVU_REGULAR);
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', font.DEJAVU_BOLD);
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  doc.setFont('DejaVu', 'normal');
  const PW = 210, PH = 297, M = 14, W = PW - 2 * M;
  const ink = [28, 28, 30], grey = [108, 108, 112], green = [43, 106, 31], deep = [0, 42, 0], line = [209, 209, 214], fill = [244, 246, 241];

  // header: logo, report name, fabric, date
  const logo = await loadLogo();
  let x0 = M;
  if (logo) {
    try {
      doc.addImage(logo, 'PNG', M, 10, 16, 16);
      x0 = M + 20;
    } catch {
      /* logo optional */
    }
  }
  doc.setFontSize(9);
  doc.setTextColor(...green);
  doc.setFont('DejaVu', 'bold');
  doc.text('HANUMAN GROUP · DETAILED FABRIC REPORT', x0, 14);
  doc.setFont('DejaVu', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...ink);
  doc.text(m.title, x0, 21.5);
  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...grey);
  doc.text(m.subtitle, x0, 26.5);
  doc.text(fmt.date(m.date), PW - M, 14, { align: 'right' });
  doc.setFont('DejaVu', 'bold');
  doc.setTextColor(158, 90, 0);
  doc.text('INTERNAL', PW - M, 19, { align: 'right' });
  doc.setFont('DejaVu', 'normal');
  doc.setTextColor(...grey);
  doc.setDrawColor(...green);
  doc.setLineWidth(0.6);
  doc.line(M, 30, PW - M, 30);
  let y = 35;

  // key figures: tiles, four to a row
  const cols = 4, gap = 3, tw = (W - gap * (cols - 1)) / cols, th = 19;
  m.figures.forEach((f, i) => {
    const cx = M + (i % cols) * (tw + gap);
    const cy = y + Math.floor(i / cols) * (th + gap);
    doc.setFillColor(...(f.accent ? [232, 241, 226] : fill));
    doc.roundedRect(cx, cy, tw, th, 1.8, 1.8, 'F');
    doc.setFontSize(7);
    doc.setTextColor(...grey);
    doc.text(f.label.toUpperCase(), cx + 3, cy + 5, { maxWidth: tw - 6 });
    doc.setFont('DejaVu', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(...(f.accent ? green : ink));
    doc.text(f.value, cx + 3, cy + 11.5, { maxWidth: tw - 6 });
    doc.setFont('DejaVu', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...grey);
    doc.text(doc.splitTextToSize(f.sub || '', tw - 6)[0] || '', cx + 3, cy + 16);
  });
  y += Math.ceil(m.figures.length / cols) * (th + gap) + 4;

  const heading = (s) => {
    if (y > PH - 40) {
      doc.addPage();
      y = 18;
    }
    doc.setFont('DejaVu', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...deep);
    doc.text(s.title, M, y);
    if (s.note) {
      doc.setFont('DejaVu', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...grey);
      // a short note sits at the right of the heading, a long one on its own line under it
      if (s.note.length <= 50) doc.text(s.note, PW - M, y, { align: 'right' });
      else {
        y += 4.2;
        doc.text(s.note, M, y);
      }
    }
    y += 2;
  };
  const base = {
    margin: { left: M, right: M, top: 16, bottom: 16 },
    tableWidth: W,
    styles: { font: 'DejaVu', fontSize: 8.5, cellPadding: 1.6, textColor: ink, lineColor: line, lineWidth: 0.1, overflow: 'linebreak' },
    headStyles: { font: 'DejaVu', fontStyle: 'bold', fillColor: [236, 240, 232], textColor: deep, fontSize: 8 },
    theme: 'grid',
  };
  const totalStyle = { fontStyle: 'bold', fillColor: fill };
  const rowCells = (r) => (Array.isArray(r) ? r : r.cells);

  for (const s of m.sections) {
    if (s.unitStart && y > PH - 70) {
      doc.addPage();
      y = 18;
    }
    // a short section is not split over two pages
    const rowsHigh = (s.kind === 'kv' && !s.single ? Math.ceil(s.rows.length / 2) : s.rows.length) + (s.kind === 'table' ? 1.5 : 0);
    const est = rowsHigh * 6.4 + 10;
    const room = PH - 18 - y;
    if (est > room && (rowsHigh <= 7 || room < 45)) {
      doc.addPage();
      y = 18;
    }
    heading(s);
    if (s.kind === 'table') {
      const columnStyles = {};
      for (const [k, v] of Object.entries(s.align || {})) columnStyles[k] = { ...(columnStyles[k] || {}), halign: v };
      for (const [k, v] of Object.entries(s.widths || {})) columnStyles[k] = { ...(columnStyles[k] || {}), cellWidth: v };
      autoTable(doc, {
        ...base,
        startY: y,
        head: [s.head],
        body: s.rows.map((r) => rowCells(r).map((c) => (Array.isArray(r) ? pdfText(c) : { content: pdfText(c), styles: totalStyle }))),
        columnStyles,
      });
    } else if (s.single) {
      autoTable(doc, {
        ...base,
        startY: y,
        body: s.rows.map((r) => {
          const c = rowCells(r);
          const total = !Array.isArray(r);
          const st = total ? totalStyle : {};
          return [{ content: pdfText(c[0]), styles: { ...st, textColor: total ? ink : grey } }, { content: pdfText(c[1]), styles: { ...st, fontStyle: 'bold', halign: 'right' } }, { content: pdfText(c[2] || ''), styles: { ...st, textColor: grey, fontSize: 7.5 } }];
        }),
        columnStyles: { 0: { cellWidth: 60 }, 1: { cellWidth: 50 } },
      });
    } else {
      // two label/value pairs per line
      const body = [];
      for (let i = 0; i < s.rows.length; i += 2) {
        const a = s.rows[i], b = s.rows[i + 1];
        body.push([pdfText(a[0]), pdfText(a[1]), b ? pdfText(b[0]) : '', b ? pdfText(b[1]) : '']);
      }
      autoTable(doc, { ...base, startY: y, body, columnStyles: { 0: { textColor: grey, cellWidth: 44 }, 1: { fontStyle: 'bold' }, 2: { textColor: grey, cellWidth: 44 }, 3: { fontStyle: 'bold' } } });
    }
    y = doc.lastAutoTable.finalY + 7;
  }

  // how the figures are worked out
  heading({ title: 'How these figures are worked out' });
  y += 2;
  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(7.8);
  for (const n of m.notes) {
    const lines = doc.splitTextToSize(`• ${pdfText(n)}`, W);
    if (y + lines.length * 3.5 > PH - 16) {
      doc.addPage();
      y = 18;
    }
    doc.setTextColor(...(m.tempText && n === m.tempText ? [158, 90, 0] : grey));
    doc.text(lines, M, y);
    y += lines.length * 3.5 + 1.2;
  }

  // footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('DejaVu', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...grey);
    doc.setDrawColor(...line);
    doc.setLineWidth(0.2);
    doc.line(M, PH - 11, PW - M, PH - 11);
    doc.text(`${m.title} · detailed report · ${fmt.date(m.date)} · internal: contains costs, yarn rates and profit`, M, PH - 7);
    doc.text(`Page ${p} of ${pages}`, PW - M, PH - 7, { align: 'right' });
  }
  return doc.output('blob');
}

export async function exportFabricPdfDetailed(fabric, calc, idx, opts = {}) {
  const blob = await buildDetailedPdf(fabric, calc, idx);
  await deliver(blob, fileName(fabric.name, 'detailed', 'pdf'), `${fabric.name} detailed report`, opts);
}

// ---------- Excel: one sheet, the same sections top to bottom ----------
export function detailedAoa(model) {
  const aoa = [];
  aoa.push(['Hanuman Group · Detailed fabric report · INTERNAL: contains costs, yarn rates and profit']);
  aoa.push([model.title]);
  aoa.push([model.subtitle]);
  aoa.push([`Date: ${fmt.date(model.date)}`]);
  aoa.push([]);
  aoa.push(['KEY FIGURES']);
  for (const f of model.figures) aoa.push(f.v === '' || f.v === undefined ? [f.label, f.value, '', f.sub || ''] : [f.label, f.v, f.u || '', f.sub || '']);
  for (const s of model.sections) {
    aoa.push([]);
    aoa.push([s.title.toUpperCase(), ...(s.note ? [s.note] : [])]);
    if (s.kind === 'table') aoa.push(s.head);
    for (const r of s.rows) {
      const cells = Array.isArray(r) ? r : r.cells;
      if (s.kind === 'table') aoa.push(cells.map(cellValueOrText));
      else aoa.push([cellText(cells[0]), cellValueOrText(cells[1]), cells[1] && typeof cells[1] === 'object' && cellValue(cells[1]) !== '' ? cells[1].u || '' : '', cellText(cells[2] || '')]);
    }
  }
  aoa.push([]);
  aoa.push(['HOW THESE FIGURES ARE WORKED OUT']);
  for (const n of model.notes) aoa.push([n]);
  return aoa;
}
// numbers go in as numbers; a blank number keeps its text ('—' or the reason)
const cellValueOrText = (c) => {
  const v = cellValue(c);
  return v === '' ? cellText(c) : v;
};

export async function buildDetailedXlsx(fabric, calc, idx) {
  const { XLSX } = await preloadExports();
  const model = detailedModel(fabric, calc, idx);
  const aoa = detailedAoa(model);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const widest = Math.max(...aoa.map((r) => r.length));
  ws['!cols'] = Array.from({ length: widest }, (_, i) => ({ wch: i === 0 ? 34 : i === 1 ? 26 : 18 }));
  ws['!merges'] = [0, 1, 2, 3].map((r) => ({ s: { r, c: 0 }, e: { r, c: Math.max(3, widest - 1) } }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Detailed report');
  return writeBook(XLSX, wb);
}

export async function exportFabricXlsxDetailed(fabric, calc, idx, opts = {}) {
  const blob = await buildDetailedXlsx(fabric, calc, idx);
  await deliver(blob, fileName(fabric.name, 'detailed', 'xlsx'), `${fabric.name} detailed report`, opts);
}
