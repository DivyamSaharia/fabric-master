// PDF and Excel for a dated TFO plan.
import { fmt } from '../calc.js';
import { groupLabel } from '../planner.js';
import { deliver, preloadExports, sheetFromRows, slug, writeBook } from './exports.js';
import { today } from '../schema.js';

const r = (v, dp = 0) => (v === null || v === undefined ? '' : Math.round(v * 10 ** dp) / 10 ** dp);
const signed = (v) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : '−'}${fmt.int(Math.abs(v))}`);
const statusText = { short: 'Short', surplus: 'Surplus', ok: 'Balanced', unknown: 'Data missing' };

// File names follow yyyy-mm-dd_name, dated by the plan's own date.
const planFile = (plan, unit, ext) => `${plan.plan_date || today()}_${slug(`${unit ? unit.name : 'unit'} tfo plan`)}.${ext}`;

export const planTitle = (plan, unit) => `${unit ? unit.name : 'Unit'} TFO plan ${plan.plan_date || ''}`.trim();

export async function exportPlanXlsx(plan, pc, opts = {}) {
  const { XLSX } = await preloadExports();
  const wb = XLSX.utils.book_new();
  const balance = pc.yarnRows.map((y) => ({
    Yarn: y.yarn.name,
    Status: statusText[y.status],
    'Used in': y.fabrics.join(', '),
    'Demand kg/day': r(y.demand, 1),
    'Outside kg/day': r(y.outside, 1),
    'Net kg/day': r(y.net, 1),
    'Output kg/spindle-day': r(y.qRef, 4),
    'At speed of': y.refType || '',
    'Spindles warp': r(y.requiredWarp),
    'Spindles weft': r(y.requiredWeft),
    'Spindles needed': r(y.required),
    'Spindles given out': y.allocSpindles,
    'Sides given out': y.allocSides,
    'Balance spindles': r(y.balanceSpindles),
    'Balance sides': r(y.balanceSides, 1),
    'Balance kg/day': r(y.balanceKg, 1),
  }));
  XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, balance.length ? balance : [{ Yarn: 'Nothing planned' }]), 'Spindle balance');
  const runningX = pc.runningRows.map((x) => ({
    Yarn: x.yarn.name,
    Type: x.tpm ? `TPM${x.base ? ` of ${x.base.name}` : ''}` : 'Base yarn',
    'Used in': x.fabrics.join(', '),
    'Warp kg/day': r(x.warp, 1),
    'Weft kg/day': r(x.weft, 1),
    'Total kg/day': r(x.total, 1),
    'Outside kg/day': x.tpm ? r(x.outside, 1) : '',
    'Spindles warp': x.tpm ? r(x.spindlesWarp) : '',
    'Spindles weft': x.tpm ? r(x.spindlesWeft) : '',
    'Spindles needed': x.tpm ? r(x.spindles) : '',
  }));
  if (runningX.length) runningX.push({ Yarn: 'Total', 'Warp kg/day': r(pc.totals.runningWarp, 1), 'Weft kg/day': r(pc.totals.runningWeft, 1), 'Total kg/day': r(pc.totals.running, 1), 'Spindles warp': r(pc.totals.requiredWarp), 'Spindles weft': r(pc.totals.requiredWeft), 'Spindles needed': r(pc.totals.required) });
  XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, runningX.length ? runningX : [{ Yarn: 'Nothing running' }]), 'Running yarn');
  const groupsX = pc.groupUse.map((u) => ({ 'Loom group': groupLabel(u.group), 'Looms on floor': u.have ?? '', 'Looms planned': u.planned, 'Looms available': u.free ?? '' }));
  XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, groupsX.length ? groupsX : [{ 'Loom group': 'None' }]), 'Loom groups');
  const looms = pc.loomRows.map((x) => ({
    'Loom group': groupLabel(x.group),
    Fabric: x.fabric ? x.fabric.name : '',
    Looms: x.looms,
    Panna: x.panna === 2 ? 'Double' : 'Single',
    RPM: x.rpm ?? '',
    'Metres/day': r(x.mPerDay, 0),
    'TPM yarn kg/day': x.tpm.map((t) => `${t.side} ${t.yarn.name}: ${t.kg === null ? '—' : r(t.kg, 1)}`).join('; '),
    Problems: x.problems.join('; '),
  }));
  XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, looms.length ? looms : [{ 'Loom group': 'No loom lines' }]), 'Loom plan');
  const tfo = pc.tfoRows.map((x) => ({
    'TFO type': x.type ? x.type.name : '',
    Yarn: x.yarn ? x.yarn.name : '',
    Sides: x.sides,
    Spindles: x.spindles,
    'kg/spindle-day': r(x.q, 4),
    'kg/day': r(x.kg, 1),
    Problems: x.problems.join('; '),
  }));
  XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, tfo.length ? tfo : [{ 'TFO type': 'No TFO lines' }]), 'TFO sides');
  const machines = pc.typeUse.map((u) => ({ 'TFO type': u.type.name, Machines: u.machines ?? '', Sides: u.sides ?? '', 'Sides given out': u.used, 'Idle sides': u.idle ?? '', 'Spindles per side': u.perSide }));
  XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, machines.length ? machines : [{ 'TFO type': 'None' }]), 'TFO machines');
  if (pc.outsideRows.length) {
    XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, pc.outsideRows.map((x) => ({ Yarn: x.yarn ? x.yarn.name : '', 'kg/day': x.kg ?? '', From: x.line.source || '' }))), 'Outside yarn');
  }
  const title = planTitle(plan, pc.unit);
  await deliver(writeBook(XLSX, wb), planFile(plan, pc.unit, 'xlsx'), title, opts);
}

export async function exportPlanPdf(plan, pc, opts = {}) {
  const { jsPDF, autoTable, font } = await preloadExports();
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  doc.addFileToVFS('DejaVuSans.ttf', font.DEJAVU_REGULAR);
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', font.DEJAVU_BOLD);
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  doc.setFont('DejaVu', 'normal');
  const M = 12;
  const W = 297 - 2 * M;
  const ink = [28, 28, 30];
  const grey = [108, 108, 112];
  const accent = [43, 106, 31];
  const bad = [196, 40, 28];
  const t = pc.totals;

  doc.setTextColor(...grey);
  doc.setFontSize(9);
  doc.text('Hanuman Fabric Database · TFO plan', M, 11);
  doc.setTextColor(...ink);
  doc.setFont('DejaVu', 'bold');
  doc.setFontSize(18);
  doc.text(`${pc.unit ? pc.unit.name : 'Unit'} · ${plan.plan_date || ''}`, M, 20);
  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...grey);
  doc.text([plan.name, plan.notes].filter(Boolean).join(' · ') || ' ', M, 26);

  const figs = [
    ['Looms planned', fmt.int(t.looms), `${t.metres === null ? '—' : fmt.int(t.metres)} m/day`],
    ['Spindles needed', t.required === null ? '—' : fmt.int(t.required), t.required === null ? '—' : `warp ${fmt.int(t.requiredWarp)} · weft ${fmt.int(t.requiredWeft)} · net of ${fmt.n(t.outside, 0)} kg/day outside`],
    ['Spindles given out', fmt.int(t.usedSpindles), t.capSpindles === null ? 'machine count not set' : `of ${fmt.int(t.capSpindles)} · ${t.idleSides} sides idle`],
    ['Deficit / surplus', t.shortYarns ? `−${fmt.int(t.deficit)}` : `+${fmt.int(t.surplus)}`, t.shortYarns ? `${t.shortYarns} yarns short · surplus elsewhere +${fmt.int(t.surplus)}` : 'spindles'],
  ];
  const colW = W / 4;
  figs.forEach((f, i) => {
    const x = M + i * colW;
    doc.setFontSize(8.5);
    doc.setTextColor(...grey);
    doc.text(f[0].toUpperCase(), x, 35);
    doc.setFont('DejaVu', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...(i === 3 ? (t.shortYarns ? bad : accent) : ink));
    doc.text(f[1], x, 43);
    doc.setFont('DejaVu', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...grey);
    doc.text(doc.splitTextToSize(f[2], colW - 4), x, 48);
  });
  let y = 58;

  const table = (title, head, body, extra = {}) => {
    if (y > 180) {
      doc.addPage();
      y = 16;
    }
    doc.setFont('DejaVu', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...ink);
    doc.text(title, M, y);
    autoTable(doc, {
      startY: y + 2,
      head: [head],
      body,
      margin: { left: M, right: M },
      tableWidth: W,
      styles: { font: 'DejaVu', fontSize: 8.5, cellPadding: 1.6, textColor: ink, lineColor: [209, 209, 214], lineWidth: 0.1 },
      headStyles: { font: 'DejaVu', fontStyle: 'bold', fillColor: [242, 242, 247], textColor: ink },
      theme: 'grid',
      ...extra,
    });
    y = doc.lastAutoTable.finalY + 8;
  };

  table('Running yarn requirement', ['Yarn', 'Used in', 'Warp kg/day', 'Weft kg/day', 'Total kg/day', 'Outside', 'Spindles warp', 'Spindles weft', 'Spindles total'],
    [...pc.runningRows.map((x) => [`${x.yarn.name}${x.tpm ? ' (TPM)' : ''}`, x.fabrics.join(', '), x.warp ? fmt.n(x.warp, 1) : '—', x.weft ? fmt.n(x.weft, 1) : '—', fmt.n(x.total, 1), x.tpm && x.outside ? fmt.n(x.outside, 1) : '—', x.tpm && x.spindlesWarp !== null ? fmt.int(x.spindlesWarp) : '—', x.tpm && x.spindlesWeft !== null ? fmt.int(x.spindlesWeft) : '—', x.tpm && x.spindles !== null ? fmt.int(x.spindles) : '—']),
      ['Total', '', fmt.n(t.runningWarp, 1), fmt.n(t.runningWeft, 1), fmt.n(t.running, 1), t.outside ? fmt.n(t.outside, 1) : '—', t.requiredWarp === null ? '—' : fmt.int(t.requiredWarp), t.requiredWeft === null ? '—' : fmt.int(t.requiredWeft), t.required === null ? '—' : fmt.int(t.required)]],
    { columnStyles: Object.fromEntries([2, 3, 4, 5, 6, 7, 8].map((i) => [i, { halign: 'right' }])) });
  const right = Object.fromEntries([2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => [i, { halign: 'right' }]));
  table('Spindle balance by yarn', ['Yarn', 'Used in', 'Demand kg/day', 'Outside', 'Net kg/day', 'Needed warp', 'Needed weft', 'Needed total', 'Given out', 'Balance', 'Balance kg/day'],
    pc.yarnRows.map((x) => [x.yarn.name, x.fabrics.join(', '), fmt.n(x.demand, 1), x.outside ? fmt.n(x.outside, 1) : '—', fmt.n(x.net, 1), x.requiredWarp === null ? '—' : fmt.int(x.requiredWarp), x.requiredWeft === null ? '—' : fmt.int(x.requiredWeft), x.required === null ? '—' : fmt.int(x.required), `${fmt.int(x.allocSpindles)} (${x.allocSides} sides)`, x.balanceSpindles === null ? statusText.unknown : signed(x.balanceSpindles), x.balanceKg === null ? '—' : `${x.balanceKg >= 0 ? '+' : '−'}${fmt.n(Math.abs(x.balanceKg), 1)}`]),
    {
      columnStyles: right,
      didParseCell: (d) => {
        if (d.section === 'body' && d.column.index === 9) {
          const row = pc.yarnRows[d.row.index];
          if (row && row.status === 'short') d.cell.styles.textColor = bad;
          if (row && row.status === 'surplus') d.cell.styles.textColor = accent;
          d.cell.styles.fontStyle = 'bold';
        }
      },
    });
  table('Looms by group', ['Loom group', 'On floor', 'Planned', 'Available'],
    pc.groupUse.map((u) => [groupLabel(u.group), u.have ?? '—', fmt.int(u.planned), u.free === null ? '—' : u.free >= 0 ? fmt.int(u.free) : `${fmt.int(-u.free)} over`]),
    { columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } } });
  table('Loom plan', ['Loom group', 'Fabric', 'Looms', 'Panna', 'RPM', 'Metres/day', 'TPM yarn kg/day'],
    pc.loomRows.map((x) => [groupLabel(x.group), x.fabric ? x.fabric.name : '—', fmt.int(x.looms), x.panna === 2 ? 'Double' : 'Single', x.rpm ?? '—', x.mPerDay === null ? '—' : fmt.int(x.mPerDay), x.tpm.map((p) => `${p.yarn.name} ${p.kg === null ? '—' : fmt.n(p.kg, 1)}`).join('\n') || 'No TPM yarn']),
    { columnStyles: { 2: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } } });
  table('TFO sides', ['TFO type', 'Yarn', 'Sides', 'Spindles', 'kg/spindle-day', 'kg/day'],
    pc.tfoRows.map((x) => [x.type ? x.type.name : '—', x.yarn ? x.yarn.name : '—', fmt.int(x.sides), fmt.int(x.spindles), x.q === null ? '—' : fmt.n(x.q, 4), x.kg === null ? '—' : fmt.n(x.kg, 1)]),
    { columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } } });
  if (pc.outsideRows.length) {
    table('Yarn from outside', ['Yarn', 'kg/day', 'From'], pc.outsideRows.map((x) => [x.yarn ? x.yarn.name : '—', x.kg === null ? '—' : fmt.n(x.kg, 1), x.line.source || '']), { columnStyles: { 1: { halign: 'right' } } });
  }
  const notes = [...pc.issues, ...[...pc.loomRows, ...pc.tfoRows, ...pc.outsideRows].flatMap((x) => x.problems)];
  if (notes.length) {
    doc.setFontSize(8.5);
    doc.setTextColor(...grey);
    doc.text(doc.splitTextToSize(`To check: ${[...new Set(notes)].join(' · ')}`, W), M, Math.min(y, 200));
  }
  await deliver(doc.output('blob'), planFile(plan, pc.unit, 'pdf'), planTitle(plan, pc.unit), opts);
}
