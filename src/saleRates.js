// Sale rate history per fabric (SaleRates tab, backend v15).
// Fabrics.price and Fabrics.sale_date stay the rate in use; history rows record every price the fabric has had.
// Like yarn rates: deleting the rate in use brings back the next older rate (price and sale date).
import { num } from './calc.js';
import { newId } from './schema.js';

const d10 = (v) => String(v || '').slice(0, 10);

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
  const list = sortSaleRows(rows).filter((r) => num(r.rate) !== null).map((r) => ({ id: r.id, rate: num(r.rate), date: d10(r.effective_date), inUse: false, virtual: false, row: r }));
  if (price === null) return list;
  const hit = list.find((h) => h.rate === price && h.date === date);
  if (hit) {
    hit.inUse = true;
    return list;
  }
  return [{ id: `current_${fabric.id}`, rate: price, date, inUse: true, virtual: true, row: null }, ...list];
}

// History ops for a fabric save. old = the stored fabric before the save (undefined for a new fabric).
export function saleSaveOps(old, f, rows) {
  const p = num(f.price);
  if (p === null) return [];
  const date = d10(f.sale_date);
  const oldP = old ? num(old.price) : null;
  const oldD = old ? d10(old.sale_date) : '';
  if (old && p === oldP && date === oldD) return [];
  const hist = rows || [];
  const up = (row) => [{ op: 'upsert', table: 'SaleRates', rows: [row] }];
  // the history row of the rate in use before this save
  const inUse = old ? hist.find((r) => num(r.rate) === oldP && d10(r.effective_date) === oldD) : null;
  // only the sale date moved: move that row with it (other rows are never overwritten)
  if (old && p === oldP && inUse) return up({ id: inUse.id, fabric_id: f.id, rate: p, effective_date: date });
  // a new price on the same date as the rate in use (a same-day correction): change that row
  if (inUse && date === oldD) return up({ id: inUse.id, fabric_id: f.id, rate: p, effective_date: date });
  // already in the history exactly: nothing to add
  if (hist.some((r) => num(r.rate) === p && d10(r.effective_date) === date)) return [];
  return up({ id: newId('sr'), fabric_id: f.id, rate: p, effective_date: date });
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
