import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { baseFabric, buildIndex, fabricCalc, fabricLabel, fmt, loomPerDay, loomRealisation, loomRealisationForUnit, num, productionForUnit, rateSources, spindleProfit, spindlesForUnit, tfoPerSide, truthy, unitHasTfo, unitProfit, yarnConsumption, TFO_CLASSES } from '../calc.js';
import { beamRowsOf, beamSlots, groupLabel, slotLabelIn } from '../machines.js';
import { constructionLine, unitsOf, yarnOptions, yarnShort } from '../describe.js';
import {
  addPhoto, backendMode, deleteFabric, deletePhoto, duplicateFabric, duplicateForRs, getIndex, rsCopyPlan, getState, refresh, retry, saveFabric, savedFilters, setAssignments, setCover, clearTempDelta, clearTempPrice, clearTempRate, clearTempRpm, toast, useStore,
} from '../store.js';
import { back, go, replace, useLeaveGuard } from '../router.js';
import { askConfirm } from '../confirm.js';
import { loadListState, saveListState, savedScroll, saveScroll } from '../listState.js';
import { Badge, Button, Chip, Empty, Field, FoldSection, Icon, IconButton, NavBar, NumField, PhotoImg, Row, SearchBox, SearchPicker, Section, Segmented, Sheet, Swatch, TextButton, Toggle, classBadge, openSection, useWide, BrandHero, History } from '../ui.jsx';
import { GuideHint, HelpButton } from './guide.jsx';
import { FABRIC_SECTIONS } from '../search.js';
import { TempPriceSection, TempRateRow, TempRpmSection, TempTpmRow } from './tempRates.jsx';
import { NO_MONEY, exportFabricPdf, exportFabricXlsx, exportListXlsx, openWhatsAppText, preloadExports, whatsappText } from '../export/exports.js';
import { DETAILED_ALL, exportFabricPdfDetailed, exportFabricXlsxDetailed } from '../export/detailed.js';

const WEAVES = ['Plain', 'Cam', 'Dobby'];
const SPINDLE_SORT = { value: 'spindle', label: 'Spindle profit ↓' };
const SORTS = [
  { value: 'realisation', label: 'Realisation ↓' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'gsm', label: 'GSM ↑' },
  { value: 'recent', label: 'Recent' },
];

// Loom widths (cm) of a unit's loom groups, narrowest first.
export const loomWidths = (unit, idx) => (unit ? [...new Set((idx.loomGroupsByUnit[unit.id] || []).map((g) => num(g.reed_width_cm)).filter(Boolean))].sort((a, b) => a - b) : []);
// Sort choices: spindle profit and loom realisation (one per loom width) need a unit.
export const sortOptions = (unit, idx) => (unit ? [...SORTS, SPINDLE_SORT, ...loomWidths(unit, idx).map((w) => ({ value: `loom:${w}`, label: `Loom realisation ${fmt.int(w)} cm ↓` }))] : SORTS);
const loomSortWidth = (sort) => (String(sort).startsWith('loom:') ? Number(String(sort).slice(5)) : null);
const loomOf = (row, width) => (row.loomReal || []).find((x) => x.width === width) || null;

export const defaultFilters = () => ({ sort: 'realisation', weaves: [], classes: [], finish: '', loomType: '', yarnId: '', endUse: '', tpmMin: '', tpmMax: '', gsmMin: '', gsmMax: '', rMin: '', rMax: '' });

export function activeFilterCount(f) {
  let n = 0;
  if (f.weaves.length) n++;
  if (f.classes.length) n++;
  for (const k of ['finish', 'loomType', 'yarnId', 'endUse']) if (f[k]) n++;
  for (const [a, b] of [['tpmMin', 'tpmMax'], ['gsmMin', 'gsmMax'], ['rMin', 'rMax']]) if (f[a] !== '' || f[b] !== '') n++;
  return n;
}

const inRange = (v, min, max) => {
  const lo = num(min), hi = num(max);
  if (lo === null && hi === null) return true;
  if (v === null || v === undefined) return false;
  return (lo === null || v >= lo) && (hi === null || v <= hi);
};

export function computeRows(idx, { search = '', unitId = 'all', filters = defaultFilters() } = {}) {
  const q = search.trim().toLowerCase();
  const unit = unitId !== 'all' ? idx.unitsById[unitId] : null;
  const rows = [];
  for (const f of Object.values(idx.fabricsById)) {
    const units = unitsOf(f.id, idx);
    if (unit && !units.some((u) => u.id === unit.id)) continue;
    const calc = fabricCalc(f, idx);
    if (q) {
      const hay = [f.name, f.end_use, f.design_note, ...calc.warp.map((x) => x.yarn && x.yarn.name), ...calc.weft.map((x) => x.yarn && x.yarn.name)].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) continue;
    }
    if (filters.weaves.length && !filters.weaves.includes(f.weave)) continue;
    if (filters.classes.length && !filters.classes.includes(calc.tfoClass)) continue;
    if (filters.finish && calc.finish !== filters.finish) continue;
    if (filters.loomType && !units.some((u) => u.type === filters.loomType)) continue;
    if (filters.yarnId && ![...calc.warp, ...calc.weft].some((x) => x.yarn && (x.yarn.id === filters.yarnId || x.yarn.base_yarn_id === filters.yarnId))) continue;
    if (filters.endUse && !String(f.end_use || '').toLowerCase().includes(filters.endUse.toLowerCase())) continue;
    if ((filters.tpmMin !== '' || filters.tpmMax !== '') && !(inRange(calc.tpmMin, filters.tpmMin, filters.tpmMax) || inRange(calc.tpmMax, filters.tpmMin, filters.tpmMax))) continue;
    if (!inRange(calc.gsm, filters.gsmMin, filters.gsmMax)) continue;
    if (!inRange(calc.realisationNetPerPick, filters.rMin, filters.rMax)) continue;
    // Spindle profitability needs a unit; sorting by it lists that unit's TPM fabrics only.
    const spin = unit ? spindleProfit(calc, f, unit, idx) : null;
    if (filters.sort === 'spindle' && !spin) continue;
    // Loom realisation per loom width at the unit; sorting by a width lists the fabrics that fit that width.
    const loomReal = unit ? loomRealisationForUnit(calc, f, unit, idx) : [];
    const lw = loomSortWidth(filters.sort);
    if (lw !== null && unit) {
      const e = loomReal.find((x) => x.width === lw);
      if (!e || !e.panna) continue;
    }
    rows.push({ fabric: f, calc, units, spin, loomReal, profit: unit ? unitProfit(calc, unit) : null });
  }
  const byNull = (v) => (v === null || v === undefined ? -Infinity : v);
  const sorters = {
    realisation: (a, b) => byNull(b.calc.realisationNetPerPick) - byNull(a.calc.realisationNetPerPick),
    spindle: (a, b) => byNull(b.spin && b.spin.value) - byNull(a.spin && a.spin.value),
    name: (a, b) => String(a.fabric.name).localeCompare(String(b.fabric.name)),
    gsm: (a, b) => (a.calc.gsm ?? Infinity) - (b.calc.gsm ?? Infinity),
    recent: (a, b) => String(b.fabric.updated_at || '').localeCompare(String(a.fabric.updated_at || '')),
  };
  const lw = loomSortWidth(filters.sort);
  const loomVal = (r) => { const e = loomOf(r, lw); return e && e.value !== null ? e.value : null; };
  const byLoom = (a, b) => { const x = loomVal(a), y = loomVal(b); return x === null ? (y === null ? 0 : 1) : y === null ? -1 : y - x; };
  rows.sort(lw !== null ? byLoom : sorters[filters.sort] || sorters.realisation);
  return rows;
}

function coverOf(fabricId, idx) {
  const photos = idx.photosByFabric[fabricId] || [];
  return photos.find((p) => truthy(p.is_cover)) || photos[0] || null;
}

function FabricBadges({ fabric, calc }) {
  return (
    <div class="badges">
      {classBadge(calc.tfoClass)}
      {calc.finish === 'RFD' ? <Badge kind="teal">RFD</Badge> : <Badge kind="outline">Greige</Badge>}
      {fabric.weave ? <Badge>{fabric.weave}</Badge> : null}
      {calc.priceTemp ? <Badge kind="amber">Temp sale rate</Badge> : null}
    </div>
  );
}

export function FabricRow({ row, idx, unit, onClick, sort }) {
  const cover = coverOf(row.fabric.id, idx);
  return (
    <button type="button" class="frow" onClick={onClick}>
      <div class="thumb">{cover ? <PhotoImg photo={cover} size="thumb" /> : <Swatch seed={row.fabric.id} />}</div>
      <div class="row-main">
        <div class="fname">{row.fabric.name || 'Untitled'}</div>
        <div class="fcon">{constructionLine(row.fabric, row.calc, idx)}</div>
        <FabricBadges fabric={row.fabric} calc={row.calc} />
      </div>
      {loomSortWidth(sort) !== null && unit ? (
      <div class="fval">
        <div class="big">{fmt.rs(loomOf(row, loomSortWidth(sort)) ? loomOf(row, loomSortWidth(sort)).value : null, 0)}</div>
        <div class="small">per loom per day · {fmt.int(loomSortWidth(sort))} cm</div>
      </div>
      ) : sort === 'spindle' && unit ? (
      <div class="fval">
        <div class={`big ${row.spin && row.spin.value !== null ? (row.spin.value >= 0 ? 'good' : 'bad') : ''}`}>{fmt.spin(row.spin && row.spin.value)}</div>
        <div class="small">{row.spin && row.spin.spindles ? `profit/pick · ${fmt.int(row.spin.spindles)} spindles` : 'profit per pick per spindle'}</div>
      </div>
      ) : (
      <div class="fval">
        <div class="big">{fmt.pick(row.calc.realisationNetPerPick)}</div>
        {unit && row.profit ? (
          <div class={`small ${row.profit.profitPerPick === null ? '' : row.profit.profitPerPick >= 0 ? 'good' : 'bad'}`}>{fmt.signedPick(row.profit.profitPerPick)} profit</div>
        ) : row.calc.vatavPct ? (
          <div class="small">{fmt.pick(row.calc.realisationPerPick)} without</div>
        ) : (
          <div class="small">no VATAV</div>
        )}
      </div>
      )}
    </button>
  );
}

// Laptop table: one row per fabric, click a column heading to sort by it.
const TABLE_COLS = [
  { key: 'name', label: 'Quality', get: (r) => String(r.fabric.name || ''), text: true },
  { key: 'rs', label: 'RS', get: (r) => r.calc.rs, show: (r) => (r.calc.rs ? `${fmt.n(r.calc.rs, r.calc.rs % 1 ? 1 : 0)}″` : '—') },
  { key: 'ppi', label: 'Pick', get: (r) => r.calc.ppi, show: (r) => r.calc.ppi ?? '—' },
  { key: 'ends', label: 'Ends', opt: true, get: (r) => r.calc.totalEnds, show: (r) => (r.calc.totalEnds === null ? '—' : fmt.int(r.calc.totalEnds)) },
  { key: 'gsm', label: 'GSM', opt: true, get: (r) => r.calc.gsm, show: (r) => fmt.n(r.calc.gsm, 1) },
  { key: 'cost', label: 'Cost ₹/m', title: 'RM cost, or RFD cost for RFD fabrics', get: (r) => (r.calc.finish === 'RFD' ? r.calc.rfdCost : r.calc.rmCost), show: (r) => fmt.n(r.calc.finish === 'RFD' ? r.calc.rfdCost : r.calc.rmCost, 2) },
  { key: 'price', label: 'Price ₹/m', get: (r) => r.calc.price, show: (r) => (r.calc.priceTemp ? <span>{fmt.n(r.calc.price, 2)}<span class="badge amber tag-temp">Temp</span></span> : fmt.n(r.calc.price, 2)) },
  { key: 'vatav', label: 'VATAV', get: (r) => r.calc.vatavPct, show: (r) => (r.calc.vatavPct ? `${fmt.n(r.calc.vatavPct, r.calc.vatavPct % 1 ? 1 : 0)}%` : '—') },
  { key: 'rw', label: '₹/pick without', title: 'Realisation per pick without VATAV', get: (r) => r.calc.realisationPerPick, show: (r) => fmt.pick(r.calc.realisationPerPick) },
  { key: 'rn', label: '₹/pick with VATAV', title: 'Realisation per pick with VATAV', get: (r) => r.calc.realisationNetPerPick, show: (r) => fmt.pick(r.calc.realisationNetPerPick), strong: true },
];
const SPINDLE_COL = { key: 'sr', label: 'Profit/spindle', title: 'Spindle profitability: profit per pick at this unit ÷ spindles per loom per day (single panna, old TFO machines). TPM fabrics only; sorting by it hides the rest.', tpmOnly: true, profit: true, get: (r) => (r.spin ? r.spin.value : null), show: (r) => (r.spin ? fmt.spin(r.spin.value) : '—') };
const PROFIT_COL = { key: 'profit', label: 'Profit ₹/pick', get: (r) => (r.profit ? r.profit.profitPerPick : null), show: (r) => fmt.signedPick(r.profit ? r.profit.profitPerPick : null), profit: true };

const loomCol = (w) => ({ key: `lr:${w}`, label: `Loom ₹/day ${fmt.int(w)} cm`, title: `Loom realisation: ₹ per pick with VATAV × metres per loom per day × PPI, on ${fmt.int(w)} cm looms at this unit.`, get: (r) => { const e = loomOf(r, w); return e ? e.value : null; }, show: (r) => { const e = loomOf(r, w); return e && e.value !== null ? fmt.rs(e.value, 0) : '—'; } });

export function FabricTable({ rows, idx, unit }) {
  const [sort, setSort] = useState(null);
  const cols = unit ? [...TABLE_COLS, PROFIT_COL, SPINDLE_COL, ...loomWidths(unit, idx).map(loomCol)] : TABLE_COLS;
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = cols.find((c) => c.key === sort.key);
    if (!col) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return (col.tpmOnly ? rows.filter((r) => r.spin) : rows.slice()).sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      if (col.text) return dir * String(x).localeCompare(String(y));
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return dir * (x - y);
    });
  }, [rows, sort, unit]);
  // first click: A–Z for text, highest first for numbers; second click flips; third goes back to the list order
  const clickHead = (c) => setSort((s) => {
    const first = c.text ? 'asc' : 'desc';
    if (!s || s.key !== c.key) return { key: c.key, dir: first };
    return s.dir === first ? { key: c.key, dir: first === 'asc' ? 'desc' : 'asc' } : null;
  });
  return (
    <div class="table-wrap">
      <table class="ftable">
        <thead>
          <tr>
            {cols.map((c) => (
              <th class={`${c.text ? 'txt' : ''} ${c.opt ? 'opt' : ''} ${c.strong ? 'key' : ''}`} title={c.title} aria-sort={sort && sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => clickHead(c)}>
                  {c.label}
                  <span class="sort-mark" aria-hidden="true">{sort && sort.key === c.key ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const cover = coverOf(r.fabric.id, idx);
            const open = () => go(`/fabric/${r.fabric.id}`);
            return (
              <tr class="click" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); }}>
                {cols.map((c) =>
                  c.key === 'name' ? (
                    <td class="txt">
                      <div class="tq">
                        <div class="tthumb">{cover ? <PhotoImg photo={cover} size="thumb" /> : <Swatch seed={r.fabric.id} size={36} radius={6} />}</div>
                        <div class="min0">
                          <div class="tname">{r.fabric.name || 'Untitled'}</div>
                          <div class="tmeta">{[r.fabric.weave, r.calc.tfoClass, r.calc.finish].filter(Boolean).join(' · ')}</div>
                        </div>
                      </div>
                    </td>
                  ) : (
                    <td class={`${c.opt ? 'opt' : ''} ${c.strong ? 'key' : ''} ${c.profit && c.get(r) !== null && c.get(r) !== undefined ? (c.get(r) >= 0 ? 'good strong' : 'bad strong') : ''}`}>{c.show(r)}</td>
                  ),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- list ----------------
export function FabricList({ query }) {
  const st = useStore();
  const idx = getIndex();
  const wide = useWide();
  const saved = loadListState(defaultFilters());
  const [search, setSearch] = useState(saved.search);
  const [unitId, setUnitId] = useState(query.unit || saved.unitId);
  const [filters, setFilters] = useState(saved.filters);
  useEffect(() => { saveListState({ search, unitId, filters }); }, [search, unitId, filters]);
  // Back from a fabric: return to the same place in the list.
  useEffect(() => {
    const y = savedScroll();
    if (y) requestAnimationFrame(() => window.scrollTo(0, y));
    return () => saveScroll(window.scrollY);
  }, []);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (query.unit) setUnitId(query.unit);
  }, [query.unit]);
  const units = (st.tables.Units || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const unit = unitId !== 'all' ? idx.unitsById[unitId] || null : null;
  // A saved unit or yarn that was deleted since: fall back instead of showing an empty list.
  useEffect(() => {
    if (st.status.loading || !Object.keys(idx.fabricsById).length) return;
    if (unitId !== 'all' && !idx.unitsById[unitId]) setUnitId('all');
    if (filters.yarnId && !(st.tables.Yarns || []).some((y) => y.id === filters.yarnId)) setFilters((f) => ({ ...f, yarnId: '' }));
  }, [st.tables, st.status.loading]);
  const rows = useMemo(() => computeRows(idx, { search, unitId, filters }), [idx, search, unitId, filters]);
  // Spindle profit and loom realisation sort one unit at a time: back to realisation when All units is picked
  // (or when the unit has no loom of that width).
  useEffect(() => {
    const ok = unitId === 'all' ? SORTS.some((o) => o.value === filters.sort) : !unit || sortOptions(unit, idx).some((o) => o.value === filters.sort);
    if (!ok) setFilters((f) => ({ ...f, sort: 'realisation' }));
  }, [unit, unitId, filters.sort, idx]);
  const nActive = activeFilterCount(filters);
  const unitOptions = [{ value: 'all', label: 'All units' }, ...units.map((u) => ({ value: u.id, label: u.name }))];

  async function exportList() {
    setBusy(true);
    try {
      await exportListXlsx(rows, idx, unit);
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  }

  return (
    <div>
      <NavBar
        large
        title={wide ? 'Fabrics' : 'Fabric Database'}
        hero={wide ? null : <BrandHero />}
        left={wide ? <HelpButton screen="fabrics" /> : <><IconButton label="Settings" onClick={() => go('/settings')}><Icon.gear /></IconButton><HelpButton screen="fabrics" /></>}
        right={
          <>
            <IconButton label="Export list to Excel" onClick={exportList} disabled={busy || !rows.length}><Icon.share /></IconButton>
            <IconButton label="Add fabric" onClick={() => go('/fabric/new')}><Icon.plus size={26} /></IconButton>
          </>
        }
      />
      <StatusBanner />
      <GuideHint />
      <div class="stack flush top">
        <SearchBox value={search} onInput={setSearch} placeholder="Search quality or yarn" />
        <div class="pad">
          {unitOptions.length <= 4 ? (
            <Segmented small label="Unit" options={unitOptions} value={unitId} onChange={setUnitId} />
          ) : (
            <div class="chips flat">
              {unitOptions.map((o) => <Chip on={unitId === o.value} onClick={() => setUnitId(o.value)}>{o.label}</Chip>)}
            </div>
          )}
        </div>
        <div class="chips">
          <Chip on onClick={() => setSheet(true)}>{(sortOptions(unit, idx).find((s) => s.value === filters.sort) || SORTS[0]).label}</Chip>
          <Chip on={nActive > 0} onClick={() => setSheet(true)}>{nActive ? `Filters · ${nActive}` : 'Filters'}</Chip>
          {WEAVES.map((w) => (
            <Chip on={filters.weaves.includes(w)} onClick={() => setFilters({ ...filters, weaves: toggleIn(filters.weaves, w) })}>{w}</Chip>
          ))}
          <Chip on={filters.finish === 'RFD'} onClick={() => setFilters({ ...filters, finish: filters.finish === 'RFD' ? '' : 'RFD' })}>RFD</Chip>
          <Chip on={filters.classes.includes('TPM × TPM')} onClick={() => setFilters({ ...filters, classes: toggleIn(filters.classes, 'TPM × TPM') })}>TPM × TPM</Chip>
        </div>
      </div>
      {st.status.error && !Object.keys(idx.fabricsById).length ? null : <div class="list-meta">
        <span>{rows.length} {rows.length === 1 ? 'fabric' : 'fabrics'} · {unit ? unit.name : 'all units'}</span>
        <span class={wide ? 'plain' : ''}>{wide ? 'Click a heading to sort. Press / or Ctrl K to search, 1–5 for tabs, Ctrl+S to save a form.' : filters.sort === 'spindle' ? 'Profit / pick per spindle · TPM fabrics' : loomSortWidth(filters.sort) !== null ? `₹ per loom per day · ${fmt.int(loomSortWidth(filters.sort))} cm looms` : '₹ / pick with VATAV'}</span>
      </div>}
      {rows.length ? (
        wide ? (
          <FabricTable rows={rows} idx={idx} unit={unit} />
        ) : (
          <div class="group">
            {rows.map((r) => <FabricRow row={r} idx={idx} unit={unit} sort={filters.sort} onClick={() => go(`/fabric/${r.fabric.id}`)} />)}
          </div>
        )
      ) : st.status.loading ? (
        <Empty title="Loading…" />
      ) : st.status.error && !Object.keys(idx.fabricsById).length ? (
        <Empty title="No copy on this device yet" text="Open the app once with a signal. It then keeps a copy on this device for times with no connection." />
      ) : (
        <Empty
          title={Object.keys(idx.fabricsById).length ? 'No fabrics match' : 'No fabrics yet'}
          text={Object.keys(idx.fabricsById).length ? 'Change the search, unit or filters.' : 'Add your first fabric. Add yarns first so you can pick them for warp and weft.'}
          action={Object.keys(idx.fabricsById).length ? null : <div class="btn-narrow"><Button onClick={() => go('/fabric/new')}>Add fabric</Button></div>}
        />
      )}
      <FilterSheet open={sheet} onClose={() => setSheet(false)} filters={filters} setFilters={setFilters} idx={idx} count={rows.length} unit={unit} />
    </div>
  );
}

// "20 Nov, 4:50 pm"
const shortWhen = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

export function StatusBanner() {
  const st = useStore();
  if (st.status.error) {
    const hasCopy = !!st.status.lastSync && Object.keys(getIndex().fabricsById).length > 0;
    return (
      <div class="banner error">
        <span>{st.status.error}{hasCopy ? ` Showing the copy saved on this device, last checked with the Sheet ${shortWhen(st.status.lastSync)}.` : ''}</span>
        <button type="button" onClick={() => retry()} disabled={st.retrying} aria-busy={st.retrying ? 'true' : undefined}>
          {st.retrying ? <><span class="spinner" aria-hidden="true" /> Trying…</> : 'Retry'}
        </button>
      </div>
    );
  }
  if (backendMode() === 'demo') {
    return (
      <div class="banner">
        <span>Demo data on this device. Connect your Google Sheet in Settings.</span>
        <button type="button" onClick={() => go('/settings')}>Settings</button>
      </div>
    );
  }
  return null;
}

const toggleIn = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

function FilterSheet({ open, onClose, filters, setFilters, idx, count, unit }) {
  const [saved, setSaved] = useState(savedFilters.list());
  const f = filters;
  const up = (patch) => setFilters({ ...f, ...patch });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Sort and filter"
      footer={
        <div class="btn-pair">
          <Button kind="secondary" onClick={() => setFilters(defaultFilters())}>Reset</Button>
          <Button onClick={onClose}>Show {count}</Button>
        </div>
      }
    >
      {saved.length ? (
        <Section header="Saved filters">
          {saved.map((s) => (
            <div class="row">
              <button type="button" class="row-main row-btn" onClick={() => { setFilters({ ...defaultFilters(), ...s.filters }); toast(`Applied “${s.name}”`); }}>
                <div class="row-label">{s.name}</div>
              </button>
              <TextButton danger onClick={() => { savedFilters.remove(s.name); setSaved(savedFilters.list()); }}>Remove</TextButton>
            </div>
          ))}
        </Section>
      ) : null}
      <Section header="Sort by">
        <label class="row field">
          <span class="row-label">Order</span>
          <span class="field-input select">
            <select value={f.sort} onChange={(e) => up({ sort: e.currentTarget.value })} aria-label="Sort by">
              {sortOptions(unit, idx).map((o) => <option value={o.value}>{o.label}</option>)}
            </select>
          </span>
        </label>
      </Section>
      <Section header="Weave">
        <div class="chips boxed">{WEAVES.map((w) => <Chip on={f.weaves.includes(w)} onClick={() => up({ weaves: toggleIn(f.weaves, w) })}>{w}</Chip>)}</div>
      </Section>
      <Section header="TFO class">
        <div class="chips boxed">{TFO_CLASSES.map((c) => <Chip on={f.classes.includes(c)} onClick={() => up({ classes: toggleIn(f.classes, c) })}>{c}</Chip>)}</div>
      </Section>
      <Section header="Finish and loom type">
        <div class="chips boxed">
          {['Greige', 'RFD'].map((x) => <Chip on={f.finish === x} onClick={() => up({ finish: f.finish === x ? '' : x })}>{x}</Chip>)}
          {['Airjet', 'Waterjet'].map((x) => <Chip on={f.loomType === x} onClick={() => up({ loomType: f.loomType === x ? '' : x })}>{x}</Chip>)}
        </div>
      </Section>
      <Section header="Yarn and end use">
        <label class="row field">
          <span class="row-label">Yarn used</span>
          <span class="field-input select">
            <select value={f.yarnId} onChange={(e) => up({ yarnId: e.currentTarget.value })} aria-label="Yarn used">
              <option value="">Any</option>
              {yarnOptions(idx).map((g) => <optgroup label={g.group}>{g.options.map((o) => <option value={o.value}>{o.label}</option>)}</optgroup>)}
            </select>
            <Icon.chevron size={12} />
          </span>
        </label>
        <Field label="End use" value={f.endUse} onInput={(v) => up({ endUse: v })} placeholder="e.g. kurti" />
      </Section>
      <Section header="Ranges">
        <RangeRow label="TPM" min={f.tpmMin} max={f.tpmMax} onChange={(a, b) => up({ tpmMin: a, tpmMax: b })} />
        <RangeRow label="GSM" min={f.gsmMin} max={f.gsmMax} onChange={(a, b) => up({ gsmMin: a, gsmMax: b })} />
        <RangeRow label="₹ / pick" min={f.rMin} max={f.rMax} onChange={(a, b) => up({ rMin: a, rMax: b })} />
      </Section>
      <div class="actions">
        <Button kind="secondary" onClick={() => {
          const name = window.prompt('Name this filter');
          if (name && name.trim()) {
            savedFilters.save(name.trim(), f);
            setSaved(savedFilters.list());
            toast('Filter saved');
          }
        }}>Save these filters</Button>
      </div>
    </Sheet>
  );
}

function RangeRow({ label, min, max, onChange }) {
  return (
    <div class="row">
      <div class="row-main"><div class="row-label">{label}</div></div>
      <div class="range-pair">
        <label class="mini"><span>Min</span><input inputmode="decimal" value={min} onInput={(e) => onChange(e.currentTarget.value, max)} aria-label={`${label} minimum`} /></label>
        <label class="mini"><span>Max</span><input inputmode="decimal" value={max} onInput={(e) => onChange(min, e.currentTarget.value)} aria-label={`${label} maximum`} /></label>
      </div>
    </div>
  );
}

// ---------------- detail ----------------
// Jump buttons that stay under the fabric page's title (B1 a). The button for the part on screen is lit: on a phone
// the last section whose top has passed the top bar; on a laptop (two columns, 1.27.0) the first section, in page
// order, that shows in the top part of the window (as the CFM dashboard does).
const JUMPS = FABRIC_SECTIONS.slice(0, 6);
const headerHeight = () => {
  const h = typeof document !== 'undefined' ? document.querySelector('.navbar') : null;
  return h ? h.offsetHeight : 0;
};
function JumpBar({ hasUnits }) {
  const wide = useWide();
  const items = JUMPS.filter(([id]) => hasUnits || id !== 'sec-production');
  const [on, setOn] = useState(items[0][0]);
  // after a tap, the tapped button stays lit while the page scrolls to it
  const jumpedAt = useRef(0);
  useEffect(() => {
    if (wide) {
      if (typeof IntersectionObserver === 'undefined') return undefined;
      const vis = new Set();
      const io = new IntersectionObserver((es) => {
        for (const e of es) (e.isIntersecting ? vis.add(e.target.id) : vis.delete(e.target.id));
        // at the very top the summary is the part on screen
        if (Date.now() - jumpedAt.current < 1200) return undefined;
        if (window.scrollY < 8) return setOn(items[0][0]);
        const cur = items.find(([id]) => vis.has(id));
        if (cur) setOn(cur[0]);
      }, { rootMargin: `-${headerHeight() + 8}px 0px -55% 0px` });
      for (const [id] of items) {
        const el = document.getElementById(id);
        if (el) io.observe(el);
      }
      return () => io.disconnect();
    }
    const f = () => {
      const h = headerHeight();
      let cur = items[0][0];
      for (const [id] of items) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top - h - 16 <= 0) cur = id;
      }
      setOn(cur);
    };
    f();
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, [hasUnits, wide]);
  const jump = (id) => {
    openSection(id);
    jumpedAt.current = Date.now();
    setOn(id);
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const top = id === items[0][0] ? 0 : el.getBoundingClientRect().top + window.scrollY - headerHeight() - 6;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    });
  };
  return (
    <nav class="jumpbar" aria-label="Jump to">
      {items.map(([id, label]) => <Chip on={on === id} onClick={() => jump(id)}>{label}</Chip>)}
    </nav>
  );
}

export function FabricDetail({ id }) {
  useStore();
  const idx = getIndex();
  const fabric = idx.fabricsById[id];
  const fileRef = useRef(null);
  const [viewer, setViewer] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [slide, setSlide] = useState(0);
  // Older yarn rates picked on this page: { baseYarnId: 'yyyy-mm-dd' }. View only, never saved.
  const [picks, setPicks] = useState({});
  useEffect(() => setPicks({}), [id]);
  if (!fabric) {
    return (
      <div>
        <NavBar title="Fabric" backLabel="Fabrics" backTo="/fabrics" />
        <Empty title="Fabric not found" text="It may have been deleted." />
      </div>
    );
  }
  // calcNow: today's rates (exports). calc: what the page shows, at any older rates picked below.
  const calcNow = fabricCalc(fabric, idx);
  const sources = rateSources(calcNow, idx);
  const livePicks = Object.fromEntries(Object.entries(picks).filter(([k, v]) => v && sources.some((s) => s.yarn.id === k && s.temp === null && s.dates.length && s.dates[0].date !== v)));
  // temporary rates that set this fabric's cost: base yarns' rates and TPM yarns' deltas
  const tempSources = [
    ...sources.filter((x) => x.temp !== null).map((x) => ({ yarn: x.yarn, text: `${x.yarn.name} ${fmt.rate(x.temp)}/kg`, clear: () => clearTempRate(x.yarn.id) })),
    ...sources.flatMap((x) => x.tpm.filter((t) => t.tempDelta !== null)).map((t) => ({ yarn: t.yarn, text: `${t.yarn.name} delta ${fmt.rate(t.tempDelta)}/kg`, clear: () => clearTempDelta(t.yarn.id) })),
  ];
  const older = Object.keys(livePicks).length > 0;
  const calc = older ? fabricCalc(fabric, idx, null, livePicks) : calcNow;
  // Same page without this fabric's temporary sale rate, to show what it changes.
  const calcMaster = calc.priceTemp ? fabricCalc(fabric, { ...idx, tempPrices: {} }, null, older ? livePicks : undefined) : calc;
  // Same page without this fabric's temporary loom RPM.
  const calcRpmMaster = calc.rpmTemp ? fabricCalc(fabric, { ...idx, tempRpms: {} }, null, older ? livePicks : undefined) : calc;
  const photos = idx.photosByFabric[id] || [];
  const units = unitsOf(id, idx);
  const spinUnit = units.find((u) => unitHasTfo(calc, u, idx)) || units[0] || null;
  const spin = spinUnit ? spindleProfit(calc, fabric, spinUnit, idx) : null;
  const rfd = calc.finish === 'RFD';
  // Daily consumption unit: an assigned unit with loom groups and loom efficiency; failing that, the first
  // unit that has them (the tile says the fabric is not assigned to it).
  const hasLooms = (u) => num(u.loom_eff_pct) && (idx.loomGroupsByUnit[u.id] || []).length;
  const anyLoomUnit = Object.values(idx.unitsById).sort((a, b) => String(a.name).localeCompare(String(b.name))).find(hasLooms) || null;
  const dayUnit = units.find(hasLooms) || anyLoomUnit || units.find((u) => num(u.loom_eff_pct)) || units[0] || null;
  const dayAssumed = !!dayUnit && !units.some((u) => u.id === dayUnit.id);
  // One daily consumption tile per loom width of that unit (plain and dobby of a width share it),
  // at the panna that width weaves; a unit with no loom groups gets one single panna tile.
  const dayTiles = [];
  if (dayUnit) {
    for (const g of productionForUnit(calc, fabric, dayUnit, idx)) {
      const w = num(g.group.reed_width_cm);
      if (!dayTiles.some((d) => d.width === w)) dayTiles.push({ width: w, panna: g.panna, loom: g.loom, reason: g.reason });
    }
    if (!dayTiles.length) dayTiles.push({ width: null, panna: 1, loom: loomPerDay(calc, fabric, dayUnit, 1), reason: null });
  }
  const tfoUnit = units.find((u) => unitHasTfo(calc, u, idx)) || null;
  const tfoTiles = tfoUnit ? tfoPerSide(calc, tfoUnit, idx) : [];
  const spinRow = spin ? (
    <Row
      label="Spindle profitability"
      sub={spin.value !== null ? `${spin.unit.name} · ${fmt.int(spin.spindles)} spindles on ${spin.type.name}` : spin.unit.name}
      value={<span class={`strong ${spin.value === null ? '' : spin.value >= 0 ? 'good' : 'bad'}`}>{fmt.spin(spin.value)}</span>}
      valueSub={spin.value !== null ? 'profit per pick per spindle' : spin.reason}
    />
  ) : null;

  async function onFiles(e) {
    const files = [...(e.currentTarget.files || [])];
    e.currentTarget.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) await addPhoto(id, file);
    } catch (err) {
      toast(err.message || 'Photo upload failed', 'error');
    }
    setUploading(false);
  }

  // Loom realisation per loom width; one tile when every width gives the same figure (C7).
  const lrTiles = dayUnit ? dayTiles.map((d) => {
    const l = d.loom;
    const v = loomRealisation(calc, l);
    const why = l && l.mPerDay !== null ? (calc.realisationNetPerPick === null ? 'realisation not available' : 'set the pick on the fabric') : l ? l.reason : d.reason;
    return { width: d.width, panna: d.panna, l, v, why };
  }) : [];
  const sameLr = lrTiles.length > 1 && lrTiles.every((t) => t.v !== null && t.v === lrTiles[0].v && t.panna === lrTiles[0].panna);
  const lrShown = sameLr ? [{ ...lrTiles[0], widths: lrTiles.map((t) => t.width) }] : lrTiles.map((t) => ({ ...t, widths: t.width ? [t.width] : [] }));
  // the last small tile fills the rest of its row, so no hole is left (C7): phone 2 columns, laptop 3
  const nSmall = 4 + lrShown.length;
  const fillCls = (i) => {
    if (i !== nSmall - 1) return '';
    const ph = nSmall % 2 ? ' pf' : '';
    const lp = nSmall % 3 === 1 ? ' lf3' : nSmall % 3 === 2 ? ' lf2' : '';
    return ph + lp;
  };
  const widthsText = (ws) => (ws.length ? ` · ${ws.map((w) => fmt.int(w)).join(' and ')} cm` : '');

  return (
    <div>
      <NavBar
        title={fabric.name}
        backLabel="Fabrics"
        backTo="/fabrics"
        right={
          <>
            <HelpButton screen="fabric" />
            <IconButton label="Export" onClick={() => setExportOpen(true)}><Icon.share /></IconButton>
            <TextButton onClick={() => go(`/fabric/${id}/edit`)}>Edit</TextButton>
          </>
        }
        strip={<JumpBar hasUnits={units.length > 0} />}
      />
      <div class="detail-cols">
      <div class="col">
      {photos.length ? (
        <div class="hero">
          <div class="carousel" onScroll={(e) => setSlide(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}>
            {photos.map((p) => (
              <button type="button" class="slide" onClick={() => setViewer(p)} aria-label="Open photo">
                <PhotoImg photo={p} size="full" alt={fabric.name} />
              </button>
            ))}
          </div>
          <button type="button" class="hero-add" onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading}>
            {uploading ? <span class="spinner" aria-hidden="true" /> : <Icon.camera size={18} />}
            {uploading ? 'Uploading' : 'Add photo'}
          </button>
          <span class="pill pill-right">{Math.min(slide + 1, photos.length)} / {photos.length}</span>
        </div>
      ) : (
        // no photo yet: one line, so the figures start on the first screen (B2)
        <button type="button" class="photo-add" onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading}>
          {uploading ? <span class="spinner" aria-hidden="true" /> : <Icon.camera size={22} />}
          <span class="pa-main">
            <span class="pa-title">{uploading ? 'Uploading…' : 'Add photo'}</span>
            <span class="pa-sub">No photos yet</span>
          </span>
        </button>
      )}
      <input ref={fileRef} class="hidden-input" type="file" accept="image/*" multiple onChange={onFiles} aria-label="Add photo" />

      <div class="title-block" id="sec-summary">
        <h1>{fabric.name}</h1>
        <div class="title-sub">{[fabric.weave, fabric.design_note, fabric.end_use].filter(Boolean).join(' · ') || 'No weave or end use set'}</div>
        <FabricBadges fabric={fabric} calc={calc} />
      </div>

      {calc.missing.length ? <div class="notice">To see every figure, add: {calc.missing.join(', ')}.</div> : null}

      {tempSources.length ? (
        <div class="notice rates-note temp-note">
          <span>Using temporary yarn rates on this device: {tempSources.map((x) => x.text).join(', ')}.</span>
          <TextButton onClick={() => tempSources.forEach((x) => x.clear())}>Reset</TextButton>
        </div>
      ) : null}

      {calc.rpmTemp ? (
        <div class="notice rates-note temp-note">
          <span>Using a temporary loom RPM on this device: {[calc.rpmTempSp ? `single panna ${fmt.int(calc.rpmSp)} (master ${calc.masterRpmSp === null ? 'not set' : fmt.int(calc.masterRpmSp)})` : null, calc.rpmTempDp ? `double panna ${fmt.int(calc.rpmDp)} (master ${calc.masterRpmDp === null ? 'not set' : fmt.int(calc.masterRpmDp)})` : null].filter(Boolean).join(', ')}.</span>
          <TextButton onClick={() => clearTempRpm(fabric.id)}>Reset</TextButton>
        </div>
      ) : null}

      {calc.priceTemp ? (
        <div class="notice rates-note temp-note">
          <span>Using a temporary sale rate on this device: {fmt.rs(calc.price)}/{rfd ? 'RFD m' : 'm'} (master {calc.masterPrice === null ? 'not set' : fmt.rs(calc.masterPrice)}).</span>
          <TextButton onClick={() => clearTempPrice(fabric.id)}>Reset</TextButton>
        </div>
      ) : null}

      {older ? (
        <div class="notice rates-note">
          <span>Showing older yarn rates: {sources.filter((x) => livePicks[x.yarn.id]).map((x) => `${x.yarn.name} ${fmt.date(livePicks[x.yarn.id])}`).join(', ')}.</span>
          <TextButton onClick={() => setPicks({})}>Use current rates</TextButton>
        </div>
      ) : null}

      <div class="tiles">
        <div class="tile accent">
          <div class="t-label">With VATAV</div>
          <div class="t-value">{fmt.pick(calc.realisationNetPerPick)}</div>
          <div class="t-sub">per pick · {fmt.rs(calc.realisationNetPerM)}/m</div>
        </div>
        <div class="tile">
          <div class="t-label">Without VATAV</div>
          <div class="t-value">{fmt.pick(calc.realisationPerPick)}</div>
          <div class="t-sub">per pick · {fmt.rs(calc.realisationPerM)}/m</div>
        </div>
        <div class="tile">
          <div class="t-label">VATAV</div>
          <div class="t-value">{calc.vatavPct ? `${fmt.n(calc.vatavPct, calc.vatavPct % 1 ? 1 : 0)}%` : 'None'}</div>
          <div class="t-sub">{calc.vatavPct ? `${fmt.rs(calc.vatavAmount)} off per ${rfd ? 'RFD m' : 'm'}` : 'no discount set'}</div>
        </div>
        <div class={`tile${fillCls(3)}`}>
          <div class="t-label">Sale rate</div>
          <div class="t-value">{calc.price === null ? 'Not set' : fmt.rs(calc.price)}{calc.priceTemp ? <span class="badge amber tag-temp">Temp</span> : null}</div>
          <div class="t-sub">{calc.price === null ? 'add a selling price' : calc.priceTemp ? `temporary · master ${calc.masterPrice === null ? 'not set' : fmt.rs(calc.masterPrice)}` : `${rfd ? 'per RFD metre' : 'per metre'}${fmt.date(fabric.sale_date) ? ` · ${fmt.date(fabric.sale_date)}` : ''}`}</div>
        </div>
        {lrShown.map((t, i) => (
          <div class={`tile loomreal${fillCls(4 + i)}`} title={t.v !== null ? `${fmt.pick(calc.realisationNetPerPick)} per pick × ${fmt.int(t.l.mPerDay)} m × ${calc.ppi} PPI · ${dayUnit.name}${dayAssumed ? ' (fabric not assigned to it)' : ''}` : undefined}>
            <div class="t-label">Loom realisation{widthsText(t.widths)}</div>
            <div class="t-value">{t.v === null ? '—' : fmt.rs(t.v, 0)}</div>
            <div class="t-sub">{t.v !== null ? `per loom per day · ${t.panna === 2 ? 'double' : 'single'} panna` : t.why}</div>
          </div>
        ))}
        {dayTiles.length ? dayTiles.map((d) => {
          const l = d.loom;
          const ok = l && l.mPerDay !== null;
          return (
            <div class="tile span daily">
              <div class="t-label">Daily consumption{d.width ? ` · ${fmt.int(d.width)} cm` : ''}</div>
              <div class="t-split">
                <div><span class="t-k">Warp</span><span class="t-v">{ok && l.warpKg !== null ? `${fmt.n(l.warpKg, 1)} kg` : '—'}</span></div>
                <div><span class="t-k">Weft</span><span class="t-v">{ok && l.weftKg !== null ? `${fmt.n(l.weftKg, 1)} kg` : '—'}</span></div>
              </div>
              <div class="t-sub">{ok ? `per loom per day (${fmt.int(l.mPerDay)} m) · ${d.panna === 2 ? 'double' : 'single'} panna · ${fmt.int(l.rpm)} RPM · ${fmt.n(l.eff, l.eff % 1 ? 1 : 0)}% eff. · ${dayUnit.name}${dayAssumed ? ' (fabric not assigned to it)' : ''}` : `${l ? l.reason : d.reason} · ${dayUnit.name}${dayAssumed ? ' (fabric not assigned to it)' : ''}`}</div>
            </div>
          );
        }) : (
          <div class="tile span daily">
            <div class="t-label">Daily consumption</div>
            <div class="t-split"><div><span class="t-k">Warp</span><span class="t-v">—</span></div><div><span class="t-k">Weft</span><span class="t-v">—</span></div></div>
            <div class="t-sub">assign a unit to see it</div>
          </div>
        )}
        {tfoTiles.map((t) => (
          <div class="tile span tfo">
            <div class="t-label">TFO per side · {t.type.name}</div>
            <div class="t-lines">
              {t.yarns.map((y) => (
                <div class="t-line">
                  <span class="t-k">{y.sides.map((x) => (x === 'warp' ? 'Warp' : 'Weft')).join(' + ')} · {y.yarn.name}</span>
                  <span class="t-v">{y.kgPerSide === null ? <span class="t-miss">{y.reason}</span> : `${fmt.n(y.kgPerSide, 1)} kg`}</span>
                </div>
              ))}
            </div>
            <div class="t-sub">per side per day · {fmt.int(t.perSide)} spindles · {t.eff !== null ? `${fmt.n(t.eff, t.eff % 1 ? 1 : 0)}% eff. assumed` : 'efficiency per yarn as set'} · {tfoUnit.name}</div>
          </div>
        ))}
      </div>

      <TempPriceSection
        fabric={fabric}
        calc={calc}
        master={calcMaster}
        unit={units.find((u) => num(u.cost_per_pick) !== null) || null}
        loom={dayUnit && dayTiles.length && dayTiles[0].loom ? { ...dayTiles[0].loom, width: dayTiles[0].width } : null}
      />

      <TempRpmSection fabric={fabric} calc={calc} master={calcRpmMaster} unit={dayUnit} widths={dayTiles.map((d) => ({ width: d.width, panna: d.panna }))} />

      {sources.length ? (
        <Section header="Yarn rates" footer="Pick an older rate, or type a temporary rate (this device only)." guide="temp-rates">
          {sources.map((src) => (
            <>
            <label class={`row field${src.dates.length ? ' stacked' : ''}`}>
              <span class="row-label">
                {src.yarn.name}
                {src.usedBy.some((y) => y.id !== src.yarn.id) ? <span class="hint"> for {src.usedBy.filter((y) => y.id !== src.yarn.id).map((y) => y.name).join(', ')}</span> : null}
              </span>
              {src.dates.length ? (
                <span class="field-input select">
                  <select disabled={src.temp !== null} value={livePicks[src.yarn.id] || src.dates[0].date} onChange={(e) => setPicks((p) => ({ ...p, [src.yarn.id]: e.currentTarget.value }))} aria-label={`Rate for ${src.yarn.name}`}>
                    {src.dates.map((d, i) => <option value={d.date}>{`${fmt.date(d.date)} · ${fmt.rate(d.rate)}/kg${i === 0 ? ' (current)' : ''}`}</option>)}
                  </select>
                  <Icon.chevron size={12} />
                </span>
              ) : (
                <span class="row-value"><span class="row-sub">No rate yet</span></span>
              )}
            </label>
            <TempRateRow yarn={src.yarn} temp={src.temp} placeholder={src.dates.length ? src.dates[0].rate : null} />
            {src.tpm.map((t) => {
              const picked = livePicks[src.yarn.id] ? src.dates.find((d) => d.date === livePicks[src.yarn.id]) : null;
              const bm = picked ? picked.rate : src.dates.length ? src.dates[0].rate : null;
              return <TempTpmRow t={t} base={src.yarn} baseTemp={src.temp} baseMaster={bm} />;
            })}
            </>
          ))}
        </Section>
      ) : null}

      <FoldSection
        fold="construction"
        id="sec-construction"
        header="Construction"
        summary={[fabric.reed ? `Reed ${fabric.reed}` : null, calc.ppi ? `${calc.ppi} PPI` : null, calc.rs ? `RS ${calc.rs}″` : null, calc.totalEnds !== null ? `${fmt.int(calc.totalEnds)} ends` : null].filter(Boolean).join(' · ') || 'Not filled in yet'}
      >
        <Row label="Reed" value={fabric.reed || '—'} />
        <Row label="Pick (PPI)" value={calc.ppi ?? '—'} />
        <Row label="Total ends" value={calc.totalEnds === null ? '—' : fmt.int(calc.totalEnds)} />
        <Row label="Reed space" value={calc.rs ? `${calc.rs}″` : '—'} />
        <Row label="Greige width" value={calc.width ? `${calc.width}″` : '—'} />
        <Row label="Warp shortage" value={fabric.warp_shortage_pct !== '' && fabric.warp_shortage_pct !== undefined ? `${fabric.warp_shortage_pct}%` : '—'} />
        <Row label="Weft shortage" value={fabric.weft_shortage_pct !== '' && fabric.weft_shortage_pct !== undefined ? `${fabric.weft_shortage_pct}%` : '—'} />
        <Row label="Loom RPM (single panna)" value={calc.rpmSp ? `${fmt.int(calc.rpmSp)}${calc.rpmTempSp ? ' (temp)' : ''}` : '—'} valueSub={calc.rpmTempSp ? `master ${calc.masterRpmSp ? fmt.int(calc.masterRpmSp) : 'not set'}` : undefined} />
        <Row label="Loom RPM (double panna)" value={calc.rpmDp ? `${fmt.int(calc.rpmDp)}${calc.rpmTempDp ? ' (temp)' : ''}` : '—'} valueSub={calc.rpmTempDp ? `master ${calc.masterRpmDp ? fmt.int(calc.masterRpmDp) : 'not set'}` : undefined} />
      </FoldSection>
      </div>

      <div class="col">
      <Section id="sec-costing" header="Warp and weft" footer={calc.rmCost !== null ? `RM cost ${fmt.rs(calc.rmCost)} per greige metre, shortage included.` : null}>
        {[...calc.warp, ...calc.weft].map((x) => (
          <Row
            label={x.yarn ? x.yarn.name : 'Yarn missing'}
            sub={x.line.side === 'warp' ? `Warp · ${x.ends ? fmt.int(x.ends) : '—'} ends · ${x.rate !== null ? `${fmt.rate(x.rate)}/kg${x.temp ? ' (temp)' : ''}` : 'no rate'}` : `Weft${x.line.pattern ? ` · ${x.line.pattern}` : ''}${calc.weft.length > 1 ? ` · ${Math.round(x.share * 100)}% of picks` : ''} · ${x.rate !== null ? `${fmt.rate(x.rate)}/kg${x.temp ? ' (temp)' : ''}` : 'no rate'}`}
            value={x.gpm === null ? '—' : <span class="strong">{fmt.n(x.gpm, 1)} g/m</span>}
            valueSub={x.gpm === null ? null : `${fmt.n(x.kgPer100, 2)} kg/100 m · ${fmt.rs(x.costPerM)}/m`}
          />
        ))}
        {!calc.warp.length && !calc.weft.length ? <Row label="No yarns yet" sub="Edit the fabric to add warp and weft yarns." /> : null}
      </Section>

      {rfd ? (
        <Section header="Finishing · RFD">
          <Row label="Selling price" value={`${fmt.rs(calc.price)} / RFD m`} />
          <Row label="Sale date" value={fmt.date(fabric.sale_date) || '—'} />
          <Row label="RFD shortage" value={fabric.rfd_shortage_pct !== '' && fabric.rfd_shortage_pct !== undefined ? `${fabric.rfd_shortage_pct}%` : '—'} />
          <Row label="Processing charge" value={`${fmt.rs(num(fabric.processing_charge))} / m`} />
          <Row label="Transportation" value={num(fabric.transport_charge) === null ? '—' : `${fmt.rs(num(fabric.transport_charge))} / RFD m`} />
          <Row label="Brokering" value={`${num(fabric.brokering_pct) ?? 0}%`} />
          <Row label="RM cost per RFD m" value={fmt.rs(calc.rmPerSaleM)} />
          <Row label="Finishing cost" value={fmt.rs(calc.finishingCost)} />
          <Row label="RFD cost" strong value={<span class="strong">{fmt.rs(calc.rfdCost)} / m</span>} />
          <Row label="Realisation without VATAV" value={<span class="strong">{fmt.pick(calc.realisationPerPick)} / pick</span>} valueSub={`${fmt.rs(calc.realisationPerM)} / RFD m`} />
          <Row label="VATAV" value={calc.vatavPct ? `${calc.vatavPct}% · −${fmt.rs(calc.vatavAmount)} / m` : 'None'} />
          <Row label="Realisation with VATAV" strong value={<span class="strong accent-text">{fmt.pick(calc.realisationNetPerPick)} / pick</span>} valueSub={`${fmt.rs(calc.realisationNetPerM)} / RFD m`} />
          {spinRow}
        </Section>
      ) : (
        <Section header="Greige">
          <Row label="Selling price" value={`${fmt.rs(calc.price)} / m`} />
          <Row label="Sale date" value={fmt.date(fabric.sale_date) || '—'} />
          <Row label="RM cost" value={`${fmt.rs(calc.rmCost)} / m`} />
          <Row label="Realisation without VATAV" value={<span class="strong">{fmt.pick(calc.realisationPerPick)} / pick</span>} valueSub={`${fmt.rs(calc.realisationPerM)} / m`} />
          <Row label="VATAV" value={calc.vatavPct ? `${calc.vatavPct}% · −${fmt.rs(calc.vatavAmount)} / m` : 'None'} />
          <Row label="Realisation with VATAV" strong value={<span class="strong accent-text">{fmt.pick(calc.realisationNetPerPick)} / pick</span>} valueSub={`${fmt.rs(calc.realisationNetPerM)} / m`} />
          {spinRow}
        </Section>
      )}

      <Section id="sec-units" header="Units · profit per pick" footer={`Profit per pick uses realisation with VATAV.${calc.tpmLines.length && units.some((u) => truthy(u.has_tfo)) ? ' Spindles are per loom, per TFO type.' : ''}`}>
        {units.map((u) => <UnitCard unit={u} fabric={fabric} calc={calc} idx={idx} />)}
        {!units.length ? <Row label="Not in any unit yet" sub="Assign it to see profit per pick and spindles." /> : null}
        <button type="button" class="add-row" onClick={() => setAssignOpen(true)}><Icon.plus size={20} />{units.length ? 'Change units' : 'Assign to units'}</button>
      </Section>

      {units.length ? (
        <Section id="sec-production" header="Production centre" footer="Per loom per day, shortage included." guide="fabric">
          {units.map((u) => <ProductionCard unit={u} fabric={fabric} calc={calc} idx={idx} />)}
        </Section>
      ) : null}

      {units.length ? (() => {
        const beams = beamRowsOf(id, idx);
        const set = beams.filter((b) => b.length !== null).length;
        return (
          <FoldSection fold="beam" id="sec-beam" header="Beam length" footer="Set it in Edit." summary={beams.length ? `${set} of ${beams.length} loom ${beams.length === 1 ? 'width' : 'widths'} set` : 'No loom groups yet'}>
            {beams.map((b) => (
              <Row key={b.group.id} label={slotLabelIn(b.unit, b)} value={b.length !== null ? `${fmt.n(b.length, 0)} m` : 'Not set'} />
            ))}
            {!beams.length ? <Row label="No loom groups yet" sub="Add loom groups to the unit to set beam lengths." /> : null}
          </FoldSection>
        );
      })() : null}

      <History row={fabric} added what="fabric" fold />

      <div class="actions">
        <Button kind="secondary" onClick={() => setExportOpen(true)}><Icon.share size={20} /> Export or share</Button>
        <Button kind="secondary" onClick={async () => {
          try {
            const nid = await duplicateFabric(id);
            go(`/fabric/${nid}/edit`);
          } catch (e) {
            toast(e.message, 'error');
          }
        }}><Icon.copy size={20} /> Duplicate</Button>
        <RsDuplicate id={id} fabric={fabric} />
      </div>
      {/* the risky action sits apart, at the very end, smaller (B11) */}
      <div class="danger-zone">
        <Button kind="danger" onClick={async () => {
          const ok = await askConfirm({ title: `Delete ${fabric.name}?`, text: 'This removes it from the Sheet for everyone, with its yarn lines, unit links, beam lengths and photos.', yes: `Delete ${fabric.name}`, danger: true });
          if (!ok) return;
          try {
            await deleteFabric(id);
            replace('/fabrics');
          } catch (e) {
            toast(e.message, 'error');
          }
        }}><Icon.trash size={18} /> Delete fabric</Button>
      </div>
      </div>
      </div>

      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} fabric={fabric} calc={calcNow} idx={idx} />
      <AssignSheet open={assignOpen} onClose={() => setAssignOpen(false)} fabric={fabric} idx={idx} />
      <PhotoSheet photo={viewer} onClose={() => setViewer(null)} />
    </div>
  );
}

// Production centre: one block per unit, one line per loom group the fabric can run on.
export function ProductionCard({ unit, fabric, calc, idx }) {
  const groups = productionForUnit(calc, fabric, unit, idx);
  const kg = (v) => (v === null || v === undefined ? '—' : `${fmt.n(v, 1)} kg`);
  const fallback = !groups.length ? [1, 2].map((panna) => ({ group: null, panna, looms: null, loom: loomPerDay(calc, fabric, unit, panna) })) : [];
  return (
    <div class="unit-card prod-card">
      <div class="unit-head">
        <div class="min0">
          <div class="row-label strong">{unit.name}</div>
          <div class="row-sub">{num(unit.loom_eff_pct) ? `loom efficiency ${fmt.n(num(unit.loom_eff_pct), num(unit.loom_eff_pct) % 1 ? 1 : 0)}%` : 'loom efficiency not set'}{groups.length ? '' : ' · no loom groups, shown per panna'}</div>
        </div>
      </div>
      {[...groups, ...fallback].map((g) => {
        const title = g.group ? groupLabel(g.group) : `${g.panna === 2 ? 'Double' : 'Single'} panna`;
        const ok = g.loom && g.loom.mPerDay !== null;
        const meta = [g.looms ? `${fmt.int(g.looms)} looms` : null, g.group && g.panna ? `${g.panna === 2 ? 'double' : 'single'} panna` : null, ok ? `${fmt.int(g.loom.rpm)} RPM` : null].filter(Boolean).join(' · ');
        return (
          <>
            <div class="pan-head">
              <span class="pan-label">{title}</span>
              <span class="pan-note tnum">{ok ? meta : g.loom ? g.loom.reason : g.reason}</span>
            </div>
            {ok ? (
              <div class="spin-grid three">
                <div class="spin"><div class="s-label">Metres / day</div><div class="s-value">{fmt.int(g.loom.mPerDay)} m</div></div>
                <div class="spin"><div class="s-label">Warp / day</div><div class="s-value">{kg(g.loom.warpKg)}</div></div>
                <div class="spin"><div class="s-label">Weft / day</div><div class="s-value">{kg(g.loom.weftKg)}</div></div>
              </div>
            ) : null}
            {ok ? <YarnWise rows={g.yarns || yarnConsumption(calc, g.loom.mPerDay, g.looms)} /> : null}
          </>
        );
      })}
    </div>
  );
}

// Yarn-wise consumption per loom per day (shortage included): one line per warp and weft yarn.
function YarnWise({ rows }) {
  if (!rows.length) return null;
  return (
    <div class="yarn-wise">
      {rows.map((r) => (
        <div class="yw-row">
          <span class="yw-side">{r.side === 'warp' ? 'Warp' : 'Weft'}</span>
          <span class="yw-name">{r.yarn.name}</span>
          <span class="yw-kg tnum">
            {r.kg === null ? '—' : `${fmt.n(r.kg, 2)} kg`}
          </span>
        </div>
      ))}
    </div>
  );
}

export function UnitCard({ unit, fabric, calc, idx }) {
  const p = unitProfit(calc, unit);
  const tfoNote = calc.tpmLines.length
    ? truthy(unit.has_tfo)
      ? (idx.tfoTypesByUnit[unit.id] || []).length ? null : 'No TFO types set in this unit'
      : 'No TFO division'
    : null;
  const sp = spindleProfit(calc, fabric, unit, idx);
  return (
    <div class="unit-card">
      <div class="unit-head">
        <div class="min0">
          <div class="row-label strong">{unit.name}</div>
          <div class="row-sub">{unit.type || 'Unit'} · cost {fmt.pick(p.costPerPick)} / pick{tfoNote ? ` · ${tfoNote}` : ''}</div>
        </div>
        <div class="end-none">
          <div class={`row-label strong tnum ${p.profitPerPick === null ? '' : p.profitPerPick >= 0 ? 'good' : 'bad'}`}>{fmt.signedPick(p.profitPerPick)} / pick</div>
          <div class="row-sub tnum">{p.profitPerM === null ? '—' : `${fmt.rs(p.profitPerM)} / ${calc.finish === 'RFD' ? 'RFD m' : 'm'}`}</div>
        </div>
      </div>
      {sp && sp.value !== null ? (
        <div class="pan-head">
          <span class="pan-label">Spindle profitability · {sp.type.name}</span>
          <span class={`pan-note tnum ${sp.value >= 0 ? 'good' : 'bad'}`}>{fmt.spin(sp.value)} / pick / spindle</span>
        </div>
      ) : null}
      {/* spindles per TFO type only: warp and weft kg live in the Production centre (B1 c) */}
      {unitHasTfo(calc, unit, idx) ? <PanBlocks calc={calc} fabric={fabric} unit={unit} idx={idx} /> : null}
    </div>
  );
}

// Per loom per day, single and double panna: spindles for each TFO type (TPM fabrics in a unit
// with TFO), otherwise warp and weft kg.
export function PanBlocks({ calc, fabric, unit, idx, showNote }) {
  const tfo = unitHasTfo(calc, unit, idx);
  return (
    <>
      {[1, 2].map((panna) => {
        const loom = loomPerDay(calc, fabric, unit, panna);
        const label = `${panna === 2 ? 'Double' : 'Single'} panna${loom.rpm ? ` · ${fmt.int(loom.rpm)} RPM` : ''}`;
        if (loom.mPerDay === null) {
          return (
            <div class="pan-head">
              <span class="pan-label">{label}</span>
              <span class="pan-note">{loom.reason}</span>
            </div>
          );
        }
        const cells = tfo
          ? spindlesForUnit(calc, fabric, unit, idx, panna).map((s) => (
              <div class="spin">
                <div class="s-label">{s.type.name}</div>
                {s.total === null ? <div class="s-note">{s.reason}</div> : <div class="s-value">{fmt.int(s.total)} spindles</div>}
                {s.total !== null ? <div class="s-note tnum">{(() => { const w = Math.round(s.perYarn.filter((p) => p.side === 'warp').reduce((t, p) => t + p.spindles, 0)); return `Warp ${fmt.int(w)} · Weft ${fmt.int(Math.round(s.total) - w)}`; })()}</div> : null}
              </div>
            ))
          : [['Warp', loom.warpKg], ['Weft', loom.weftKg]].map(([k, v]) => (
              <div class="spin">
                <div class="s-label">{k}</div>
                <div class="s-value">{v === null ? '—' : `${fmt.n(v, 1)} kg/day`}</div>
              </div>
            ));
        return (
          <>
            <div class="pan-head"><span class="pan-label">{label}</span></div>
            <div class="spin-grid">{cells}</div>
          </>
        );
      })}
    </>
  );
}

// Copy a fabric at a new reed space. Warp ends and greige width scale with RS; the sale rate is the one
// entered, or scaled with RS. The stored name stays, so the new RS shows on its own.
function RsDuplicate({ id, fabric }) {
  const [open, setOpen] = useState(false);
  const [rsIn, setRsIn] = useState('');
  const [priceIn, setPriceIn] = useState('');
  const [busy, setBusy] = useState(false);
  const oldRs = num(fabric.reed_space_in);
  const newRs = num(rsIn);
  const price = num(priceIn);
  const plan = oldRs && newRs && newRs > 0 ? rsCopyPlan(id, newRs, price) : null;
  async function run() {
    if (!oldRs) return toast('Set the reed space on this fabric first', 'error');
    if (!newRs || newRs <= 0) return toast('Enter the new RS', 'error');
    setBusy(true);
    try {
      const nid = await duplicateForRs(id, newRs, price);
      setOpen(false);
      go(`/fabric/${nid}`);
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  }
  return (
    <>
      <Button kind="secondary" onClick={() => { setRsIn(''); setPriceIn(''); setOpen(true); }}><Icon.copy size={20} /> Duplicate for new RS</Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Duplicate for new RS"
        footer={oldRs ? <Button busy={busy} onClick={run}>Duplicate</Button> : null}
      >
        {oldRs ? (
          <>
            <Section header={fabric.name} footer={`Warp ends${num(fabric.greige_width_in) === null ? '' : ', greige width'}${price === null ? ' and sale rate' : ''} scale with RS. Everything else stays the same.`}>
              <NumField label="New RS" required value={rsIn} onInput={setRsIn} suffix="in" placeholder={String(oldRs)} autofocus />
              <NumField label="Sale rate" hint="optional" prefix="₹" value={priceIn} onInput={setPriceIn} placeholder={plan && plan.price !== null ? String(plan.price) : ''} />
            </Section>
            {plan ? (
              <Section header="New quality">
                <Row label="Name" value={fabricLabel({ name: plan.name, reed_space_in: newRs, finish: plan.fabric.finish })} />
                <Row label="RS" value={`${oldRs} → ${newRs} in`} />
                {plan.warp.map((w) => <Row label="Warp ends" sub={w.name} value={`${fmt.int(w.from)} → ${fmt.int(w.to)}`} />)}
                <Row label="Sale rate" value={plan.price === null ? '—' : `${fmt.rs(plan.price)} / m`} valueSub={price === null && plan.price !== null ? `scaled from ${fmt.rs(num(fabric.price))}` : undefined} />
              </Section>
            ) : null}
          </>
        ) : (
          <Section>
            <Row label="No reed space on this fabric" sub="Add the RS from Edit first." />
          </Section>
        )}
      </Sheet>
    </>
  );
}

function AssignSheet({ open, onClose, fabric, idx }) {
  const current = new Set(unitsOf(fabric.id, idx).map((u) => u.id));
  const [sel, setSel] = useState(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setSel(new Set(unitsOf(fabric.id, idx).map((u) => u.id)));
  }, [open]);
  const units = Object.values(idx.unitsById).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Units"
      footer={<Button busy={busy} onClick={async () => {
        setBusy(true);
        try {
          await setAssignments(fabric.id, [...sel]);
          onClose();
        } catch (e) {
          toast(e.message, 'error');
        }
        setBusy(false);
      }}>Save</Button>}
    >
      <Section header={`Units running ${fabric.name}`} footer="A fabric appears in the database of every unit ticked here.">
        {units.map((u) => (
          <Row label={u.name} sub={`${u.type || 'Unit'} · ${fmt.pick(num(u.cost_per_pick))} / pick`} onClick={() => {
            const n = new Set(sel);
            if (n.has(u.id)) n.delete(u.id);
            else n.add(u.id);
            setSel(n);
          }} value={sel.has(u.id) ? <span class="accent-text"><Icon.check size={20} /></span> : ''} />
        ))}
        {!units.length ? <Row label="No units yet" sub="Add units in the Units tab." /> : null}
      </Section>
    </Sheet>
  );
}

function PhotoSheet({ photo, onClose }) {
  const [busy, setBusy] = useState(false);
  if (!photo) return null;
  return (
    <Sheet open={!!photo} onClose={onClose} title="Photo">
      <div class="photo-view"><PhotoImg photo={photo} size="full" /></div>
      <div class="actions">
        {!truthy(photo.is_cover) ? <Button kind="secondary" busy={busy} onClick={async () => { setBusy(true); try { await setCover(photo); onClose(); } catch (e) { toast(e.message, 'error'); } setBusy(false); }}>Set as cover</Button> : <Button kind="secondary" disabled>This is the cover photo</Button>}
        <Button kind="danger" busy={busy} onClick={async () => {
          if (!(await askConfirm({ title: 'Delete this photo?', text: 'It is removed for everyone.', yes: 'Delete photo', danger: true }))) return;
          setBusy(true);
          try {
            await deletePhoto(photo);
            onClose();
          } catch (e) {
            toast(e.message, 'error');
          }
          setBusy(false);
        }}>Delete photo</Button>
      </div>
    </Sheet>
  );
}

// ₹ switches under Detailed → Advanced (1.29.0): one per money group, each on its own. Basic has no ₹ at all.
export const MONEY_SWITCHES = [
  ['realisation', 'Realisation', 'Per pick and per m, with and without VATAV; profit per pick; spindle profitability'],
  ['sale', 'Sale rate', 'Sale rate, sale date, VATAV; the price line in WhatsApp and Copy text'],
  ['yarn', 'Yarn rates', 'Yarn rates and raw material cost tables'],
  ['costs', 'Costs', 'RM cost, RFD cost breakdown, unit cost per pick, profit per m'],
  ['loom', 'Loom realisation', '₹ per loom per day'],
];

function ExportSheet({ open, onClose, fabric, calc, idx }) {
  const [toDrive, setToDrive] = useState(backendMode() === 'sheet');
  const [busy, setBusy] = useState('');
  // Basic (no money at all) or Detailed (internal; every figure, or only the ₹ groups switched on under Advanced).
  // Back to Basic, Advanced closed and every switch on, each time the sheet opens.
  const [level, setLevel] = useState('basic');
  const [advanced, setAdvanced] = useState(false);
  const [sw, setSw] = useState({ ...DETAILED_ALL });
  useEffect(() => {
    if (open) {
      setLevel('basic');
      setAdvanced(false);
      setSw({ ...DETAILED_ALL });
      preloadExports().catch(() => {});
    }
  }, [open]);
  const detailed = level === 'detailed';
  // Basic carries no money anywhere; Detailed's WhatsApp and Copy text carry the price only with Sale rate on
  const text = whatsappText(fabric, calc, idx, detailed ? sw : NO_MONEY);
  const priced = detailed && sw.sale && calc.price !== null;
  const run = async (kind, fn) => {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      if (e && e.name !== 'AbortError') toast(e.message || 'Export failed', 'error');
    }
    setBusy('');
  };
  const sheetMode = backendMode() === 'sheet';
  const on = MONEY_SWITCHES.filter(([k]) => sw[k]).map(([, l]) => l.toLowerCase());
  const detailedFooter = on.length === MONEY_SWITCHES.length
    ? 'Every figure, with costs, yarn rates and profit. Internal use only.'
    : on.length
      ? `Contains ₹: ${on.join(', ')}. Internal use only.`
      : 'Every ₹ switch is off: construction, consumption, looms and TFO only, no ₹ figures.';
  return (
    <Sheet open={open} onClose={onClose} title="Export">
      <Section header="Report" footer={detailed ? detailedFooter : 'No ₹ figures at all. Safe to send to anyone.'}>
        <div class="row"><div class="seg-fill"><Segmented label="Report" options={[{ value: 'basic', label: 'Basic' }, { value: 'detailed', label: 'Detailed' }]} value={level} onChange={setLevel} /></div></div>
        {detailed ? (
          <>
            <button type="button" class="row link-row" aria-expanded={advanced ? 'true' : 'false'} onClick={() => setAdvanced(!advanced)}>
              <span class="row-label">Advanced</span>
              <span class="fold-mark">{advanced ? 'Hide' : on.length === MONEY_SWITCHES.length ? 'Choose ₹ figures' : `${on.length} of ${MONEY_SWITCHES.length} on`}<Icon.chevron size={11} /></span>
            </button>
            {advanced ? MONEY_SWITCHES.map(([k, label, sub]) => (
              <div class="row money-switch">
                <div class="row-main"><div class="row-label">{label}</div><div class="row-sub">{sub}</div></div>
                <button type="button" class={`switch ${sw[k] ? 'on' : ''}`} aria-pressed={sw[k] ? 'true' : 'false'} aria-label={label} onClick={() => setSw((x) => ({ ...x, [k]: !x[k] }))}><span /></button>
              </div>
            )) : null}
          </>
        ) : null}
      </Section>
      <Section header={`${fabric.name} · ${calc.finish}`} footer={detailed ? (priced ? 'WhatsApp and Copy text add the price to the Basic text. Turn off Sale rate to leave it out.' : 'WhatsApp and Copy text send the Basic text, with no ₹ figures.') : null}>
        {detailed ? (
          <>
            <Row label="Detailed PDF" sub="Internal · key figures, every table, how each figure is worked out" onClick={() => run('dpdf', () => exportFabricPdfDetailed(fabric, calc, idx, { toDrive: sheetMode && toDrive, money: sw }))} value={busy === 'dpdf' ? <span class="spinner" /> : undefined} chevron={busy !== 'dpdf'} />
            <Row label="Detailed Excel" sub="The same sections on one sheet, numbers as numbers" onClick={() => run('dxlsx', () => exportFabricXlsxDetailed(fabric, calc, idx, { toDrive: sheetMode && toDrive, money: sw }))} value={busy === 'dxlsx' ? <span class="spinner" /> : undefined} chevron={busy !== 'dxlsx'} />
          </>
        ) : (
          <>
            <Row label="PDF spec sheet" sub="Photo, construction, consumption, no ₹ figures" onClick={() => run('pdf', () => exportFabricPdf(fabric, calc, idx, { toDrive: sheetMode && toDrive, money: NO_MONEY }))} value={busy === 'pdf' ? <span class="spinner" /> : undefined} chevron={busy !== 'pdf'} />
            <Row label="Excel sheet" sub="Construction and consumption, no ₹ figures" onClick={() => run('xlsx', () => exportFabricXlsx(fabric, calc, idx, { toDrive: sheetMode && toDrive, money: NO_MONEY }))} value={busy === 'xlsx' ? <span class="spinner" /> : undefined} chevron={busy !== 'xlsx'} />
          </>
        )}
        <Row label="WhatsApp message" sub={priced ? 'Contains price · Basic text with the price' : detailed ? 'Basic text, no ₹ figures' : 'Opens WhatsApp with the text below'} onClick={() => openWhatsAppText(text)} chevron />
        <Row label="Copy text" sub={priced ? 'Contains price · Basic text with the price' : detailed ? 'Basic text, no ₹ figures' : 'Paste it anywhere'} onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            toast('Copied');
          } catch {
            toast('Copy is not available here', 'error');
          }
        }} chevron />
      </Section>
      <Section footer={sheetMode ? 'Saves a copy of each PDF or Excel file in the Exports folder in your Drive.' : 'Available once your Google Sheet is connected.'}>
        {sheetMode ? <Toggle label="Also save to Drive folder" value={toDrive} onChange={setToDrive} /> : <Row label="Also save to Drive folder" value="Off" />}
      </Section>
      <Section header="WhatsApp text preview" flush>
        <div class="wa-bubble">{text}</div>
      </Section>
    </Sheet>
  );
}

// ---------------- edit ----------------
// Today in India, yyyy-mm-dd.
export const todayIst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const blankFabric = () => ({ name: '', weave: 'Plain', design_note: '', end_use: '', reed: '', ppi: '', reed_space_in: '', greige_width_in: '', warp_shortage_pct: '', weft_shortage_pct: '', price: '', sale_date: '', vatav_pct: '', finish: 'Greige', rfd_shortage_pct: '', processing_charge: '', brokering_pct: '', transport_charge: '', loom_rpm: '', loom_rpm_dp: '', loom_eff_pct: '', notes: '' });

export function FabricEdit({ id }) {
  const st = useStore();
  const existing = id ? getIndex().fabricsById[id] : null;
  if (id && !existing) {
    return (
      <div>
        <NavBar title="Edit fabric" backLabel="Back" backTo="/fabrics" />
        <Empty title={st.status.loading ? 'Loading…' : 'Fabric not found'} />
      </div>
    );
  }
  return <FabricEditForm key={id || 'new'} id={id} />;
}

function FabricEditForm({ id }) {
  const st = useStore();
  const idx = getIndex();
  const existing = id ? idx.fabricsById[id] : null;
  const [f, setF] = useState(() => ({ ...blankFabric(), ...baseFabric(existing || {}) }));
  const [lines, setLines] = useState(() => (existing ? (idx.linesByFabric[id] || []).map((l) => ({ ...l })) : [{ side: 'warp', yarn_id: '', ends: '' }, { side: 'weft', yarn_id: '', parts: 1, pattern: '' }]));
  const [unitIds, setUnitIds] = useState(() => (existing ? unitsOf(id, idx).map((u) => u.id) : []));
  // Beam length typed per slot (unit + make + width), keyed by the slot's first loom group.
  const [beams, setBeams] = useState(() => {
    const m = {};
    for (const b of existing ? idx.beamsByFabric[id] || [] : []) if (num(b.beam_length_m) !== null) m[b.loom_group_id] = String(b.beam_length_m);
    return m;
  });
  const slots = beamSlots(f.weave, unitIds, idx);
  const slotValue = (slot) => {
    const g = slot.groupIds.find((x) => beams[x] !== undefined && beams[x] !== '');
    return g ? beams[g] : '';
  };
  const [busy, setBusy] = useState(false);
  const up = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  // Sale date follows the selling price: a changed price dates the sale today, unless the date was set by hand.
  const [saleTouched, setSaleTouched] = useState(false);
  const origPrice = existing ? num(existing.price) : null;
  const origSale = existing ? String(existing.sale_date || '').slice(0, 10) : '';
  const setPrice = (v) => setF((x) => ({ ...x, price: v, sale_date: saleTouched ? x.sale_date : num(v) !== null && num(v) !== origPrice ? todayIst() : origSale }));
  const saleAuto = !saleTouched && num(f.price) !== null && num(f.price) !== origPrice && f.sale_date === todayIst();

  const tempId = existing ? existing.id : '__new__';
  const preview = useMemo(() => {
    const t = getState().tables;
    const fab = { ...f, id: tempId };
    const ls = lines.filter((l) => l.yarn_id).map((l, i) => ({ ...l, id: l.id || `tmp${i}`, fabric_id: tempId, sort: i }));
    const tIdx = buildIndex({ ...t, Fabrics: [...(t.Fabrics || []).filter((x) => x.id !== tempId), fab], FabricYarns: [...(t.FabricYarns || []).filter((x) => x.fabric_id !== tempId), ...ls] }, getState().tempRates);
    return fabricCalc(fab, tIdx);
  }, [f, lines, st.tables, st.tempRates]);
  // Cancel, Back or the back gesture asks before throwing away changes
  const startSnap = useRef(null);
  const snap = JSON.stringify([f, lines, unitIds, beams]);
  if (startSnap.current === null) startSnap.current = snap;
  const allowLeave = useLeaveGuard(snap !== startSnap.current);

  if (id && !existing) {
    return (
      <div>
        <NavBar title="Edit fabric" backLabel="Back" backTo="/fabrics" />
        <Empty title="Fabric not found" />
      </div>
    );
  }

  const opts = yarnOptions(idx);
  const setLine = (i, patch) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const removeLine = (i) => setLines((ls) => ls.filter((_, j) => j !== i));
  const addLine = (side) => setLines((ls) => [...ls, side === 'warp' ? { side, yarn_id: '', ends: '' } : { side, yarn_id: '', parts: 1, pattern: '' }]);

  async function save() {
    if (!String(f.name || '').trim()) {
      toast('Add a quality name first', 'error');
      return;
    }
    setBusy(true);
    try {
      const clean = lines.filter((l) => l.yarn_id);
      const fid = await saveFabric({ ...f, name: f.name.trim() }, clean, unitIds, slots.flatMap((slot) => slot.groupIds.map((loom_group_id) => ({ loom_group_id, beam_length_m: slotValue(slot) }))));
      allowLeave();
      if (existing) back(`/fabric/${fid}`);
      else replace(`/fabric/${fid}`);
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  }

  const rfd = f.finish === 'RFD';
  const lineBlock = (side) =>
    lines.map((l, i) =>
      l.side !== side ? null : (
        <div class="line">
          <div class="line-top">
            <SearchPicker value={l.yarn_id} onChange={(v) => setLine(i, { yarn_id: v })} options={opts} label={`${side} yarn`} placeholder={`Choose ${side} yarn`} title={`Choose ${side} yarn`} searchHint="Search yarns, e.g. 75D or TPM 2000" />
            <IconButton label={`Remove ${side} yarn`} onClick={() => removeLine(i)}><span class="bad"><Icon.trash size={20} /></span></IconButton>
          </div>
          <div class="line-bottom">
            {side === 'warp' ? (
              <label class="mini"><span>Ends</span><input inputmode="numeric" value={l.ends ?? ''} onInput={(e) => setLine(i, { ends: e.currentTarget.value })} aria-label="Ends" /></label>
            ) : (
              <>
                <label class="mini share"><span>Share</span><input inputmode="decimal" value={l.parts ?? ''} onInput={(e) => setLine(i, { parts: e.currentTarget.value })} aria-label="Pick share" /></label>
                <label class="mini"><span>Pattern</span><input value={l.pattern ?? ''} placeholder="2S:2Z" onInput={(e) => setLine(i, { pattern: e.currentTarget.value })} aria-label="Pattern" /></label>
              </>
            )}
            <LineOut calc={preview} line={l} index={i} lines={lines} />
          </div>
        </div>
      ),
    );

  const units = Object.values(idx.unitsById).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return (
    <div class="no-tabs-pad">
      <NavBar
        title={existing ? 'Edit fabric' : 'New fabric'}
        left={<TextButton onClick={() => back(existing ? `/fabric/${id}` : '/fabrics')}>Cancel</TextButton>}
        right={<TextButton bold onClick={save} disabled={busy} title="Save (Ctrl+S)">{busy ? 'Saving…' : 'Save'}</TextButton>}
      />
      <Section header="Identity" footer={String(f.name || '').trim() ? `Shown as ${fabricLabel(f)}.` : 'Type the quality without the RS; the app adds it.'}>
        <Field label="Quality name" required value={f.name} onInput={up('name')} placeholder="e.g. Natural Crape" autofocus={!existing} />
        <div class="row"><div class="fill"><Segmented label="Weave" options={WEAVES} value={f.weave} onChange={up('weave')} /></div></div>
        <Field label="Design note" value={f.design_note} onInput={up('design_note')} placeholder="e.g. 2/1 twill" />
        <Field label="End use" value={f.end_use} onInput={up('end_use')} placeholder="Optional" />
      </Section>

      <Section header="Construction" footer="Shortage % covers crimp and wastage.">
        <NumField label="Reed" value={f.reed} onInput={up('reed')} placeholder="optional" />
        <NumField label="Pick (PPI)" required value={f.ppi} onInput={up('ppi')} />
        <NumField label="Reed space" required value={f.reed_space_in} onInput={up('reed_space_in')} suffix="in" />
        <NumField label="Greige width" value={f.greige_width_in} onInput={up('greige_width_in')} suffix="in" placeholder="optional" />
        <NumField label="Warp shortage" required value={f.warp_shortage_pct} onInput={up('warp_shortage_pct')} suffix="%" />
        <NumField label="Weft shortage" required value={f.weft_shortage_pct} onInput={up('weft_shortage_pct')} suffix="%" />
      </Section>

      <Section header={`Warp · ${preview.totalEnds ? `${fmt.int(preview.totalEnds)} ends` : 'ends'}`}>
        {lineBlock('warp')}
        <button type="button" class="add-row" onClick={() => addLine('warp')}><Icon.plus size={20} />Add warp yarn</button>
      </Section>

      <Section header="Weft" footer="Pick share splits picks between weft yarns." guide="edit-fabric">
        {lineBlock('weft')}
        <button type="button" class="add-row" onClick={() => addLine('weft')}><Icon.plus size={20} />Add weft yarn</button>
      </Section>
      {!opts.length ? <p class="section-footer">No yarns yet. Add them in the Yarns tab first.</p> : null}

      <Section header="Price and finishing" footer="A new selling price dates the sale today." guide="edit-fabric">
        <div class="row"><div class="fill"><Segmented label="Finish" options={['Greige', 'RFD']} value={f.finish === 'RFD' ? 'RFD' : 'Greige'} onChange={up('finish')} /></div></div>
        <NumField label="Selling price" hint={rfd ? 'per RFD m' : 'per m'} prefix="₹" value={f.price} onInput={setPrice} />
        <Field label="Sale date" hint={saleAuto ? 'today, price changed' : 'last sale'} type="date" value={String(f.sale_date || '').slice(0, 10)} onInput={(v) => { setSaleTouched(true); up('sale_date')(v); }} />
        <NumField label="VATAV" hint="discount" value={f.vatav_pct} onInput={up('vatav_pct')} suffix="%" placeholder="0" />
        {rfd ? (
          <>
            <NumField label="RFD shortage" hint="shrinkage" value={f.rfd_shortage_pct} onInput={up('rfd_shortage_pct')} suffix="%" />
            <NumField label="Processing charge" hint="per m" prefix="₹" value={f.processing_charge} onInput={up('processing_charge')} />
            <NumField label="Transportation" hint="per RFD m" prefix="₹" value={f.transport_charge} onInput={up('transport_charge')} placeholder="optional" />
            <NumField label="Brokering" value={f.brokering_pct} onInput={up('brokering_pct')} suffix="%" />
          </>
        ) : null}
      </Section>

      <Section header="Loom" footer="Loom efficiency is set on each unit." guide="edit-fabric">
        <NumField label="Loom RPM (single panna)" value={f.loom_rpm} onInput={up('loom_rpm')} placeholder="not set" />
        <NumField label="Loom RPM (double panna)" value={f.loom_rpm_dp} onInput={up('loom_rpm_dp')} placeholder="optional" />
      </Section>

      <Section header="Units">
        {units.map((u) => (
          <Row label={u.name} sub={`${u.type || 'Unit'} · ${fmt.pick(num(u.cost_per_pick))} / pick`} onClick={() => setUnitIds((s) => (s.includes(u.id) ? s.filter((x) => x !== u.id) : [...s, u.id]))} value={unitIds.includes(u.id) ? <span class="accent-text"><Icon.check size={20} /></span> : ''} />
        ))}
        {!units.length ? <Row label="No units yet" sub="Add units in the Units tab." /> : null}
      </Section>

      <Section header="Beam length" footer="Metres, per loom width of the units above." guide="edit-fabric">
        {slots.map((slot) => (
          <NumField key={slot.key} label={slotLabelIn(slot.unit, slot)} value={slotValue(slot)} onInput={(v) => setBeams((m) => ({ ...m, ...Object.fromEntries(slot.groupIds.map((g) => [g, v])) }))} suffix="m" placeholder="not set" />
        ))}
        {unitIds.length && !slots.length ? <Row label="No matching loom group" sub={String(f.weave).toLowerCase() === 'dobby' ? 'A dobby quality needs a dobby loom group in its units.' : 'Add loom groups to its units.'} /> : null}
        {!unitIds.length ? <Row label="Pick a unit first" sub="Beam lengths are per loom group of its units." /> : null}
      </Section>

      {preview.missing.length ? <p class="section-footer">Still needed for every figure: {preview.missing.join(', ')}.</p> : null}

      <div class="result-bar" aria-live="polite">
        <div class="result-inner">
          <div><div class="r-label">GSM</div><div class="r-value">{fmt.n(preview.gsm, 1)}</div></div>
          <div><div class="r-label">{rfd ? 'RFD cost' : 'RM cost'}</div><div class="r-value">{fmt.rs(rfd ? preview.rfdCost : preview.rmCost)}</div></div>
          <div><div class="r-label">₹/pick w/o</div><div class="r-value">{fmt.pick(preview.realisationPerPick)}</div></div>
          <div><div class="r-label">With VATAV</div><div class="r-value accent">{fmt.pick(preview.realisationNetPerPick)}</div></div>
        </div>
      </div>
    </div>
  );
}

function LineOut({ calc, line, index, lines }) {
  // match the preview row for this line by position among lines with a yarn
  const side = line.side;
  const sideLines = lines.filter((l) => l.side === side && l.yarn_id);
  const pos = sideLines.indexOf(line);
  const x = pos >= 0 ? calc[side][pos] : null;
  return (
    <div class="mini-out">
      <span>{x && x.gpm !== null ? `${fmt.n(x.gpm, 1)} g/m` : '— g/m'}</span>
      <span>{x && x.costPerM !== null ? `${fmt.rs(x.costPerM)}/m` : ''}</span>
    </div>
  );
}
