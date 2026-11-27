// Sale rate history per fabric (SaleRates tab, backend v15).
// Fabrics.price and Fabrics.sale_date stay the rate in use; history rows record every price the fabric has had.
// Like yarn rates: deleting the rate in use brings back the next older rate (price and sale date).
// Every price change is its own row (1.35.0); rows on one date are ordered by when they were saved.
import { fabricCalc, num, rateSources } from './calc.js';
import { newId } from './schema.js';

const d10 = (v) => String(v || '').slice(0, 10);

// "4:42 pm" (IST) from an ISO timestamp, '' when there is none.
function savedTime(v) {
  const t = Date.parse(v || '');
  return isNaN(t) ? '' : new Date(t).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
}

// Newest first; rows without a date go last. Same date: the one saved last first.
export function sortSaleRows(rows) {
  return [...(rows || [])].sort((a, b) => {
    const da = d10(a.effective_date);
    const db = d10(b.effective_date);
    if (!da !== !db) return da ? -1 : 1;
    return db.localeCompare(da) || String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  });
}

// The history shown on a fabric page: [{ id, rate, date, inUse, virtual, row }].
// The row in use is the one matching the fabric's price and sale date. A price that no history row
// matches (typed into the Sheet by hand, or before the history existed) shows as a virtual row on top.
export function saleHistory(fabric, rows) {
  const price = num(fabric && fabric.price);
  const date = d10(fabric && fabric.sale_date);
  const list = sortSaleRows(rows).filter((r) => num(r.rate) !== null).map((r) => ({ id: r.id, rate: num(r.rate), date: d10(r.effective_date), inUse: false, virtual: false, saved: '', row: r }));
  // rows sharing a date are told apart by the time they were saved
  const seen = {};
  for (const h of list) seen[h.date] = (seen[h.date] || 0) + 1;
  for (const h of list) if (seen[h.date] > 1) h.saved = savedTime(h.row.updated_at);
  if (price === null) return list;
  const hit = list.find((h) => h.rate === price && h.date === date);
  if (hit) {
    hit.inUse = true;
    return list;
  }
  return [{ id: `current_${fabric.id}`, rate: price, date, inUse: true, virtual: true, saved: '', row: null }, ...list];
}

// History ops for a fabric save. old = the stored fabric before the save (undefined for a new fabric).
// Every price change adds its own row, also on the same date and also when that price and date are already in
// the history, so a row is never overwritten and the newest row is the rate in use. Nothing here depends on this
// device holding the full history (a save made before a load has finished must not lose or change a row).
export function saleSaveOps(old, f, rows) {
  const p = num(f.price);
  if (p === null) return [];
  const date = d10(f.sale_date);
  const oldP = old ? num(old.price) : null;
  const oldD = old ? d10(old.sale_date) : '';
  if (old && p === oldP && date === oldD) return [];
  const hist = sortSaleRows(rows);
  const up = (row) => [{ op: 'upsert', table: 'SaleRates', rows: [row] }];
  if (old && p === oldP) {
    // only the sale date moved: move the row of the rate in use with it (the newest one at that price and date)
    const inUse = hist.find((r) => num(r.rate) === oldP && d10(r.effective_date) === oldD);
    if (inUse) return up({ id: inUse.id, fabric_id: f.id, rate: p, effective_date: date });
    // no such row on this device: add one, unless the price is already there on the new date
    if (hist.some((r) => num(r.rate) === p && d10(r.effective_date) === date)) return [];
  }
  return up({ id: newId('sr'), fabric_id: f.id, rate: p, effective_date: date });
}

// A past sale rate looked at on its own date: realisation at that rate with the yarn rates that applied then,
// next to the rate in use at today's yarn rates. h = a saleHistory entry. Master figures only (temporary rates
// on this device are left out). Everything else (construction, shortage, VATAV %, finishing, TPM deltas, unit
// cost per pick) is as it stands today: only sale rates and yarn rates carry dates.
// Returns { then, now, yarns: [{ yarn, tpm, thenRate, thenDate, nowRate, nowDate, changed, early, none }], changed, dated }.
// early: the yarn has no rate on or before the date, so its earliest rate is used. none: the yarn has no rate at all.
export function pastRateView(fabric, h, idx) {
  const clean = { ...idx, tempRates: {}, tempDeltas: {}, tempPrices: {}, tempRpms: {} };
  const now = fabricCalc(fabric, clean);
  const date = d10(h.date);
  const picks = {};
  const yarns = rateSources(now, clean).map((s) => {
    const all = (clean.ratesByYarn[s.yarn.id] || []).filter((r) => num(r.rate) !== null);
    const cur = all[0] || null;
    let was = date ? all.find((r) => d10(r.effective_date) <= date) || null : cur;
    let early = false;
    if (!was && all.length) {
      was = all[all.length - 1];
      early = true;
      picks[s.yarn.id] = d10(was.effective_date);
    }
    const thenRate = was ? num(was.rate) : null;
    const nowRate = cur ? num(cur.rate) : null;
    return {
      yarn: s.yarn, tpm: s.tpm.map((t) => t.yarn), thenRate, thenDate: was ? d10(was.effective_date) : '', nowRate, nowDate: cur ? d10(cur.effective_date) : '',
      changed: thenRate !== null && nowRate !== null && thenRate !== nowRate, early, none: !all.length,
    };
  });
  const then = fabricCalc({ ...fabric, price: h.rate, sale_date: date }, clean, date || null, picks);
  return { then, now, yarns, changed: yarns.filter((y) => y.changed).length, dated: !!date };
}

// What deleting some history rows does: { ops, next } where next is the rate that takes over
// ({ rate, date } or null for no price) when the rate in use goes; undefined when the price stays.
export function saleDeletePlan(fabric, rows, ids) {
  const gone = new Set(ids);
  const hist = saleHistory(fabric, rows);
  const real = hist.filter((h) => !h.virtual && gone.has(h.id));
  if (!real.length) return { ops: [], next: undefined };
  const ops = [{ op: 'delete', table: 'SaleRates', ids: real.map((h) => h.id) }];
  const inUse = hist.find((h) => h.inUse);
  if (!inUse || inUse.virtual || !gone.has(inUse.id)) return { ops, next: undefined };
  const left = hist.filter((h) => !h.virtual && !gone.has(h.id));
  const next = left.length ? { rate: left[0].rate, date: left[0].date } : null;
  ops.push({ op: 'upsert', table: 'Fabrics', rows: [{ id: fabric.id, price: next ? next.rate : '', sale_date: next ? next.date : '' }] });
  return { ops, next };
}
