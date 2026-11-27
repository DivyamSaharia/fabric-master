import { useMemo, useRef, useState } from 'preact/hooks';
import { DEFAULT_TPM_DELTA, fmt, isTpm, num, tempDeltaOf, tempRateOf, tfoEff, tfoOutput, tpmDelta, truthy, yarnDenier, yarnRate } from '../calc.js';
import { SIDES_PER_MACHINE, spindlesPerSide } from '../machines.js';
import { rateLabel, yarnSub } from '../describe.js';
import { clearTempDelta, clearTempRate, deleteRates, deleteYarn, getIndex, saveYarn, toast, useStore, yarnUsage } from '../store.js';
import { today } from '../schema.js';
import { back, go, replace, useLeaveGuard } from '../router.js';
import { askConfirm } from '../confirm.js';
import { Button, Empty, Field, FoldSection, Icon, IconButton, NavBar, NumField, Row, SearchBox, Section, Segmented, SelectField, TextButton, useWide, History } from '../ui.jsx';
import { HelpButton } from './guide.jsx';

function YarnTable({ yarns, idx }) {
  const used = {};
  for (const l of idx.tables.FabricYarns || []) (used[l.yarn_id] ||= new Set()).add(l.fabric_id);
  return (
    <div class="table-wrap">
      <table class="ftable">
        <thead>
          <tr>
            <th class="txt"><span class="th">Yarn</span></th>
            <th class="txt"><span class="th">Kind</span></th>
            <th class="txt opt"><span class="th">Material</span></th>
            <th><span class="th">Denier</span></th>
            <th><span class="th">TPM</span></th>
            <th class="txt"><span class="th">Twist</span></th>
            <th><span class="th">Rate ₹/kg</span></th>
            <th class="txt"><span class="th">Rate basis</span></th>
            <th class="opt"><span class="th">Fabrics</span></th>
          </tr>
        </thead>
        <tbody>
          {yarns.map((y) => {
            const tpm = isTpm(y);
            const r = yarnRate(y, idx);
            const d = yarnDenier(y, idx);
            const open = () => go(`/yarn/${y.id}`);
            return (
              <tr class="click" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); }}>
                <td class="txt"><div class="tname">{y.name}</div></td>
                <td class="txt">{tpm ? 'TPM' : 'Base'}</td>
                <td class="txt opt">{y.material || (tpm && idx.yarnsById[y.base_yarn_id] ? idx.yarnsById[y.base_yarn_id].material : '') || '—'}</td>
                <td>{d ? fmt.n(d, d % 1 ? 1 : 0) : '—'}</td>
                <td>{tpm && num(y.tpm) ? fmt.int(num(y.tpm)) : '—'}</td>
                <td class="txt">{tpm ? y.twist || '—' : '—'}</td>
                <td class="strong">{r ? fmt.n(r.rate, 2) : '—'}{r && r.temp ? <span class="badge amber tag-temp">Temp</span> : null}</td>
                <td class="txt muted">{!r ? 'No rate' : r.tpmTemp ? `temporary${r.masterRate !== null ? `, master ${fmt.rate(r.masterRate)}` : ''}` : r.delta !== undefined ? `base ${fmt.rate(r.baseRate)}${r.temp ? ' (temp)' : ''} + ${fmt.rate(r.delta)}` : r.temp ? `temporary${r.masterRate !== null ? `, master ${fmt.rate(r.masterRate)}` : ''}` : r.date ? `from ${r.date}` : ''}</td>
                <td class="opt">{used[y.id] ? used[y.id].size : 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function YarnList() {
  const st = useStore();
  const idx = getIndex();
  const wide = useWide();
  const [kind, setKind] = useState('all');
  const [search, setSearch] = useState('');
  const yarns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (st.tables.Yarns || [])
      .filter((y) => (kind === 'all' ? true : kind === 'tpm' ? isTpm(y) : !isTpm(y)))
      .filter((y) => !q || [y.name, y.material, y.form].filter(Boolean).join(' ').toLowerCase().includes(q))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [st.tables, kind, search]);
  return (
    <div>
      <NavBar large title="Yarns" left={<HelpButton screen="yarns" />} right={<IconButton label="Add yarn" onClick={() => go(`/yarn/new${kind === 'tpm' ? '?kind=tpm' : ''}`)}><Icon.plus size={26} /></IconButton>} />
      <div class="stack flush">
        <SearchBox value={search} onInput={setSearch} placeholder="Search yarns" />
        <div class="pad"><Segmented small label="Yarn kind" options={[{ value: 'all', label: 'All' }, { value: 'base', label: 'Base' }, { value: 'tpm', label: 'TPM' }]} value={kind} onChange={setKind} /></div>
      </div>
      <div class="list-meta"><span>{yarns.length} yarns</span><span>{wide ? 'Click a yarn to edit it or its rate' : 'Rate'}</span></div>
      {yarns.length ? (
        wide ? (
          <YarnTable yarns={yarns} idx={idx} />
        ) : (
          <div class="group">
            {yarns.map((y) => {
              const r = rateLabel(y, idx);
              return <Row label={y.name} sub={<>{yarnSub(y, idx)}{r.basis ? <span class="row-basis">{r.basis}</span> : null}</>} value={<span class="strong">{r.value}{r.temp ? <span class="badge amber tag-temp">Temp</span> : null}</span>} valueSub={r.sub} onClick={() => go(`/yarn/${y.id}`)} />;
            })}
          </div>
        )
      ) : (
        <Empty title={(st.tables.Yarns || []).length ? 'No yarns match' : 'No yarns yet'} text="Base yarns first; TPM yarns are made from a base yarn." action={<div class="btn-narrow"><Button onClick={() => go('/yarn/new')}>Add yarn</Button></div>} />
      )}
    </div>
  );
}

const blankYarn = (kind) => ({ name: '', kind, base_yarn_id: '', material: '', form: '', count: '', count_unit: 'D', filaments: '', lustre: '', tpm: '', twist: 'S/Z', tpm_delta: String(DEFAULT_TPM_DELTA), notes: '' });

export function YarnEdit({ id, query }) {
  const st = useStore();
  const existing = id && id !== 'new' ? getIndex().yarnsById[id] : null;
  if (id && id !== 'new' && !existing) {
    return (
      <div>
        <NavBar title="Yarn" backLabel="Yarns" backTo="/yarns" />
        <Empty title={st.status.loading ? 'Loading…' : 'Yarn not found'} />
      </div>
    );
  }
  return <YarnEditForm key={`${id || 'new'}${query.kind || ''}`} id={id} query={query} />;
}

function YarnEditForm({ id, query }) {
  useStore();
  const idx = getIndex();
  const existing = id && id !== 'new' ? idx.yarnsById[id] : null;
  const [y, setY] = useState(() => {
    const start = { ...blankYarn(query.kind === 'tpm' ? 'tpm' : 'base'), ...(existing || {}) };
    if (num(start.tpm_delta) === null) start.tpm_delta = String(DEFAULT_TPM_DELTA);
    return start;
  });
  const current = existing && !isTpm(existing) ? yarnRate(existing, { ...idx, tempRates: {} }) : null;
  const tempNow = existing && !isTpm(existing) ? tempRateOf(idx, existing.id) : null;
  const tempDeltaNow = existing && isTpm(existing) ? tempDeltaOf(idx, existing.id) : null;
  const [rate, setRate] = useState(current ? String(current.rate) : '');
  const [rateDate, setRateDate] = useState(today());
  const [busy, setBusy] = useState(false);
  // Cancel, Back or the back gesture asks before throwing away changes
  const startSnap = useRef(null);
  const snap = JSON.stringify([y, rate, rateDate]);
  if (startSnap.current === null) startSnap.current = snap;
  const allowLeave = useLeaveGuard(snap !== startSnap.current);
  const up = (k) => (v) => setY((x) => ({ ...x, [k]: v }));
  if (id && id !== 'new' && !existing) {
    return (
      <div>
        <NavBar title="Yarn" backLabel="Yarns" backTo="/yarns" />
        <Empty title="Yarn not found" />
      </div>
    );
  }
  const tpm = y.kind === 'tpm';
  const base = tpm ? idx.yarnsById[y.base_yarn_id] : null;
  const baseDenier = base ? yarnDenier(base, idx) : null;
  const baseRate = base ? yarnRate(base, idx) : null;
  const history = existing ? idx.ratesByYarn[existing.id] || [] : [];
  const usage = existing ? yarnUsage(existing.id) : { fabrics: 0, tpmChildren: 0 };
  const baseOptions = Object.values(idx.yarnsById).filter((x) => !isTpm(x)).sort((a, b) => String(a.name).localeCompare(String(b.name))).map((x) => ({ value: x.id, label: x.name }));
  const rateChanged = !tpm && rate !== '' && (!current || num(rate) !== current.rate);
  const delta = num(y.tpm_delta) ?? DEFAULT_TPM_DELTA;

  async function removeRates(rows) {
    const list = rows.map((r) => `${fmt.rate(num(r.rate))} from ${String(r.effective_date || '').slice(0, 10)}`).join(', ');
    const left = history.filter((h) => !rows.includes(h));
    const after = rows.includes(history[0])
      ? left.length
        ? ` ${fmt.rate(num(left[0].rate))} from ${String(left[0].effective_date || '').slice(0, 10)} will apply instead.`
        : tpm
          ? ''
          : ' This yarn will have no rate.'
      : '';
    if (!(await askConfirm({ title: `Delete ${list}?`, text: after.trim() || 'It is removed for everyone.', yes: rows.length === 1 ? 'Delete rate' : `Delete ${rows.length} rates`, danger: true }))) return;
    setBusy(true);
    try {
      await deleteRates(rows.map((r) => r.id));
      if (!tpm && rows.includes(history[0])) setRate(left.length ? String(num(left[0].rate)) : '');
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  }

  async function save() {
    if (!String(y.name || '').trim()) {
      toast('Add a name first', 'error');
      return;
    }
    if (tpm && !y.base_yarn_id) {
      toast('Choose the base yarn', 'error');
      return;
    }
    if (!tpm && rate !== '' && num(rate) === null) {
      toast('Rate must be a number', 'error');
      return;
    }
    if (tpm && String(y.tpm_delta ?? '').trim() !== '' && num(y.tpm_delta) === null) {
      toast('Delta must be a number', 'error');
      return;
    }
    setBusy(true);
    try {
      const row = { ...y, name: y.name.trim() };
      if (!tpm) {
        row.base_yarn_id = '';
        row.tpm = '';
        row.twist = '';
        row.tpm_delta = '';
      } else {
        row.tpm_delta = delta;
      }
      const yid = await saveYarn(row, rateChanged ? num(rate) : null, rateDate);
      allowLeave();
      if (existing) back('/yarns');
      else replace(`/yarn/${yid}`);
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  }

  return (
    <div>
      <NavBar
        title={existing ? existing.name : 'New yarn'}
        left={<TextButton onClick={() => back('/yarns')}>{existing ? 'Back' : 'Cancel'}</TextButton>}
        right={<TextButton bold onClick={save} disabled={busy} title="Save (Ctrl+S)">{busy ? 'Saving…' : 'Save'}</TextButton>}
      />
      {!existing ? <div class="pad mt8"><Segmented label="Yarn kind" options={[{ value: 'base', label: 'Base yarn' }, { value: 'tpm', label: 'TPM yarn' }]} value={y.kind} onChange={(k) => setY({ ...y, kind: k })} /></div> : null}

      <Section header={tpm ? 'TPM yarn' : 'Base yarn'} footer="Only the name is required.">
        <Field label="Name" required value={y.name} onInput={up('name')} placeholder={tpm ? 'e.g. 75D TPM 2000 S/Z' : 'e.g. 75D Polyester FDY'} />
        {tpm ? <SelectField label="Base yarn" required value={y.base_yarn_id} onChange={up('base_yarn_id')} options={baseOptions} /> : null}
        {!tpm ? (
          <>
            <Field label="Material" value={y.material} onInput={up('material')} placeholder="Polyester" />
            <Field label="Form" value={y.form} onInput={up('form')} placeholder="FDY, DTY, spun" />
          </>
        ) : null}
      </Section>

      {tpm ? (
        <Section header="Twist">
          <NumField label="TPM" value={y.tpm} onInput={up('tpm')} />
          <div class="row">
            <div class="row-main"><div class="row-label">Twist direction</div></div>
            <div class="seg-twist"><Segmented small label="Twist direction" options={['S', 'Z', 'S/Z']} value={y.twist || 'S/Z'} onChange={up('twist')} /></div>
          </div>
        </Section>
      ) : null}

      <Section header="Count and rate" footer={tpm ? 'Rate = base yarn rate + delta.' : null} guide={tpm ? 'yarns' : undefined}>
        <div class="row">
          <div class="row-main"><div class="row-label">Count</div></div>
          <div class="count-pair">
            <label class="mini wide2"><input inputmode="decimal" value={y.count ?? ''} placeholder={tpm && baseDenier ? fmt.n(baseDenier, 0) : ''} onInput={(e) => up('count')(e.currentTarget.value)} aria-label="Count" /></label>
            <div class="flex2"><Segmented small label="Count unit" options={[{ value: 'D', label: 'D' }, { value: 'Ne', label: 'Ne' }]} value={y.count_unit || 'D'} onChange={up('count_unit')} /></div>
          </div>
        </div>
        {!tpm ? (
          <>
            <NumField label="Filaments" value={y.filaments} onInput={up('filaments')} placeholder="optional" />
            <Field label="Lustre" value={y.lustre} onInput={up('lustre')} placeholder="SD, BR, FD" />
          </>
        ) : null}
        {tpm ? (
          <>
            <NumField label="Delta" hint="added to base rate, per kg" prefix="₹" value={y.tpm_delta} onInput={up('tpm_delta')} placeholder={String(DEFAULT_TPM_DELTA)} />
            <Row label="Rate" value={<span class="strong">{baseRate ? `${fmt.rate(baseRate.rate + delta)} / kg` : '—'}</span>} valueSub={baseRate ? `base ${fmt.rate(baseRate.rate)}${baseRate.temp ? ' (temp)' : ''} + delta ${fmt.rate(delta)}` : base ? 'base yarn has no rate yet' : 'choose the base yarn'} />
            {tempDeltaNow !== null ? (
              <Row label="Temporary delta" sub="This device only, typed on a fabric page. Screens and files use it instead of the delta above." value={<span class="strong">{fmt.rate(tempDeltaNow)}/kg <span class="badge amber tag-temp">Temp</span></span>}>
                <div class="temp-actions"><TextButton onClick={() => clearTempDelta(existing.id)}>Reset</TextButton></div>
              </Row>
            ) : null}
          </>
        ) : (
          <>
            <NumField label="Rate" hint="per kg" prefix="₹" value={rate} onInput={setRate} />
            {tempNow !== null ? (
              <Row label="Temporary rate" sub="This device only. Screens and files use it instead of the rate above." value={<span class="strong">{fmt.rate(tempNow)}/kg <span class="badge amber tag-temp">Temp</span></span>}>
                <div class="temp-actions"><TextButton onClick={() => clearTempRate(existing.id)}>Reset</TextButton></div>
              </Row>
            ) : null}
            {rateChanged ? <Field label="Rate from" type="date" value={rateDate} onInput={setRateDate} /> : null}
          </>
        )}
      </Section>

      {tpm && existing ? <TpmProduction yarn={{ ...existing, ...y }} idx={idx} /> : null}

      {history.length ? (
        <Section header={tpm ? 'Old TPM rates (not used)' : 'Rate history'} footer={tpm ? 'Entered before rates moved to base rate plus delta. They are no longer used and can be deleted.' : 'The latest rate is the one in use. Delete it and the next older rate applies.'}>
          {history.map((r, i) => (
            <div class="row">
              <div class="row-main">
                <div class="row-label">{fmt.rate(num(r.rate))} / kg</div>
                <div class="row-sub">From {String(r.effective_date || '').slice(0, 10) || 'no date'}{i === 0 && !tpm ? ' · in use' : ''}</div>
              </div>
              <IconButton label={`Delete rate from ${String(r.effective_date || '').slice(0, 10)}`} disabled={busy} onClick={() => removeRates([r])}>
                <span class="bad"><Icon.trash size={20} /></span>
              </IconButton>
            </div>
          ))}
          {history.length > 1 && !tpm ? (
            <button type="button" class="add-row danger" disabled={busy} onClick={() => removeRates(history.slice(1))}>
              <Icon.trash size={20} />Delete older rates
            </button>
          ) : null}
        </Section>
      ) : null}

      {existing ? (
        <>
          <History row={existing} what="yarn" />
          <UsedIn yarn={existing} idx={idx} tpm={tpm} inUse={!!(usage.fabrics || usage.tpmChildren)} />
          <div class="danger-zone">
            <Button kind="danger" disabled={!!(usage.fabrics || usage.tpmChildren)} onClick={async () => {
              if (!(await askConfirm({ title: `Delete ${existing.name}?`, text: 'Its rate history goes too, for everyone.', yes: `Delete ${existing.name}`, danger: true }))) return;
              try {
                await deleteYarn(existing.id);
                allowLeave();
                replace('/yarns');
              } catch (e) {
                toast(e.message, 'error');
              }
            }}><Icon.trash size={20} /> Delete yarn</Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

const sideText = (sides) => (sides.has('warp') && sides.has('weft') ? 'Warp and weft' : sides.has('warp') ? 'Warp' : 'Weft');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Fabrics that use a yarn. Direct lines first; for a base yarn also the fabrics that use one of its TPM yarns,
// each with the TPM yarn it goes through (via). One entry per fabric and route, sorted by fabric name.
export function yarnFabricUses(yarnId, idx) {
  const routes = [{ id: yarnId, via: null }];
  const children = Object.values(idx.yarnsById)
    .filter((y) => y.base_yarn_id === yarnId && isTpm(y))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  for (const c of children) routes.push({ id: c.id, via: c });
  const out = [];
  for (const r of routes) {
    const byFabric = new Map();
    for (const l of idx.tables.FabricYarns || []) {
      if (l.yarn_id !== r.id || !idx.fabricsById[l.fabric_id]) continue;
      if (!byFabric.has(l.fabric_id)) byFabric.set(l.fabric_id, new Set());
      byFabric.get(l.fabric_id).add(l.side);
    }
    const list = [...byFabric].map(([fid, sides]) => ({ fabric: idx.fabricsById[fid], sides, via: r.via }));
    list.sort((a, b) => String(a.fabric.name).localeCompare(String(b.fabric.name)));
    out.push(...list);
  }
  return { uses: out, children };
}

function UsedIn({ yarn, idx, tpm, inUse }) {
  const { uses, children } = yarnFabricUses(yarn.id, idx);
  const direct = uses.filter((u) => !u.via);
  const through = uses.filter((u) => u.via);
  const throughCount = new Set(through.map((u) => u.fabric.id)).size;
  const summary = direct.length || throughCount
    ? [direct.length ? plural(direct.length, 'fabric', 'fabrics') : 'No fabric directly', throughCount ? `${throughCount} through its TPM yarns` : null].filter(Boolean).join(' · ')
    : 'Not used in any fabric';
  const directCount = (id) => new Set((idx.tables.FabricYarns || []).filter((l) => l.yarn_id === id && idx.fabricsById[l.fabric_id]).map((l) => l.fabric_id)).size;
  const fabricRow = (u) => (
    <Row
      label={u.fabric.name}
      sub={u.via ? <>Through <span class="strong">{u.via.name}</span> · {sideText(u.sides)}</> : sideText(u.sides)}
      chevron
      onClick={() => go(`/fabric/${u.fabric.id}`)}
    />
  );
  return (
    <>
      <FoldSection
        fold="yarnUsedIn"
        id="yarn-used-in"
        header="Used in fabrics"
        summary={summary}
        footer={through.length ? 'Fabrics marked "Through" use a TPM yarn made from this yarn, not this yarn itself.' : null}
      >
        {uses.length ? (
          <>
            {direct.map(fabricRow)}
            {through.length ? (
              <>
                {direct.length ? <div class="row"><div class="row-main"><div class="row-sub strong">Through its TPM yarns</div></div></div> : null}
                {through.map(fabricRow)}
              </>
            ) : null}
          </>
        ) : (
          <Row label="Not used in any fabric" />
        )}
      </FoldSection>
      {!tpm ? (
        <FoldSection fold="yarnTpmChildren" id="yarn-tpm-children" header="TPM yarns made from it" summary={children.length ? plural(children.length, 'TPM yarn', 'TPM yarns') : 'None'}>
          {children.length ? children.map((c) => (
            <Row label={c.name} sub={`Used in ${plural(directCount(c.id), 'fabric', 'fabrics')}`} chevron onClick={() => go(`/yarn/${c.id}`)} />
          )) : <Row label="No TPM yarn is made from it" />}
        </FoldSection>
      ) : null}
      {inUse ? <p class="section-footer">A yarn in use cannot be deleted. Remove it from those fabrics or TPM yarns first.</p> : null}
    </>
  );
}

// TPM yarn page: what one spindle and one machine make per day of this yarn, at every unit and TFO type where the
// yarn has a TFO speed. Same formula as the spindle requirement (calc.tfoOutput): RPM as stored (already ×2),
// efficiency from the speed, else its TFO type, else the unit default. A machine = 2 sides × spindles per side.
export function tpmProductionRows(yarn, idx) {
  const denier = yarnDenier(yarn, idx);
  const out = [];
  const units = Object.values(idx.unitsById).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  for (const unit of units) {
    const speeds = (idx.speedsByUnit[unit.id] || []).filter((s) => s.yarn_id === yarn.id);
    const types = idx.tfoTypesByUnit[unit.id] || [];
    if (!speeds.length) {
      // a unit with a TFO division but no speed for this yarn: listed, blank
      if (truthy(unit.has_tfo) && types.length) out.push({ unit, rows: [], none: true, noTfo: false });
      continue;
    }
    const rows = [];
    for (const type of types) {
      const sp = speeds.find((s) => s.tfo_type_id === type.id) || null;
      if (!sp) {
        rows.push({ type, speed: null, reason: 'No speed set' });
        continue;
      }
      const eff = tfoEff(sp, type, unit);
      const q = tfoOutput(sp.rpm, yarn.tpm, eff, denier);
      const perSide = spindlesPerSide(type);
      const machine = q !== null ? q * perSide * SIDES_PER_MACHINE : null;
      rows.push({ type, speed: sp, rpm: num(sp.rpm), eff, perSpindle: q, perMachine: machine, spindles: perSide * SIDES_PER_MACHINE, machines: num(type.machines),
        reason: q !== null ? null : !num(yarn.tpm) ? 'Set the TPM' : !denier ? 'Set the count' : eff === null ? 'Set the TFO efficiency' : 'Set the RPM' });
    }
    out.push({ unit, rows, noTfo: !truthy(unit.has_tfo) });
  }
  return out;
}

function TpmProduction({ yarn, idx }) {
  const list = tpmProductionRows(yarn, idx);
  return (
    <Section id="sec-tpm-production" header="Production per spindle and machine · kg per day" footer={list.length ? 'kg per day, at each TFO speed and efficiency. A machine = 2 sides of spindles.' : null} guide="yarns">
      {list.length ? list.map(({ unit, rows, noTfo, none }) => (
        <>
          <div class="row sub-head"><div class="row-main"><div class="row-label strong">{unit.name}</div>{noTfo ? <div class="row-sub">TFO division switched off on this unit</div> : none ? <div class="row-sub">No TFO speed set for this yarn</div> : null}</div></div>
          {rows.map((r) => (
            <Row
              label={r.type.name}
              sub={r.speed ? `${r.rpm !== null ? `${fmt.int(r.rpm)} RPM` : 'no RPM'} · ${r.eff !== null ? `${fmt.n(r.eff, 0)}% eff` : 'no efficiency'} · ${fmt.int(r.spindles)} spindles${r.machines ? ` · ${fmt.int(r.machines)} machines` : ''}` : undefined}
              value={r.perSpindle !== null && r.perSpindle !== undefined ? <span class="strong">{fmt.n(r.perSpindle, 3)} kg</span> : '—'}
              valueSub={r.perSpindle !== null && r.perSpindle !== undefined ? `per spindle · ${fmt.n(r.perMachine, 1)} kg per machine` : r.reason}
            />
          ))}
        </>
      )) : <Row label="No TFO speed set" sub="No unit has a TFO division with a speed for this yarn." />}
    </Section>
  );
}
