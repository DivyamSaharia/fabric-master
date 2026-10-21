import { useEffect, useState } from 'preact/hooks';
import { fabricCalc, fmt, isTpm, num, spindlesForUnit, tfoEff, tfoOutput, truthy, yarnDenier } from '../calc.js';
import { deleteSpeed, deleteUnit, getIndex, saveSpeed, saveUnit, toast, useStore } from '../store.js';
import { back, go, replace } from '../router.js';
import { PanBlocks } from './fabrics.jsx';
import { DEFAULT_SPINDLES_PER_SIDE, planCalc, planLines, planVerdict, plansOf, typeCapacity } from '../planner.js';
import { dateText } from './plans.jsx';
import { Button, Empty, Field, Icon, IconButton, NavBar, NumField, Row, Section, Segmented, SelectField, Sheet, TextButton, Toggle, classBadge, History } from '../ui.jsx';

export function UnitList() {
  const st = useStore();
  const idx = getIndex();
  const units = (st.tables.Units || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return (
    <div>
      <NavBar large title="Units" right={<IconButton label="Add unit" onClick={() => go('/unit/new')}><Icon.plus size={26} /></IconButton>} />
      <div class="list-meta"><span>{units.length} units</span><span>Cost per pick</span></div>
      {units.length ? (
        <div class="group">
          {units.map((u) => {
            const n = (idx.assignmentsByUnit[u.id] || []).length;
            const types = (idx.tfoTypesByUnit[u.id] || []).length;
            return (
              <Row
                label={u.name}
                sub={[u.type, `${n} ${n === 1 ? 'fabric' : 'fabrics'}`, truthy(u.has_tfo) ? `TFO · ${types} ${types === 1 ? 'type' : 'types'}` : 'No TFO'].filter(Boolean).join(' · ')}
                value={<span class="strong">{fmt.pick(num(u.cost_per_pick))}</span>}
                onClick={() => go(`/unit/${u.id}`)}
                chevron
              />
            );
          })}
        </div>
      ) : (
        <Empty title="No units yet" text="Add each airjet or waterjet unit with its cost per pick." action={<div style={{ width: '220px' }}><Button onClick={() => go('/unit/new')}>Add unit</Button></div>} />
      )}
    </div>
  );
}

export function UnitDetail({ id }) {
  useStore();
  const idx = getIndex();
  const unit = idx.unitsById[id];
  const [speed, setSpeed] = useState(null);
  if (!unit) {
    return (
      <div>
        <NavBar title="Unit" backLabel="Units" backTo="/units" />
        <Empty title="Unit not found" />
      </div>
    );
  }
  const fabrics = (idx.assignmentsByUnit[id] || []).map((a) => idx.fabricsById[a.fabric_id]).filter(Boolean);
  const types = idx.tfoTypesByUnit[id] || [];
  const speeds = idx.speedsByUnit[id] || [];
  const groups = idx.loomGroupsByUnit[id] || [];
  const hasTfo = truthy(unit.has_tfo);
  const plans = plansOf(idx, id);
  const latest = plans[0] || null;
  const verdict = latest ? planVerdict(planCalc(latest, planLines(idx, latest.id), idx)) : null;
  const tpmFabrics = fabrics.map((f) => ({ f, c: fabricCalc(f, idx) })).filter((x) => x.c.tpmLines.length).sort((a, b) => String(a.f.name).localeCompare(String(b.f.name)));

  // speed table grouped by TPM yarn
  const byYarn = {};
  for (const s of speeds) (byYarn[s.yarn_id] ||= []).push(s);
  const yarnIds = Object.keys(byYarn).sort((a, b) => String((idx.yarnsById[a] || {}).name).localeCompare(String((idx.yarnsById[b] || {}).name)));

  // TPM yarns used by this unit's fabrics that lack a speed on some TFO type
  const missing = [];
  const needYarns = new Map();
  for (const { c } of tpmFabrics) for (const x of c.tpmLines) needYarns.set(x.yarn.id, x.yarn);
  for (const y of needYarns.values()) for (const t of types) if (!speeds.some((s) => s.yarn_id === y.id && s.tfo_type_id === t.id)) missing.push({ y, t });

  return (
    <div>
      <NavBar title={unit.name} backLabel="Units" backTo="/units" right={<TextButton onClick={() => go(`/unit/${id}/edit`)}>Edit</TextButton>} />
      <div class="title-block" style={{ paddingTop: '4px' }}>
        <h1>{unit.name}</h1>
        <div class="title-sub">{[unit.type, unit.notes].filter(Boolean).join(' · ') || 'Unit'}</div>
      </div>

      <div class="detail-cols">
      <div class="col">
      <Section>
        <Row label="Cost per pick" value={<span class="strong">{fmt.pick(num(unit.cost_per_pick))}</span>} />
        <Row label="Loom efficiency" value={num(unit.loom_eff_pct) === null ? '—' : `${num(unit.loom_eff_pct)}%`} />
        <Row label="Fabric database" value={`${fabrics.length} ${fabrics.length === 1 ? 'fabric' : 'fabrics'}`} onClick={() => go(`/fabrics?unit=${id}`)} chevron />
      </Section>

      <Section header="Loom groups · for reference">
        {groups.map((g) => <Row label={[g.make, g.reed_width_cm ? `${g.reed_width_cm} cm` : null, g.shedding].filter(Boolean).join(' · ') || 'Loom group'} value={num(g.looms) ? `${g.looms} looms` : '—'} />)}
        {!groups.length ? <Row label="None added" sub="Add them from Edit." /> : null}
      </Section>

      {hasTfo ? (
        <>
          <Section header="TFO types" footer={types.length ? `Efficiency per TFO type; a type without one uses the unit default of ${num(unit.tfo_default_eff) ?? '—'}%. A speed can still set its own.` : 'Add a TFO type from Edit, e.g. M/C 1–12 and M/C 13–16, for each set of machines that runs at its own speed.'}>
            {types.map((t) => {
              const cap = typeCapacity(t);
              return <Row label={t.name} sub={[cap.machines === null ? 'Machines not set' : `${cap.machines} machines · ${cap.sides} sides · ${fmt.int(cap.spindles)} spindles`, `${tfoEff(null, t, unit) ?? '—'}% efficiency${num(t.efficiency) === null ? ' (unit default)' : ''}`].join(' · ')} value={`${speeds.filter((s) => s.tfo_type_id === t.id).length} speeds`} />;
            })}
            {!types.length ? <Row label="No TFO types yet" /> : null}
          </Section>

          <Section header="TFO planner" footer="Dated plans: what each loom group runs, how TFO sides are given out, and yarn bought in. Shows the surplus or deficit of spindles for each TPM yarn.">
            {latest ? <Row label={`Latest · ${dateText(latest.plan_date)}`} sub={latest.name || null} value={<span class={verdict.kind === 'bad' ? 'bad' : verdict.kind === 'good' ? 'good' : ''}>{verdict.text}</span>} onClick={() => go(`/plan/${latest.id}`)} chevron /> : null}
            <Row label="All plans" value={String(plans.length)} onClick={() => go(`/plans?unit=${id}`)} chevron />
          </Section>

          <Section header="TFO speed table" footer={<><strong class="note-strong">Enter RPM already multiplied by 2. The app does not double it.</strong> Output per spindle = RPM ÷ TPM × 1,440 minutes × efficiency × denier ÷ 9,000,000.</>}>
            {yarnIds.map((yid) =>
              byYarn[yid]
                .slice()
                .sort((a, b) => String((types.find((t) => t.id === a.tfo_type_id) || {}).name).localeCompare(String((types.find((t) => t.id === b.tfo_type_id) || {}).name)))
                .map((s) => {
                  const y = idx.yarnsById[yid];
                  const t = types.find((x) => x.id === s.tfo_type_id);
                  const eff = tfoEff(s, t, unit);
                  const q = y ? tfoOutput(s.rpm, y.tpm, eff, yarnDenier(y, idx)) : null;
                  return (
                    <Row
                      label={y ? y.name : 'Yarn deleted'}
                      sub={`${t ? t.name : 'Type deleted'} · ${fmt.int(num(s.rpm))} RPM · ${eff ?? '—'}%`}
                      value={<span class="strong">{q === null ? '—' : `${fmt.n(q, 3)} kg`}</span>}
                      valueSub="per spindle-day"
                      onClick={() => setSpeed(s)}
                    />
                  );
                }),
            )}
            {!speeds.length ? <Row label="No speeds yet" sub="Add a speed for each TPM yarn on each TFO type." /> : null}
            <button type="button" class="add-row" onClick={() => setSpeed({ unit_id: id })} disabled={!types.length}><Icon.plus size={20} />Add speed</button>
          </Section>
          {missing.length ? (
            <div class="notice">Missing speeds for this unit's fabrics: {missing.map((m) => `${m.y.name} on ${m.t.name}`).join('; ')}.</div>
          ) : null}
        </>
      ) : (
        <Section footer="Turn on the TFO division from Edit to add TFO types, speeds and spindle requirement.">
          <Row label="TFO division" value="No" />
        </Section>
      )}
      <History row={unit} what="unit" />
      </div>
      {hasTfo ? (
        <div class="col">
          <Section header="Spindle requirement · per loom" footer={tpmFabrics.length ? "For each TPM fabric in this unit, on every TFO type, for single and double panna. Uses the fabric's loom RPM and this unit's loom efficiency." : null}>
            {tpmFabrics.map(({ f, c }) => <SpindleCard fabric={f} calc={c} unit={unit} idx={idx} />)}
            {!tpmFabrics.length ? <Row label="No TPM fabrics in this unit" /> : null}
          </Section>
        </div>
      ) : null}
      </div>

      <SpeedSheet speed={speed} unit={unit} idx={idx} onClose={() => setSpeed(null)} />
    </div>
  );
}

function SpindleCard({ fabric, calc, unit, idx }) {
  const spins = spindlesForUnit(calc, fabric, unit, idx);
  const multi = calc.tpmLines.length > 1;
  return (
    <button type="button" class="unit-card" style={{ border: 0, background: 'none', textAlign: 'left', width: '100%', color: 'inherit' }} onClick={() => go(`/fabric/${fabric.id}`)}>
      <div class="unit-head">
        <div style={{ minWidth: 0 }}>
          <div class="row-label strong">{fabric.name}</div>
          <div class="row-sub">{calc.tpmLines.map((x) => `${x.line.side} ${x.yarn.name}`).join(' · ')}</div>
        </div>
        {classBadge(calc.tfoClass)}
      </div>
      {spins.length ? (
        <PanBlocks calc={calc} fabric={fabric} unit={unit} idx={idx} showNote={multi} />
      ) : (
        <div class="row-sub">Add TFO types to this unit to see spindles.</div>
      )}
    </button>
  );
}

function SpeedSheet({ speed, unit, idx, onClose }) {
  const [s, setS] = useState(speed || {});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setS(speed ? { ...speed } : {});
  }, [speed]);
  if (!speed) return null;
  const types = idx.tfoTypesByUnit[unit.id] || [];
  const tpmYarns = Object.values(idx.yarnsById).filter(isTpm).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const y = idx.yarnsById[s.yarn_id];
  const type = types.find((t) => t.id === s.tfo_type_id) || null;
  const eff = tfoEff(s, type, unit);
  const typeEff = tfoEff(null, type, unit);
  const q = y ? tfoOutput(s.rpm, y.tpm, eff, yarnDenier(y, idx)) : null;
  const up = (k) => (v) => setS((x) => ({ ...x, [k]: v }));
  return (
    <Sheet
      open={!!speed}
      onClose={onClose}
      title={speed.id ? 'Edit speed' : 'Add speed'}
      footer={
        <div style={{ display: 'flex', gap: '10px' }}>
          {speed.id ? <Button kind="danger" busy={busy} onClick={async () => { setBusy(true); try { await deleteSpeed(speed.id); onClose(); } catch (e) { toast(e.message, 'error'); } setBusy(false); }}>Remove</Button> : null}
          <Button busy={busy} onClick={async () => {
            if (!s.yarn_id || !s.tfo_type_id || !num(s.rpm)) {
              toast('Choose the TPM yarn and TFO type, and enter the RPM', 'error');
              return;
            }
            setBusy(true);
            try {
              await saveSpeed({ id: s.id, unit_id: unit.id, yarn_id: s.yarn_id, tfo_type_id: s.tfo_type_id, rpm: num(s.rpm), efficiency: s.efficiency === '' || s.efficiency === undefined ? '' : num(s.efficiency) });
              onClose();
            } catch (e) {
              toast(e.message, 'error');
            }
            setBusy(false);
          }}>Save</Button>
        </div>
      }
    >
      <Section header={unit.name} footer={<><strong class="note-strong">Enter RPM already multiplied by 2. The app does not double it.</strong>{y && !num(y.tpm) ? ' This TPM yarn has no TPM value yet. Add it in Yarns.' : ''}</>}>
        <SelectField label="TPM yarn" required value={s.yarn_id} onChange={up('yarn_id')} options={tpmYarns.map((t) => ({ value: t.id, label: t.name }))} />
        <SelectField label="TFO type" required value={s.tfo_type_id} onChange={up('tfo_type_id')} options={types.map((t) => ({ value: t.id, label: t.name }))} />
        <NumField label="RPM" hint="already × 2" required value={s.rpm} onInput={up('rpm')} />
        <NumField label="Efficiency" value={s.efficiency} onInput={up('efficiency')} suffix="%" placeholder={typeEff !== null ? String(typeEff) : ''} hint={type ? `blank = ${type.name}'s` : undefined} />
      </Section>
      <Section>
        <Row label="Output" strong value={<span class="strong">{q === null ? '—' : `${fmt.n(q, 3)} kg`}</span>} valueSub="per spindle per day" />
      </Section>
    </Sheet>
  );
}

const blankUnit = () => ({ name: '', type: 'Airjet', cost_per_pick: '', loom_eff_pct: '', has_tfo: false, tfo_default_eff: '', notes: '' });

export function UnitEdit({ id }) {
  const st = useStore();
  const existing = id ? getIndex().unitsById[id] : null;
  if (id && !existing) {
    return (
      <div>
        <NavBar title="Unit" backLabel="Units" backTo="/units" />
        <Empty title={st.status.loading ? 'Loading…' : 'Unit not found'} />
      </div>
    );
  }
  return <UnitEditForm key={id || 'new'} id={id} />;
}

function UnitEditForm({ id }) {
  useStore();
  const idx = getIndex();
  const existing = id ? idx.unitsById[id] : null;
  const [u, setU] = useState(() => ({ ...blankUnit(), ...(existing || {}), has_tfo: existing ? truthy(existing.has_tfo) : false }));
  const [groups, setGroups] = useState(() => (existing ? (idx.loomGroupsByUnit[id] || []).map((g) => ({ ...g })) : []));
  const [types, setTypes] = useState(() => (existing ? (idx.tfoTypesByUnit[id] || []).map((t) => ({ ...t })) : []));
  const [busy, setBusy] = useState(false);
  const up = (k) => (v) => setU((x) => ({ ...x, [k]: v }));
  if (id && !existing) {
    return (
      <div>
        <NavBar title="Unit" backLabel="Units" backTo="/units" />
        <Empty title="Unit not found" />
      </div>
    );
  }
  const setGroup = (i, patch) => setGroups((gs) => gs.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const setType = (i, patch) => setTypes((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  async function save() {
    if (!String(u.name || '').trim()) {
      toast('Add a unit name first', 'error');
      return;
    }
    if (u.cost_per_pick !== '' && num(u.cost_per_pick) === null) {
      toast('Cost per pick must be a number', 'error');
      return;
    }
    const keptTypes = u.has_tfo ? types : [];
    const dropping = (idx.tfoTypesByUnit[id] || []).filter((t) => !keptTypes.some((x) => x.id === t.id));
    const droppingGroups = (idx.loomGroupsByUnit[id] || []).filter((g) => !groups.some((x) => x.id === g.id));
    const planHits = (idx.tables.PlanTfo || []).filter((l) => dropping.some((t) => t.id === l.tfo_type_id)).length + (idx.tables.PlanLooms || []).filter((l) => droppingGroups.some((g) => g.id === l.loom_group_id)).length;
    const planNote = planHits ? ` ${planHits} TFO plan ${planHits === 1 ? 'line goes' : 'lines go'} too.` : '';
    if (dropping.length && !window.confirm(`Removing ${dropping.map((t) => t.name).join(', ')} also removes its speeds.${planNote} Continue?`)) return;
    if (!dropping.length && planHits && !window.confirm(`Removing that loom group also removes it from TFO plans.${planNote} Continue?`)) return;
    setBusy(true);
    try {
      const uid = await saveUnit(
        { ...u, name: u.name.trim(), cost_per_pick: num(u.cost_per_pick) ?? '', tfo_default_eff: num(u.tfo_default_eff) ?? '', loom_eff_pct: num(u.loom_eff_pct) ?? '' },
        groups.map((g) => ({ ...g, reed_width_cm: num(g.reed_width_cm) ?? '', looms: num(g.looms) ?? '' })),
        u.has_tfo ? types.map((t) => ({ ...t, machines: num(t.machines) ?? '', spindles_per_side: num(t.spindles_per_side) ?? '', efficiency: num(t.efficiency) ?? '' })) : [],
      );
      if (existing) back(`/unit/${uid}`);
      else replace(`/unit/${uid}`);
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  }

  return (
    <div>
      <NavBar
        title={existing ? 'Edit unit' : 'New unit'}
        left={<TextButton onClick={() => back(existing ? `/unit/${id}` : '/units')}>Cancel</TextButton>}
        right={<TextButton bold onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</TextButton>}
      />
      <Section header="Unit" footer="Cost per pick is ₹ per metre per pick of PPI, one constant per unit. Loom efficiency applies to every fabric in the unit.">
        <Field label="Name" required value={u.name} onInput={up('name')} placeholder="e.g. Unit 2" />
        <div class="row"><div style={{ width: '100%' }}><Segmented label="Loom type" options={['Airjet', 'Waterjet']} value={u.type || 'Airjet'} onChange={up('type')} /></div></div>
        <NumField label="Cost per pick" prefix="₹" value={u.cost_per_pick} onInput={up('cost_per_pick')} placeholder="0.200" />
        <NumField label="Loom efficiency" value={u.loom_eff_pct} onInput={up('loom_eff_pct')} suffix="%" placeholder="93" />
        <Field label="Notes" value={u.notes} onInput={up('notes')} placeholder="e.g. Toyota airjet" />
      </Section>

      <Section header="Loom groups · for reference">
        {groups.map((g, i) => (
          <div class="line">
            <div class="line-top">
              <label class="mini" style={{ flex: 2 }}><span>Make</span><input value={g.make ?? ''} onInput={(e) => setGroup(i, { make: e.currentTarget.value })} aria-label="Make" style={{ textAlign: 'right' }} /></label>
              <IconButton label="Remove loom group" onClick={() => setGroups((gs) => gs.filter((_, j) => j !== i))}><span class="bad"><Icon.trash size={20} /></span></IconButton>
            </div>
            <div class="line-bottom">
              <label class="mini"><span>Width cm</span><input inputmode="decimal" value={g.reed_width_cm ?? ''} onInput={(e) => setGroup(i, { reed_width_cm: e.currentTarget.value })} aria-label="Reed width in cm" /></label>
              <label class="mini"><span>Looms</span><input inputmode="numeric" value={g.looms ?? ''} onInput={(e) => setGroup(i, { looms: e.currentTarget.value })} aria-label="Number of looms" /></label>
            </div>
            <div class="line-bottom"><div style={{ width: '100%' }}><Segmented small label="Shedding" options={['Plain', 'Cam', 'Dobby']} value={g.shedding || 'Plain'} onChange={(v) => setGroup(i, { shedding: v })} /></div></div>
          </div>
        ))}
        <button type="button" class="add-row" onClick={() => setGroups((gs) => [...gs, { make: '', reed_width_cm: '', shedding: 'Plain', looms: '' }])}><Icon.plus size={20} />Add loom group</button>
      </Section>

      <Section header="TFO" footer={u.has_tfo ? 'Each TFO type is a set of machines that runs at its own speed. Every machine has 2 sides; each side runs one yarn quality. Speeds are added on the unit page.' : null}>
        <Toggle label="TFO division" value={!!u.has_tfo} onChange={up('has_tfo')} />
        {u.has_tfo ? <NumField label="Default TFO efficiency" hint="for types without their own" value={u.tfo_default_eff} onInput={up('tfo_default_eff')} suffix="%" placeholder="90" /> : null}
      </Section>
      {u.has_tfo ? (
        <Section header="TFO types">
          {types.map((t, i) => (
            <div class="line">
              <div class="line-top">
                <label class="mini" style={{ flex: 1 }}><span>Name</span><input value={t.name ?? ''} placeholder="M/C 1–12" onInput={(e) => setType(i, { name: e.currentTarget.value })} aria-label="TFO type name" style={{ textAlign: 'right' }} /></label>
                <IconButton label="Remove TFO type" onClick={() => setTypes((ts) => ts.filter((_, j) => j !== i))}><span class="bad"><Icon.trash size={20} /></span></IconButton>
              </div>
              <div class="line-bottom">
                <label class="mini"><span>Machines</span><input inputmode="numeric" value={t.machines ?? ''} placeholder="12" onInput={(e) => setType(i, { machines: e.currentTarget.value })} aria-label="Number of machines" /></label>
                <label class="mini"><span>Spindles/side</span><input inputmode="numeric" value={t.spindles_per_side ?? ''} placeholder={String(DEFAULT_SPINDLES_PER_SIDE)} onInput={(e) => setType(i, { spindles_per_side: e.currentTarget.value })} aria-label="Spindles per side" /></label>
              </div>
              <div class="line-bottom">
                <label class="mini"><span>Efficiency %</span><input inputmode="decimal" value={t.efficiency ?? ''} placeholder={u.tfo_default_eff !== '' && u.tfo_default_eff !== undefined ? String(u.tfo_default_eff) : '85'} onInput={(e) => setType(i, { efficiency: e.currentTarget.value })} aria-label="TFO type efficiency" /></label>
              </div>
            </div>
          ))}
          <button type="button" class="add-row" onClick={() => setTypes((ts) => [...ts, { name: '' }])}><Icon.plus size={20} />Add TFO type</button>
        </Section>
      ) : null}

      {existing ? (
        <div class="actions">
          <Button kind="danger" onClick={async () => {
            if (!window.confirm(`Delete ${existing.name}? Its fabric links, loom groups, TFO types and speeds go too. Fabrics stay.`)) return;
            try {
              await deleteUnit(existing.id);
              replace('/units');
            } catch (e) {
              toast(e.message, 'error');
            }
          }}><Icon.trash size={20} /> Delete unit</Button>
        </div>
      ) : null}
    </div>
  );
}
