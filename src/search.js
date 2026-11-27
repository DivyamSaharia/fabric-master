// One search for the whole app (1.27.0), like the CFM dashboard's: tabs, fabrics, yarns, units, Guide topics and,
// on a fabric page, that page's sections. Favourites (the 5 places opened most over 30 days) and Recent (the last 10
// places or searches) are kept on this device only. Nothing here changes data.
import { TOPICS, topicText } from './guide/topics.js';
import { isTpm, yarnCountLabel } from './calc.js';
import { local } from './storage.js';

// Sections of the fabric page, in page order. The first six are also the jump buttons.
export const FABRIC_SECTIONS = [
  ['sec-summary', 'Summary'], ['sec-rates', 'Rates'], ['sec-construction', 'Construction'], ['sec-costing', 'Costing'],
  ['sec-units', 'Units'], ['sec-production', 'Production'], ['sec-rpm', 'Try a loom RPM'], ['sec-beam', 'Beam length'],
  ['sec-sale-rates', 'Sale rate history'],
];

export const TAB_PLACES = [
  ['fabrics', 'Fabrics'], ['yarns', 'Yarns'], ['units', 'Units'], ['ranking', 'Ranking'], ['planner', 'Planner'],
];
const OTHER_PLACES = [
  ['/guide', 'Guide', 'Help for every screen'], ['/settings', 'Settings', 'Connection, people, what’s new'],
  ['/changes', 'Recent changes', 'Who changed what'],
];

const low = (s) => String(s || '').toLowerCase();

// Every place the search can open. fabricId: the fabric page on screen (its sections are listed), or null.
export function buildSearchIndex(idx, fabricId) {
  const out = [];
  const add = (it) => out.push({ ...it, hay: low(`${it.label} ${it.sub || ''} ${it.extra || ''}`) });
  TAB_PLACES.forEach(([id, label], i) => add({ id: `t:${id}`, kind: 'Tab', label, sub: `Tab · key ${i + 1}`, go: `/${id}`, tab: true }));
  for (const [go, label, sub] of OTHER_PLACES) add({ id: `p:${go}`, kind: 'Tab', label, sub, go });
  const f = fabricId ? idx.fabricsById[fabricId] : null;
  if (f) {
    for (const [sec, label] of FABRIC_SECTIONS) add({ id: `s:${fabricId}:${sec}`, kind: 'On this page', label, sub: f.name, go: `/fabric/${fabricId}`, section: sec });
  }
  for (const fab of Object.values(idx.fabricsById)) {
    add({ id: `f:${fab.id}`, kind: 'Fabric', label: fab.name, sub: [fab.weave, fab.finish === 'RFD' ? 'RFD' : 'Greige', fab.design_note].filter(Boolean).join(' · '), go: `/fabric/${fab.id}`, extra: fab.end_use });
  }
  for (const y of Object.values(idx.yarnsById)) {
    add({ id: `y:${y.id}`, kind: 'Yarn', label: y.name, sub: [isTpm(y) ? 'TPM yarn' : 'Base yarn', yarnCountLabel(y, idx), y.material].filter(Boolean).join(' · '), go: `/yarn/${y.id}` });
  }
  for (const u of Object.values(idx.unitsById)) add({ id: `u:${u.id}`, kind: 'Unit', label: u.name, sub: 'Unit', go: `/unit/${u.id}` });
  for (const t of TOPICS) add({ id: `g:${t.id}`, kind: 'Guide', label: t.title, sub: t.purpose, go: `/guide/${t.id}`, extra: topicText(t) });
  return out;
}

const KIND_ORDER = ['On this page', 'Tab', 'Fabric', 'Yarn', 'Unit', 'Guide'];
// "fabric …" or "yarn …" at the start limits the search to that kind (g then f / g then y).
const SCOPES = { fabric: 'Fabric', fabrics: 'Fabric', yarn: 'Yarn', yarns: 'Yarn', unit: 'Unit', units: 'Unit', guide: 'Guide' };

// Places matching q: every word must appear. Best first: name starts with the text, then a word of the name does,
// then the name has it, then only the second line or Guide text has it. Grouped by kind in KIND_ORDER.
export function searchPlaces(items, q, limit = 40) {
  let words = low(q).split(/\s+/).filter(Boolean);
  let scope = null;
  if (words.length && SCOPES[words[0]] && /\s/.test(String(q).trimStart())) {
    scope = SCOPES[words[0]];
    words = words.slice(1);
  }
  if (!words.length && !scope) return [];
  const text = words.join(' ');
  const scored = [];
  for (const it of items) {
    if (scope && it.kind !== scope) continue;
    if (!words.every((w) => it.hay.includes(w))) continue;
    const l = low(it.label);
    let s = 4;
    if (!text) s = 1;
    else if (l.startsWith(text)) s = 0;
    else if (l.split(/[\s(·/-]+/).some((p) => p.startsWith(words[0]))) s = 1;
    else if (words.every((w) => l.includes(w))) s = 2;
    else if (words.every((w) => low(`${it.label} ${it.sub || ''}`).includes(w))) s = 3;
    scored.push({ it, s });
  }
  scored.sort((a, b) => KIND_ORDER.indexOf(a.it.kind) - KIND_ORDER.indexOf(b.it.kind) || a.s - b.s || a.it.label.localeCompare(b.it.label, 'en', { numeric: true }));
  // the best match of all leads, so Enter opens it
  const best = scored.slice().sort((a, b) => a.s - b.s)[0];
  const list = scored.map((x) => x.it);
  if (best && best.s < 2) {
    const i = list.indexOf(best.it);
    if (i > 0) list.unshift(...list.splice(i, 1));
  }
  return list.slice(0, limit);
}

// ---------- favourites and recent (this device only) ----------
const NAV_KEY = 'fm.nav.v1';
const DAY = 86400000;
const read = () => {
  const v = local.get(NAV_KEY, {}) || {};
  return { visits: v.visits && typeof v.visits === 'object' ? v.visits : {}, recent: Array.isArray(v.recent) ? v.recent : [] };
};

// A place opened. Tabs and fabric/yarn/unit pages count towards Favourites; every place (and a search with no place)
// goes to the top of Recent.
export function notePlace(place, now = Date.now()) {
  if (!place || !place.id) return;
  const v = read();
  const keep = { id: place.id, kind: place.kind, label: place.label, sub: place.sub || '', go: place.go || null, section: place.section || null, search: place.search || null };
  if (!place.search && place.kind !== 'On this page') {
    const times = (v.visits[place.id] && v.visits[place.id].t) || [];
    v.visits[place.id] = { ...keep, t: [...times.filter((x) => now - x < 30 * DAY), now].slice(-60) };
  }
  v.recent = [keep, ...v.recent.filter((r) => r.id !== place.id)].slice(0, 10);
  // drop places not visited in 30 days
  for (const [k, x] of Object.entries(v.visits)) if (!(x.t || []).some((t) => now - t < 30 * DAY)) delete v.visits[k];
  local.set(NAV_KEY, v);
}

export function favourites(now = Date.now()) {
  return Object.values(read().visits)
    .map((x) => ({ ...x, n: (x.t || []).filter((t) => now - t < 30 * DAY).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || Math.max(...b.t) - Math.max(...a.t))
    .slice(0, 5);
}

export const recentPlaces = () => read().recent;

// Open the search with text typed: in the side menu on a laptop, else the full-screen sheet (screens/search.jsx).
export const openSearch = (text = '') => window.dispatchEvent(new CustomEvent('fm-open-search', { detail: text }));
