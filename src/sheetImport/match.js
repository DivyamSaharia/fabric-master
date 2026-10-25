// Planning sheet rows → planner rows. Matching a sheet name ("SALSA ANMOL-54(5902)") to a quality of the master,
// placing looms on a loom group of the right width, and choosing an RPM per row. Pure functions.
import { groupPanna, num, stripRfd, stripRs } from '../calc.js';
import { fitsGroup, keys, masterLoomRpm, withSetting } from '../planner.js';
import { splitName } from './parse.js';

// ---------- names ----------
const SPELLINGS = { GAJI: 'GAJJI', GAIJI: 'GAJJI', GAJJl: 'GAJJI', CREPE: 'CRAPE', CRAP: 'CRAPE', SATTIN: 'SATIN', TWIL: 'TWILL', ORGANJA: 'ORGANZA' };

// Words only: no codes, numbers, single letters ("Gajji Silk-L-41 (8802)" → "GAJJI SILK").
export function nameWords(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !/^\d+$/.test(w))
    .map((w) => SPELLINGS[w] || w)
    .join(' ');
}

// Text used as the alias key: what the sheet says, tidied (spacing, case).
export const aliasText = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').replace(/\s*\(\s*/g, '(').replace(/\s*\)\s*/g, ')').trim();

const bigrams = (s) => {
  const t = ` ${s} `;
  const out = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
};

// Dice similarity of two word strings, 0..1.
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let both = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v;
  for (const v of B.values()) nb += v;
  for (const [g, v] of A) both += Math.min(v, B.get(g) || 0);
  return (2 * both) / (na + nb);
}

export const codesIn = (s) => [...String(s || '').matchAll(/\((\d{3,5})\)/g)].map((m) => m[1]);

// What a quality can be recognised by: its names (stored name, design notes), its codes and its RS.
export function qualityKeys(q) {
  const names = new Set();
  const codes = new Set();
  for (const m of q.members) {
    const rs = num(m.reed_space_in);
    names.add(nameWords(stripRs(stripRfd(m.name), rs)));
    if (m.design_note) {
      const w = nameWords(m.design_note);
      if (w) names.add(w);
      for (const c of codesIn(m.design_note)) codes.add(c);
    }
  }
  const rs = num(q.fabric.reed_space_in);
  return { names: [...names].filter(Boolean), codes: [...codes], rs: rs === null ? null : Math.round(rs) };
}

// Score of one quality for one sheet name, 0..1, and what it rests on.
export function scoreQuality(sheet, q) {
  const k = qualityKeys(q);
  const words = nameWords(sheet.base || sheet.text);
  const nameSim = Math.max(0, ...k.names.map((n) => similarity(words, n)));
  let rsScore = 0.5;
  if (sheet.rs !== null && sheet.rs !== undefined && k.rs !== null) rsScore = Math.abs(sheet.rs - k.rs) <= 1 ? 1 : 0;
  let codeScore = 0.5, codeExact = false;
  if (sheet.code && k.codes.length) {
    if (k.codes.includes(sheet.code)) { codeScore = 1; codeExact = true; }
    else if (k.codes.some((c) => c.slice(0, 3) === sheet.code.slice(0, 3))) codeScore = 0.75;
    else codeScore = 0;
  }
  const score = 0.6 * nameSim + 0.25 * rsScore + 0.15 * codeScore;
  return { q, score, nameSim, rsScore, codeScore, codeExact };
}

export const AUTO_SCORE = 0.75;
export const AUTO_MARGIN = 0.1;

// Candidate qualities for a size: those that fit at least one loom group of that width at the unit.
export function widthGroups(groups, width) {
  return groups.filter((g) => Math.abs((num(g.reed_width_cm) ?? 0) - width) <= 15);
}

// One sheet row → { how: 'alias' | 'code' | 'name' | 'ask' | 'none', pick, options }.
// 'alias' = you confirmed this text before; 'code'/'name' = sure enough to pre-select (shown in review);
// 'ask' = two or more close candidates; 'none' = nothing close.
export function matchRow(name, width, list, groups, aliases = []) {
  const sheet = splitName(name);
  const wg = widthGroups(groups, width);
  const fits = list.filter((q) => wg.some((g) => fitsGroup(q, g)));
  const key = aliasText(name);
  const alias = aliases.find((a) => Number(a.width_cm) === width && aliasText(a.sheet_text) === key);
  if (alias) {
    const q = list.find((x) => x.members.some((m) => m.id === alias.fabric_id));
    if (q) return { sheet, how: 'alias', pick: q, options: [q], scored: [] };
  }
  const scored = fits.map((q) => scoreQuality(sheet, q)).sort((a, b) => b.score - a.score);
  const best = scored[0], second = scored[1];
  const options = scored.filter((s) => s.score >= 0.45).slice(0, 3).map((s) => s.q);
  if (!best || best.score < 0.5) return { sheet, how: 'none', pick: null, options, scored };
  // A code decides only when exactly one quality carries it AND its name agrees with the sheet name AND the RS
  // does not contradict it. A code shared by two fabrics, or written against another name, falls back to scoring.
  const exactCodes = scored.filter((s) => s.codeExact && s.nameSim >= 0.8);
  const codeHolders = scored.filter((s) => s.codeExact);
  if (exactCodes.length === 1 && codeHolders.length === 1 && exactCodes[0].rsScore !== 0) return { sheet, how: 'code', pick: exactCodes[0].q, options, scored };
  if (best.score >= AUTO_SCORE && (!second || best.score - second.score >= AUTO_MARGIN)) return { sheet, how: 'name', pick: best.q, options, scored };
  return { sheet, how: 'ask', pick: null, options, scored };
}

// ---------- loom groups ----------
const isDobby = (x) => String((x && (x.weave ?? x.shedding)) || '').toLowerCase() === 'dobby';

// Looms of each matched row placed on a loom group of its width: a dobby quality on the dobby group, a plain one
// on the plain group; plain looms beyond the plain group's size go to the dobby group of that width (a dobby loom
// weaves plain too). Returns [{ key, groupId, looms, overflow }] per row key.
export function placeLooms(rows, groups) {
  const out = [];
  const left = new Map(groups.map((g) => [g.id, num(g.looms) ?? Infinity]));
  // dobby first, so plain overflow sees what the dobby qualities left
  const order = rows.slice().sort((a, b) => Number(isDobby(b.q.fabric)) - Number(isDobby(a.q.fabric)));
  for (const r of order) {
    const wg = widthGroups(groups, r.width).filter((g) => fitsGroup(r.q, g));
    const dobbyG = wg.filter(isDobby);
    const plainG = wg.filter((g) => !isDobby(g));
    const prefer = isDobby(r.q.fabric) ? dobbyG : [...plainG, ...dobbyG];
    let need = r.looms;
    const parts = [];
    prefer.forEach((g, i) => {
      if (need <= 0) return;
      const last = i === prefer.length - 1;
      const room = left.get(g.id);
      const take = last ? need : Math.min(need, Math.max(0, room));
      if (take > 0) {
        parts.push({ key: r.key, groupId: g.id, looms: take, overflow: i > 0 });
        left.set(g.id, room - take);
        need -= take;
      }
    });
    if (!prefer.length) parts.push({ key: r.key, groupId: null, looms: r.looms, overflow: false });
    out.push(...parts);
  }
  return out;
}

// ---------- RPM ----------
export const RPM_RANGE = { 190: [500, 1300], 280: [400, 1000] };
export const RPM_GAP = 0.2;

// The RPM a row will use, from the source picked: 'image' (current speed), 'target', 'master' or 'manual'.
export function defaultSource({ image, master }) {
  if (image !== null && image !== undefined) return 'image';
  if (master !== null && master !== undefined) return 'master';
  return 'manual';
}

// Check a typed or chosen RPM. Errors stop the import; warnings only flag.
export function checkRpm(raw, { width, master, image }) {
  const s = String(raw ?? '').trim();
  if (!s) return { value: null, error: 'Enter an RPM', warnings: [] };
  if (!/^\d+(\.\d+)?$/.test(s)) return { value: null, error: 'Numbers only', warnings: [] };
  const v = Number(s);
  if (!Number.isInteger(v)) return { value: null, error: 'Whole number only', warnings: [] };
  if (v <= 0) return { value: null, error: 'Must be more than 0', warnings: [] };
  const warnings = [];
  const range = RPM_RANGE[width];
  if (range && (v < range[0] || v > range[1])) warnings.push(`Unusual for ${width} cm (usual ${range[0]}–${range[1]})`);
  if (master && Math.abs(v - master) / master > RPM_GAP) warnings.push(`${Math.round(((v - master) / master) * 100)}% from master ${master}`);
  else if (!master && image && Math.abs(v - image) / image > RPM_GAP) warnings.push(`${Math.round(((v - image) / image) * 100)}% from sheet ${image}`);
  return { value: v, error: null, warnings };
}

// ---------- into the plan ----------
// Replaces the looms of the working plan with the imported rows (and their loom RPM / efficiency edits);
// TFO sides, receipts, TFO settings and Greige/RFD choices of qualities still in the plan are kept.
// entries: [{ fabricId (quality id), groupId, looms, rpm }]. Same quality on the same group twice is summed,
// with a loom-weighted RPM.
export function applyImport(plan, entries, list, groups) {
  const merged = new Map();
  for (const e of entries) {
    if (!e.groupId || !e.fabricId || !(e.looms > 0)) continue;
    const k = `${e.fabricId}:${e.groupId}`;
    const cur = merged.get(k);
    if (!cur) merged.set(k, { ...e });
    else {
      const looms = cur.looms + e.looms;
      cur.rpm = cur.rpm !== null && e.rpm !== null ? Math.round((cur.rpm * cur.looms + e.rpm * e.looms) / looms) : cur.rpm ?? e.rpm;
      cur.looms = looms;
    }
  }
  const settings = {};
  for (const [k, v] of Object.entries(plan.settings || {})) if (!/^(rpm|eff):/.test(k)) settings[k] = v;
  const soldAs = {};
  for (const [k, v] of Object.entries(plan.soldAs || {})) if (merged.has(k)) soldAs[k] = v;
  let next = { ...plan, looms: [], settings, soldAs };
  const byMember = Object.fromEntries(list.flatMap((q) => q.members.map((m) => [m.id, q])));
  for (const e of merged.values()) {
    next.looms.push({ fabricId: e.fabricId, groupId: e.groupId, looms: String(e.looms) });
    const q = byMember[e.fabricId];
    const g = groups.find((x) => x.id === e.groupId);
    const master = q && g ? masterLoomRpm(q, g) : null;
    if (e.rpm !== null && e.rpm !== undefined) next = withSetting(next, keys.rpm(e.fabricId, e.groupId), e.rpm, master);
  }
  return next;
}

// Design note to add a missing article code to: "Bright Satin-48 (0402)" from the sheet text.
export function noteWithCode(sheetText, code) {
  const t = splitName(sheetText);
  const title = t.base.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return `${title}${t.rs ? `-${t.rs}` : ''} (${code})`;
}

// Fabrics of a quality that carry no code in their design note yet.
export const membersWithoutCode = (q) => q.members.filter((m) => !codesIn(m.design_note).length);

// A sheet code is only written to a fabric when no other quality already carries it (no new shared codes).
export const codeFree = (code, list, q) => !!code && !list.some((x) => x.id !== q.id && x.members.some((m) => codesIn(m.design_note).includes(code)));

export { groupPanna };
