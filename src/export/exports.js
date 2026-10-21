import { fmt, loomPerDay, num, spindlesForUnit, truthy, unitHasTfo, unitProfit } from '../calc.js';
import { constructionLine, unitsOf } from '../describe.js';
import { beamRowsOf, slotLabel } from '../machines.js';
import { getPhoto, saveExportToDrive, setPendingShare, toast } from '../store.js';
import { today } from '../schema.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const slug = (s) => String(s || 'fabric').toLowerCase().normalize('NFKD').replace(/×/g, 'x').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'fabric';
export const fileName = (name, suffix, ext) => `${today()}_${slug(name)}${suffix ? `_${suffix}` : ''}.${ext}`;

let libs = null;
export function preloadExports() {
  if (!libs) {
    libs = Promise.all([import('jspdf'), import('jspdf-autotable'), import('xlsx'), import('./pdfFont.js')]).then(([jspdf, autotable, xlsx, font]) => ({
      jsPDF: jspdf.jsPDF || jspdf.default,
      autoTable: autotable.default || autotable.autoTable,
      XLSX: xlsx,
      font,
    }));
  }
  return libs;
}

// ---------- WhatsApp ----------
export function whatsappText(fabric, calc, idx) {
  const lines = [`*${fabric.name}*${calc.finish === 'RFD' ? (/\(RFD\)/.test(fabric.name) ? '' : ' (RFD)') : ' (Greige)'}`];
  const reed = num(fabric.reed);
  lines.push(`Reed × Pick: ${reed ? `${reed} × ${calc.ppi ?? '—'}` : `— × ${calc.ppi ?? '—'}`}`);
  for (const w of calc.warp) lines.push(`Warp: ${w.yarn ? w.yarn.name : '—'}${w.ends ? `, ${fmt.int(w.ends)} ends` : ''}`);
  for (const w of calc.weft) lines.push(`Weft: ${w.yarn ? w.yarn.name : '—'}${w.line.pattern ? ` (${w.line.pattern})` : ''}`);
  const extra = [calc.width ? `Width ${calc.width}″` : null, calc.gsm !== null ? `GSM ${fmt.n(calc.gsm, 1)}` : null].filter(Boolean).join(' · ');
  if (extra) lines.push(extra);
  if (fabric.weave) lines.push(`Weave: ${fabric.weave}${fabric.design_note ? `, ${fabric.design_note}` : ''}`);
  if (calc.price !== null) lines.push(`Price ${fmt.rs(calc.price)} / m`);
  return lines.join('\n');
}

export function openWhatsAppText(text) {
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

// ---------- delivery ----------
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(blob);
  });
}

function download(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function shareFile(file, title) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return true;
    } catch (e) {
      if (e && e.name === 'AbortError') return true;
      if (e && e.name === 'NotAllowedError') {
        // The file took too long to make for iOS to keep the tap; ask for one more tap.
        setPendingShare({ file, title });
        return false;
      }
      throw e;
    }
  }
  download(file);
  return true;
}

export async function deliver(blob, name, title, { toDrive } = {}) {
  const file = new File([blob], name, { type: blob.type });
  if (toDrive) {
    try {
      await saveExportToDrive({ name, mime: blob.type, base64: await blobToBase64(blob) });
      toast('Saved to your Drive exports folder');
    } catch (e) {
      toast(`Drive copy failed: ${e.message}`, 'error');
    }
  }
  await shareFile(file, title);
}

// ---------- PDF ----------
export async function exportFabricPdf(fabric, calc, idx, opts = {}) {
  const { jsPDF, autoTable, font } = await preloadExports();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.addFileToVFS('DejaVuSans.ttf', font.DEJAVU_REGULAR);
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', font.DEJAVU_BOLD);
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  doc.setFont('DejaVu', 'normal');
  const M = 14;
  const W = 210 - 2 * M;
  const ink = [28, 28, 30];
  const grey = [108, 108, 112];
  const accent = [43, 106, 31]; // Hanuman green
  const rfd = calc.finish === 'RFD';

  doc.setTextColor(...grey);
  doc.setFontSize(9);
  doc.text(`Fabric spec sheet · ${today()}`, M, 12);
  doc.setTextColor(...ink);
  doc.setFont('DejaVu', 'bold');
  doc.setFontSize(20);
  doc.text(fabric.name || 'Fabric', M, 22);
  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...grey);
  doc.text([fabric.weave, fabric.design_note, fabric.end_use, calc.finish, calc.tfoClass].filter(Boolean).join(' · '), M, 28);

  // cover photo + key figures
  let y = 34;
  const photos = idx.photosByFabric[fabric.id] || [];
  const cover = photos.find((p) => truthy(p.is_cover)) || photos[0];
  let figX = M;
  if (cover) {
    try {
      const data = await getPhoto(cover, 'full');
      if (data) {
        const props = doc.getImageProperties(data);
        const h = 52;
        const w = Math.min(78, (props.width / props.height) * h);
        doc.addImage(data, 'JPEG', M, y, w, h);
        figX = M + w + 8;
      }
    } catch {
      /* photo optional */
    }
  }
  const figs = [
    ['Realisation with VATAV', `${fmt.pick(calc.realisationNetPerPick)} / pick`, `${fmt.rs(calc.realisationNetPerM)} / ${rfd ? 'RFD m' : 'm'} · without VATAV ${fmt.pick(calc.realisationPerPick)} / pick`],
    [rfd ? 'RFD cost' : 'RM cost', `${fmt.rs(rfd ? calc.rfdCost : calc.rmCost)} / m`, rfd ? `RM ${fmt.rs(calc.rmPerSaleM)} + finishing ${fmt.rs(calc.finishingCost)}` : 'shortage included'],
    ['GSM (estimate)', fmt.n(calc.gsm, 1), `${fmt.n(calc.totalGpm, 1)} g/m · ${fmt.n(calc.kgPer100, 2)} kg/100 m`],
    ['Selling price', `${fmt.rs(calc.price)} / ${rfd ? 'RFD m' : 'm'}`, `${calc.vatavPct ? `VATAV ${calc.vatavPct}%` : 'No VATAV'} · ${constructionLine(fabric, calc, idx)}`],
  ];
  const colW = (210 - M - figX) / 2;
  figs.forEach((f, i) => {
    const fx = figX + (i % 2) * colW;
    const fy = y + Math.floor(i / 2) * 27;
    doc.setFontSize(8.5);
    doc.setTextColor(...grey);
    doc.text(f[0].toUpperCase(), fx, fy + 4);
    doc.setFont('DejaVu', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...(i === 0 ? accent : ink));
    doc.text(f[1], fx, fy + 11);
    doc.setFont('DejaVu', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...grey);
    doc.text(doc.splitTextToSize(f[2], colW - 4), fx, fy + 16);
  });
  y += 60;

  const table = (title, head, body, colStyles) => {
    doc.setFont('DejaVu', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...ink);
    doc.text(title, M, y);
    autoTable(doc, {
      startY: y + 2,
      head: head ? [head] : undefined,
      body,
      margin: { left: M, right: M },
      tableWidth: W,
      styles: { font: 'DejaVu', fontSize: 9, cellPadding: 1.8, textColor: ink, lineColor: [209, 209, 214], lineWidth: 0.1 },
      headStyles: { font: 'DejaVu', fontStyle: 'bold', fillColor: [242, 242, 247], textColor: ink },
      columnStyles: colStyles || {},
      theme: 'grid',
    });
    y = doc.lastAutoTable.finalY + 8;
  };

  const pctv = (v) => (v === '' || v === undefined || v === null ? '—' : `${v}%`);
  table('Construction', null, [
    ['Reed', fabric.reed || '—', 'Pick (PPI)', calc.ppi ?? '—'],
    ['Total ends', calc.totalEnds === null ? '—' : fmt.int(calc.totalEnds), 'Reed space', calc.rs ? `${calc.rs}″` : '—'],
    ['Greige width', calc.width ? `${calc.width}″` : '—', 'Weave', fabric.weave || '—'],
    ['Warp shortage', pctv(fabric.warp_shortage_pct), 'Weft shortage', pctv(fabric.weft_shortage_pct)],
  ], { 0: { textColor: grey }, 2: { textColor: grey } });

  table('Warp and weft', ['Side', 'Yarn', 'Ends / share', 'Rate ₹/kg', 'g/m', 'kg/100 m', '₹/m'], [
    ...[...calc.warp, ...calc.weft].map((x) => [
      x.line.side === 'warp' ? 'Warp' : 'Weft',
      `${x.yarn ? x.yarn.name : '—'}${x.line.pattern ? ` (${x.line.pattern})` : ''}`,
      x.line.side === 'warp' ? (x.ends ? fmt.int(x.ends) : '—') : `${Math.round((x.share || 0) * 100)}%`,
      x.rate === null ? '—' : fmt.n(x.rate, 2),
      fmt.n(x.gpm, 2),
      fmt.n(x.kgPer100, 3),
      x.costPerM === null ? '—' : fmt.n(x.costPerM, 2),
    ]),
    [{ content: 'Total', colSpan: 4, styles: { fontStyle: 'bold' } }, { content: fmt.n(calc.totalGpm, 2), styles: { fontStyle: 'bold' } }, { content: fmt.n(calc.kgPer100, 3), styles: { fontStyle: 'bold' } }, { content: calc.rmCost === null ? '—' : fmt.n(calc.rmCost, 2), styles: { fontStyle: 'bold' } }],
  ], { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } });

  const costRows = rfd
    ? [
        ['Selling price', `${fmt.rs(calc.price)} / RFD m`],
        ['RFD shortage', pctv(fabric.rfd_shortage_pct)],
        ['Processing charge', `${fmt.rs(num(fabric.processing_charge))} / m`],
        ['Transportation', num(fabric.transport_charge) === null ? '—' : `${fmt.rs(num(fabric.transport_charge))} / RFD m`],
        ['Brokering', pctv(fabric.brokering_pct)],
        ['RM cost per RFD m', fmt.rs(calc.rmPerSaleM)],
        ['Finishing cost', fmt.rs(calc.finishingCost)],
        ['RFD cost', `${fmt.rs(calc.rfdCost)} / m`],
        ['Realisation without VATAV', `${fmt.rs(calc.realisationPerM)} / m · ${fmt.pick(calc.realisationPerPick)} / pick`],
        ['VATAV', calc.vatavPct ? `${calc.vatavPct}% · −${fmt.rs(calc.vatavAmount)} / m` : 'None'],
        ['Realisation with VATAV', `${fmt.rs(calc.realisationNetPerM)} / m · ${fmt.pick(calc.realisationNetPerPick)} / pick`],
      ]
    : [
        ['Selling price', `${fmt.rs(calc.price)} / m`],
        ['RM cost (shortage included)', `${fmt.rs(calc.rmCost)} / m`],
        ['Realisation without VATAV', `${fmt.rs(calc.realisationPerM)} / m · ${fmt.pick(calc.realisationPerPick)} / pick`],
        ['VATAV', calc.vatavPct ? `${calc.vatavPct}% · −${fmt.rs(calc.vatavAmount)} / m` : 'None'],
        ['Realisation with VATAV', `${fmt.rs(calc.realisationNetPerM)} / m · ${fmt.pick(calc.realisationNetPerPick)} / pick`],
      ];
  table(rfd ? 'Finishing · RFD' : 'Greige', null, costRows, { 0: { textColor: grey, cellWidth: 70 }, 1: { fontStyle: 'bold' } });

  const units = unitsOf(fabric.id, idx);
  if (units.length) {
    table('Units', ['Unit', 'Cost / pick', 'Profit / pick (with VATAV)', 'Profit / m', 'Per loom · single / double panna'], units.map((u) => {
      const p = unitProfit(calc, u);
      return [u.name, fmt.pick(p.costPerPick), fmt.signedPick(p.profitPerPick), fmt.rs(p.profitPerM), panText(calc, fabric, u, idx)];
    }), { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } });
  }

  const beamRows = beamRowsOf(fabric.id, idx);
  if (beamRows.length) {
    table('Beam length', ['Unit', 'Loom group', 'Beam length'], beamRows.map((b) => [b.unit.name, slotLabel(b), b.length !== null ? `${fmt.n(b.length, 0)} m` : 'Not set']), { 2: { halign: 'right' } });
  }

  if (y - 8 > 282) doc.addPage();
  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...grey);
  doc.text(doc.splitTextToSize('Realisation per pick = (selling price − RM cost with shortage − finishing cost) ÷ picks; with VATAV, the VATAV discount is also taken off. Figures use the latest yarn rates.', W), M, 289);
  const blob = doc.output('blob');
  await deliver(blob, fileName(fabric.name, 'spec', 'pdf'), `${fabric.name} spec sheet`, opts);
}

// Per loom per day, "single / double panna": spindles per TFO type, or warp and weft kg.
function panText(calc, fabric, unit, idx) {
  const one = loomPerDay(calc, fabric, unit, 1);
  const two = loomPerDay(calc, fabric, unit, 2);
  const kg = (v) => (v === null ? '—' : fmt.n(v, 1));
  if (unitHasTfo(calc, unit, idx)) {
    const s1 = spindlesForUnit(calc, fabric, unit, idx, 1);
    const s2 = spindlesForUnit(calc, fabric, unit, idx, 2);
    return s1.map((s, i) => `${s.type.name}: ${s.total === null ? '—' : fmt.int(s.total)} / ${s2[i].total === null ? '—' : fmt.int(s2[i].total)} spindles`).join('\n');
  }
  return `Warp ${kg(one.warpKg)} / ${kg(two.warpKg)} kg/day\nWeft ${kg(one.weftKg)} / ${kg(two.weftKg)} kg/day`;
}

// ---------- Excel ----------
const r2 = (v, dp = 2) => (v === null || v === undefined ? '' : Math.round(v * 10 ** dp) / 10 ** dp);

function fabricRow(fabric, calc, idx, unit) {
  const row = {
    Quality: fabric.name,
    Weave: fabric.weave || '',
    'End use': fabric.end_use || '',
    Finish: calc.finish,
    'TFO class': calc.tfoClass,
    Reed: num(fabric.reed) ?? '',
    'Pick (PPI)': calc.ppi ?? '',
    'Loom RPM single panna': num(fabric.loom_rpm) ?? '',
    'Loom RPM double panna': num(fabric.loom_rpm_dp) ?? '',
    'Total ends': calc.totalEnds ?? '',
    'Reed space (in)': calc.rs ?? '',
    'Greige width (in)': calc.width ?? '',
    Warp: calc.warp.map((x) => (x.yarn ? x.yarn.name : '')).join(' + '),
    Weft: calc.weft.map((x) => (x.yarn ? x.yarn.name : '')).join(' + '),
    'Warp shortage %': num(fabric.warp_shortage_pct) ?? '',
    'Weft shortage %': num(fabric.weft_shortage_pct) ?? '',
    'Warp g/m': r2(calc.warpGpm),
    'Weft g/m': r2(calc.weftGpm),
    'Total g/m': r2(calc.totalGpm),
    'kg per 100 m': r2(calc.kgPer100, 3),
    GSM: r2(calc.gsm, 1),
    'RM cost ₹/m': r2(calc.rmCost),
    'Selling price ₹/m': calc.price ?? '',
    'VATAV %': calc.vatavPct || '',
    'RFD shortage %': calc.finish === 'RFD' ? num(fabric.rfd_shortage_pct) ?? '' : '',
    'Processing ₹/m': calc.finish === 'RFD' ? num(fabric.processing_charge) ?? '' : '',
    'Transportation ₹/m': calc.finish === 'RFD' ? num(fabric.transport_charge) ?? '' : '',
    'Brokering %': calc.finish === 'RFD' ? num(fabric.brokering_pct) ?? '' : '',
    'RFD cost ₹/m': r2(calc.rfdCost),
    'Realisation ₹/m without VATAV': r2(calc.realisationPerM),
    'Realisation ₹/pick without VATAV': r2(calc.realisationPerPick, 4),
    'VATAV ₹/m': r2(calc.vatavAmount),
    'Realisation ₹/m with VATAV': r2(calc.realisationNetPerM),
    'Realisation ₹/pick with VATAV': r2(calc.realisationNetPerPick, 4),
    Units: unitsOf(fabric.id, idx).map((u) => u.name).join(', '),
  };
  if (unit) {
    const p = unitProfit(calc, unit);
    row[`Cost/pick ${unit.name}`] = p.costPerPick ?? '';
    row[`Profit ₹/pick ${unit.name} (with VATAV)`] = r2(p.profitPerPick, 4);
    row[`Profit ₹/m ${unit.name}`] = r2(p.profitPerM);
  }
  return row;
}

export function sheetFromRows(XLSX, rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const keys = rows.length ? Object.keys(rows[0]) : [];
  ws['!cols'] = keys.map((k) => ({ wch: Math.max(10, Math.min(36, Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length)) + 2)) }));
  return ws;
}

export function writeBook(XLSX, wb) {
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: XLSX_MIME });
}

export async function exportFabricXlsx(fabric, calc, idx, opts = {}) {
  const { XLSX } = await preloadExports();
  const wb = XLSX.utils.book_new();
  const summary = Object.entries(fabricRow(fabric, calc, idx)).map(([k, v]) => ({ Field: k, Value: v }));
  XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, summary), 'Summary');
  const yarnRows = [...calc.warp, ...calc.weft].map((x) => ({
    Side: x.line.side === 'warp' ? 'Warp' : 'Weft',
    Yarn: x.yarn ? x.yarn.name : '',
    Denier: r2(x.denier, 1),
    Ends: x.line.side === 'warp' ? x.ends ?? '' : '',
    'Pick share %': x.line.side === 'weft' ? r2((x.share || 0) * 100, 1) : '',
    Pattern: x.line.pattern || '',
    'Rate ₹/kg': x.rate ?? '',
    'g/m': r2(x.gpm),
    'kg per 100 m': r2(x.kgPer100, 3),
    '₹/m': r2(x.costPerM),
  }));
  XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, yarnRows), 'Warp and weft');
  const units = unitsOf(fabric.id, idx);
  if (units.length) {
    const unitRows = [];
    for (const u of units) {
      const p = unitProfit(calc, u);
      const single = unitHasTfo(calc, u, idx) ? spindlesForUnit(calc, fabric, u, idx, 1) : [];
      const double = spindlesForUnit(calc, fabric, u, idx, 2);
      const l1 = loomPerDay(calc, fabric, u, 1);
      const l2 = loomPerDay(calc, fabric, u, 2);
      const base = {
        Unit: u.name,
        'Cost ₹/pick': p.costPerPick ?? '',
        'Profit ₹/pick (with VATAV)': r2(p.profitPerPick, 4),
        'Profit ₹/m': r2(p.profitPerM),
        'Loom RPM single panna': l1.rpm ?? '',
        'Loom RPM double panna': l2.rpm ?? '',
      };
      if (single.length) {
        single.forEach((s, i) => unitRows.push({
          ...base,
          'TFO type': s.type.name,
          'Spindles per loom (single panna)': s.total === null ? s.reason : r2(s.total, 0),
          'Spindles per loom (double panna)': double[i].total === null ? double[i].reason : r2(double[i].total, 0),
        }));
      } else {
        unitRows.push({
          ...base,
          'Warp kg/day per loom (single panna)': r2(l1.warpKg, 1),
          'Weft kg/day per loom (single panna)': r2(l1.weftKg, 1),
          'Warp kg/day per loom (double panna)': r2(l2.warpKg, 1),
          'Weft kg/day per loom (double panna)': r2(l2.weftKg, 1),
        });
      }
    }
    XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, unitRows), 'Units');
  }
  const beamRows = beamRowsOf(fabric.id, idx);
  if (beamRows.length) {
    XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, beamRows.map((b) => ({ Unit: b.unit.name, 'Loom group': slotLabel(b), 'Beam length (m)': b.length ?? '' }))), 'Beam length');
  }
  await deliver(writeBook(XLSX, wb), fileName(fabric.name, 'costing', 'xlsx'), `${fabric.name} costing`, opts);
}

export async function exportListXlsx(rows, idx, unit) {
  if (!rows.length) {
    toast('No fabrics to export', 'error');
    return;
  }
  const { XLSX } = await preloadExports();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, rows.map((r) => fabricRow(r.fabric, r.calc, idx, unit))), 'Fabrics');
  await deliver(writeBook(XLSX, wb), fileName(unit ? `${unit.name} fabrics` : 'all fabrics', '', 'xlsx'), unit ? `${unit.name} fabrics` : 'All fabrics');
}
