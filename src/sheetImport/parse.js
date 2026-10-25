// Planning sheet photo → sections of rows (quality text, looms planned, current and target speed).
// The OCR engine is passed in as `ocr(cellImage, kind)` → { text, confidence } so this runs in the browser
// (Tesseract.js worker) and in tests alike. kind: 'header' | 'text' | 'digits'.
import { cellImage, findLines, inkShare, tableRows } from './grid.js';

const up = (s) => String(s || '').toUpperCase();
const lettersOnly = (s) => up(s).replace(/[^A-Z]/g, '');

// Column roles from the header words. The sheet has two headers with "PLANNING": the real one and PRIPOSE PLANNING.
export function columnRoles(headerTexts) {
  const roles = { name: 0, planning: null, current: null, target: null };
  headerTexts.forEach((t, i) => {
    const L = lettersOnly(t);
    if (/CURREN/.test(L) || /CURRENTSPEED/.test(L)) roles.current = i;
    else if (/TARGET/.test(L)) roles.target = i;
    else if (/PLANN/.test(L) && !/PR[IO1]POS|PROPOS|PRIPO|POSE/.test(L) && i > 0) roles.planning ??= i;
  });
  return roles;
}

// The fixed layout of the Unit 2 planning sheet, used when a header word cannot be read.
export const FIXED_ROLES = { name: 0, planning: 3, current: 8, target: 9 };

export const isNoProgram = (t) => /NOPRO/.test(lettersOnly(String(t || '').replace(/0/g, 'O')));

// Digits out of an OCR reading ("1,000" → 1000, "O" read for 0 fixed). Blank → null.
export function readInt(text) {
  const s = String(text || '').replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/[^0-9]/g, '');
  return s ? Number(s) : null;
}

// Article code in brackets and a trailing RS: "SALSA ANMOL-54(5902)" → { code: '5902', rs: 54 }.
export function splitName(text) {
  let t = up(text).replace(/\s+/g, ' ').trim();
  // the code is digits only, so letters read inside the brackets are look-alike digits (A801 → 4801)
  const codeM = /\(\s*([0-9A-Z]{3,5})\s*\)?\s*$/.exec(t);
  let code = null;
  if (codeM && /\d/.test(codeM[1])) {
    const LOOK = { O: '0', D: '0', Q: '0', I: '1', L: '1', T: '7', Z: '2', A: '4', S: '5', G: '6', B: '8' };
    const fixed = codeM[1].replace(/[A-Z]/g, (ch) => LOOK[ch] ?? '');
    if (/^\d{3,5}$/.test(fixed)) code = fixed;
    t = t.slice(0, codeM.index).trim();
  }
  t = t.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  const rsM = /[-\s]+(\d{2,3})\s*$/.exec(t);
  const rs = rsM ? Number(rsM[1]) : null;
  const base = (rsM ? t.slice(0, rsM.index) : t).replace(/[-]+$/, '').trim();
  return { text: up(text).replace(/\s+/g, ' ').trim(), base, code, rs };
}

const sectionWidth = (text) => {
  const s = up(text).replace(/O/g, '0');
  if (/280|28O|2B0/.test(s)) return 280;
  if (/190|19O|I90|l90/.test(s)) return 190;
  return null;
};

// The whole sheet. Returns { sections: [{ width, rows, total }], grandTotal, problems, columns, lines }.
// Each row: { kind: 'quality' | 'stopped', name, nameConf, planning, planningConf, current, currentConf, target,
// targetConf, rect: { name, planning, current, target } } with rects in image pixels for showing the cell.
export async function parseSheet(img, ocr, { onProgress } = {}) {
  const lines = findLines(img);
  const problems = [];
  if (lines.xs.length < 6 || lines.ys.length < 6) {
    return { sections: [], grandTotal: null, problems: ['No table found in the photo. Use a screenshot of the planning sheet.'], columns: null, lines };
  }
  const xs = lines.xs;
  const rows = tableRows(img, lines);
  const header = rows[0];
  const ncol = xs.length - 1;
  const rect = (row, c) => ({ x0: xs[c], y0: row.y0, x1: xs[c + 1], y1: row.y1 });
  const cell = (row, c) => rect(row, c);

  const read = async (r, kind) => {
    if (inkShare(img, r.x0, r.y0, r.x1, r.y1) < 0.004) return { text: '', confidence: 100, blank: true };
    const ci = cellImage(img, r.x0, r.y0, r.x1, r.y1);
    if (!ci) return { text: '', confidence: 100, blank: true };
    const out = await ocr(ci, kind);
    return { text: String(out.text || '').trim(), confidence: Math.round(out.confidence ?? 0), blank: false };
  };

  // Header → which column is which.
  const headerTexts = [];
  for (let c = 0; c < ncol; c++) headerTexts.push((await read(cell(header, c), 'header')).text);
  let roles = columnRoles(headerTexts);
  const fixed = ncol === 11;
  for (const k of ['planning', 'current', 'target']) {
    if (roles[k] === null && fixed) roles[k] = FIXED_ROLES[k];
  }
  if (roles.planning === null) {
    return { sections: [], grandTotal: null, problems: ['Could not find the PLANNING column. Is this the daily planning sheet?'], columns: { headerTexts, roles }, lines };
  }

  const body = rows.slice(1);
  const sections = [];
  let current = null, grandTotal = null, done = 0;
  for (const row of body) {
    done++;
    if (onProgress) onProgress(done / body.length);
    if (row.merged) {
      const t = (await read({ x0: xs[0], y0: row.y0, x1: xs[xs.length - 1], y1: row.y1 }, 'text')).text;
      const w = sectionWidth(t);
      if (w) {
        current = { width: w, rows: [], total: null, totalConf: null, sizeText: t };
        sections.push(current);
      } else if (t) problems.push(`Skipped a merged row reading “${t}”.`);
      continue;
    }
    if (row.tinted) {
      // TOTAL rows: the first one after a size block is that size's total, a later one the grand total.
      const p = await read(cell(row, roles.planning), 'digits');
      const v = readInt(p.text);
      if (current && current.total === null) {
        current.total = v;
        current.totalConf = p.confidence;
      } else grandTotal = v;
      continue;
    }
    if (!current) continue; // rows above the first SIZE header
    const n = await read(cell(row, roles.name), 'text');
    const p = await read(cell(row, roles.planning), 'digits');
    const planning = readInt(p.text);
    const stopped = isNoProgram(n.text);
    const out = {
      kind: stopped ? 'stopped' : 'quality',
      name: n.text,
      nameConf: n.confidence,
      planning,
      planningRaw: p.text,
      planningConf: p.blank ? null : p.confidence,
      planningBlank: p.blank,
      current: null, currentConf: null, target: null, targetConf: null,
      rect: { name: cell(row, roles.name), planning: cell(row, roles.planning), current: roles.current !== null ? cell(row, roles.current) : null, target: roles.target !== null ? cell(row, roles.target) : null },
    };
    if (!stopped && n.blank && p.blank) continue; // empty row
    if (!stopped && (planning ?? 0) > 0) {
      if (roles.current !== null) {
        const c = await read(cell(row, roles.current), 'digits');
        out.current = readInt(c.text);
        out.currentConf = c.blank ? null : c.confidence;
      }
      if (roles.target !== null) {
        const t = await read(cell(row, roles.target), 'digits');
        out.target = readInt(t.text);
        out.targetConf = t.blank ? null : t.confidence;
      }
    }
    current.rows.push(out);
  }
  if (!sections.length) problems.push('No SIZE 190 or SIZE 280 heading found.');
  return { sections, grandTotal, problems, columns: { headerTexts, roles }, lines };
}

// Count checks: looms planned + stopped per size against that size's TOTAL row and the unit's loom groups.
export function countChecks(parsed, fleetByWidth = {}) {
  const out = [];
  let all = 0;
  for (const s of parsed.sections) {
    const sum = s.rows.reduce((a, r) => a + (r.planning ?? 0), 0);
    all += sum;
    const fleet = fleetByWidth[s.width] ?? null;
    out.push({ width: s.width, sum, total: s.total, fleet, okTotal: s.total === null || s.total === sum, okFleet: fleet === null || fleet === sum });
  }
  return { sizes: out, all, grandTotal: parsed.grandTotal, okGrand: parsed.grandTotal === null || parsed.grandTotal === all };
}
