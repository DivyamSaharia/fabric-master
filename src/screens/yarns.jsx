import { useMemo, useState } from 'preact/hooks';
import { DEFAULT_TPM_DELTA, fmt, isTpm, num, tpmDelta, yarnDenier, yarnRate } from '../calc.js';
import { rateLabel, yarnSub } from '../describe.js';
import { deleteRates, deleteYarn, getIndex, saveYarn, toast, useStore, yarnUsage } from '../store.js';
import { today } from '../schema.js';
import { back, go, replace } from '../router.js';
import { Button, Empty, Field, Icon, IconButton, NavBar, NumField, Row, SearchBox, Section, Segmented, SelectField, TextButton, useWide, History } from '../ui.jsx';

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
                <td class="strong">{r ? fmt.n(r.rate, 2) : '—'}</td>
                <td class="txt muted">{!r ? 'No rate' : r.delta !== undefined ? `base ${fmt.rate(r.baseRate)} + ${fmt.rate(r.delta)}` : r.date ? `from ${r.date}` : ''}</td>
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
      <NavBar large title="Yarns" right={<IconButton label="Add yarn" onClick={() => go(`/yarn/new${kind === 'tpm' ? '?kind=tpm' : ''}`)}><Icon.plus size={26} /></IconButton>} />
      <div class="stack" style={{ padding: 0 }}>
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
              return <Row label={y.name} sub={yarnSub(y, idx)} value={<span class="strong">{r.value}</span>} valueSub={r.sub} onClick={() => go(`/yarn/${y.id}`)} />;
            })}
          </div>
        )
      ) : (
        <Empty title={(st.tables.Yarns || []).length ? 'No yarns match' : 'No yarns yet'} text="Base yarns first; TPM yarns are made from a base yarn." action={<div style={{ width: '220px' }}><Button onClick={() => go('/yarn/new')}>Add yarn</Button></div>} />
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
  const current = existing && !isTpm(existing) ? yarnRate(existing, idx) : null;
  const [rate, setRate] = useState(current ? String(current.rate) : '');
  const [rateDate, setRateDate] = useState(today());
  const [busy, setBusy] = useState(false);
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
  const usage = existing ? yarnUsage(existing.id) : { fabrics: 0, tpmChildren: 0, plans: 0 };
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
    if (!window.confirm(`Delete ${list}?${after}`)) return;
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
        right={<TextButton bold onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</TextButton>}
      />
      {!existing ? <div class="pad" style={{ marginTop: '8px' }}><Segmented label="Yarn kind" options={[{ value: 'base', label: 'Base yarn' }, { value: 'tpm', label: 'TPM yarn' }]} value={y.kind} onChange={(k) => setY({ ...y, kind: k })} /></div> : null}

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
            <div style={{ width: '150px' }}><Segmented small label="Twist direction" options={['S', 'Z', 'S/Z']} value={y.twist || 'S/Z'} onChange={up('twist')} /></div>
          </div>
        </Section>
      ) : null}

      <Section header="Count and rate" footer={tpm ? `Count defaults to the base yarn's; enter the twisted denier if it differs. The rate is the base yarn's rate plus the delta, so it follows every base rate change. The delta stays at ₹${DEFAULT_TPM_DELTA} unless you change it here.` : null}>
        <div class="row">
          <div class="row-main"><div class="row-label">Count</div></div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '60%' }}>
            <label class="mini" style={{ flex: 2 }}><input inputmode="decimal" value={y.count ?? ''} placeholder={tpm && baseDenier ? fmt.n(baseDenier, 0) : ''} onInput={(e) => up('count')(e.currentTarget.value)} aria-label="Count" /></label>
            <div style={{ flex: 2 }}><Segmented small label="Count unit" options={[{ value: 'D', label: 'D' }, { value: 'Ne', label: 'Ne' }]} value={y.count_unit || 'D'} onChange={up('count_unit')} /></div>
          </div>
        </div>
        {!tpm ? (
          <>
            <NumField label="Filaments" value={y.filaments} onInput={up('filaments')} />
            <Field label="Lustre" value={y.lustre} onInput={up('lustre')} placeholder="SD, BR, FD" />
          </>
        ) : null}
        {tpm ? (
          <>
            <NumField label="Delta" hint="added to base rate, per kg" prefix="₹" value={y.tpm_delta} onInput={up('tpm_delta')} placeholder={String(DEFAULT_TPM_DELTA)} />
            <Row label="Rate" value={<span class="strong">{baseRate ? `${fmt.rate(baseRate.rate + delta)} / kg` : '—'}</span>} valueSub={baseRate ? `base ${fmt.rate(baseRate.rate)} + delta ${fmt.rate(delta)}` : base ? 'base yarn has no rate yet' : 'choose the base yarn'} />
          </>
        ) : (
          <>
            <NumField label="Rate" hint="per kg" prefix="₹" value={rate} onInput={setRate} />
            {rateChanged ? <Field label="Rate from" type="date" value={rateDate} onInput={setRateDate} /> : null}
          </>
        )}
      </Section>

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
            <button type="button" class="add-row" style={{ color: 'var(--bad)' }} disabled={busy} onClick={() => removeRates(history.slice(1))}>
              <Icon.trash size={20} />Delete older rates
            </button>
          ) : null}
        </Section>
      ) : null}

      {existing ? (
        <>
          <History row={existing} what="yarn" />
          <Section footer={usage.fabrics || usage.tpmChildren || usage.plans ? 'A yarn in use cannot be deleted. Remove it from those fabrics, TPM yarns or TFO plans first.' : null}>
            <Row label="Used in fabrics" value={String(usage.fabrics)} />
            {!tpm ? <Row label="TPM yarns made from it" value={String(usage.tpmChildren)} /> : null}
            {usage.plans ? <Row label="Used in TFO plans" value={String(usage.plans)} /> : null}
          </Section>
          <div class="actions">
            <Button kind="danger" disabled={!!(usage.fabrics || usage.tpmChildren || usage.plans)} onClick={async () => {
              if (!window.confirm(`Delete ${existing.name} and its rate history?`)) return;
              try {
                await deleteYarn(existing.id);
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
