import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { baseFabric, buildIndex, fabricCalc, fabricLabel, fmt, loomPerDay, num, spindlesForUnit, truthy, unitHasTfo, unitProfit, TFO_CLASSES } from '../calc.js';
import { constructionLine, unitsOf, yarnOptions, yarnShort } from '../describe.js';
import {
  addPhoto, backendMode, deleteFabric, deletePhoto, duplicateFabric, fabricPlanCount, duplicateForRs, getIndex, rsCopyPlan, getState, refresh, saveFabric, savedFilters, setAssignments, setCover, toast, useStore,
} from '../store.js';
import { back, go, replace } from '../router.js';
import { Badge, Button, Chip, Empty, Field, Icon, IconButton, NavBar, NumField, PhotoImg, Row, SearchBox, Section, Segmented, Sheet, Swatch, TextButton, Toggle, classBadge, useWide, BrandHero, History } from '../ui.jsx';
import { exportFabricPdf, exportFabricXlsx, exportListXlsx, openWhatsAppText, preloadExports, whatsappText } from '../export/exports.js';

const WEAVES = ['Plain', 'Cam', 'Dobby'];
const SORTS = [
  { value: 'realisation', label: 'Realisation ↓' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'gsm', label: 'GSM ↑' },
  { value: 'recent', label: 'Recent' },
];

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
    rows.push({ fabric: f, calc, units, profit: unit ? unitProfit(calc, unit) : null });
  }
  const byNull = (v) => (v === null || v === undefined ? -Infinity : v);
  const sorters = {
    realisation: (a, b) => byNull(b.calc.realisationNetPerPick) - byNull(a.calc.realisationNetPerPick),
    name: (a, b) => String(a.fabric.name).localeCompare(String(b.fabric.name)),
    gsm: (a, b) => (a.calc.gsm ?? Infinity) - (b.calc.gsm ?? Infinity),
    recent: (a, b) => String(b.fabric.updated_at || '').localeCompare(String(a.fabric.updated_at || '')),
  };
  rows.sort(sorters[filters.sort] || sorters.realisation);
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
    </div>
  );
}

export function FabricRow({ row, idx, unit, onClick }) {
  const cover = coverOf(row.fabric.id, idx);
  return (
    <button type="button" class="frow" onClick={onClick}>
      <div class="thumb">{cover ? <PhotoImg photo={cover} size="thumb" /> : <Swatch seed={row.fabric.id} />}</div>
      <div class="row-main">
        <div class="fname">{row.fabric.name || 'Untitled'}</div>
        <div class="fcon">{constructionLine(row.fabric, row.calc, idx)}</div>
        <FabricBadges fabric={row.fabric} calc={row.calc} />
      </div>
      <div class="fval">
        <div class="big">{fmt.pick(row.calc.realisationNetPerPick)}</div>
        {unit && row.profit ? (
          <div class={`small ${row.profit.profitPerPick === null ? '' : row.profit.profitPerPick >= 0 ? 'good' : 'bad'}`}>{fmt.signedPick(row.profit.profitPerPick)} profit</div>
        ) : row.calc.vatavPct ? (
          <div class="small">{fmt.pick(row.calc.realisationPerPick)} without</div>
        ) : (
          <div class="small">per pick</div>
        )}
      </div>
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
  { key: 'price', label: 'Price ₹/m', get: (r) => r.calc.price, show: (r) => fmt.n(r.calc.price, 2) },
  { key: 'vatav', label: 'VATAV', get: (r) => r.calc.vatavPct, show: (r) => (r.calc.vatavPct ? `${fmt.n(r.calc.vatavPct, r.calc.vatavPct % 1 ? 1 : 0)}%` : '—') },
  { key: 'rw', label: '₹/pick without', title: 'Realisation per pick without VATAV', get: (r) => r.calc.realisationPerPick, show: (r) => fmt.pick(r.calc.realisationPerPick) },
  { key: 'rn', label: '₹/pick with VATAV', title: 'Realisation per pick with VATAV', get: (r) => r.calc.realisationNetPerPick, show: (r) => fmt.pick(r.calc.realisationNetPerPick), strong: true },
];
const PROFIT_COL = { key: 'profit', label: 'Profit ₹/pick', get: (r) => (r.profit ? r.profit.profitPerPick : null), show: (r) => fmt.signedPick(r.profit ? r.profit.profitPerPick : null), profit: true };

export function FabricTable({ rows, idx, unit }) {
  const [sort, setSort] = useState(null);
  const cols = unit ? [...TABLE_COLS, PROFIT_COL] : TABLE_COLS;
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = cols.find((c) => c.key === sort.key);
    if (!col) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
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
                        <div class="tthumb">{cover ? <PhotoImg photo={cover} size="thumb" /> : <Swatch seed={r.fabric.id} size={36} radius={7} />}</div>
                        <div style={{ minWidth: 0 }}>
                          <div class="tname">{r.fabric.name || 'Untitled'}</div>
                          <div class="tmeta">{[r.fabric.weave, r.calc.tfoClass, r.calc.finish].filter(Boolean).join(' · ')}</div>
                        </div>
                      </div>
                    </td>
                  ) : (
                    <td class={`${c.opt ? 'opt' : ''} ${c.strong ? 'key' : ''} ${c.profit && r.profit && r.profit.profitPerPick !== null ? (r.profit.profitPerPick >= 0 ? 'good strong' : 'bad strong') : ''}`}>{c.show(r)}</td>
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
  const [search, setSearch] = useState('');
  const [unitId, setUnitId] = useState(query.unit || 'all');
  const [filters, setFilters] = useState(defaultFilters());
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (query.unit) setUnitId(query.unit);
  }, [query.unit]);
  const units = (st.tables.Units || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const unit = unitId !== 'all' ? idx.unitsById[unitId] : null;
  const rows = useMemo(() => computeRows(idx, { search, unitId, filters }), [idx, search, unitId, filters]);
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
        left={<IconButton label="Settings" onClick={() => go('/settings')}><Icon.gear /></IconButton>}
        right={
          <>
            <IconButton label="Export list to Excel" onClick={exportList} disabled={busy || !rows.length}><Icon.share /></IconButton>
            <IconButton label="Filters" onClick={() => setSheet(true)}><Icon.filter /></IconButton>
            <IconButton label="Add fabric" onClick={() => go('/fabric/new')}><Icon.plus size={26} /></IconButton>
          </>
        }
      />
      <StatusBanner />
      <div class="stack" style={{ padding: 0, gap: '10px', marginTop: '10px' }}>
        <SearchBox value={search} onInput={setSearch} placeholder="Search quality or yarn" />
        <div class="pad">
          {unitOptions.length <= 4 ? (
            <Segmented small label="Unit" options={unitOptions} value={unitId} onChange={setUnitId} />
          ) : (
            <div class="chips" style={{ padding: 0 }}>
              {unitOptions.map((o) => <Chip on={unitId === o.value} onClick={() => setUnitId(o.value)}>{o.label}</Chip>)}
            </div>
          )}
        </div>
        <div class="chips">
          <Chip on onClick={() => setSheet(true)}>{(SORTS.find((s) => s.value === filters.sort) || SORTS[0]).label}</Chip>
          <Chip on={nActive > 0} onClick={() => setSheet(true)}>{nActive ? `Filters · ${nActive}` : 'Filters'}</Chip>
          {WEAVES.map((w) => (
            <Chip on={filters.weaves.includes(w)} onClick={() => setFilters({ ...filters, weaves: toggleIn(filters.weaves, w) })}>{w}</Chip>
          ))}
          <Chip on={filters.finish === 'RFD'} onClick={() => setFilters({ ...filters, finish: filters.finish === 'RFD' ? '' : 'RFD' })}>RFD</Chip>
          <Chip on={filters.classes.includes('TPM × TPM')} onClick={() => setFilters({ ...filters, classes: toggleIn(filters.classes, 'TPM × TPM') })}>TPM × TPM</Chip>
        </div>
      </div>
      <div class="list-meta">
        <span>{rows.length} {rows.length === 1 ? 'fabric' : 'fabrics'} · {unit ? unit.name : 'all units'}</span>
        <span>{wide ? 'Click a heading to sort · press / to search' : '₹ / pick with VATAV'}</span>
      </div>
      {rows.length ? (
        wide ? (
          <FabricTable rows={rows} idx={idx} unit={unit} />
        ) : (
          <div class="group">
            {rows.map((r) => <FabricRow row={r} idx={idx} unit={unit} onClick={() => go(`/fabric/${r.fabric.id}`)} />)}
          </div>
        )
      ) : st.status.loading ? (
        <Empty title="Loading…" />
      ) : (
        <Empty
          title={Object.keys(idx.fabricsById).length ? 'No fabrics match' : 'No fabrics yet'}
          text={Object.keys(idx.fabricsById).length ? 'Change the search, unit or filters.' : 'Add your first fabric. Add yarns first so you can pick them for warp and weft.'}
          action={Object.keys(idx.fabricsById).length ? null : <div style={{ width: '220px' }}><Button onClick={() => go('/fabric/new')}>Add fabric</Button></div>}
        />
      )}
      <FilterSheet open={sheet} onClose={() => setSheet(false)} filters={filters} setFilters={setFilters} idx={idx} count={rows.length} />
    </div>
  );
}

export function StatusBanner() {
  const st = useStore();
  if (st.status.error) {
    return (
      <div class="banner error">
        <span>{st.status.error}{st.status.lastSync ? ' Showing the last saved copy.' : ''}</span>
        <button type="button" onClick={() => refresh()}>Retry</button>
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

function FilterSheet({ open, onClose, filters, setFilters, idx, count }) {
  const [saved, setSaved] = useState(savedFilters.list());
  const f = filters;
  const up = (patch) => setFilters({ ...f, ...patch });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Sort and filter"
      footer={
        <div style={{ display: 'flex', gap: '10px' }}>
          <Button kind="secondary" onClick={() => setFilters(defaultFilters())}>Reset</Button>
          <Button onClick={onClose}>Show {count}</Button>
        </div>
      }
    >
      {saved.length ? (
        <Section header="Saved filters">
          {saved.map((s) => (
            <div class="row">
              <button type="button" class="row-main" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => { setFilters({ ...defaultFilters(), ...s.filters }); toast(`Applied “${s.name}”`); }}>
                <div class="row-label">{s.name}</div>
              </button>
              <TextButton danger onClick={() => { savedFilters.remove(s.name); setSaved(savedFilters.list()); }}>Remove</TextButton>
            </div>
          ))}
        </Section>
      ) : null}
      <Section header="Sort by">
        <div class="pad" style={{ padding: '10px 12px' }}>
          <Segmented small options={SORTS.map((s) => ({ value: s.value, label: s.label.replace(' ↓', '').replace(' ↑', '') }))} value={f.sort} onChange={(v) => up({ sort: v })} />
        </div>
      </Section>
      <Section header="Weave">
        <div class="chips" style={{ padding: '10px 12px' }}>{WEAVES.map((w) => <Chip on={f.weaves.includes(w)} onClick={() => up({ weaves: toggleIn(f.weaves, w) })}>{w}</Chip>)}</div>
      </Section>
      <Section header="TFO class">
        <div class="chips" style={{ padding: '10px 12px', flexWrap: 'wrap' }}>{TFO_CLASSES.map((c) => <Chip on={f.classes.includes(c)} onClick={() => up({ classes: toggleIn(f.classes, c) })}>{c}</Chip>)}</div>
      </Section>
      <Section header="Finish and loom type">
        <div class="chips" style={{ padding: '10px 12px', flexWrap: 'wrap' }}>
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
      <div style={{ display: 'flex', gap: '8px', width: '62%' }}>
        <label class="mini"><span>Min</span><input inputmode="decimal" value={min} onInput={(e) => onChange(e.currentTarget.value, max)} aria-label={`${label} minimum`} /></label>
        <label class="mini"><span>Max</span><input inputmode="decimal" value={max} onInput={(e) => onChange(min, e.currentTarget.value)} aria-label={`${label} maximum`} /></label>
      </div>
    </div>
  );
}

// ---------------- detail ----------------
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
  if (!fabric) {
    return (
      <div>
        <NavBar title="Fabric" backLabel="Fabrics" backTo="/fabrics" />
        <Empty title="Fabric not found" text="It may have been deleted." />
      </div>
    );
  }
  const calc = fabricCalc(fabric, idx);
  const photos = idx.photosByFabric[id] || [];
  const units = unitsOf(id, idx);
  const rfd = calc.finish === 'RFD';

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

  return (
    <div>
      <NavBar
        title={fabric.name}
        backLabel="Fabrics"
        backTo="/fabrics"
        right={
          <>
            <IconButton label="Export" onClick={() => setExportOpen(true)}><Icon.share /></IconButton>
            <TextButton onClick={() => go(`/fabric/${id}/edit`)}>Edit</TextButton>
          </>
        }
      />
      <div class="detail-cols">
      <div class="col">
      <div class="hero">
        {photos.length ? (
          <div class="carousel" onScroll={(e) => setSlide(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}>
            {photos.map((p) => (
              <button type="button" class="slide" onClick={() => setViewer(p)} aria-label="Open photo">
                <PhotoImg photo={p} size="full" alt={fabric.name} />
              </button>
            ))}
          </div>
        ) : (
          <Swatch seed={id} size="100%" radius={0} />
        )}
        <button type="button" class="hero-add" onClick={() => fileRef.current && fileRef.current.click()} disabled={uploading}>
          {uploading ? <span class="spinner" aria-hidden="true" /> : <Icon.camera size={18} />}
          {uploading ? 'Uploading' : 'Add photo'}
        </button>
        <input ref={fileRef} class="hidden-input" type="file" accept="image/*" multiple onChange={onFiles} aria-label="Add photo" />
        {photos.length ? <span class="pill" style={{ right: '10px' }}>{Math.min(slide + 1, photos.length)} / {photos.length}</span> : <span class="pill" style={{ left: '10px' }}>No photos yet</span>}
      </div>

      <div class="title-block">
        <h1>{fabric.name}</h1>
        <div class="title-sub">{[fabric.weave, fabric.design_note, fabric.end_use].filter(Boolean).join(' · ') || 'No weave or end use set'}</div>
        <FabricBadges fabric={fabric} calc={calc} />
      </div>

      {calc.missing.length ? <div class="notice">To see every figure, add: {calc.missing.join(', ')}.</div> : null}

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
          <div class="t-label">{rfd ? 'RFD cost' : 'RM cost'}</div>
          <div class="t-value">{fmt.rs(rfd ? calc.rfdCost : calc.rmCost)}</div>
          <div class="t-sub">{rfd ? 'per RFD metre' : 'per metre'}</div>
        </div>
        <div class="tile">
          <div class="t-label">VATAV</div>
          <div class="t-value">{calc.vatavPct ? `${fmt.n(calc.vatavPct, calc.vatavPct % 1 ? 1 : 0)}%` : 'None'}</div>
          <div class="t-sub">{calc.vatavPct ? `${fmt.rs(calc.vatavAmount)} off per ${rfd ? 'RFD m' : 'm'}` : 'no discount set'}</div>
        </div>
        <div class="tile">
          <div class="t-label">GSM</div>
          <div class="t-value">{fmt.n(calc.gsm, 1)}</div>
          <div class="t-sub">estimate, greige</div>
        </div>
        <div class="tile">
          <div class="t-label">Consumption</div>
          <div class="t-value">{calc.totalGpm === null ? '—' : `${fmt.n(calc.totalGpm, 1)} g/m`}</div>
          <div class="t-sub">{calc.kgPer100 === null ? '—' : `${fmt.n(calc.kgPer100, 2)} kg per 100 m`}</div>
        </div>
      </div>

      <Section header="Construction">
        <Row label="Reed" value={fabric.reed || '—'} />
        <Row label="Pick (PPI)" value={calc.ppi ?? '—'} />
        <Row label="Total ends" value={calc.totalEnds === null ? '—' : fmt.int(calc.totalEnds)} />
        <Row label="Reed space" value={calc.rs ? `${calc.rs}″` : '—'} />
        <Row label="Greige width" value={calc.width ? `${calc.width}″` : '—'} />
        <Row label="Warp shortage" value={fabric.warp_shortage_pct !== '' && fabric.warp_shortage_pct !== undefined ? `${fabric.warp_shortage_pct}%` : '—'} />
        <Row label="Weft shortage" value={fabric.weft_shortage_pct !== '' && fabric.weft_shortage_pct !== undefined ? `${fabric.weft_shortage_pct}%` : '—'} />
        <Row label="Loom RPM (single panna)" value={num(fabric.loom_rpm) ? fmt.int(num(fabric.loom_rpm)) : '—'} />
        <Row label="Loom RPM (double panna)" value={num(fabric.loom_rpm_dp) ? fmt.int(num(fabric.loom_rpm_dp)) : '—'} />
      </Section>
      </div>

      <div class="col">
      <Section header="Warp and weft" footer={calc.rmCost !== null ? `RM cost ${fmt.rs(calc.rmCost)} per greige metre, shortage included.` : null}>
        {[...calc.warp, ...calc.weft].map((x) => (
          <Row
            label={x.yarn ? x.yarn.name : 'Yarn missing'}
            sub={x.line.side === 'warp' ? `Warp · ${x.ends ? fmt.int(x.ends) : '—'} ends · ${x.rate !== null ? `${fmt.rate(x.rate)}/kg` : 'no rate'}` : `Weft${x.line.pattern ? ` · ${x.line.pattern}` : ''}${calc.weft.length > 1 ? ` · ${Math.round(x.share * 100)}% of picks` : ''} · ${x.rate !== null ? `${fmt.rate(x.rate)}/kg` : 'no rate'}`}
            value={x.gpm === null ? '—' : <span class="strong">{fmt.n(x.gpm, 1)} g/m</span>}
            valueSub={x.gpm === null ? null : `${fmt.n(x.kgPer100, 2)} kg/100 m · ${fmt.rs(x.costPerM)}/m`}
          />
        ))}
        {!calc.warp.length && !calc.weft.length ? <Row label="No yarns yet" sub="Edit the fabric to add warp and weft yarns." /> : null}
      </Section>

      {rfd ? (
        <Section header="Finishing · RFD">
          <Row label="Selling price" value={`${fmt.rs(calc.price)} / RFD m`} />
          <Row label="RFD shortage" value={fabric.rfd_shortage_pct !== '' && fabric.rfd_shortage_pct !== undefined ? `${fabric.rfd_shortage_pct}%` : '—'} />
          <Row label="Processing charge" value={`${fmt.rs(num(fabric.processing_charge))} / m`} />
          <Row label="Brokering" value={`${num(fabric.brokering_pct) ?? 0}%`} />
          <Row label="RM cost per RFD m" value={fmt.rs(calc.rmPerSaleM)} />
          <Row label="Finishing cost" value={fmt.rs(calc.finishingCost)} />
          <Row label="RFD cost" strong value={<span class="strong">{fmt.rs(calc.rfdCost)} / m</span>} />
          <Row label="Realisation without VATAV" value={<span class="strong">{fmt.pick(calc.realisationPerPick)} / pick</span>} valueSub={`${fmt.rs(calc.realisationPerM)} / RFD m`} />
          <Row label="VATAV" value={calc.vatavPct ? `${calc.vatavPct}% · −${fmt.rs(calc.vatavAmount)} / m` : 'None'} />
          <Row label="Realisation with VATAV" strong value={<span class="strong accent-text">{fmt.pick(calc.realisationNetPerPick)} / pick</span>} valueSub={`${fmt.rs(calc.realisationNetPerM)} / RFD m`} />
        </Section>
      ) : (
        <Section header="Greige">
          <Row label="Selling price" value={`${fmt.rs(calc.price)} / m`} />
          <Row label="RM cost" value={`${fmt.rs(calc.rmCost)} / m`} />
          <Row label="Realisation without VATAV" value={<span class="strong">{fmt.pick(calc.realisationPerPick)} / pick</span>} valueSub={`${fmt.rs(calc.realisationPerM)} / m`} />
          <Row label="VATAV" value={calc.vatavPct ? `${calc.vatavPct}% · −${fmt.rs(calc.vatavAmount)} / m` : 'None'} />
          <Row label="Realisation with VATAV" strong value={<span class="strong accent-text">{fmt.pick(calc.realisationNetPerPick)} / pick</span>} valueSub={`${fmt.rs(calc.realisationNetPerM)} / m`} />
        </Section>
      )}

      <Section header="Units · profit per pick" footer={`Profit per pick uses realisation with VATAV. ${calc.tpmLines.length && units.some((u) => truthy(u.has_tfo)) ? 'Spindles are per loom, for each TFO type of the unit.' : 'Warp and weft kg are per loom per day.'} Double panna weaves two widths on one loom.`}>
        {units.map((u) => <UnitCard unit={u} fabric={fabric} calc={calc} idx={idx} />)}
        {!units.length ? <Row label="Not in any unit yet" sub="Assign it to see profit per pick and spindles." /> : null}
        <button type="button" class="add-row" onClick={() => setAssignOpen(true)}><Icon.plus size={20} />{units.length ? 'Change units' : 'Assign to units'}</button>
      </Section>

      <History row={fabric} added what="fabric" />

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
        <Button kind="danger" onClick={async () => {
          const inPlans = fabricPlanCount(fabric.id);
          if (!window.confirm(`Delete ${fabric.name}? This removes it from the Sheet, with its yarn lines, unit links and photos.${inPlans ? ` It is also taken out of ${inPlans} TFO ${inPlans === 1 ? 'plan' : 'plans'}.` : ''}`)) return;
          try {
            await deleteFabric(id);
            replace('/fabrics');
          } catch (e) {
            toast(e.message, 'error');
          }
        }}><Icon.trash size={20} /> Delete fabric</Button>
      </div>
      </div>
      </div>

      <ExportSheet open={exportOpen} onClose={() => setExportOpen(false)} fabric={fabric} calc={calc} idx={idx} />
      <AssignSheet open={assignOpen} onClose={() => setAssignOpen(false)} fabric={fabric} idx={idx} />
      <PhotoSheet photo={viewer} onClose={() => setViewer(null)} />
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
  return (
    <div class="unit-card">
      <div class="unit-head">
        <div style={{ minWidth: 0 }}>
          <div class="row-label strong">{unit.name}</div>
          <div class="row-sub">{unit.type || 'Unit'} · cost {fmt.pick(p.costPerPick)} / pick{tfoNote ? ` · ${tfoNote}` : ''}</div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div class={`row-label strong tnum ${p.profitPerPick === null ? '' : p.profitPerPick >= 0 ? 'good' : 'bad'}`}>{fmt.signedPick(p.profitPerPick)} / pick</div>
          <div class="row-sub tnum">{p.profitPerM === null ? '—' : `${fmt.rs(p.profitPerM)} / ${calc.finish === 'RFD' ? 'RFD m' : 'm'}`}</div>
        </div>
      </div>
      <PanBlocks calc={calc} fabric={fabric} unit={unit} idx={idx} />
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
                {showNote && s.total !== null ? <div class="s-note">{s.perYarn.map((p) => `${p.side} ${fmt.int(p.spindles)}`).join(' + ')}</div> : null}
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
                <Row label="Name" value={fabricLabel({ name: plan.name, reed_space_in: newRs })} />
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
          if (!window.confirm('Delete this photo?')) return;
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

function ExportSheet({ open, onClose, fabric, calc, idx }) {
  const [toDrive, setToDrive] = useState(backendMode() === 'sheet');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (open) preloadExports().catch(() => {});
  }, [open]);
  const text = whatsappText(fabric, calc, idx);
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
  return (
    <Sheet open={open} onClose={onClose} title="Export">
      <Section header={`${fabric.name} · ${calc.finish}`}>
        <Row label="PDF spec sheet" sub="Photo, construction, consumption, finishing, realisation" onClick={() => run('pdf', () => exportFabricPdf(fabric, calc, idx, { toDrive: sheetMode && toDrive }))} value={busy === 'pdf' ? <span class="spinner" /> : undefined} chevron={busy !== 'pdf'} />
        <Row label="WhatsApp message" sub="Opens WhatsApp with the text below" onClick={() => openWhatsAppText(text)} chevron />
        <Row label="Excel sheet" sub="Construction, consumption and cost breakdown" onClick={() => run('xlsx', () => exportFabricXlsx(fabric, calc, idx, { toDrive: sheetMode && toDrive }))} value={busy === 'xlsx' ? <span class="spinner" /> : undefined} chevron={busy !== 'xlsx'} />
        <Row label="Copy text" sub="Paste it anywhere" onClick={async () => {
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
const blankFabric = () => ({ name: '', weave: 'Plain', design_note: '', end_use: '', reed: '', ppi: '', reed_space_in: '', greige_width_in: '', warp_shortage_pct: '', weft_shortage_pct: '', price: '', vatav_pct: '', finish: 'Greige', rfd_shortage_pct: '', processing_charge: '', brokering_pct: '', loom_rpm: '', loom_rpm_dp: '', loom_eff_pct: '', notes: '' });

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
  const [busy, setBusy] = useState(false);
  const up = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  const tempId = existing ? existing.id : '__new__';
  const preview = useMemo(() => {
    const t = getState().tables;
    const fab = { ...f, id: tempId };
    const ls = lines.filter((l) => l.yarn_id).map((l, i) => ({ ...l, id: l.id || `tmp${i}`, fabric_id: tempId, sort: i }));
    const tIdx = buildIndex({ ...t, Fabrics: [...(t.Fabrics || []).filter((x) => x.id !== tempId), fab], FabricYarns: [...(t.FabricYarns || []).filter((x) => x.fabric_id !== tempId), ...ls] });
    return fabricCalc(fab, tIdx);
  }, [f, lines, st.tables]);

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
      const fid = await saveFabric({ ...f, name: f.name.trim() }, clean, unitIds);
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
            <select value={l.yarn_id} onChange={(e) => setLine(i, { yarn_id: e.currentTarget.value })} aria-label={`${side} yarn`}>
              <option value="">Choose {side} yarn</option>
              {opts.map((g) => <optgroup label={g.group}>{g.options.map((o) => <option value={o.value}>{o.label}</option>)}</optgroup>)}
            </select>
            <IconButton label={`Remove ${side} yarn`} onClick={() => removeLine(i)}><span class="bad"><Icon.trash size={20} /></span></IconButton>
          </div>
          <div class="line-bottom">
            {side === 'warp' ? (
              <label class="mini"><span>Ends</span><input inputmode="numeric" value={l.ends ?? ''} onInput={(e) => setLine(i, { ends: e.currentTarget.value })} aria-label="Ends" /></label>
            ) : (
              <>
                <label class="mini" style={{ flex: '0 0 88px' }}><span>Share</span><input inputmode="decimal" value={l.parts ?? ''} onInput={(e) => setLine(i, { parts: e.currentTarget.value })} aria-label="Pick share" /></label>
                <label class="mini"><span>Pattern</span><input value={l.pattern ?? ''} placeholder="2S:2Z" onInput={(e) => setLine(i, { pattern: e.currentTarget.value })} aria-label="Pattern" style={{ textAlign: 'right' }} /></label>
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
        right={<TextButton bold onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</TextButton>}
      />
      <Section header="Identity" footer={String(f.name || '').trim() ? `Shown as ${fabricLabel(f)}. The RS is added to the name automatically.` : 'Enter the quality without the RS. The RS is added to the name automatically.'}>
        <Field label="Quality name" required value={f.name} onInput={up('name')} placeholder="e.g. Natural Crape" autofocus={!existing} />
        <div class="row"><div style={{ width: '100%' }}><Segmented label="Weave" options={WEAVES} value={f.weave} onChange={up('weave')} /></div></div>
        <Field label="Design note" value={f.design_note} onInput={up('design_note')} placeholder="e.g. 2/1 twill" />
        <Field label="End use" value={f.end_use} onInput={up('end_use')} placeholder="Optional" />
      </Section>

      <Section header="Construction" footer="Shortage % covers crimp and wastage, entered separately for warp and weft.">
        <NumField label="Reed" hint="optional" value={f.reed} onInput={up('reed')} />
        <NumField label="Pick (PPI)" required value={f.ppi} onInput={up('ppi')} />
        <NumField label="Reed space" required value={f.reed_space_in} onInput={up('reed_space_in')} suffix="in" />
        <NumField label="Greige width" value={f.greige_width_in} onInput={up('greige_width_in')} suffix="in" />
        <NumField label="Warp shortage" required value={f.warp_shortage_pct} onInput={up('warp_shortage_pct')} suffix="%" />
        <NumField label="Weft shortage" required value={f.weft_shortage_pct} onInput={up('weft_shortage_pct')} suffix="%" />
      </Section>

      <Section header={`Warp · ${preview.totalEnds ? `${fmt.int(preview.totalEnds)} ends` : 'ends'}`}>
        {lineBlock('warp')}
        <button type="button" class="add-row" onClick={() => addLine('warp')}><Icon.plus size={20} />Add warp yarn</button>
      </Section>

      <Section header="Weft" footer="Pick share splits picks between weft yarns, e.g. 1 and 1 for alternate picks. One weft yarn takes all picks.">
        {lineBlock('weft')}
        <button type="button" class="add-row" onClick={() => addLine('weft')}><Icon.plus size={20} />Add weft yarn</button>
      </Section>
      {!opts.length ? <p class="section-footer">No yarns yet. Add them in the Yarns tab first.</p> : null}

      <Section header="Price and finishing" footer={rfd ? 'For RFD the selling price is per RFD metre. VATAV is the discount off that price. Shrinkage grosses up RM and processing; brokering is taken on the full selling price.' : 'VATAV is the discount off the selling price. Leave it blank if there is none.'}>
        <div class="row"><div style={{ width: '100%' }}><Segmented label="Finish" options={['Greige', 'RFD']} value={f.finish === 'RFD' ? 'RFD' : 'Greige'} onChange={up('finish')} /></div></div>
        <NumField label="Selling price" hint={rfd ? 'per RFD m' : 'per m'} prefix="₹" value={f.price} onInput={up('price')} />
        <NumField label="VATAV" hint="discount" value={f.vatav_pct} onInput={up('vatav_pct')} suffix="%" placeholder="0" />
        {rfd ? (
          <>
            <NumField label="RFD shortage" hint="shrinkage" value={f.rfd_shortage_pct} onInput={up('rfd_shortage_pct')} suffix="%" />
            <NumField label="Processing charge" hint="per m" prefix="₹" value={f.processing_charge} onInput={up('processing_charge')} />
            <NumField label="Brokering" value={f.brokering_pct} onInput={up('brokering_pct')} suffix="%" />
          </>
        ) : null}
      </Section>

      <Section header="Loom" footer="Used for spindles, or warp and weft kg, per loom per day. Double panna weaves two widths on one loom. Loom efficiency is set on each unit.">
        <NumField label="Loom RPM (single panna)" value={f.loom_rpm} onInput={up('loom_rpm')} />
        <NumField label="Loom RPM (double panna)" value={f.loom_rpm_dp} onInput={up('loom_rpm_dp')} />
      </Section>

      <Section header="Units">
        {units.map((u) => (
          <Row label={u.name} sub={`${u.type || 'Unit'} · ${fmt.pick(num(u.cost_per_pick))} / pick`} onClick={() => setUnitIds((s) => (s.includes(u.id) ? s.filter((x) => x !== u.id) : [...s, u.id]))} value={unitIds.includes(u.id) ? <span class="accent-text"><Icon.check size={20} /></span> : ''} />
        ))}
        {!units.length ? <Row label="No units yet" sub="Add units in the Units tab." /> : null}
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
