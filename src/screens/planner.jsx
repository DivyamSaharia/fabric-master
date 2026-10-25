// TFO planner: an average day at a unit. Looms per quality per loom group, TFO sides per TPM yarn per TFO type
// and yarn bought in → consumption of every yarn, balance per TPM yarn (kg) and the plant's realisation.
// The open plan is a working draft kept on this device; plans are saved by date to the Sheet (TfoBalancePlans/Lines).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { fmt, num } from '../calc.js';
import { deletePlan, duplicatePlan, getIndex, savePlan, toast, useStore } from '../store.js';
import { local } from '../storage.js';
import {
  cleanPlan, computePlan, defaultPlanName, emptyPlan, groupLabel, groupOptions, keys, linesToPlan,
  planSig, planSummary, planToLines, resetAll, tfoUnits, todayIst, tpmYarns, withSetting,
} from '../planner.js';
import { Badge, Button, Empty, Icon, IconButton, NavBar, SearchPicker, Segmented, Sheet, TextButton, Toggle, useWide } from '../ui.jsx';
import { SheetImport } from './sheetImport.jsx';

const KEY = 'fm.planner.v1';

// ---------- the working draft, per unit, on this device ----------
function readStore() {
  const s = local.get(KEY, null);
  return s && typeof s === 'object' ? { unitId: s.unitId || '', drafts: s.drafts && typeof s.drafts === 'object' ? s.drafts : {}, assignedOnly: !!s.assignedOnly } : { unitId: '', drafts: {}, assignedOnly: false };
}

const blankDraft = (unitId) => {
  const plan = emptyPlan(unitId);
  return { plan, planId: null, name: '', date: '', savedSig: planSig(plan) };
};

function normalDraft(d, unitId) {
  if (!d || !d.plan) return blankDraft(unitId);
  const plan = { ...emptyPlan(unitId), ...d.plan, unitId };
  return { plan, planId: d.planId || null, name: d.name || '', date: d.date || '', savedSig: d.savedSig ?? planSig(emptyPlan(unitId)) };
}

const parseSummary = (s) => {
  try {
    const v = JSON.parse(s || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
};

const kg = (v, dp = 1) => (v === null || v === undefined ? '—' : `${fmt.n(v, dp)} kg`);
const signedKg = (v) => (v === null || v === undefined ? '—' : `${v > 0.05 ? '+' : v < -0.05 ? '−' : ''}${fmt.n(Math.abs(v), 1)} kg`);
const mtr = (v) => (v === null || v === undefined ? '—' : `${fmt.int(v)} m`);
const rs0 = (v) => (v === null || v === undefined ? '—' : fmt.rs(v, 0));
const effText = (v) => (v === null || v === undefined ? '—' : fmt.n(v, v % 1 ? 1 : 0));

// ---------- inputs ----------
// A number box that keeps what you type while it has focus (so clearing it to type a new value does not snap back).
function NumBox({ value, onChange, label, placeholder, need, edited, focusKey, pendingFocus, wide }) {
  const ref = useRef(null);
  const [text, setText] = useState(null);
  useEffect(() => {
    if (focusKey && pendingFocus && pendingFocus.current === focusKey) {
      pendingFocus.current = null;
      setTimeout(() => {
        if (ref.current) {
          ref.current.focus();
          ref.current.select();
        }
      }, 80);
    }
  }, []);
  const shown = text !== null ? text : value === null || value === undefined ? '' : String(value);
  return (
    <input
      ref={ref}
      class={`pbox ${edited ? 'edited' : ''} ${need ? 'need' : ''} ${wide ? 'wide' : ''}`}
      type="text"
      inputmode="decimal"
      aria-label={label}
      placeholder={placeholder}
      value={shown}
      onFocus={(e) => setText(e.currentTarget.value)}
      onInput={(e) => {
        const v = e.currentTarget.value;
        setText(v);
        onChange(v);
      }}
      onBlur={() => setText(null)}
    />
  );
}

// A setting box: prefilled from master, lime with "edited" when changed, Reset back to master.
function SettingBox({ s, label, onChange, needText = 'Enter' }) {
  return (
    <div class="sbox">
      <NumBox value={s.value} label={label} placeholder={s.missing ? needText : ''} need={s.missing} edited={s.edited} onChange={onChange} />
      {s.edited ? (
        <div class="sbox-note">
          <span class="ed-tag">edited</span>
          <span>{s.master === null ? 'no master' : `master ${fmt.n(s.master, s.master % 1 ? 1 : 0)}`}</span>
          <button type="button" class="link-btn" onClick={() => onChange('')}>Reset</button>
        </div>
      ) : null}
    </div>
  );
}

function Labeled({ label, children }) {
  return (
    <label class="lbox">
      <span class="lbox-label">{label}</span>
      {children}
    </label>
  );
}

// ---------- in-page confirm ----------
function Confirm({ open, title, text, yes, onYes, onClose, danger }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p class="confirm-text">{text}</p>
      <div class="actions" style={{ marginTop: '16px' }}>
        <Button kind={danger ? 'danger' : 'primary'} onClick={() => { onClose(); onYes(); }}>{yes}</Button>
        <Button kind="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </Sheet>
  );
}

// ---------- the screen ----------
export function Planner() {
  const st = useStore();
  const idx = getIndex();
  const wide = useWide();
  const units = tfoUnits(idx);
  const [store, setStore] = useState(readStore);
  const unitId = units.some((u) => u.id === store.unitId) ? store.unitId : units[0] ? units[0].id : '';
  const draft = normalDraft(store.drafts[unitId], unitId);
  const savedPlans = (idx.tables.TfoBalancePlans || []).filter((p) => p.unit_id === unitId);
  const planRow = draft.planId ? savedPlans.find((p) => p.id === draft.planId) || null : null;
  const plan = draft.plan;
  const model = useMemo(() => computePlan(plan, idx), [plan, idx]);
  const unsaved = planSig(plan) !== draft.savedSig || (draft.planId && !planRow);
  const [sheet, setSheet] = useState(null); // 'save' | 'plans' | 'export' | 'reset' | 'clear' | 'import'
  const pendingFocus = useRef(null);

  useEffect(() => local.set(KEY, store), [store]);

  const setDraft = (patch) => setStore((s) => {
    const cur = normalDraft(s.drafts[unitId], unitId);
    const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
    return { ...s, unitId, drafts: { ...s.drafts, [unitId]: next } };
  });
  const setPlan = (fn) => setDraft((d) => ({ ...d, plan: fn(d.plan) }));

  if (!units.length) {
    return (
      <div>
        <NavBar large title="TFO planner" />
        <Empty title={st.status.loading ? 'Loading…' : 'No unit with a TFO division'} text={st.status.loading ? '' : 'Turn on TFO for a unit and add its TFO types on the Units tab.'} />
      </div>
    );
  }

  // ----- edits -----
  const addLoom = (groupId, fabricId) => {
    if (!fabricId) return;
    pendingFocus.current = `looms:${fabricId}:${groupId}`;
    setPlan((p) => (p.looms.some((r) => r.fabricId === fabricId && r.groupId === groupId) ? p : { ...p, looms: [...p.looms, { fabricId, groupId, looms: '' }] }));
  };
  const setLooms = (fabricId, groupId, v) => setPlan((p) => ({ ...p, looms: p.looms.map((r) => (r.fabricId === fabricId && r.groupId === groupId ? { ...r, looms: v } : r)) }));
  const removeLoom = (fabricId, groupId) => setPlan((p) => {
    const settings = { ...p.settings };
    delete settings[keys.rpm(fabricId, groupId)];
    delete settings[keys.eff(fabricId, groupId)];
    const soldAs = { ...p.soldAs };
    delete soldAs[`${fabricId}:${groupId}`];
    return { ...p, settings, soldAs, looms: p.looms.filter((r) => !(r.fabricId === fabricId && r.groupId === groupId)) };
  });
  const setSoldAs = (k, v) => setPlan((p) => {
    const soldAs = { ...p.soldAs };
    if (v === 'rfd') soldAs[k] = 'rfd';
    else delete soldAs[k];
    return { ...p, soldAs };
  });
  const addSide = (typeId, yarnId) => {
    if (!yarnId) return;
    pendingFocus.current = `sides:${yarnId}:${typeId}`;
    setPlan((p) => (p.sides.some((r) => r.yarnId === yarnId && r.typeId === typeId) ? p : { ...p, sides: [...p.sides, { yarnId, typeId, sides: '' }] }));
  };
  const setSides = (yarnId, typeId, v) => setPlan((p) => ({ ...p, sides: p.sides.map((r) => (r.yarnId === yarnId && r.typeId === typeId ? { ...r, sides: v } : r)) }));
  const removeSide = (yarnId, typeId) => setPlan((p) => {
    const settings = { ...p.settings };
    delete settings[keys.tfoRpm(yarnId, typeId)];
    return { ...p, settings, sides: p.sides.filter((r) => !(r.yarnId === yarnId && r.typeId === typeId)) };
  });
  const addReceipt = (yarnId) => {
    if (!yarnId) return;
    pendingFocus.current = `rec:${yarnId}`;
    setPlan((p) => (p.receipts.some((r) => r.yarnId === yarnId) ? p : { ...p, receipts: [...p.receipts, { yarnId, kg: '' }] }));
  };
  const setReceipt = (yarnId, v) => setPlan((p) => ({ ...p, receipts: p.receipts.map((r) => (r.yarnId === yarnId ? { ...r, kg: v } : r)) }));
  const removeReceipt = (yarnId) => setPlan((p) => ({ ...p, receipts: p.receipts.filter((r) => r.yarnId !== yarnId) }));
  const setSetting = (s) => (raw) => setPlan((p) => withSetting(p, s.key, raw, s.master));

  const openSaved = (row) => {
    const lines = (idx.tables.TfoBalanceLines || []).filter((l) => l.plan_id === row.id);
    const p = cleanPlan(linesToPlan(unitId, lines), idx);
    setDraft({ plan: p, planId: row.id, name: row.name || '', date: String(row.plan_date || '').slice(0, 10), savedSig: planSig(p) });
    setSheet(null);
    window.scrollTo(0, 0);
  };

  const nSettings = Object.keys(plan.settings || {}).length;
  const hasInputs = plan.looms.length || plan.sides.length || plan.receipts.length || nSettings;
  const t = model.totals;
  const tpmList = tpmYarns(idx);
  const yarnOptions = (exclude) => [
    { group: 'TPM yarns', options: tpmList.filter((y) => !exclude.includes(y.yarn.id)).map((y) => ({ value: y.yarn.id, label: y.yarn.name })) },
  ];

  return (
    <div class="planner">
      <NavBar
        large
        title="TFO planner"
        right={
          <>
            <IconButton label="Import from sheet photo" onClick={() => setSheet('import')}><Icon.camera /></IconButton>
            <IconButton label="Saved plans" onClick={() => setSheet('plans')}><Icon.grid /></IconButton>
            <IconButton label="Share plan" onClick={() => setSheet('export')}><Icon.share /></IconButton>
            <TextButton bold onClick={() => setSheet('save')}>Save</TextButton>
          </>
        }
      />
      <div class="stack" style={{ padding: 0, gap: '10px' }}>
        {units.length > 1 ? (
          <div class="pad"><Segmented small label="Unit" options={units.map((u) => ({ value: u.id, label: u.name }))} value={unitId} onChange={(v) => setStore((s) => ({ ...s, unitId: v }))} /></div>
        ) : null}
        <div class="plan-head">
          <div class="plan-title">
            <div class="plan-name">{planRow ? planRow.name || 'Plan' : 'Working plan'}</div>
            <div class="plan-sub">
              {model.unit ? model.unit.name : ''}
              {planRow ? ` · ${fmt.date(planRow.plan_date)}` : ' · not saved yet'}
              {unsaved && planRow ? <Badge kind="amber">Unsaved changes</Badge> : null}
              {!unsaved && planRow ? <Badge kind="teal">Saved</Badge> : null}
            </div>
          </div>
          <div class="plan-btns">
            <button type="button" class="chip" onClick={() => setSheet('import')}>Import sheet photo</button>
            <button type="button" class="chip" disabled={!nSettings} onClick={() => setSheet('reset')}>Reset all{nSettings ? ` · ${nSettings}` : ''}</button>
            <button type="button" class="chip" disabled={!hasInputs && !planRow} onClick={() => setSheet('clear')}>Clear plan</button>
          </div>
        </div>
      </div>

      <div class="ptiles">
        <Tile label="TPM consumption" value={kg(t.tpmConsumption, 0)} sub="per day, shortage included" />
        <Tile label="TFO output" value={kg(t.tfoOutput, 0)} sub="per day from the sides entered" />
        <Tile label="From outside" value={kg(t.received, 0)} sub="average per day" />
        <Tile label="Net balance" value={signedKg(t.net)} sub={t.net < -0.05 ? 'short across TPM yarns' : 'surplus across TPM yarns'} tone={t.net < -0.05 ? 'bad' : t.net > 0.05 ? 'good' : ''} accent />
        <Tile label="Yarns short" value={String(t.short)} sub={`of ${model.balance.length} TPM ${model.balance.length === 1 ? 'yarn' : 'yarns'}`} tone={t.short ? 'bad' : ''} />
        <Tile label="Production" value={mtr(t.metresPerDay)} sub={`per day · ${fmt.int(t.looms)} looms`} />
        <Tile label="Plant realisation" value={rs0(t.plantRealisation)} sub={t.realLooms ? `per day · ${fmt.int(t.realLooms)} looms` : 'enter looms with a price'} accent />
        <Tile label="Average loom" value={rs0(t.avgLoomRealisation)} sub="per loom per day" />
        <Tile label="Average per pick" value={fmt.pick(t.avgPerPick)} sub="with VATAV, weighted by output" />
      </div>

      <Notes model={model} />

      <section class="section">
        <h2 class="section-header">Balance by TPM yarn</h2>
        <BalanceChart balance={model.balance} />
      </section>

      <section class="section">
        <h2 class="section-header">TFO settings</h2>
        <div class="group">
          {model.types.map((b) => (
            <div class="pline">
              <div class="pline-top">
                <div class="pline-name">{b.type.name}</div>
                <div class="pline-meta">{fmt.int(b.perSide)} spindles per side</div>
              </div>
              <div class="pline-boxes">
                <Labeled label="Efficiency %"><SettingBox s={b.eff} label={`TFO efficiency ${b.type.name}`} onChange={setSetting(b.eff)} /></Labeled>
                <Labeled label="Sides available"><SettingBox s={b.avail} label={`Sides available ${b.type.name}`} onChange={setSetting(b.avail)} /></Labeled>
              </div>
            </div>
          ))}
          {!model.types.length ? <div class="pline"><div class="pline-meta">This unit has no TFO types. Add them on the Units tab.</div></div> : null}
        </div>
      </section>

      <section class="section">
        <div class="psec-head">
          <h2 class="section-header">Looms</h2>
        </div>
        <div class="group">
          <Toggle label="Assigned to this unit only" value={store.assignedOnly} onChange={(v) => setStore((s) => ({ ...s, assignedOnly: v }))} />
        </div>
        {model.groups.map((b) => (
          <LoomGroupCard
            block={b}
            wide={wide}
            idx={idx}
            list={model.qualities}
            unitId={unitId}
            assignedOnly={store.assignedOnly}
            pendingFocus={pendingFocus}
            onAdd={(fid) => addLoom(b.group.id, fid)}
            onLooms={setLooms}
            onRemove={removeLoom}
            onSoldAs={setSoldAs}
            setSetting={setSetting}
          />
        ))}
        {!model.groups.length ? <p class="section-footer">This unit has no loom groups. Add them on the Units tab.</p> : null}
      </section>

      <section class="section">
        <h2 class="section-header">TFO</h2>
        {model.types.map((b) => (
          <div class="pcard">
            <div class="pcard-head">
              <div class="pcard-title">{b.type.name}</div>
              <div class={`pcard-cap ${b.over ? 'bad' : ''}`}>{fmt.int(b.used)} of {b.avail.value === null ? '—' : fmt.int(b.avail.value)} sides</div>
            </div>
            {b.rows.length ? (
              wide ? (
                <table class="ftable ptable">
                  <thead><tr><th class="txt"><span class="th">Yarn</span></th><th><span class="th">Sides</span></th><th><span class="th">TFO RPM</span></th><th><span class="th">kg / side / day</span></th><th><span class="th">Output kg/day</span></th><th><span class="th" /></th></tr></thead>
                  <tbody>
                    {b.rows.map((r) => {
                      const s = r.rpm;
                      return (
                        <tr>
                          <td class="txt"><div class="tname">{r.yarn.name}</div><div class="tmeta">{r.denier ? `${fmt.n(r.denier, 0)} D` : 'no count'} · {num(r.yarn.tpm) ? `${fmt.int(num(r.yarn.tpm))} TPM` : 'no TPM'}</div></td>
                          <td><NumBox value={r.sidesRaw} label={`Sides ${r.yarn.name} ${b.type.name}`} onChange={(v) => setSides(r.yarn.id, b.type.id, v)} focusKey={`sides:${r.yarn.id}:${b.type.id}`} pendingFocus={pendingFocus} /></td>
                          <td><SettingBox s={s} label={`TFO RPM ${r.yarn.name} ${b.type.name}`} needText="Enter RPM" onChange={setSetting(s)} /></td>
                          <td>{kg(r.perSideKg)}</td>
                          <td class="strong">{kg(r.output)}</td>
                          <td><button type="button" class="link-btn danger" onClick={() => removeSide(r.yarn.id, b.type.id)}>Remove</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                b.rows.map((r) => (
                  <div class="pline">
                    <div class="pline-top">
                      <div class="pline-name">{r.yarn.name}</div>
                      <button type="button" class="x-btn" aria-label={`Remove ${r.yarn.name}`} onClick={() => removeSide(r.yarn.id, b.type.id)}><Icon.close size={12} /></button>
                    </div>
                    <div class="pline-boxes">
                      <Labeled label="Sides"><NumBox value={r.sidesRaw} label={`Sides ${r.yarn.name} ${b.type.name}`} onChange={(v) => setSides(r.yarn.id, b.type.id, v)} focusKey={`sides:${r.yarn.id}:${b.type.id}`} pendingFocus={pendingFocus} /></Labeled>
                      <Labeled label="TFO RPM"><SettingBox s={r.rpm} label={`TFO RPM ${r.yarn.name} ${b.type.name}`} needText="Enter RPM" onChange={setSetting(r.rpm)} /></Labeled>
                    </div>
                    <div class="pline-out">{kg(r.perSideKg)} per side per day · <b>{kg(r.output)}</b> a day</div>
                  </div>
                ))
              )
            ) : null}
            <div class="padd">
              <SearchPicker value="" label={`Add a TPM yarn to ${b.type.name}`} title={`Add a yarn · ${b.type.name}`} placeholder="+ Add a TPM yarn" searchHint="Search TPM yarns" options={yarnOptions(b.rows.map((r) => r.yarn.id))} onChange={(v) => addSide(b.type.id, v)} />
            </div>
          </div>
        ))}
        <div class="pcard">
          <div class="pcard-head">
            <div class="pcard-title">Received from outside</div>
            <div class="pcard-cap">average kg per day</div>
          </div>
          {model.receipts.map((r) => (
            <div class="pline">
              <div class="pline-top rec">
                <div class="pline-name">{r.yarn.name}</div>
                <div class="pline-right">
                  <NumBox value={r.kgRaw} label={`kg per day ${r.yarn.name}`} onChange={(v) => setReceipt(r.yarn.id, v)} focusKey={`rec:${r.yarn.id}`} pendingFocus={pendingFocus} />
                  <span class="unit-txt">kg/day</span>
                  <button type="button" class="x-btn" aria-label={`Remove ${r.yarn.name}`} onClick={() => removeReceipt(r.yarn.id)}><Icon.close size={12} /></button>
                </div>
              </div>
            </div>
          ))}
          <div class="padd">
            <SearchPicker value="" label="Add yarn received from outside" title="Received from outside" placeholder="+ Add a TPM yarn" searchHint="Search TPM yarns" options={yarnOptions(model.receipts.map((r) => r.yarn.id))} onChange={addReceipt} />
          </div>
        </div>
      </section>

      <section class="section">
        <h2 class="section-header">Production by quality</h2>
        <ProductionTable rows={model.production} total={t.metresPerDay} wide={wide} />
        <p class="section-footer">Metres per day = looms × RPM × 1,440 × efficiency ÷ (PPI × 39.37) × panna, summed over loom groups. Greige metres, before shortage.</p>
      </section>

      <section class="section">
        <h2 class="section-header">Yarn consumption · all yarns</h2>
        <ConsumptionTable rows={model.consumption} wide={wide} />
      </section>

      <section class="section">
        <h2 class="section-header">TPM balance</h2>
        <BalanceTable rows={model.balance} wide={wide} />
        <p class="section-footer">Balance = TFO output + received from outside − consumption (warp and weft, shortage included), kg per day.</p>
      </section>

      <SaveSheet open={sheet === 'save'} onClose={() => setSheet(null)} draft={draft} planRow={planRow} unitId={unitId} model={model} onSaved={(d) => setDraft(d)} />
      <PlansSheet open={sheet === 'plans'} onClose={() => setSheet(null)} idx={idx} unitId={unitId} plans={savedPlans} currentId={planRow ? planRow.id : null} unsaved={!!(unsaved && hasInputs)} onOpen={openSaved} onDeleted={(id) => { if (id === draft.planId) setDraft((d) => ({ ...d, planId: null, savedSig: '' })); }} />
      <ExportSheet open={sheet === 'export'} onClose={() => setSheet(null)} model={model} planRow={planRow} unsaved={unsaved} />
      <SheetImport
        open={sheet === 'import'}
        onClose={() => setSheet(null)}
        idx={idx}
        unitId={unitId}
        list={model.qualities}
        plan={plan}
        onApply={(next, n) => {
          // an imported day is a new plan: Save offers today's date and a new name
          setDraft((d) => ({ ...d, plan: next, planId: null, name: '', date: '', savedSig: '' }));
          window.scrollTo(0, 0);
          toast(`Imported ${n.qualities} ${n.qualities === 1 ? 'quality' : 'qualities'}, ${n.looms} looms${n.stopped ? ` · ${n.stopped} stopped` : ''}. Save to keep it.`);
        }}
      />
      <Confirm open={sheet === 'reset'} onClose={() => setSheet(null)} title="Reset all settings?" text={`Every edited setting in this plan (${nSettings}) goes back to the master value. Looms, sides and receipts stay.`} yes="Reset all" onYes={() => setPlan(resetAll)} />
      <Confirm open={sheet === 'clear'} onClose={() => setSheet(null)} danger title="Clear the plan?" text="This empties the working plan on this device: looms, sides, receipts and edited settings. Saved plans are not touched." yes="Clear plan" onYes={() => setDraft(blankDraft(unitId))} />
    </div>
  );
}

function Tile({ label, value, sub, tone, accent }) {
  return (
    <div class={`tile ${accent ? 'accent' : ''}`}>
      <div class="t-label">{label}</div>
      <div class={`t-value ${tone || ''}`}>{value}</div>
      <div class="t-sub">{sub}</div>
    </div>
  );
}

function Notes({ model }) {
  const n = model.notes;
  const where = (r) => `${r.q.label} on ${groupLabel(r.group)}`;
  const items = [];
  if (n.needRpm.length) items.push(`Enter the loom RPM for ${n.needRpm.map(where).join(', ')}. Until then their consumption and realisation are left out.`);
  if (n.needEff.length) items.push(`Enter the loom efficiency for ${n.needEff.map(where).join(', ')}.`);
  if (n.needTfo.length) items.push(`Enter the TFO RPM for ${n.needTfo.map((r) => `${r.yarn.name} on ${r.type.name}`).join(', ')}. Until then that output is left out.`);
  if (n.noReal.length) items.push(`No realisation for ${[...new Set(n.noReal.map((r) => r.q.label + (r.soldAs === 'rfd' && r.q.both ? ' (RFD)' : '')))].join(', ')} (no selling price or cost): left out of the realisation tiles.`);
  if (n.noCount.length) items.push(`${n.noCount.map((y) => y.name).join(', ')} ${n.noCount.length === 1 ? 'has' : 'have'} no count, so ${n.noCount.length === 1 ? 'it is' : 'they are'} left out of the kg.`);
  if (!items.length) return null;
  return <div class="notice"><ul class="pnotes">{items.map((x) => <li>{x}</li>)}</ul></div>;
}

function BalanceChart({ balance }) {
  if (!balance.length) return <div class="group"><div class="pline"><div class="pline-meta">Add looms that use TPM yarn, or TFO sides, to see the balance.</div></div></div>;
  const max = Math.max(...balance.map((b) => Math.abs(b.balance)), 1);
  return (
    <div class="group bchart" role="img" aria-label="Balance by TPM yarn">
      <div class="bchart-axis"><span>Short</span><span>Surplus</span></div>
      {balance.map((b) => {
        const w = `${Math.min(50, (Math.abs(b.balance) / max) * 50)}%`;
        const short = b.balance < -0.05;
        return (
          <div class="brow" title={`${b.yarn.name}: consumption ${fmt.n(b.consumption, 1)} kg, TFO ${fmt.n(b.output, 1)} kg, outside ${fmt.n(b.received, 1)} kg`}>
            <div class="brow-name">{b.yarn.name}</div>
            <div class="brow-track">
              <div class="brow-mid" />
              <div class={`brow-bar ${short ? 'short' : 'surplus'}`} style={short ? { right: '50%', width: w } : { left: '50%', width: w }} />
            </div>
            <div class={`brow-val ${short ? 'bad' : b.balance > 0.05 ? 'good' : ''}`}>{signedKg(b.balance)}</div>
          </div>
        );
      })}
    </div>
  );
}

function LoomGroupCard({ block, wide, idx, list, unitId, assignedOnly, pendingFocus, onAdd, onLooms, onRemove, onSoldAs, setSetting }) {
  const g = block.group;
  const opts = groupOptions(list, g, idx, { assignedOnly, unitId, exclude: block.rows.map((r) => r.fabricId) });
  const label = (q) => `${q.label} · ${q.fabric.weave || 'Plain'}${q.both ? ' · Greige + RFD' : ''}`;
  const options = [
    ...(opts.tpm.length ? [{ group: 'Uses TPM yarn', options: opts.tpm.map((q) => ({ value: q.id, label: label(q) })) }] : []),
    ...(opts.other.length ? [{ group: 'Other qualities', options: opts.other.map((q) => ({ value: q.id, label: label(q) })) }] : []),
  ];
  const pannaText = (r) => (r.panna === 2 ? 'double panna' : 'single panna');
  const sold = (r) => (r.q.both ? (
    <Segmented small label={`Sold as ${r.q.label}`} options={[{ value: 'greige', label: 'Greige' }, { value: 'rfd', label: 'RFD' }]} value={r.soldAs} onChange={(v) => onSoldAs(r.soldKey, v)} />
  ) : null);
  return (
    <div class="pcard">
      <div class="pcard-head">
        <div class="pcard-title">{groupLabel(g)}{g.make ? <span class="pcard-make"> · {g.make}</span> : null}</div>
        <div class={`pcard-cap ${block.over ? 'bad' : ''}`}>{fmt.int(block.used)} of {block.capacity === null ? '—' : fmt.int(block.capacity)} looms</div>
      </div>
      {block.rows.length ? (
        wide ? (
          <table class="ftable ptable">
            <thead>
              <tr>
                <th class="txt"><span class="th">Quality</span></th>
                <th><span class="th">Looms</span></th>
                <th><span class="th">RPM</span></th>
                <th><span class="th">Eff %</span></th>
                <th><span class="th">m / day / loom</span></th>
                <th><span class="th">m / day, all looms</span></th>
                <th><span class="th">TPM kg/day</span></th>
                <th><span class="th">₹ / loom / day</span></th>
                <th><span class="th" /></th>
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r) => (
                <tr>
                  <td class="txt">
                    <div class="tname">{r.q.label}</div>
                    <div class="tmeta">{r.q.fabric.weave || 'Plain'} · {pannaText(r)}{r.tpm ? ' · TPM' : ''}</div>
                    {sold(r) ? <div class="sold">{sold(r)}</div> : null}
                  </td>
                  <td><NumBox value={r.loomsRaw} label={`Looms ${r.q.label} ${groupLabel(g)}`} onChange={(v) => onLooms(r.fabricId, g.id, v)} focusKey={`looms:${r.fabricId}:${g.id}`} pendingFocus={pendingFocus} /></td>
                  <td><SettingBox s={r.rpm} label={`RPM ${r.q.label} ${groupLabel(g)}`} needText="Enter RPM" onChange={setSetting(r.rpm)} /></td>
                  <td><SettingBox s={r.eff} label={`Efficiency ${r.q.label} ${groupLabel(g)}`} onChange={setSetting(r.eff)} /></td>
                  <td>{fmt.int(r.mPerDay)}</td>
                  <td class="strong">{fmt.int(r.mTotal)}</td>
                  <td>{r.tpm ? kg(r.tpmKg) : '—'}</td>
                  <td class="strong" title={r.realPerLoom !== null ? `${fmt.pick(r.perPick)} per pick × ${fmt.int(r.mPerDay)} m × ${r.ppi} PPI` : undefined}>{rs0(r.realPerLoom)}</td>
                  <td><button type="button" class="link-btn danger" onClick={() => onRemove(r.fabricId, g.id)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          block.rows.map((r) => (
            <div class="pline">
              <div class="pline-top">
                <div>
                  <div class="pline-name">{r.q.label}</div>
                  <div class="pline-meta">{r.q.fabric.weave || 'Plain'} · {pannaText(r)}{r.tpm ? ' · TPM' : ''}</div>
                </div>
                <button type="button" class="x-btn" aria-label={`Remove ${r.q.label}`} onClick={() => onRemove(r.fabricId, g.id)}><Icon.close size={12} /></button>
              </div>
              <div class="pline-boxes three">
                <Labeled label="Looms"><NumBox value={r.loomsRaw} label={`Looms ${r.q.label} ${groupLabel(g)}`} onChange={(v) => onLooms(r.fabricId, g.id, v)} focusKey={`looms:${r.fabricId}:${g.id}`} pendingFocus={pendingFocus} /></Labeled>
                <Labeled label="RPM"><SettingBox s={r.rpm} label={`RPM ${r.q.label} ${groupLabel(g)}`} needText="Enter RPM" onChange={setSetting(r.rpm)} /></Labeled>
                <Labeled label="Eff %"><SettingBox s={r.eff} label={`Efficiency ${r.q.label} ${groupLabel(g)}`} onChange={setSetting(r.eff)} /></Labeled>
              </div>
              {sold(r) ? <div class="sold">{sold(r)}</div> : null}
              <div class="pline-out">
                {r.mPerDay === null ? 'm/day needs RPM and efficiency' : `${fmt.int(r.mPerDay)} m/day per loom · ${fmt.int(r.mTotal)} m/day for ${fmt.int(r.looms)} ${r.looms === 1 ? 'loom' : 'looms'}`}
                {r.tpm ? ` · TPM ${kg(r.tpmKg)}/day` : ''}
                {' · '}<b>{r.realPerLoom === null ? '₹ —' : `${rs0(r.realPerLoom)}/loom/day`}</b>
              </div>
            </div>
          ))
        )
      ) : null}
      <div class="padd">
        <SearchPicker value="" label={`Add a quality to ${groupLabel(g)}`} title={`Add a quality · ${groupLabel(g)}`} placeholder="+ Add a quality" searchHint="Search qualities" options={options} onChange={onAdd} />
      </div>
    </div>
  );
}

function ProductionTable({ rows, total, wide }) {
  if (!rows.length) return <div class="group"><div class="pline"><div class="pline-meta">Enter looms to see production per quality.</div></div></div>;
  const where = (r) => r.byGroup.map((x) => `${groupLabel(x.group)} ${fmt.int(x.looms)}`).join(' · ');
  const looms = rows.reduce((s, r) => s + r.looms, 0);
  const note = (r) => (r.loomsNoRate ? ` · ${fmt.int(r.loomsNoRate)} without RPM or efficiency` : '');
  if (!wide) {
    return (
      <div class="group">
        {rows.map((r) => (
          <div class="pline">
            <div class="pline-top">
              <div class="pline-name">{r.q.label}</div>
              <div class="pline-val">{mtr(r.metres)}</div>
            </div>
            <div class="pline-meta">{fmt.int(r.looms)} {r.looms === 1 ? 'loom' : 'looms'} · {where(r)}{note(r)}</div>
          </div>
        ))}
        <div class="pline"><div class="pline-top"><div class="pline-name">Total</div><div class="pline-val">{mtr(total)}</div></div><div class="pline-meta">{fmt.int(looms)} looms</div></div>
      </div>
    );
  }
  return (
    <div class="table-wrap">
      <table class="ftable">
        <thead><tr><th class="txt"><span class="th">Quality</span></th><th><span class="th">Looms</span></th><th><span class="th">Metres / day</span></th><th><span class="th">Share</span></th><th class="txt"><span class="th">Running on</span></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td class="txt strong">{r.q.label}</td>
              <td>{fmt.int(r.looms)}</td>
              <td class="strong">{fmt.int(r.metres)}</td>
              <td>{total ? `${fmt.n((r.metres / total) * 100, 1)}%` : '—'}</td>
              <td class="txt muted">{where(r)}{note(r)}</td>
            </tr>
          ))}
          <tr><td class="txt strong">Total</td><td class="strong">{fmt.int(looms)}</td><td class="strong">{fmt.int(total)}</td><td /><td /></tr>
        </tbody>
      </table>
    </div>
  );
}

function ConsumptionTable({ rows, wide }) {
  if (!rows.length) return <div class="group"><div class="pline"><div class="pline-meta">Enter looms to see what they consume.</div></div></div>;
  const tot = (k) => rows.reduce((s, r) => s + r[k], 0);
  if (!wide) {
    return (
      <div class="group">
        {rows.map((r) => (
          <div class="pline">
            <div class="pline-top">
              <div class="pline-name">{r.yarn.name} {r.tpm ? <Badge kind="amber">TPM</Badge> : null}</div>
              <div class="pline-val">{kg(r.total)}</div>
            </div>
            <div class="pline-meta">Warp {kg(r.warp)} · Weft {kg(r.weft)}{r.used.length ? ` · ${r.used.join(', ')}` : ''}</div>
          </div>
        ))}
        <div class="pline"><div class="pline-top"><div class="pline-name">Total</div><div class="pline-val">{kg(tot('total'))}</div></div></div>
      </div>
    );
  }
  return (
    <div class="table-wrap">
      <table class="ftable">
        <thead><tr><th class="txt"><span class="th">Yarn</span></th><th class="txt"><span class="th">Kind</span></th><th><span class="th">Warp kg/day</span></th><th><span class="th">Weft kg/day</span></th><th><span class="th">Total kg/day</span></th><th class="txt"><span class="th">Used in</span></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td class="txt strong">{r.yarn.name}</td>
              <td class="txt">{r.tpm ? <Badge kind="amber">TPM</Badge> : <Badge>Base</Badge>}</td>
              <td>{fmt.n(r.warp, 1)}</td>
              <td>{fmt.n(r.weft, 1)}</td>
              <td class="strong">{fmt.n(r.total, 1)}</td>
              <td class="txt muted">{r.used.join(', ')}</td>
            </tr>
          ))}
          <tr><td class="txt strong">Total</td><td /><td class="strong">{fmt.n(tot('warp'), 1)}</td><td class="strong">{fmt.n(tot('weft'), 1)}</td><td class="strong">{fmt.n(tot('total'), 1)}</td><td /></tr>
        </tbody>
      </table>
    </div>
  );
}

function BalanceTable({ rows, wide }) {
  if (!rows.length) return <div class="group"><div class="pline"><div class="pline-meta">No TPM yarn in this plan yet.</div></div></div>;
  if (!wide) {
    return (
      <div class="group">
        {rows.map((r) => (
          <div class="pline">
            <div class="pline-top">
              <div class="pline-name">{r.yarn.name}</div>
              <div class={`pline-val ${r.balance < -0.05 ? 'bad' : r.balance > 0.05 ? 'good' : ''}`}>{signedKg(r.balance)}</div>
            </div>
            <div class="pline-meta">Use {kg(r.consumption)} · TFO {kg(r.output)} · outside {kg(r.received)}</div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div class="table-wrap">
      <table class="ftable">
        <thead><tr><th class="txt"><span class="th">TPM yarn</span></th><th><span class="th">Consumption</span></th><th><span class="th">TFO output</span></th><th><span class="th">From outside</span></th><th><span class="th">Balance kg/day</span></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td class="txt strong">{r.yarn.name}</td>
              <td>{fmt.n(r.consumption, 1)}</td>
              <td>{fmt.n(r.output, 1)}</td>
              <td>{fmt.n(r.received, 1)}</td>
              <td class={`strong ${r.balance < -0.05 ? 'bad' : r.balance > 0.05 ? 'good' : ''}`}>{signedKg(r.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- save ----------
function SaveSheet({ open, onClose, draft, planRow, unitId, model, onSaved }) {
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const d = (planRow && String(planRow.plan_date || '').slice(0, 10)) || todayIst();
    setDate(d);
    setName(planRow ? planRow.name || defaultPlanName(d) : defaultPlanName(d));
    setNameEdited(!!planRow);
  }, [open]);
  const onDate = (v) => {
    setDate(v);
    if (!nameEdited) setName(defaultPlanName(v));
  };
  async function run(asNew) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast('Pick a plan date', 'error');
      return;
    }
    const n = name.trim() || defaultPlanName(date);
    setBusy(true);
    try {
      const id = await savePlan({ id: asNew ? null : planRow.id, unitId, date, name: n, lines: planToLines(draft.plan), summary: planSummary(model) });
      onSaved({ ...draft, planId: id, name: n, date, savedSig: planSig(draft.plan) });
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
  }
  return (
    <Sheet open={open} onClose={onClose} title={planRow ? 'Save plan' : 'Save as a plan'}>
      <section class="section">
        <div class="group">
          <label class="row field">
            <span class="row-label">Plan date</span>
            <span class="field-input"><input type="date" value={date} aria-label="Plan date" onInput={(e) => onDate(e.currentTarget.value)} /></span>
          </label>
          <label class="row field">
            <span class="row-label">Name</span>
            <span class="field-input"><input type="text" value={name} aria-label="Plan name" onInput={(e) => { setName(e.currentTarget.value); setNameEdited(true); }} /></span>
          </label>
        </div>
        <p class="section-footer">Saved to the Sheet for everyone with access. Only looms, sides, receipts and settings that differ from master are stored.</p>
      </section>
      <div class="actions">
        {planRow ? (
          <>
            <Button busy={busy} onClick={() => run(false)}>Update this plan</Button>
            <Button kind="secondary" disabled={busy} onClick={() => run(true)}>Save as new</Button>
          </>
        ) : (
          <Button busy={busy} onClick={() => run(true)}>Save plan</Button>
        )}
      </div>
    </Sheet>
  );
}

// ---------- saved plans ----------
function PlansSheet({ open, onClose, idx, unitId, plans, currentId, unsaved, onOpen, onDeleted }) {
  const [ask, setAsk] = useState(null); // { kind: 'open' | 'delete' | 'share', row }
  const [shareMoney, setShareMoney] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!open) setAsk(null); }, [open]);
  const sorted = plans.slice().sort((a, b) => String(b.plan_date || '').localeCompare(String(a.plan_date || '')) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const tryOpen = (row) => (unsaved && row.id !== currentId ? setAsk({ kind: 'open', row }) : onOpen(row));
  async function act(fn) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy(false);
    setAsk(null);
  }
  // Share a saved plan straight from the list, without opening it.
  async function share(row, kind) {
    setBusy(true);
    try {
      const lines = (idx.tables.TfoBalanceLines || []).filter((l) => l.plan_id === row.id);
      const saved = cleanPlan(linesToPlan(unitId, lines), idx);
      const meta = { name: row.name || 'Plan', date: String(row.plan_date || '').slice(0, 10) || todayIst(), unsaved: false };
      await sharePlanFile(kind, shareMoney, computePlan(saved, idx), meta);
      setAsk(null);
    } catch (e) {
      toast(e.message || 'Share failed', 'error');
    }
    setBusy(false);
  }
  return (
    <Sheet open={open} onClose={onClose} title="Saved plans">
      {!sorted.length ? <Empty title="No saved plans" text="Save the working plan to keep it by date." /> : null}
      {sorted.length ? (
        <section class="section">
          <div class="group">
            {sorted.map((p) => {
              const s = parseSummary(p.summary);
              const asking = ask && ask.row.id === p.id;
              return (
                <div class="plan-item">
                  <div class="plan-item-top">
                    <div style={{ minWidth: 0 }}>
                      <div class="pline-name">{p.name || 'Plan'}{p.id === currentId ? <span class="pcard-make"> · open</span> : null}</div>
                      <div class="pline-meta">{fmt.date(p.plan_date)}{p.updated_by ? ` · ${p.updated_by}` : ''}</div>
                    </div>
                    <div class="plan-item-figs">
                      <div class={num(s.net) !== null && num(s.net) < 0 ? 'bad' : 'good'}>{num(s.net) === null ? '—' : signedKg(num(s.net))}</div>
                      <div class="pline-meta">{num(s.plantRealisation) === null ? '₹ —' : `${rs0(num(s.plantRealisation))}/day`}</div>
                    </div>
                  </div>
                  {asking && ask.kind === 'share' ? (
                    <div class="plan-ask">
                      <Segmented small label="Revenue" options={[{ value: 'with', label: 'With ₹' }, { value: 'without', label: 'No ₹' }]} value={shareMoney ? 'with' : 'without'} onChange={(v) => setShareMoney(v === 'with')} />
                      <button type="button" class="link-btn" disabled={busy} onClick={() => share(p, 'pdf')}>PDF</button>
                      <button type="button" class="link-btn" disabled={busy} onClick={() => share(p, 'xlsx')}>Excel</button>
                      <button type="button" class="link-btn" disabled={busy} onClick={() => setAsk(null)}>Cancel</button>
                    </div>
                  ) : asking ? (
                    <div class="plan-ask">
                      <span>{ask.kind === 'delete' ? `Delete ${p.name || 'this plan'}?` : 'Discard unsaved changes and open this plan?'}</span>
                      <button type="button" class="link-btn danger" disabled={busy} onClick={() => (ask.kind === 'delete' ? act(async () => { await deletePlan(p.id); onDeleted(p.id); }) : (setAsk(null), onOpen(p)))}>{ask.kind === 'delete' ? 'Delete' : 'Discard and open'}</button>
                      <button type="button" class="link-btn" onClick={() => setAsk(null)}>Cancel</button>
                    </div>
                  ) : (
                    <div class="plan-item-btns">
                      <button type="button" class="link-btn" onClick={() => tryOpen(p)}>Open</button>
                      <button type="button" class="link-btn" disabled={busy} onClick={() => act(() => duplicatePlan(p.id))}>Duplicate</button>
                      <button type="button" class="link-btn" onClick={() => setAsk({ kind: 'share', row: p })}>Share</button>
                      <button type="button" class="link-btn danger" onClick={() => setAsk({ kind: 'delete', row: p })}>Delete</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p class="section-footer">Net TPM balance and plant realisation as they were when each plan was saved.</p>
        </section>
      ) : null}
    </Sheet>
  );
}

// ---------- export ----------
// One place builds and shares the file, for the working plan and for any saved plan.
// money = false leaves out every rupee figure. Edited-setting markers never appear in a shared file.
async function sharePlanFile(kind, money, model, meta) {
  const mod = await import('../export/planExport.js');
  if (kind === 'pdf') await mod.exportPlanPdf(model, meta, { money });
  else await mod.exportPlanXlsx(model, meta, { money });
}

function ExportSheet({ open, onClose, model, planRow, unsaved }) {
  const [busy, setBusy] = useState('');
  const [money, setMoney] = useState(true);
  const meta = planRow
    ? { name: planRow.name || 'Plan', date: String(planRow.plan_date || '').slice(0, 10) || todayIst(), unsaved: !!unsaved }
    : { name: 'Unsaved plan', date: todayIst(), unsaved: false };
  async function run(kind) {
    setBusy(kind);
    try {
      await sharePlanFile(kind, money, model, meta);
      onClose();
    } catch (e) {
      toast(e.message || 'Export failed', 'error');
    }
    setBusy('');
  }
  return (
    <Sheet open={open} onClose={onClose} title="Share plan">
      <section class="section">
        <div class="group">
          <Toggle label="Include revenue (₹)" value={money} onChange={setMoney} />
          <button type="button" class="row" disabled={!!busy} onClick={() => run('pdf')}>
            <span class="row-chevron" style={{ color: 'var(--accent)' }}><Icon.pdf /></span>
            <div class="row-main"><div class="row-label">PDF</div><div class="row-sub">{money ? 'Tiles, looms, TFO, yarn consumption and TPM balance' : 'Looms, TFO, yarn consumption and TPM balance, with no rupee figures'}</div></div>
            {busy === 'pdf' ? <span class="spinner" aria-hidden="true" /> : null}
          </button>
          <button type="button" class="row" disabled={!!busy} onClick={() => run('xlsx')}>
            <span class="row-chevron" style={{ color: 'var(--accent)' }}><Icon.grid /></span>
            <div class="row-main"><div class="row-label">Excel</div><div class="row-sub">{money ? 'One sheet each: Summary, Looms, TFO, Received, Yarn consumption, TPM balance' : 'The same sheets, with no rupee figures'}</div></div>
            {busy === 'xlsx' ? <span class="spinner" aria-hidden="true" /> : null}
          </button>
        </div>
        <p class="section-footer">{planRow ? `${meta.name} · ${fmt.date(meta.date)}${unsaved ? ' · with the unsaved changes on screen' : ''}` : 'The working plan is not saved: it shares as “Unsaved plan” with today’s date.'}</p>
      </section>
    </Sheet>
  );
}
