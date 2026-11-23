import { fmt, num, truthy, unitProfit } from '../calc.js';
import { constructionLine, unitsOf } from '../describe.js';
import { getPhoto, saveExportToDrive, setPendingShare, toast } from '../store.js';
import { today } from '../schema.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const slug = (s) => String(s || 'fabric').toLowerCase().normalize('NFKD').replace(/×/g, 'x').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'fabric';
export const fileName = (name, suffix, ext) => `${today()}_${slug(name)}${suffix ? `_${suffix}` : ''}.${ext}`;

// ₹ groups of the Basic spec sheet builders (1.28.0). Since 1.29.0 the app always sends Basic with NO_MONEY: the
// Includes ₹ share is gone and its switches moved to the Detailed share (detailed.js, which adds loom realisation).
// The builders still take any mix, so the 1.27.0 saved copy keeps guarding them. A group switched off is left out
// completely (no row, no blank, no label):
//   realisation: realisation per pick and per m, with and without VATAV; profit per pick
//   sale: selling price, sale date, VATAV % and ₹, price basis (also the price line of the WhatsApp/Copy text)
//   yarn: per-yarn rates, rate basis, per-yarn ₹/m (and their total)
//   costs: RM cost, processing, transport, brokering, finishing/RFD cost, unit cost per pick, profit per m
// The method note under the PDF goes with realisation. The fabric list export ignores this.
export const MONEY_GROUPS = ['realisation', 'sale', 'yarn', 'costs'];
export const ALL_MONEY = Object.freeze({ realisation: true, sale: true, yarn: true, costs: true });
export const NO_MONEY = Object.freeze({ realisation: false, sale: false, yarn: false, costs: false });
const moneyOf = (m) => ({ ...ALL_MONEY, ...(m || {}) });

// GSM in shared files (1.31.0): on greige width when it is set, else on reed space, labelled so.
export function shareGsm(calc) {
  if (calc.gsm !== null && calc.gsm !== undefined) return { value: calc.gsm, onReed: false, label: 'GSM (estimate)' };
  if (calc.gsmReed !== null && calc.gsmReed !== undefined) return { value: calc.gsmReed, onReed: true, label: 'GSM (on reed space)' };
  return { value: null, onReed: false, label: 'GSM (estimate)' };
}

// App logo for the PDF headers (Basic and Detailed)
let logoData;
export async function loadLogo() {
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

// Shared look of both fabric PDFs (1.31.0): deep green header band with the logo, lime rule, rounded tiles,
// section headings with a lime bar, deep green table heads, striped rows, a footer on every page.
export const PDF_LOOK = {
  ink: [28, 28, 30], grey: [108, 108, 112], green: [43, 106, 31], deep: [0, 42, 0], lime: [166, 206, 56],
  line: [214, 220, 208], tile: [240, 245, 236], tileAccent: [226, 240, 214], stripe: [247, 249, 245], amber: [158, 90, 0],
};
export function pdfHeader(doc, { logo, kicker, title, subtitle, right, chip }) {
  const L = PDF_LOOK, PW = 210, M = 14, H = 36;
  doc.setFillColor(...L.deep);
  doc.rect(0, 0, PW, H, 'F');
  doc.setFillColor(...L.lime);
  doc.rect(0, H, PW, 1.2, 'F');
  let x0 = M;
  if (logo) {
    try {
      doc.addImage(logo, 'PNG', M, 9, 18, 18);
      x0 = M + 23;
    } catch {
      /* logo optional */
    }
  }
  doc.setFont('DejaVu', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...L.lime);
  doc.text(kicker, x0, 12.5);
  doc.setFontSize(19);
  doc.setTextColor(255, 255, 255);
  doc.text(title, x0, 21.5, { maxWidth: PW - M - x0 - 34 });
  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(214, 228, 206);
  if (subtitle) doc.text(subtitle, x0, 28, { maxWidth: PW - M - x0 });
  doc.setFontSize(8.5);
  doc.setTextColor(214, 228, 206);
  if (right) doc.text(right, PW - M, 12.5, { align: 'right' });
  if (chip) {
    doc.setFont('DejaVu', 'bold');
    doc.setFontSize(7.5);
    const w = doc.getTextWidth(chip) + 6;
    doc.setFillColor(255, 214, 140);
    doc.roundedRect(PW - M - w, 15.5, w, 5.5, 2.75, 2.75, 'F');
    doc.setTextColor(...L.amber);
    doc.text(chip, PW - M - w / 2, 19.3, { align: 'center' });
    doc.setFont('DejaVu', 'normal');
  }
  return H + 8;
}
export function pdfTile(doc, x, y, w, h, f) {
  const L = PDF_LOOK;
  doc.setFillColor(...(f.accent ? L.tileAccent : L.tile));
  doc.roundedRect(x, y, w, h, 2.5, 2.5, 'F');
  doc.setFillColor(...(f.accent ? L.green : L.lime));
  doc.roundedRect(x, y, 1.6, h, 0.8, 0.8, 'F');
  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...L.grey);
  doc.text(String(f.label).toUpperCase(), x + 4.5, y + 5.2, { maxWidth: w - 7 });
  doc.setFont('DejaVu', 'bold');
  doc.setFontSize(h >= 21 ? 14 : 11.5);
  doc.setTextColor(...(f.accent ? L.green : L.ink));
  doc.text(String(f.value), x + 4.5, y + (h >= 21 ? 13 : 11.8), { maxWidth: w - 7 });
  doc.setFont('DejaVu', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(...L.grey);
  doc.text(doc.splitTextToSize(f.sub || '', w - 7)[0] || '', x + 4.5, y + h - 3.2);
}
export function pdfHeading(doc, x, y, title) {
  const L = PDF_LOOK;
  doc.setFillColor(...L.lime);
  doc.roundedRect(x, y - 3.8, 1.4, 4.8, 0.7, 0.7, 'F');
  doc.setFont('DejaVu', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...L.deep);
  doc.text(title, x + 3.4, y);
}
export const pdfTableLook = () => {
  const L = PDF_LOOK;
  return {
    styles: { font: 'DejaVu', fontSize: 8.8, cellPadding: { top: 1.9, bottom: 1.9, left: 2.4, right: 2.4 }, textColor: L.ink, lineColor: L.line, lineWidth: { bottom: 0.15 }, overflow: 'linebreak' },
    headStyles: { font: 'DejaVu', fontStyle: 'bold', fillColor: L.deep, textColor: [255, 255, 255], fontSize: 8, lineWidth: 0 },
    alternateRowStyles: { fillColor: L.stripe },
    theme: 'plain',
  };
};
export function pdfFooter(doc, left) {
  const L = PDF_LOOK, PW = 210, PH = 297, M = 14;
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('DejaVu', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...L.grey);
    doc.setFillColor(...L.lime);
    doc.rect(M, PH - 11.2, 12, 0.6, 'F');
    doc.setDrawColor(...L.line);
    doc.setLineWidth(0.2);
    doc.line(M + 12, PH - 10.9, PW - M, PH - 10.9);
    // a long footer shrinks to fit beside the page number
    const pageText = `Page ${p} of ${pages}`;
    const room = PW - 2 * M - doc.getTextWidth(pageText) - 6;
    let size = 7.5;
    while (size > 5.5 && doc.getTextWidth(left) > room) doc.setFontSize((size -= 0.25));
    doc.text(left, M, PH - 7);
    doc.setFontSize(7.5);
    doc.text(pageText, PW - M, PH - 7, { align: 'right' });
  }
}

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

// Temporary yarn rates and sale rates (device only) change the figures, so files say so.
export function tempRatesText(idx, money) {
  const m = moneyOf(money);
  const items = !m.yarn ? [] : [
    ...Object.entries((idx && idx.tempRates) || {}).map(([id, rate]) => ({ yarn: idx.yarnsById[id], text: `${fmt.n(rate, 2)}/kg` })),
    ...Object.entries((idx && idx.tempDeltas) || {}).map(([id, d]) => ({ yarn: idx.yarnsById[id], text: `delta ${fmt.n(d, 2)}/kg` })),
  ].filter((x) => x.yarn);
  const rpms = Object.entries((idx && idx.tempRpms) || {})
    .map(([id, v]) => ({ fabric: idx.fabricsById[id], v: v || {} }))
    .filter((x) => x.fabric && (num(x.v.sp) || num(x.v.dp)));
  const prices = !m.sale ? [] : Object.entries((idx && idx.tempPrices) || {})
    .map(([id, price]) => ({ fabric: idx.fabricsById[id], price }))
    .filter((x) => x.fabric);
  return [
    items.length ? `Includes temporary yarn rates, not the yarn master: ${items.map((x) => `${x.yarn.name} ${x.text}`).join(', ')}.` : '',
    rpms.length ? `Temporary loom RPM used, not the fabric master: ${rpms.map((x) => `${x.fabric.name} ${[num(x.v.sp) ? `single panna ${fmt.int(num(x.v.sp))}` : null, num(x.v.dp) ? `double panna ${fmt.int(num(x.v.dp))}` : null].filter(Boolean).join(', ')}`).join('; ')}.` : '',
    prices.length ? `Temporary sale rate used, not the fabric master: ${prices.map((x) => `${x.fabric.name} ₹${fmt.n(x.price, 2)}/m`).join(', ')}.` : '',
  ].filter(Boolean).join(' ');
}

// ---------- WhatsApp ----------
export function whatsappText(fabric, calc, idx, money) {
  const m = moneyOf(money);
  const lines = [`*${fabric.name}*${calc.finish === 'RFD' ? (/\(RFD\)/.test(fabric.name) ? '' : ' (RFD)') : ' (Greige)'}`];
  const reed = num(fabric.reed);
  lines.push(`Reed × Pick: ${reed ? `${reed} × ${calc.ppi ?? '—'}` : `— × ${calc.ppi ?? '—'}`}`);
  for (const w of calc.warp) lines.push(`Warp: ${w.yarn ? w.yarn.name : '—'}${w.ends ? `, ${fmt.int(w.ends)} ends` : ''}`);
  for (const w of calc.weft) lines.push(`Weft: ${w.yarn ? w.yarn.name : '—'}${w.line.pattern ? ` (${w.line.pattern})` : ''}`);
  const g = shareGsm(calc);
  const extra = [calc.width ? `Width ${calc.width}″` : null, g.value !== null ? `GSM ${fmt.n(g.value, 1)}${g.onReed ? ' (on reed space)' : ''}` : null].filter(Boolean).join(' · ');
  if (extra) lines.push(extra);
  if (fabric.weave) lines.push(`Weave: ${fabric.weave}${fabric.design_note ? `, ${fabric.design_note}` : ''}`);
  if (m.sale && calc.price !== null) lines.push(`Price ${fmt.rs(calc.price)} / m`);
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
// Basic spec sheet (1.31.0): header band, key figure tiles, Construction, Warp and weft (and the ₹ groups when a
// caller turns them on; the app sends none). Units and Beam length are no longer in it.
export async function exportFabricPdf(fabric, calc, idx, opts = {}) {
  const m = moneyOf(opts.money);
  const { jsPDF, autoTable, font } = await preloadExports();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  doc.addFileToVFS('DejaVuSans.ttf', font.DEJAVU_REGULAR);
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', font.DEJAVU_BOLD);
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  doc.setFont('DejaVu', 'normal');
  const L = PDF_LOOK;
  const M = 14;
  const W = 210 - 2 * M;
  const { grey } = L;
  const rfd = calc.finish === 'RFD';

  let y = pdfHeader(doc, {
    logo: await loadLogo(),
    kicker: 'HANUMAN GROUP · FABRIC SPEC SHEET',
    title: fabric.name || 'Fabric',
    subtitle: [fabric.weave, fabric.design_note, fabric.end_use, calc.finish, calc.tfoClass].filter(Boolean).join(' · '),
    right: fmt.date(today()) || today(),
  });

  // cover photo + key figures
  const photos = idx.photosByFabric[fabric.id] || [];
  const cover = photos.find((p) => truthy(p.is_cover)) || photos[0];
  let figX = M;
  let photoH = 0;
  if (cover) {
    try {
      const data = await getPhoto(cover, 'full');
      if (data) {
        const props = doc.getImageProperties(data);
        photoH = 50;
        const w = Math.min(74, (props.width / props.height) * photoH);
        doc.addImage(data, 'JPEG', M, y, w, photoH);
        figX = M + w + 5;
      }
    } catch {
      /* photo optional */
    }
  }
  const g = shareGsm(calc);
  const reed = num(fabric.reed);
  const figs = [
    ...(m.realisation ? [{ label: 'Realisation with VATAV', value: `${fmt.pick(calc.realisationNetPerPick)} / pick`, sub: `${fmt.rs(calc.realisationNetPerM)} / ${rfd ? 'RFD m' : 'm'}`, accent: true }, { label: 'Without VATAV', value: `${fmt.pick(calc.realisationPerPick)} / pick`, sub: `${fmt.rs(calc.realisationPerM)} / ${rfd ? 'RFD m' : 'm'}` }] : []),
    ...(m.costs ? [{ label: rfd ? 'RFD cost' : 'RM cost', value: `${fmt.rs(rfd ? calc.rfdCost : calc.rmCost)} / m`, sub: rfd ? `RM ${fmt.rs(calc.rmPerSaleM)} + finishing ${fmt.rs(calc.finishingCost)}` : 'shortage included' }] : []),
    ...(m.sale ? [{ label: 'Selling price', value: `${fmt.rs(calc.price)} / ${rfd ? 'RFD m' : 'm'}${calc.priceTemp ? ' (temporary)' : ''}`, sub: calc.vatavPct ? `VATAV ${calc.vatavPct}%` : 'No VATAV' }] : []),
    { label: g.label, value: g.value === null ? '—' : fmt.n(g.value, 1), sub: g.value === null ? 'needs greige width' : g.onReed ? 'estimate: no greige width set' : 'on greige width', accent: !m.realisation },
    { label: 'Weight per metre', value: `${fmt.n(calc.totalGpm, 1)} g/m`, sub: `${fmt.n(calc.kgPer100, 2)} kg per 100 m` },
    { label: 'Finish', value: calc.finish, sub: calc.tfoClass },
    { label: 'Reed × Pick', value: `${reed || '—'} × ${calc.ppi ?? '—'}`, sub: constructionLine(fabric, calc, idx) },
  ];
  // four tiles to a row across the page; beside a photo, two to a row
  const cols = cover && figX > M ? 2 : 4;
  const gap = 3;
  const tw = (210 - M - figX - gap * (cols - 1)) / cols;
  const th = 22;
  figs.forEach((f, i) => pdfTile(doc, figX + (i % cols) * (tw + gap), y + Math.floor(i / cols) * (th + gap), tw, th, f));
  y += Math.max(Math.ceil(figs.length / cols) * (th + gap) - gap, photoH) + 9;

  const look = pdfTableLook();
  const table = (title, head, body, colStyles) => {
    pdfHeading(doc, M, y, title);
    autoTable(doc, {
      ...look,
      startY: y + 2.5,
      // a heading over a right-aligned column is right-aligned too
      head: head ? [head.map((h, i) => (colStyles && colStyles[i] && colStyles[i].halign === 'right' ? { content: h, styles: { halign: 'right' } } : h))] : undefined,
      body,
      margin: { left: M, right: M, bottom: 16 },
      tableWidth: W,
      columnStyles: colStyles || {},
    });
    y = doc.lastAutoTable.finalY + 9;
  };

  const pctv = (v) => (v === '' || v === undefined || v === null ? '—' : `${v}%`);
  const lab = { textColor: grey, cellWidth: 38 };
  // with no ₹ group on, an RFD fabric's RFD shortage joins Construction instead of a one-row table of its own
  const moneyOn = MONEY_GROUPS.some((k) => m[k]);
  table('Construction', null, [
    ['Reed', fabric.reed || '—', 'Pick (PPI)', calc.ppi ?? '—'],
    ['Total ends', calc.totalEnds === null ? '—' : fmt.int(calc.totalEnds), 'Reed space', calc.rs ? `${calc.rs}″` : '—'],
    ['Greige width', calc.width ? `${calc.width}″` : '—', 'Weave', [fabric.weave, fabric.design_note].filter(Boolean).join(' · ') || '—'],
    ['Warp shortage', pctv(fabric.warp_shortage_pct), 'Weft shortage', pctv(fabric.weft_shortage_pct)],
    ...(rfd && !moneyOn ? [['RFD shortage', pctv(fabric.rfd_shortage_pct), '', '']] : []),
  ], { 0: lab, 1: { fontStyle: 'bold' }, 2: lab, 3: { fontStyle: 'bold' } });

  // Yarn rates off: no Rate and ₹/m columns (the ₹/m total is the sum of those lines, so it goes with them)
  const total = (c) => ({ content: c, styles: { fontStyle: 'bold', fillColor: L.tileAccent, textColor: L.deep } });
  table('Warp and weft', ['Side', 'Yarn', 'Ends / share', ...(m.yarn ? ['Rate ₹/kg'] : []), 'g/m', 'kg/100 m', ...(m.yarn ? ['₹/m'] : [])], [
    ...[...calc.warp, ...calc.weft].map((x) => [
      x.line.side === 'warp' ? 'Warp' : 'Weft',
      `${x.yarn ? x.yarn.name : '—'}${x.line.pattern ? ` (${x.line.pattern})` : ''}`,
      x.line.side === 'warp' ? (x.ends ? fmt.int(x.ends) : '—') : `${Math.round((x.share || 0) * 100)}%`,
      ...(m.yarn ? [x.rate === null ? '—' : `${fmt.n(x.rate, 2)}${x.temp ? ' (temp)' : ''}`] : []),
      fmt.n(x.gpm, 2),
      fmt.n(x.kgPer100, 3),
      ...(m.yarn ? [x.costPerM === null ? '—' : fmt.n(x.costPerM, 2)] : []),
    ]),
    [{ content: 'Total', colSpan: m.yarn ? 4 : 3, styles: { fontStyle: 'bold', fillColor: L.tileAccent, textColor: L.deep } }, total(fmt.n(calc.totalGpm, 2)), total(fmt.n(calc.kgPer100, 3)), ...(m.yarn ? [total(calc.rmCost === null ? '—' : fmt.n(calc.rmCost, 2))] : [])],
  ], m.yarn ? { 0: { cellWidth: 18 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } } : { 0: { cellWidth: 18 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } });

  // [group, label, value]; null group = always shown (no ₹ in it)
  const costRows = (rfd
    ? [
        ['sale', 'Selling price', `${fmt.rs(calc.price)} / RFD m${calc.priceTemp ? ' (temporary)' : ''}`],
        ['sale', 'Sale date', fmt.date(fabric.sale_date) || '—'],
        [null, 'RFD shortage', pctv(fabric.rfd_shortage_pct)],
        ['costs', 'Processing charge', `${fmt.rs(num(fabric.processing_charge))} / m`],
        ['costs', 'Transportation', num(fabric.transport_charge) === null ? '—' : `${fmt.rs(num(fabric.transport_charge))} / RFD m`],
        ['costs', 'Brokering', pctv(fabric.brokering_pct)],
        ['costs', 'RM cost per RFD m', fmt.rs(calc.rmPerSaleM)],
        ['costs', 'Finishing cost', fmt.rs(calc.finishingCost)],
        ['costs', 'RFD cost', `${fmt.rs(calc.rfdCost)} / m`],
        ['realisation', 'Realisation without VATAV', `${fmt.rs(calc.realisationPerM)} / m · ${fmt.pick(calc.realisationPerPick)} / pick`],
        ['sale', 'VATAV', calc.vatavPct ? `${calc.vatavPct}% · −${fmt.rs(calc.vatavAmount)} / m` : 'None'],
        ['realisation', 'Realisation with VATAV', `${fmt.rs(calc.realisationNetPerM)} / m · ${fmt.pick(calc.realisationNetPerPick)} / pick`],
      ]
    : [
        ['sale', 'Selling price', `${fmt.rs(calc.price)} / m${calc.priceTemp ? ' (temporary)' : ''}`],
        ['sale', 'Sale date', fmt.date(fabric.sale_date) || '—'],
        ['costs', 'RM cost (shortage included)', `${fmt.rs(calc.rmCost)} / m`],
        ['realisation', 'Realisation without VATAV', `${fmt.rs(calc.realisationPerM)} / m · ${fmt.pick(calc.realisationPerPick)} / pick`],
        ['sale', 'VATAV', calc.vatavPct ? `${calc.vatavPct}% · −${fmt.rs(calc.vatavAmount)} / m` : 'None'],
        ['realisation', 'Realisation with VATAV', `${fmt.rs(calc.realisationNetPerM)} / m · ${fmt.pick(calc.realisationNetPerPick)} / pick`],
      ]).filter(([gr]) => !gr || m[gr]).map(([, l, v]) => [l, v]);
  // the RFD shortage row has no ₹, so an RFD sheet keeps it with every ₹ group off
  if (moneyOn && costRows.length) table(rfd ? 'Finishing · RFD' : 'Greige', null, costRows, { 0: { textColor: grey, cellWidth: 70 }, 1: { fontStyle: 'bold' } });

  const note = [m.realisation ? 'Realisation per pick = (selling price − RM cost with shortage − finishing cost) / picks; with VATAV, the VATAV discount is also taken off. Figures use the latest yarn rates.' : '', g.onReed ? 'GSM is an estimate on reed space, as no greige width is set.' : '', tempRatesText(idx, m)].filter(Boolean).join(' ');
  if (note) {
    const lines = doc.splitTextToSize(note, W);
    if (y + lines.length * 3.4 > 282) {
      doc.addPage();
      y = 18;
    }
    doc.setFont('DejaVu', 'normal');
    doc.setFontSize(7.8);
    doc.setTextColor(...(tempRatesText(idx, m) ? L.amber : grey));
    doc.text(lines, M, y);
  }
  pdfFooter(doc, `${fabric.name || 'Fabric'} · fabric spec sheet · ${fmt.date(today()) || today()} · Hanuman Group`);
  const blob = doc.output('blob');
  await deliver(blob, fileName(fabric.name, 'spec', 'pdf'), `${fabric.name} spec sheet`, opts);
}

// ---------- Excel ----------
const r2 = (v, dp = 2) => (v === null || v === undefined ? '' : Math.round(v * 10 ** dp) / 10 ** dp);

// Excel fields of each ₹ group, left out when the group is off.
const XL_GROUPS = {
  sale: ['Selling price ₹/m', 'Price basis', 'Sale date', 'VATAV %', 'VATAV ₹/m'],
  costs: ['RM cost ₹/m', 'Processing ₹/m', 'Transportation ₹/m', 'Brokering %', 'RFD cost ₹/m'],
  realisation: ['Realisation ₹/m without VATAV', 'Realisation ₹/pick without VATAV', 'Realisation ₹/m with VATAV', 'Realisation ₹/pick with VATAV'],
};

function fabricRow(fabric, calc, idx, unit, money, basic = false) {
  const m = moneyOf(money);
  const row = {
    Quality: fabric.name,
    Weave: fabric.weave || '',
    'End use': fabric.end_use || '',
    Finish: calc.finish,
    'TFO class': calc.tfoClass,
    Reed: num(fabric.reed) ?? '',
    'Pick (PPI)': calc.ppi ?? '',
    'Loom RPM single panna': calc.rpmSp ?? num(fabric.loom_rpm) ?? '',
    'Loom RPM double panna': calc.rpmDp ?? num(fabric.loom_rpm_dp) ?? '',
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
    ...(calc.priceTemp ? { 'Price basis': `Temporary (master ${calc.masterPrice ?? '—'})` } : {}),
    'Sale date': String(fabric.sale_date || '').slice(0, 10),
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
    if (m.costs) row[`Cost/pick ${unit.name}`] = p.costPerPick ?? '';
    if (m.realisation) row[`Profit ₹/pick ${unit.name} (with VATAV)`] = r2(p.profitPerPick, 4);
    if (m.costs) row[`Profit ₹/m ${unit.name}`] = r2(p.profitPerM);
  }
  for (const [g, keys] of Object.entries(XL_GROUPS)) if (!m[g]) for (const k of keys) delete row[k];
  if (basic) {
    // Basic spec sheet (1.31.0): construction and consumption only; GSM on reed space when there is no greige width
    for (const k of ['Loom RPM single panna', 'Loom RPM double panna', 'Units']) delete row[k];
    const g = shareGsm(calc);
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === 'GSM') {
        out.GSM = r2(g.value, 1);
        if (g.onReed) out['GSM basis'] = 'Reed space (no greige width set)';
      } else out[k] = v;
    }
    return out;
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
  const m = moneyOf(opts.money);
  const { XLSX } = await preloadExports();
  const wb = XLSX.utils.book_new();
  const summary = Object.entries(fabricRow(fabric, calc, idx, null, m, true)).map(([k, v]) => ({ Field: k, Value: v }));
  if (tempRatesText(idx, m)) summary.push({ Field: 'Note', Value: tempRatesText(idx, m) });
  XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, summary), 'Summary');
  const yarnRows = [...calc.warp, ...calc.weft].map((x) => ({
    Side: x.line.side === 'warp' ? 'Warp' : 'Weft',
    Yarn: x.yarn ? x.yarn.name : '',
    Denier: r2(x.denier, 1),
    Ends: x.line.side === 'warp' ? x.ends ?? '' : '',
    'Pick share %': x.line.side === 'weft' ? r2((x.share || 0) * 100, 1) : '',
    Pattern: x.line.pattern || '',
    ...(m.yarn ? { 'Rate ₹/kg': x.rate ?? '' } : {}),
    ...(m.yarn && x.temp ? { 'Rate basis': 'Temporary' } : {}),
    'g/m': r2(x.gpm),
    'kg per 100 m': r2(x.kgPer100, 3),
    ...(m.yarn ? { '₹/m': r2(x.costPerM) } : {}),
  }));
  XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, yarnRows), 'Warp and weft');
  await deliver(writeBook(XLSX, wb), fileName(fabric.name, 'spec', 'xlsx'), `${fabric.name} spec sheet`, opts);
}

export async function exportListXlsx(rows, idx, unit) {
  if (!rows.length) {
    toast('No fabrics to export', 'error');
    return;
  }
  const { XLSX } = await preloadExports();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, rows.map((r) => fabricRow(r.fabric, r.calc, idx, unit))), 'Fabrics');
  if (tempRatesText(idx)) XLSX.utils.book_append_sheet(wb, sheetFromRows(XLSX, [{ Note: tempRatesText(idx) }]), 'Note');
  await deliver(writeBook(XLSX, wb), fileName(unit ? `${unit.name} fabrics` : 'all fabrics', '', 'xlsx'), unit ? `${unit.name} fabrics` : 'All fabrics');
}
