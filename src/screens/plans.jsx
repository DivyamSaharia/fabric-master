// TFO planner: dated plans per unit. List → plan (spindle balance) → edit (looms, TFO sides, outside yarn).
import { useMemo, useState } from 'preact/hooks';
import { fmt, isTpm, num } from '../calc.js';
import { DEFAULT_SPINDLES_PER_SIDE, groupLabel, planCalc, planLines, planVerdict, plansOf, spindlesPerSide, unitHasPlanner } from '../planner.js';
import { backendMode, copyPlan, deletePlan, getIndex, savePlan, toast, useStore } from '../store.js';
import { back, go, replace } from '../router.js';
import { today } from '../schema.js';
import { Badge, Button, Chip, Empty, Field, History, Icon, IconButton, NavBar, Row, Section, Segmented, SelectField, Sheet, TextButton, Toggle, useWide } from '../ui.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// "21 Oct 2026"; with weekday: "Wed, 21 Oct 2026". Plan dates are stored as yyyy-mm-dd.
export function dateText(v, weekday) {
  const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return v ? String(v) : 'No date';
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return `${weekday ? `${DAYS[d.getDay()]}, ` : ''}${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}

const signed = (v) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : '−'}${fmt.int(Math.abs(v))}`);
const signedKg = (v) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : '−'}${fmt.n(Math.abs(v), 1)}`);
const STATUS = { short: ['bad', 'Short'], surplus: ['good', 'Surplus'], ok: ['good', 'Balanced'], unknown: ['amber', 'Data missing'] };
const tone = (kind) => (kind === 'bad' ? 'bad' : kind === 'good' ? 'good' : '');
const StatusBadge = ({ status }) => <Badge kind={status === 'unknown' ? 'amber' : status === 'short' ? 'red' : 'teal'}>{STATUS[status][1]}</Badge>;

function plannerUnits(idx) {
  return Object.values(idx.unitsById).filter((u) => unitHasPlanner(u, idx)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// ---------- list ----------

export function PlanList({ query }) {
  const st = useStore();
  const idx = getIndex();
  const units = plannerUnits(idx);
  const [unitId, setUnitId] = useState(query.unit || '');
  const [adding, setAdding] = useState(false);
  const shown = unitId ? units.filter((u) => u.id === unitId) : units;
  const plans = plansOf(idx).filter((p) => shown.some((u) => u.id === p.unit_id));
  const tfoUnitsWithoutTypes = Object.values(idx.unitsById).filter((u) => (u.has_tfo === true || u.has_tfo === 'TRUE') && !unitHasPlanner(u, idx));

  return (
    <div>
      <NavBar large title="TFO planner" right={<IconButton label="New plan" onClick={() => setAdding(true)} disabled={!units.length}><Icon.plus size={26} /></IconButton>} />
      {units.length > 1 ? (
        <div class="chips" style={{ marginBottom: '6px' }}>
          <Chip on={!unitId} onClick={() => setUnitId('')}>All units</Chip>
          {units.map((u) => <Chip on={unitId === u.id} onClick={() => setUnitId(u.id)}>{u.name}</Chip>)}
        </div>
      ) : null}
      {!units.length ? (
        <Empty
          title={st.status.loading ? 'Loading…' : 'No unit with a TFO division'}
          text={tfoUnitsWithoutTypes.length ? `Add TFO types with their machine counts to ${tfoUnitsWithoutTypes.map((u) => u.name).join(', ')} first.` : 'Turn on the TFO division on a unit and add its TFO types, then plan here.'}
          action={<div style={{ width: '220px' }}><Button kind="secondary" onClick={() => go('/units')}>Go to units</Button></div>}
        />
      ) : plans.length ? (
        shown.map((u) => {
          const list = plans.filter((p) => p.unit_id === u.id);
          if (!list.length) return null;
          return (
            <Section header={`${u.name} · ${list.length} ${list.length === 1 ? 'plan' : 'plans'}`}>
              {list.map((p) => {
                const pc = planCalc(p, planLines(idx, p.id), idx);
                const v = planVerdict(pc);
                return (
                  <Row
                    label={dateText(p.plan_date, true)}
                    sub={[p.name, `${fmt.int(pc.totals.looms)} looms`, `${pc.typeUse.reduce((s, x) => s + x.used, 0)} sides given out`].filter(Boolean).join(' · ')}
                    value={<span class={`strong ${tone(v.kind)}`}>{v.text}</span>}
                    onClick={() => go(`/plan/${p.id}`)}
                    chevron
                  />
                );
              })}
            </Section>
          );
        })
      ) : (
        <Empty title="No plans yet" text="Make a dated plan: which fabric runs on how many looms, how TFO sides are given out, and yarn bought in." action={<div style={{ width: '220px' }}><Button onClick={() => setAdding(true)}>New plan</Button></div>} />
      )}
      <NewPlanSheet open={adding} onClose={() => setAdding(false)} units={units} unitId={unitId || (units[0] && units[0].id)} idx={idx} />
    </div>
  );
}

function NewPlanSheet({ open, onClose, units, unitId, idx, fromPlan }) {
  const [unit, setUnit] = useState(unitId || '');
  const [date, setDate] = useState(today());
  const [name, setName] = useState('');
  const [copy, setCopy] = useState(true);
  const [busy, setBusy] = useState(false);
  const uid = fromPlan ? fromPlan.unit_id : unit || unitId;
  const source = fromPlan || plansOf(idx, uid)[0] || null;
  if (!open) return null;
  const clash = plansOf(idx, uid).find((p) => p.plan_date === date && String(p.name || '') === String(name || '').trim());
  async function create() {
    if (!uid) return toast('Choose a unit', 'error');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('Choose a date', 'error');
    setBusy(true);
    try {
      if (source && copy) {
        const id = await copyPlan(source.id, date, String(name).trim() || source.name || '');
        onClose();
        go(`/plan/${id}`);
      } else {
        onClose();
        go(`/plan/new?unit=${encodeURIComponent(uid)}&date=${date}&name=${encodeURIComponent(String(name).trim())}`);
      }
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  }
  return (
    <Sheet open={open} onClose={onClose} title={fromPlan ? 'Copy to a new date' : 'New plan'} footer={<Button busy={busy} onClick={create}>{source && copy ? 'Create copy' : 'Continue'}</Button>}>
      <Section footer={clash ? `${dateText(date)} already has a plan with this name. A second one will be added.` : 'Each plan is for one unit on one date. Copy the last plan and change what moved.'}>
        {!fromPlan && units.length > 1 ? <SelectField label="Unit" required value={uid} onChange={setUnit} options={units.map((u) => ({ value: u.id, label: u.name }))} /> : null}
        <Field label="Date" required type="date" value={date} onInput={setDate} />
        <Field label="Name" value={name} onInput={setName} placeholder={source && copy ? source.name || 'e.g. Nov plan' : 'e.g. Nov plan'} />
        {source && !fromPlan ? <Toggle label={`Start from ${dateText(source.plan_date)}${source.name ? ` · ${source.name}` : ''}`} value={copy} onChange={setCopy} /> : null}
      </Section>
    </Sheet>
  );
}

// ---------- plan ----------

export function PlanDetail({ id }) {
  const st = useStore();
  const idx = getIndex();
  const wide = useWide();
  const plan = (idx.tables.TfoPlans || []).find((p) => p.id === id);
  const [copying, setCopying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const pc = useMemo(() => (plan ? planCalc(plan, planLines(idx, plan.id), idx) : null), [plan, idx]);
  if (!plan) {
    return (
      <div>
        <NavBar title="Plan" backLabel="Planner" backTo="/plans" />
        <Empty title={st.status.loading ? 'Loading…' : 'Plan not found'} />
      </div>
    );
  }
  const t = pc.totals;
  const verdict = planVerdict(pc);
  const unitName = pc.unit ? pc.unit.name : 'Unit deleted';
  const problems = [...pc.loomRows, ...pc.tfoRows, ...pc.outsideRows].filter((r) => r.problems.length);

  return (
    <div>
      <NavBar
        title={dateText(plan.plan_date)}
        backLabel="Planner"
        backTo={`/plans?unit=${plan.unit_id}`}
        right={<>
          <IconButton label="Export" onClick={() => setExporting(true)}><Icon.share size={22} /></IconButton>
          <TextButton onClick={() => go(`/plan/${id}/edit`)}>Edit</TextButton>
        </>}
      />
      <div class="title-block" style={{ paddingTop: '4px' }}>
        <h1>{dateText(plan.plan_date, true)}</h1>
        <div class="title-sub">{[unitName, plan.name, plan.notes].filter(Boolean).join(' · ')}</div>
      </div>

      <div class="tiles plan-tiles">
        <div class={`tile ${verdict.kind === 'bad' ? 'bad-tile' : 'accent'}`}>
          <span class="t-label">{t.shortYarns ? 'Spindle deficit' : 'Spindle balance'}</span>
          <span class="t-value">{t.shortYarns ? `−${fmt.int(t.deficit)}` : t.unknownYarns && !pc.yarnRows.some((y) => y.status !== 'unknown') ? '—' : `+${fmt.int(t.surplus)}`}</span>
          <span class="t-sub">{t.shortYarns ? `${t.shortYarns} ${t.shortYarns === 1 ? 'yarn' : 'yarns'} short${t.surplus >= 0.5 ? ` · +${fmt.int(t.surplus)} spare elsewhere` : ''}` : verdict.text}</span>
        </div>
        <div class="tile">
          <span class="t-label">Spindles needed</span>
          <span class="t-value">{t.required === null ? '—' : fmt.int(t.required)}</span>
          <span class="t-sub">{fmt.n(t.net, 0)} kg/day to twist{t.outside ? ` · ${fmt.n(t.outside, 0)} kg/day bought` : ''}</span>
        </div>
        <div class="tile">
          <span class="t-label">Given out</span>
          <span class="t-value">{fmt.int(t.usedSpindles)}</span>
          <span class="t-sub">{t.capSpindles === null ? 'Set machine counts on the unit' : `of ${fmt.int(t.capSpindles)} · ${t.idleSides} ${t.idleSides === 1 ? 'side' : 'sides'} idle`}</span>
        </div>
        {wide ? (
          <div class="tile">
            <span class="t-label">Looms</span>
            <span class="t-value">{fmt.int(t.looms)}</span>
            <span class="t-sub">{t.metres === null ? 'Output incomplete' : `${fmt.int(t.metres)} m/day`}</span>
          </div>
        ) : null}
      </div>

      {pc.issues.length || problems.length ? (
        <div class="notice">
          {[...pc.issues, ...(problems.length ? [`${problems.length} ${problems.length === 1 ? 'line needs' : 'lines need'} a look (marked below).`] : [])].map((x) => <div>{x}</div>)}
        </div>
      ) : null}

      <Section header="Running yarn requirement" footer={pc.runningRows.length ? 'kg/day of every yarn on the planned looms, shortage included. Spindles needed is for the TPM yarns (after outside yarn).' : null}>
        {pc.runningRows.length ? (wide ? <RunningTable rows={pc.runningRows} totals={t} /> : <>{pc.runningRows.map((r) => <RunningCard r={r} />)}<Row label="Total running" strong value={<span class="strong">{fmt.n(t.running, 1)} kg</span>} valueSub={`warp ${fmt.n(t.runningWarp, 1)} · weft ${fmt.n(t.runningWeft, 1)} per day`} /></>) : <Row label="Nothing running yet" sub="Add loom lines from Edit." />}
      </Section>

      <Section header="Spindle balance by yarn" footer="Needed = (loom demand − outside yarn) ÷ output per spindle-day, at the speed of the TFO types given out for that yarn (or the first TFO type with a speed). TFO RPM is already × 2. Loom efficiency is the unit's.">
        {pc.yarnRows.length ? (wide ? <BalanceTable rows={pc.yarnRows} /> : pc.yarnRows.map((y) => <BalanceCard y={y} />)) : <Row label="Nothing planned yet" sub="Add loom lines and TFO sides from Edit." />}
      </Section>

      <div class="detail-cols">
        <div class="col">
          {pc.groupUse.map((u) => (
            <Section header={`${groupLabel(u.group)} · ${u.planned}${u.have === null ? ' looms' : ` of ${u.have} looms`} · ${u.free === null ? 'count not set' : u.free >= 0 ? `${u.free} available` : `${-u.free} over`}`}>
              {u.rows.map((r) => <LoomRow r={r} />)}
              {!u.rows.length ? <Row label="Nothing planned" sub={u.have === null ? 'Set the loom count on the unit.' : `${u.have} looms available`} /> : null}
            </Section>
          ))}
          {pc.loomRows.some((r) => !r.group) ? <Section header="No loom group">{pc.loomRows.filter((r) => !r.group).map((r) => <LoomRow r={r} />)}</Section> : null}
          {!pc.groupUse.length && !pc.loomRows.length ? <Section header="Loom plan"><Row label="No loom lines" /></Section> : null}
        </div>
        <div class="col">
          <Section header="TFO sides given out">
            {pc.tfoRows.map((r) => (
              <Row
                label={r.yarn ? r.yarn.name : 'Yarn deleted'}
                sub={`${r.type ? r.type.name : 'TFO type deleted'} · ${fmt.int(r.sides)} ${r.sides === 1 ? 'side' : 'sides'} · ${fmt.int(r.spindles)} spindles`}
                value={<span class="strong">{r.kg === null ? '—' : `${fmt.n(r.kg, 1)} kg`}</span>}
                valueSub="per day"
              >
                {r.problems.length ? <div class="row-sub bad">{r.problems.join(' · ')}</div> : null}
              </Row>
            ))}
            {!pc.tfoRows.length ? <Row label="No TFO sides given out" /> : null}
          </Section>
          <Section header="TFO machines">
            {pc.typeUse.map((u) => <Row label={u.type.name} sub={u.machines === null ? 'Machines not set on the unit' : `${u.machines} machines · ${u.sides} sides · ${u.perSide} spindles a side`} value={<span class={u.idle !== null && u.idle < 0 ? 'bad strong' : 'strong'}>{u.sides === null ? `${u.used} used` : `${u.used} of ${u.sides}`}</span>} valueSub={u.idle === null ? 'sides' : u.idle >= 0 ? `${u.idle} idle` : `${-u.idle} over`} />)}
          </Section>
          <Section header="Yarn from outside">
            {pc.outsideRows.map((r) => <Row label={r.yarn ? r.yarn.name : 'Yarn deleted'} sub={r.line.source || null} value={<span class="strong">{r.kg === null ? '—' : `${fmt.n(r.kg, 1)} kg`}</span>} valueSub="per day" />)}
            {!pc.outsideRows.length ? <Row label="None" sub="Twisted yarn bought in, kg per day." /> : null}
          </Section>
        </div>
      </div>

      <History row={plan} added what="plan" />
      <div class="actions">
        <Button kind="secondary" onClick={() => setCopying(true)}><Icon.copy size={20} /> Copy to a new date</Button>
        <Button kind="danger" onClick={async () => {
          if (!window.confirm(`Delete the ${unitName} plan for ${dateText(plan.plan_date)}${plan.name ? ` (${plan.name})` : ''}? Its loom lines, TFO sides and outside yarn go too.`)) return;
          try {
            await deletePlan(plan.id);
            replace(`/plans?unit=${plan.unit_id}`);
          } catch (e) {
            toast(e.message, 'error');
          }
        }}><Icon.trash size={20} /> Delete plan</Button>
      </div>
      <NewPlanSheet open={copying} onClose={() => setCopying(false)} units={[]} unitId={plan.unit_id} idx={idx} fromPlan={plan} />
      <PlanExportSheet open={exporting} onClose={() => setExporting(false)} plan={plan} pc={pc} />
    </div>
  );
}

function LoomRow({ r }) {
  return (
    <Row
      label={r.fabric ? r.fabric.name : 'Fabric deleted'}
      sub={[`${fmt.int(r.looms)} looms`, r.panna === 2 ? 'double panna' : null, r.rpm ? `${fmt.int(r.rpm)} RPM${num(r.line.rpm) ? ' (set here)' : ''}` : null].filter(Boolean).join(' · ')}
      value={<span class="strong">{r.mPerDay === null ? '—' : `${fmt.int(r.mPerDay)} m`}</span>}
      valueSub="per day"
      onClick={r.fabric ? () => go(`/fabric/${r.fabric.id}`) : undefined}
    >
      {r.problems.length ? <div class="row-sub bad">{r.problems.join(' · ')}</div> : null}
    </Row>
  );
}

function RunningTable({ rows, totals }) {
  return (
    <div class="table-wrap" style={{ margin: 0 }}>
      <table class="ftable plan-table">
        <thead>
          <tr>
            <th class="txt"><span class="th">Yarn</span></th>
            <th><span class="th">Warp kg/day</span></th>
            <th><span class="th">Weft kg/day</span></th>
            <th class="key"><span class="th">Total kg/day</span></th>
            <th><span class="th">Outside</span></th>
            <th><span class="th">Spindles needed</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td class="txt">
                <div class="tname">{r.yarn.name}</div>
                <div class="tmeta">{[r.tpm ? `TPM${r.base ? ` of ${r.base.name}` : ''}` : null, r.fabrics.join(', ')].filter(Boolean).join(' · ')}</div>
                {!r.known ? <div class="tmeta bad">Incomplete: a loom line is missing data</div> : null}
              </td>
              <td class={r.warp ? '' : 'muted'}>{r.warp ? fmt.n(r.warp, 1) : '—'}</td>
              <td class={r.weft ? '' : 'muted'}>{r.weft ? fmt.n(r.weft, 1) : '—'}</td>
              <td class="key">{fmt.n(r.total, 1)}</td>
              <td class={r.outside ? '' : 'muted'}>{r.outside ? fmt.n(r.outside, 1) : '—'}</td>
              <td class={r.tpm ? '' : 'muted'}>{r.tpm ? (r.spindles === null ? '—' : fmt.int(r.spindles)) : '—'}</td>
            </tr>
          ))}
          <tr>
            <td class="txt strong">Total</td>
            <td class="strong">{fmt.n(totals.runningWarp, 1)}</td>
            <td class="strong">{fmt.n(totals.runningWeft, 1)}</td>
            <td class="key">{fmt.n(totals.running, 1)}</td>
            <td class="muted">{totals.outside ? fmt.n(totals.outside, 1) : '—'}</td>
            <td class="strong">{totals.required === null ? '—' : fmt.int(totals.required)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function RunningCard({ r }) {
  return (
    <Row
      label={r.yarn.name}
      sub={[r.tpm ? `TPM${r.base ? ` of ${r.base.name}` : ''}` : null, r.warp ? `warp ${fmt.n(r.warp, 1)}` : null, r.weft ? `weft ${fmt.n(r.weft, 1)}` : null].filter(Boolean).join(' · ')}
      value={<span class="strong">{fmt.n(r.total, 1)} kg</span>}
      valueSub={r.tpm && r.spindles !== null ? `${fmt.int(r.spindles)} spindles` : 'per day'}
    >
      {r.fabrics.length ? <div class="row-sub">{r.fabrics.join(', ')}</div> : null}
      {!r.known ? <div class="row-sub bad">Incomplete: a loom line is missing data</div> : null}
    </Row>
  );
}

function BalanceTable({ rows }) {
  return (
    <div class="table-wrap" style={{ margin: 0 }}>
      <table class="ftable plan-table">
        <thead>
          <tr>
            <th class="txt"><span class="th">Yarn</span></th>
            <th><span class="th">Demand kg/day</span></th>
            <th><span class="th">Outside</span></th>
            <th><span class="th">Net kg/day</span></th>
            <th class="opt"><span class="th">kg / spindle-day</span></th>
            <th><span class="th">Needed</span></th>
            <th><span class="th">Given out</span></th>
            <th class="key"><span class="th">Balance spindles</span></th>
            <th><span class="th">Balance sides</span></th>
            <th class="opt"><span class="th">Balance kg/day</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((y) => (
            <tr>
              <td class="txt">
                <div class="tname">{y.yarn.name}</div>
                <div class="tmeta">{[y.fabrics.join(', ') || 'Not on looms', y.refType ? `at ${y.refType}` : null].filter(Boolean).join(' · ')}</div>
                {y.problems.length ? <div class="tmeta bad">{y.problems.join(' · ')}</div> : null}
              </td>
              <td>{fmt.n(y.demand, 1)}</td>
              <td class={y.outside ? '' : 'muted'}>{y.outside ? fmt.n(y.outside, 1) : '—'}</td>
              <td>{fmt.n(y.net, 1)}</td>
              <td class="opt muted">{y.qRef === null ? '—' : fmt.n(y.qRef, 4)}</td>
              <td>{y.required === null ? '—' : fmt.int(y.required)}</td>
              <td>{fmt.int(y.allocSpindles)}<div class="tmeta">{y.allocSides} {y.allocSides === 1 ? 'side' : 'sides'}</div></td>
              <td class={`key ${y.status === 'short' ? 'bad' : y.status === 'unknown' ? '' : 'good'}`}>{y.status === 'unknown' ? '—' : signed(y.balanceSpindles)}</td>
              <td class={y.status === 'short' ? 'bad' : ''}>{y.balanceSides === null ? '—' : `${y.balanceSides >= 0 ? '+' : '−'}${fmt.n(Math.abs(y.balanceSides), 1)}`}</td>
              <td class="opt">{signedKg(y.balanceKg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BalanceCard({ y }) {
  return (
    <div class="unit-card">
      <div class="unit-head">
        <div style={{ minWidth: 0 }}>
          <div class="row-label strong">{y.yarn.name}</div>
          <div class="row-sub">{y.fabrics.join(', ') || 'Not on looms'}</div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div class={`plan-bal ${y.status === 'short' ? 'bad' : y.status === 'unknown' ? '' : 'good'}`}>{y.status === 'unknown' ? '—' : signed(y.balanceSpindles)}</div>
          <StatusBadge status={y.status} />
        </div>
      </div>
      <div class="kv">
        <span class="k">Demand</span><span class="v">{fmt.n(y.demand, 1)} kg/day</span>
        {y.outside ? <><span class="k">Outside</span><span class="v">− {fmt.n(y.outside, 1)} kg/day</span></> : null}
        <span class="k">Spindles needed</span><span class="v">{y.required === null ? '—' : fmt.int(y.required)}{y.sidesNeeded !== null ? ` (${fmt.n(y.sidesNeeded, 1)} sides)` : ''}</span>
        <span class="k">Given out</span><span class="v">{fmt.int(y.allocSpindles)} ({y.allocSides} {y.allocSides === 1 ? 'side' : 'sides'})</span>
        <span class="k">Balance</span><span class="v">{signedKg(y.balanceKg)} kg/day</span>
      </div>
      {y.problems.length ? <div class="row-sub bad">{y.problems.join(' · ')}</div> : null}
    </div>
  );
}

function PlanExportSheet({ open, onClose, plan, pc }) {
  const [busy, setBusy] = useState('');
  const [toDrive, setToDrive] = useState(false);
  const sheetMode = backendMode() === 'sheet';
  if (!open) return null;
  const run = async (kind) => {
    setBusy(kind);
    try {
      const m = await import('../export/planExports.js');
      await (kind === 'pdf' ? m.exportPlanPdf : m.exportPlanXlsx)(plan, pc, { toDrive: sheetMode && toDrive });
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy('');
  };
  return (
    <Sheet open={open} onClose={onClose} title="Export plan">
      <Section>
        <Row label="PDF" sub="Spindle balance, loom plan, TFO sides, outside yarn" onClick={() => run('pdf')} value={busy === 'pdf' ? <span class="spinner" /> : undefined} chevron={busy !== 'pdf'} />
        <Row label="Excel sheet" sub="One tab each for balance, looms, TFO sides and machines" onClick={() => run('xlsx')} value={busy === 'xlsx' ? <span class="spinner" /> : undefined} chevron={busy !== 'xlsx'} />
      </Section>
      {sheetMode ? <Section><Toggle label="Also save to Drive" value={toDrive} onChange={setToDrive} /></Section> : null}
    </Sheet>
  );
}

// ---------- edit ----------

export function PlanEdit({ id, query }) {
  const st = useStore();
  const idx = getIndex();
  const existing = id ? (idx.tables.TfoPlans || []).find((p) => p.id === id) : null;
  if (id && !existing) {
    return (
      <div>
        <NavBar title="Plan" backLabel="Planner" backTo="/plans" />
        <Empty title={st.status.loading ? 'Loading…' : 'Plan not found'} />
      </div>
    );
  }
  const unitId = existing ? existing.unit_id : query.unit;
  if (!idx.unitsById[unitId]) {
    return (
      <div>
        <NavBar title="New plan" backLabel="Planner" backTo="/plans" />
        <Empty title={st.status.loading ? 'Loading…' : 'Unit not found'} />
      </div>
    );
  }
  return <PlanEditForm key={id || 'new'} id={id} query={query} unitId={unitId} />;
}

const strip = ({ updated_at, updated_by, ...rest }) => rest;

function PlanEditForm({ id, query, unitId }) {
  useStore();
  const idx = getIndex();
  const wide = useWide();
  const existing = id ? (idx.tables.TfoPlans || []).find((p) => p.id === id) : null;
  const unit = idx.unitsById[unitId];
  const [plan, setPlan] = useState(() => (existing ? strip(existing) : { unit_id: unitId, plan_date: query.date || today(), name: query.name || '', notes: '' }));
  const [lines, setLines] = useState(() => {
    if (!existing) return { looms: [], tfo: [], outside: [] };
    const l = planLines(idx, id);
    return { looms: l.looms.map(strip), tfo: l.tfo.map(strip), outside: l.outside.map(strip) };
  });
  const [busy, setBusy] = useState(false);
  const pc = useMemo(() => planCalc(plan, lines, idx), [plan, lines, idx]);
  const up = (k) => (v) => setPlan((p) => ({ ...p, [k]: v }));
  const setLine = (list, i, patch) => setLines((ls) => ({ ...ls, [list]: ls[list].map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const addLine = (list, row) => setLines((ls) => ({ ...ls, [list]: [...ls[list], row] }));
  const dropLine = (list, i) => setLines((ls) => ({ ...ls, [list]: ls[list].filter((_, j) => j !== i) }));

  const groups = idx.loomGroupsByUnit[unitId] || [];
  const types = pc.types;
  const assigned = new Set((idx.assignmentsByUnit[unitId] || []).map((a) => a.fabric_id));
  const allFabrics = Object.values(idx.fabricsById).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const fabricOptions = [
    { group: `In ${unit.name}`, options: allFabrics.filter((f) => assigned.has(f.id)).map((f) => ({ value: f.id, label: f.name })) },
    { group: 'Other fabrics', options: allFabrics.filter((f) => !assigned.has(f.id)).map((f) => ({ value: f.id, label: f.name })) },
  ].filter((g) => g.options.length);
  const tpmYarns = Object.values(idx.yarnsById).filter(isTpm).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const needed = new Set(pc.yarnRows.filter((y) => y.demand > 0).map((y) => y.yarn.id));
  const yarnOptions = [
    { group: 'Needed by this plan', options: tpmYarns.filter((y) => needed.has(y.id)).map((y) => ({ value: y.id, label: y.name })) },
    { group: 'Other TPM yarns', options: tpmYarns.filter((y) => !needed.has(y.id)).map((y) => ({ value: y.id, label: y.name })) },
  ].filter((g) => g.options.length);

  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(plan.plan_date || ''))) return toast('Choose the plan date', 'error');
    const clean = {
      looms: lines.looms.filter((l) => l.fabric_id || l.loom_group_id || num(l.looms)).map((l) => ({ ...l, looms: num(l.looms) ?? '', panna: num(l.panna) === 2 ? 2 : 1, rpm: num(l.rpm) ?? '' })),
      tfo: lines.tfo.filter((l) => l.yarn_id || l.tfo_type_id || num(l.sides)).map((l) => ({ ...l, sides: num(l.sides) ?? '' })),
      outside: lines.outside.filter((l) => l.yarn_id || num(l.kg_per_day)).map((l) => ({ ...l, kg_per_day: num(l.kg_per_day) ?? '', source: String(l.source || '').trim() })),
    };
    if (clean.looms.some((l) => !l.fabric_id || !l.loom_group_id)) return toast('Each loom line needs a loom group and a fabric', 'error');
    if (clean.tfo.some((l) => !l.yarn_id || !l.tfo_type_id)) return toast('Each TFO line needs a TFO type and a yarn', 'error');
    if (clean.outside.some((l) => !l.yarn_id)) return toast('Each outside yarn line needs a yarn', 'error');
    setBusy(true);
    try {
      const pid = await savePlan({ ...plan, name: String(plan.name || '').trim(), notes: String(plan.notes || '').trim() }, clean);
      if (existing) back(`/plan/${pid}`);
      else replace(`/plan/${pid}`);
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  }

  const loomLine = (l, i, showGroup) => {
    const r = pc.loomRows[i];
    const fabric = idx.fabricsById[l.fabric_id];
    const defRpm = fabric ? num(num(l.panna) === 2 ? fabric.loom_rpm_dp : fabric.loom_rpm) : null;
    return (
      <div class="line">
        <div class="line-top">
          {showGroup ? (
            <select value={l.loom_group_id || ''} aria-label="Loom group" onChange={(e) => setLine('looms', i, { loom_group_id: e.currentTarget.value })}>
              <option value="">Loom group</option>
              {groups.map((g) => <option value={g.id}>{groupLabel(g)}{num(g.looms) ? ` · ${num(g.looms)} looms` : ''}</option>)}
            </select>
          ) : (
            <select class="line-select" value={l.fabric_id || ''} aria-label="Fabric" onChange={(e) => setLine('looms', i, { fabric_id: e.currentTarget.value })}>
              <option value="">Fabric</option>
              {fabricOptions.map((g) => <optgroup label={g.group}>{g.options.map((o) => <option value={o.value}>{o.label}</option>)}</optgroup>)}
            </select>
          )}
          <IconButton label="Remove loom line" onClick={() => dropLine('looms', i)}><span class="bad"><Icon.trash size={20} /></span></IconButton>
        </div>
        {showGroup ? (
          <div class="line-bottom">
            <select class="line-select" value={l.fabric_id || ''} aria-label="Fabric" onChange={(e) => setLine('looms', i, { fabric_id: e.currentTarget.value })}>
              <option value="">Fabric</option>
              {fabricOptions.map((g) => <optgroup label={g.group}>{g.options.map((o) => <option value={o.value}>{o.label}</option>)}</optgroup>)}
            </select>
          </div>
        ) : null}
        <div class="line-bottom">
          <label class="mini"><span>Looms</span><input inputmode="numeric" value={l.looms ?? ''} onInput={(e) => setLine('looms', i, { looms: e.currentTarget.value })} aria-label="Number of looms" /></label>
          <label class="mini"><span>RPM</span><input inputmode="numeric" value={l.rpm ?? ''} placeholder={defRpm ? String(defRpm) : 'enter'} onInput={(e) => setLine('looms', i, { rpm: e.currentTarget.value })} aria-label="Loom RPM" /></label>
          <div class="mini-out"><span class="strong">{r && r.mPerDay !== null ? `${fmt.int(r.mPerDay)} m` : '—'}</span><span>per day</span></div>
        </div>
        <div class="line-bottom"><div style={{ width: '100%' }}><Segmented small label="Panna" options={[{ value: '1', label: 'Single panna' }, { value: '2', label: 'Double panna' }]} value={num(l.panna) === 2 ? '2' : '1'} onChange={(v) => setLine('looms', i, { panna: Number(v) })} /></div></div>
        {r && r.tpm.length ? <div class="row-sub" style={{ marginTop: '6px' }}>{r.tpm.map((x) => `${x.side} ${x.yarn.name} ${x.kg === null ? '—' : `${fmt.n(x.kg, 1)} kg/day`}`).join(' · ')}</div> : null}
        {r && r.problems.length && l.fabric_id && l.loom_group_id ? <div class="row-sub bad" style={{ marginTop: '4px' }}>{r.problems.join(' · ')}</div> : null}
      </div>
    );
  };

  // one section per loom group of the unit, always shown, with looms still available as lines are added or removed
  const strayLines = lines.looms.map((l, i) => ({ l, i })).filter(({ l }) => !groups.some((g) => g.id === l.loom_group_id));
  const loomSection = (
    <>
      {pc.groupUse.map((u) => {
        const mine = lines.looms.map((l, i) => ({ l, i })).filter(({ l }) => l.loom_group_id === u.group.id);
        const over = u.free !== null && u.free < 0;
        return (
          <Section header={groupLabel(u.group)} footer={mine.length ? null : 'No fabric on these looms yet.'}>
            <Row
              label="Looms"
              sub={u.have === null ? 'Set the loom count on the unit to see what is available.' : `${u.planned} used of ${u.have}`}
              value={<span class={`strong ${over ? 'bad' : u.free === 0 ? '' : 'good'}`}>{u.free === null ? `${u.planned} planned` : over ? `${-u.free} over` : `${u.free} available`}</span>}
            />
            {mine.map(({ l, i }) => loomLine(l, i, false))}
            <button type="button" class="add-row" onClick={() => addLine('looms', { loom_group_id: u.group.id, fabric_id: '', looms: '', panna: 1, rpm: '' })}><Icon.plus size={20} />Add fabric to these looms</button>
          </Section>
        );
      })}
      {strayLines.length ? <Section header="Lines without a loom group" footer="Choose a loom group, or remove the line.">{strayLines.map(({ l, i }) => loomLine(l, i, true))}</Section> : null}
      {!groups.length ? <Section header="Loom plan"><Row label="This unit has no loom groups" sub="Add them from the unit's Edit screen." /></Section> : null}
    </>
  );

  const tfoSection = (
    <Section header="TFO sides" footer={`Each machine has 2 sides and each side runs one yarn. A side is ${types.map((t) => `${spindlesPerSide(t)} spindles on ${t.name}`).join(', ') || `${DEFAULT_SPINDLES_PER_SIDE} spindles`}.`}>
      {lines.tfo.map((l, i) => {
        const r = pc.tfoRows[i];
        return (
          <div class="line">
            <div class="line-top">
              <select value={l.tfo_type_id || ''} aria-label="TFO type" onChange={(e) => setLine('tfo', i, { tfo_type_id: e.currentTarget.value })}>
                <option value="">TFO type</option>
                {pc.typeUse.map((u) => <option value={u.type.id}>{u.type.name}{u.idle !== null ? ` · ${u.idle} sides free` : ''}</option>)}
              </select>
              <IconButton label="Remove TFO line" onClick={() => dropLine('tfo', i)}><span class="bad"><Icon.trash size={20} /></span></IconButton>
            </div>
            <div class="line-bottom">
              <select class="line-select" value={l.yarn_id || ''} aria-label="TPM yarn" onChange={(e) => setLine('tfo', i, { yarn_id: e.currentTarget.value })}>
                <option value="">TPM yarn</option>
                {yarnOptions.map((g) => <optgroup label={g.group}>{g.options.map((o) => <option value={o.value}>{o.label}</option>)}</optgroup>)}
              </select>
            </div>
            <div class="line-bottom">
              <label class="mini"><span>Sides</span><input inputmode="numeric" value={l.sides ?? ''} onInput={(e) => setLine('tfo', i, { sides: e.currentTarget.value })} aria-label="Number of sides" /></label>
              <div class="mini-out"><span class="strong">{r ? fmt.int(r.spindles) : '—'}</span><span>spindles</span></div>
              <div class="mini-out"><span class="strong">{r && r.kg !== null ? `${fmt.n(r.kg, 1)} kg` : '—'}</span><span>per day</span></div>
            </div>
            {r && r.problems.length && l.yarn_id && l.tfo_type_id ? <div class="row-sub bad" style={{ marginTop: '4px' }}>{r.problems.join(' · ')}</div> : null}
          </div>
        );
      })}
      <button type="button" class="add-row" onClick={() => addLine('tfo', { tfo_type_id: types.length === 1 ? types[0].id : '', yarn_id: '', sides: '' })}><Icon.plus size={20} />Add TFO line</button>
    </Section>
  );

  const outsideSection = (
    <Section header="Yarn from outside" footer="Twisted yarn bought in or done on job work, kg per day. It is taken off the demand before spindles are worked out.">
      {lines.outside.map((l, i) => (
        <div class="line">
          <div class="line-top">
            <select value={l.yarn_id || ''} aria-label="Outside yarn" onChange={(e) => setLine('outside', i, { yarn_id: e.currentTarget.value })}>
              <option value="">TPM yarn</option>
              {yarnOptions.map((g) => <optgroup label={g.group}>{g.options.map((o) => <option value={o.value}>{o.label}</option>)}</optgroup>)}
            </select>
            <IconButton label="Remove outside yarn line" onClick={() => dropLine('outside', i)}><span class="bad"><Icon.trash size={20} /></span></IconButton>
          </div>
          <div class="line-bottom">
            <label class="mini"><span>kg/day</span><input inputmode="decimal" value={l.kg_per_day ?? ''} onInput={(e) => setLine('outside', i, { kg_per_day: e.currentTarget.value })} aria-label="kg per day" /></label>
            <label class="mini" style={{ flex: 1.4 }}><span>From</span><input value={l.source ?? ''} placeholder="supplier" onInput={(e) => setLine('outside', i, { source: e.currentTarget.value })} aria-label="From" /></label>
          </div>
        </div>
      ))}
      <button type="button" class="add-row" onClick={() => addLine('outside', { yarn_id: '', kg_per_day: '', source: '' })}><Icon.plus size={20} />Add outside yarn</button>
    </Section>
  );

  // live balance while editing, so sides can be given out to match
  const liveSection = (
    <Section header="Balance as you edit" footer={pc.totals.idleSides !== null ? `${pc.totals.idleSides} ${pc.totals.idleSides === 1 ? 'side' : 'sides'} free across ${types.map((t) => t.name).join(' and ')}.` : null}>
      {pc.yarnRows.map((y) => (
        <Row
          label={y.yarn.name}
          sub={`Needed ${y.required === null ? '—' : fmt.int(y.required)}${y.sidesNeeded !== null ? ` (${fmt.n(y.sidesNeeded, 1)} sides)` : ''} · given ${fmt.int(y.allocSpindles)}`}
          value={<span class={`strong ${y.status === 'short' ? 'bad' : y.status === 'unknown' ? '' : 'good'}`}>{y.status === 'unknown' ? '—' : signed(y.balanceSpindles)}</span>}
          valueSub={y.balanceSides === null ? STATUS[y.status][1] : `${y.balanceSides >= 0 ? '+' : '−'}${fmt.n(Math.abs(y.balanceSides), 1)} sides`}
        />
      ))}
      {!pc.yarnRows.length ? <Row label="Add a loom line to see what's needed" /> : null}
    </Section>
  );
  const runningLive = (
    <Section header="Running yarn as you edit" footer={pc.runningRows.length ? `Total ${fmt.n(pc.totals.running, 1)} kg/day: warp ${fmt.n(pc.totals.runningWarp, 1)}, weft ${fmt.n(pc.totals.runningWeft, 1)}.` : null}>
      {pc.runningRows.map((r) => <RunningCard r={r} />)}
      {!pc.runningRows.length ? <Row label="Add a loom line to see the yarn running" /> : null}
    </Section>
  );

  return (
    <div>
      <NavBar
        title={existing ? 'Edit plan' : 'New plan'}
        left={<TextButton onClick={() => back(existing ? `/plan/${id}` : `/plans?unit=${unitId}`)}>Cancel</TextButton>}
        right={<TextButton bold onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</TextButton>}
      />
      <Section header={unit.name}>
        <Field label="Date" required type="date" value={plan.plan_date} onInput={up('plan_date')} />
        <Field label="Name" value={plan.name} onInput={up('name')} placeholder="e.g. Nov plan" />
        <Field label="Notes" value={plan.notes} onInput={up('notes')} placeholder="optional" />
      </Section>
      {wide ? (
        <div class="detail-cols">
          <div class="col">{loomSection}{outsideSection}</div>
          <div class="col">{liveSection}{runningLive}{tfoSection}</div>
        </div>
      ) : (
        <>
          {loomSection}
          {tfoSection}
          {outsideSection}
          {liveSection}
          {runningLive}
        </>
      )}
    </div>
  );
}
