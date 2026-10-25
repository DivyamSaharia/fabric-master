// TFO planner exports: a PDF and an Excel workbook of the plan on screen (saved or not).
import { fmt } from '../calc.js';
import { groupLabel } from '../planner.js';
import { deliver, preloadExports, sheetFromRows, slug, writeBook } from './exports.js';
import { today } from '../schema.js';

export const planFileName = (meta, ext) => `${meta.date}_tfo-plan_${slug(meta.name || 'plan')}.${ext}`;

const r = (v, dp = 2) => (v === null || v === undefined ? '' : Math.round(v * 10 ** dp) / 10 ** dp);
const n1 = (v) => (v === null || v === undefined ? '—' : fmt.n(v, 1));
const n0 = (v) => (v === null || v === undefined ? '—' : fmt.int(v));
const signed = (v) => (v === null || v === undefined ? '—' : `${v > 0.05 ? '+' : v < -0.05 ? '−' : ''}${fmt.n(Math.abs(v), 1)}`);
const setText = (s) => (s.value === null ? 'Enter' : `${fmt.n(s.value, s.value % 1 ? 1 : 0)}${s.edited ? ' *' : ''}`);
const soldText = (row) => (row.q.both ? (row.soldAs === 'rfd' ? 'RFD' : 'Greige') : row.soldAs === 'rfd' ? 'RFD' : 'Greige');

function summaryRows(model, meta) {
  const t = model.totals;
  return [
    ['Plan', meta.name],
    ['Plan date', meta.date],
    ['Unit', model.unit ? model.unit.name : ''],
    ['TPM consumption kg/day', r(t.tpmConsumption, 1)],
    ['TFO output kg/day', r(t.tfoOutput, 1)],
    ['From outside kg/day', r(t.received, 1)],
    ['Net TPM balance kg/day', r(t.net, 1)],
    ['TPM yarns short', t.short],
    ['Looms entered', t.looms],
    ['Plant realisation ₹/day', r(t.plantRealisation, 0)],
    ['Average loom realisation ₹/loom/day', r(t.avgLoomRealisation, 0)],
    ['Average realisation ₹/pick (with VATAV, weighted by output)', r(t.avgPerPick, 4)],
  ];
}

export async function exportPlanPdf(model, meta, edited) {
  const { jsPDF, autoTable, font } = await preloadExports();
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  doc.addFileToVFS('DejaVuSans.ttf', font.DEJAVU_REGULAR);
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', font.DEJAVU_BOLD);
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  doc.setFont('DejaVu', 'normal');
  const PW = 297, PH = 210, M = 12, W = PW - 2 * M;
  const ink = [28, 28, 30], grey = [108, 108, 112], accent = [43, 106, 31], red = [179, 38, 30];
  const t = model.totals;

  doc.setFontSize(9);
  doc.setTextColor(...grey);
  doc.text(`${model.unit ? model.unit.name : ''} · printed ${fmt.date(today())}${meta.unsaved ? ' · includes unsaved changes' : ''}`, M, 11);
  doc.setFont('DejaVu', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...ink);
  doc.text(`TFO plan · ${meta.name} · ${fmt.date(meta.date)}`, M, 20);

  // tiles
  const tiles = [
    ['TPM consumption', `${n1(t.tpmConsumption)} kg/day`, ink],
    ['TFO output', `${n1(t.tfoOutput)} kg/day`, ink],
    ['From outside', `${n1(t.received)} kg/day`, ink],
    ['Net balance', `${signed(t.net)} kg/day`, t.net < -0.05 ? red : accent],
    ['Yarns short', `${t.short} of ${model.balance.length}`, t.short ? red : ink],
    ['Plant realisation', `${fmt.rs(t.plantRealisation, 0)} / day`, accent],
    ['Average loom', `${fmt.rs(t.avgLoomRealisation, 0)} / loom / day`, ink],
    ['Average per pick', `${fmt.pick(t.avgPerPick)} with VATAV`, ink],
  ];
  const tw = W / 4;
  tiles.forEach((x, i) => {
    const tx = M + (i % 4) * tw;
    const ty = 27 + Math.floor(i / 4) * 15;
    doc.setFont('DejaVu', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...grey);
    doc.text(x[0].toUpperCase(), tx, ty + 3);
    doc.setFont('DejaVu', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...x[2]);
    doc.text(x[1], tx, ty + 9);
  });
  let y = 62;

  const table = (title, head, body, opts = {}) => {
    if (!body.length) return;
    if (y > PH - 30) {
      doc.addPage();
      y = 16;
    }
    doc.setFont('DejaVu', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...ink);
    doc.text(title, M, y);
    if (opts.note) {
      const tw2 = doc.getTextWidth(title);
      doc.setFont('DejaVu', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...grey);
      doc.text(opts.note, M + tw2 + 4, y);
    }
    autoTable(doc, {
      startY: y + 2,
      head: [head],
      body,
      margin: { left: M, right: M },
      tableWidth: W,
      styles: { font: 'DejaVu', fontSize: 8.5, cellPadding: 1.6, textColor: ink, lineColor: [209, 209, 214], lineWidth: 0.1 },
      headStyles: { font: 'DejaVu', fontStyle: 'bold', fillColor: [242, 242, 247], textColor: ink },
      columnStyles: Object.fromEntries(head.map((_, i) => [i, i === 0 ? {} : { halign: 'right' }]).concat(opts.left ? opts.left.map((i) => [i, { halign: 'left' }]) : [])),
      theme: 'grid',
    });
    y = doc.lastAutoTable.finalY + 7;
  };

  for (const b of model.groups) {
    if (!b.rows.length) continue;
    table(`Looms · ${groupLabel(b.group)}`, ['Quality', 'Sold as', 'Looms', 'Panna', 'RPM', 'Eff %', 'm/day per loom', 'TPM kg/day', '₹ / loom / day'], b.rows.map((x) => [
      x.q.label, soldText(x), n0(x.looms), x.panna === 2 ? 'double' : 'single', setText(x.rpm), setText(x.eff), n0(x.mPerDay), x.tpm ? n1(x.tpmKg) : '—', x.realPerLoom === null ? '—' : fmt.rs(x.realPerLoom, 0),
    ]), { note: `${n0(b.used)} of ${b.capacity === null ? '—' : n0(b.capacity)} looms${b.over ? ' · over capacity' : ''}`, left: [1, 3] });
  }
  for (const b of model.types) {
    if (!b.rows.length) continue;
    table(`TFO · ${b.type.name}`, ['Yarn', 'Sides', 'TFO RPM', 'kg / side / day', 'Output kg/day'], b.rows.map((x) => [x.yarn.name, n0(x.sides), setText(x.rpm), n1(x.perSideKg), n1(x.output)]), {
      note: `${n0(b.used)} of ${b.avail.value === null ? '—' : n0(b.avail.value)} sides · ${b.eff.value === null ? '—' : fmt.n(b.eff.value, b.eff.value % 1 ? 1 : 0)}% efficiency${b.eff.edited ? ' (edited)' : ''} · ${n0(b.perSide)} spindles per side`,
    });
  }
  table('Received from outside', ['Yarn', 'kg/day'], model.receipts.map((x) => [x.yarn.name, n1(x.kg)]));
  table('Yarn consumption · all yarns (shortage included)', ['Yarn', 'Kind', 'Warp kg/day', 'Weft kg/day', 'Total kg/day', 'Used in'], model.consumption.map((x) => [x.yarn.name, x.tpm ? 'TPM' : 'Base', n1(x.warp), n1(x.weft), n1(x.total), x.used.join(', ')]), { left: [1, 5] });
  table('TPM balance', ['TPM yarn', 'Consumption', 'TFO output', 'From outside', 'Balance kg/day'], model.balance.map((x) => [x.yarn.name, n1(x.consumption), n1(x.output), n1(x.received), signed(x.balance)]));
  table('Edited settings (* in the tables above)', ['Setting', 'For', 'In this plan', 'Master'], edited.map((e) => [e.what, e.item, fmt.n(e.value, e.value % 1 ? 1 : 0), e.master === null ? 'blank' : fmt.n(e.master, e.master % 1 ? 1 : 0)]), { left: [1] });

  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...grey);
  const foot = 'Metres per loom per day = RPM × 1440 × efficiency / (PPI × 39.37) × panna. TFO kg per side per day = RPM / TPM × 60 × denier / 9000 × efficiency × 24 × spindles / 1000 (RPM as stored, already × 2). Loom realisation = realisation per pick with VATAV × metres × PPI.';
  if (y > PH - 14) doc.addPage();
  doc.text(doc.splitTextToSize(foot, W), M, PH - 9);
  await deliver(doc.output('blob'), planFileName(meta, 'pdf'), `TFO plan ${meta.name}`);
}

export function planWorkbookRows(model, meta, edited) {
  const looms = model.groups.flatMap((b) => b.rows.map((x) => ({
    'Loom group': groupLabel(b.group),
    Quality: x.q.label,
    'Sold as': soldText(x),
    Looms: x.looms,
    Panna: x.panna === 2 ? 'double' : 'single',
    RPM: x.rpm.value ?? '',
    'RPM edited': x.rpm.edited ? 'yes' : '',
    'Efficiency %': x.eff.value ?? '',
    'Efficiency edited': x.eff.edited ? 'yes' : '',
    PPI: x.ppi ?? '',
    'm/day per loom': r(x.mPerDay, 1),
    'TPM kg/day': x.tpm ? r(x.tpmKg, 2) : '',
    '₹/pick with VATAV': r(x.perPick, 4),
    '₹/loom/day': r(x.realPerLoom, 0),
    '₹/day all looms': r(x.realTotal, 0),
  })));
  const tfo = model.types.flatMap((b) => b.rows.map((x) => ({
    'TFO type': b.type.name,
    Yarn: x.yarn.name,
    Sides: x.sides,
    'TFO RPM': x.rpm.value ?? '',
    'RPM edited': x.rpm.edited ? 'yes' : '',
    'Efficiency %': b.eff.value ?? '',
    'Spindles per side': b.perSide,
    'kg/side/day': r(x.perSideKg, 2),
    'Output kg/day': r(x.output, 2),
  })));
  return {
    Summary: summaryRows(model, meta).map(([k, v]) => ({ Field: k, Value: v })),
    Looms: looms,
    TFO: tfo,
    Received: model.receipts.map((x) => ({ Yarn: x.yarn.name, 'kg/day': x.kg })),
    'Yarn consumption': model.consumption.map((x) => ({ Yarn: x.yarn.name, Kind: x.tpm ? 'TPM' : 'Base', 'Warp kg/day': r(x.warp, 2), 'Weft kg/day': r(x.weft, 2), 'Total kg/day': r(x.total, 2), 'Used in': x.used.join(', ') })),
    'TPM balance': model.balance.map((x) => ({ 'TPM yarn': x.yarn.name, 'Consumption kg/day': r(x.consumption, 2), 'TFO output kg/day': r(x.output, 2), 'From outside kg/day': r(x.received, 2), 'Balance kg/day': r(x.balance, 2) })),
    Settings: [
      ...model.types.flatMap((b) => [
        { Setting: 'TFO efficiency %', For: b.type.name, 'In this plan': b.eff.value ?? '', Master: b.eff.master ?? '', Edited: b.eff.edited ? 'yes' : '' },
        { Setting: 'Sides available', For: b.type.name, 'In this plan': b.avail.value ?? '', Master: b.avail.master ?? '', Edited: b.avail.edited ? 'yes' : '' },
        { Setting: 'Spindles per side', For: b.type.name, 'In this plan': b.perSide, Master: b.perSide, Edited: '' },
      ]),
      ...edited.filter((e) => !/^(tfoEff|avail):/.test(e.key)).map((e) => ({ Setting: e.what, For: e.item, 'In this plan': e.value, Master: e.master ?? '', Edited: 'yes' })),
    ],
  };
}

export async function exportPlanXlsx(model, meta, edited) {
  const { XLSX } = await preloadExports();
  const wb = XLSX.utils.book_new();
  const sheets = planWorkbookRows(model, meta, edited);
  const empty = { Looms: { Note: 'No looms entered' }, TFO: { Note: 'No TFO sides entered' }, Received: { Note: 'Nothing received from outside' }, 'Yarn consumption': { Note: 'No consumption' }, 'TPM balance': { Note: 'No TPM yarn' }, Settings: { Note: 'No settings' } };
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, rows.length ? rows : [empty[name] || {}]), name);
  await deliver(writeBook(XLSX, wb), planFileName(meta, 'xlsx'), `TFO plan ${meta.name}`);
}
