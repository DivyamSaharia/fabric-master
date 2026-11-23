import { useEffect, useState } from 'preact/hooks';
import { askConfirm } from '../confirm.js';
import { fmt, loomPerDay, loomRealisation, num, priceForPick } from '../calc.js';
import {
  activeTempPrices, activeTempRates, activeTempRpms, baseImpact, clearAllTempPrices, clearAllTempRates, clearAllTempRpms, clearTempDelta, clearTempPrice, clearTempRate, clearTempRpm,
  getState, saveTempPriceToMaster, saveTempRateToMaster, saveTempRpmToMaster, saveTpmTempToMaster, setTempDelta, setTempPrice, setTempRate, setTempRpm, toast, todayIst, tpmSavePlan, useStore,
} from '../store.js';
import { Button, Icon, Row, Section, Sheet, TextButton } from '../ui.jsx';

// The strip sits in every top bar (so it stays in view); the panel it opens is drawn once by the app.
let panelOpen = false;
const panelSubs = new Set();
const setPanelOpen = (v) => {
  panelOpen = v;
  panelSubs.forEach((f) => f());
};
function usePanelOpen() {
  const [open, setOpen] = useState(panelOpen);
  useEffect(() => {
    const f = () => setOpen(panelOpen);
    panelSubs.add(f);
    return () => panelSubs.delete(f);
  }, []);
  return [open, setPanelOpen];
}

function stripLabel(list, prices, rpms = []) {
  return [
    list.length ? (list.length === 1 ? '1 temporary yarn rate' : `${list.length} temporary yarn rates`) : '',
    prices.length ? (prices.length === 1 ? '1 temporary sale rate' : `${prices.length} temporary sale rates`) : '',
    rpms.length ? (rpms.length === 1 ? '1 temporary loom RPM' : `${rpms.length} temporary loom RPMs`) : '',
  ].filter(Boolean).join(' · ');
}

const anyYarnTemp = (st) => Object.keys(st.tempRates).length || Object.keys(st.tempDeltas || {}).length;

// Strip under the top bar of every screen while any temporary rate is on.
export function TempRatesStrip() {
  const st = useStore();
  const list = anyYarnTemp(st) ? activeTempRates() : [];
  const prices = Object.keys(st.tempPrices).length ? activeTempPrices() : [];
  const rpms = Object.keys(st.tempRpms || {}).length ? activeTempRpms() : [];
  if (!list.length && !prices.length && !rpms.length) return null;
  return (
    <button type="button" class="temp-strip" onClick={() => setPanelOpen(true)}>
      <span>{stripLabel(list, prices, rpms)} active</span>
      <span class="temp-strip-go">View<Icon.chevron size={11} /></span>
    </button>
  );
}

// The Temporary rates panel and the TPM Save to master screen.
export function TempRatesPanel() {
  const st = useStore();
  const [open, setOpen] = usePanelOpen();
  const [busy, setBusy] = useState(false);
  // TPM yarn whose temporary rate is being saved to master (the three choices), or null
  const [tpmItem, setTpmItem] = useState(null);
  const list = anyYarnTemp(st) ? activeTempRates() : [];
  const prices = Object.keys(st.tempPrices).length ? activeTempPrices() : [];
  const rpms = Object.keys(st.tempRpms || {}).length ? activeTempRpms() : [];
  if (!list.length && !prices.length && !rpms.length) return null;

  async function rpmToMaster(item) {
    if (!(await confirmRpmToMaster(item.fabric, item))) return;
    setBusy(true);
    try {
      await saveTempRpmToMaster(item.fabric.id);
    } catch (e) {
      toast(e.message || 'Could not save the loom RPM', 'error');
    }
    setBusy(false);
  }

  async function toMaster(item) {
    if (item.tpm) {
      setTpmItem(item);
      return;
    }
    const m = item.masterRate === null ? 'no rate' : `${fmt.rate(item.masterRate)}/kg`;
    const ok = await askConfirm({
      title: `Save ${item.yarn.name} to master?`,
      text: `${fmt.rate(item.rate)}/kg becomes today's rate in the yarn master, for everyone. It is ${m} now.${reachText(item.yarn.id)} The temporary rate is removed afterwards.`,
      yes: `Save ${fmt.rate(item.rate)}/kg to master`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await saveTempRateToMaster(item.yarn.id);
    } catch (e) {
      toast(e.message || 'Could not save the rate', 'error');
    }
    setBusy(false);
  }

  async function priceToMaster(item) {
    if (!(await confirmPriceToMaster(item.fabric, item.price, item.masterPrice))) return;
    setBusy(true);
    try {
      await saveTempPriceToMaster(item.fabric.id);
    } catch (e) {
      toast(e.message || 'Could not save the sale rate', 'error');
    }
    setBusy(false);
  }

  return (
    <>
      <Sheet
        open={open && !!tpmItem}
        onClose={() => { setTpmItem(null); setOpen(false); }}
        title="Save to master"
      >
        {tpmItem ? <TpmSaveView key={tpmItem.yarn.id} item={tpmItem} onClose={() => setTpmItem(null)} /> : null}
      </Sheet>
      <Sheet
        open={open && !tpmItem}
        onClose={() => setOpen(false)}
        title="Temporary rates"
        footer={<Button kind="secondary" onClick={() => { clearAllTempRates(); clearAllTempPrices(); clearAllTempRpms(); setOpen(false); }}>Reset all</Button>}
      >
        {prices.length ? (
          <Section header="Sale rates" footer="This device only. Save to master sets the selling price for everyone, dated today.">
            {prices.map((item) => (
              <Row
                label={item.fabric.name}
                sub={item.masterPrice === null ? 'No master sale rate' : `Master ${fmt.rs(item.masterPrice)}`}
                value={<span class="strong">{fmt.rs(item.price)}/{item.fabric.finish === 'RFD' ? 'RFD m' : 'm'}</span>}
                valueSub="temporary"
              >
                <div class="temp-actions">
                  <Button kind="primary small" onClick={() => priceToMaster(item)} disabled={busy}>Save to master</Button>
                  <button type="button" class="link-btn" onClick={() => clearTempPrice(item.fabric.id)}>Reset</button>
                </div>
              </Row>
            ))}
          </Section>
        ) : null}
        {rpms.length ? (
          <Section header="Loom RPM" footer="This device only. Save to master sets the fabric's loom RPM for everyone. The Planner keeps its own RPMs.">
            {rpms.map((item) => (
              <Row
                label={item.fabric.name}
                sub={`Master ${rpmPair(item.masterSp, item.masterDp)}`}
                value={<span class="strong">{[item.sp !== null ? `single ${fmt.int(item.sp)}` : null, item.dp !== null ? `double ${fmt.int(item.dp)}` : null].filter(Boolean).join(' · ')}</span>}
                valueSub="temporary"
              >
                <div class="temp-actions">
                  <Button kind="primary small" onClick={() => rpmToMaster(item)} disabled={busy}>Save to master</Button>
                  <button type="button" class="link-btn" onClick={() => clearTempRpm(item.fabric.id)}>Reset</button>
                </div>
              </Row>
            ))}
          </Section>
        ) : null}
        {list.length ? (
        <Section header={prices.length || rpms.length ? 'Yarn rates' : undefined} footer="This device only. The yarn master is not changed until you save.">
          {list.map((item) => (
            <Row
              label={item.yarn.name}
              sub={item.tpm
                ? `TPM yarn · delta ${fmt.rate(item.tempDelta)} (master ${fmt.rate(item.delta)})${item.baseTemp !== null ? ` · base ${fmt.rate(item.baseTemp)} temporary` : ''} · master ${item.masterBase === null ? `${item.base ? item.base.name : 'base'} has no rate` : `${fmt.rate(item.masterBase)} + ${fmt.rate(item.delta)} = ${fmt.rate(item.masterRate)}/kg`}`
                : item.masterRate === null ? 'No master rate' : `Master ${fmt.rate(item.masterRate)}/kg`}
              value={<span class="strong">{item.rate === null ? 'no base rate' : `${fmt.rate(item.rate)}/kg`}</span>}
              valueSub="temporary"
            >
              <div class="temp-actions">
                <Button kind="primary small" onClick={() => toMaster(item)} disabled={busy}>Save to master</Button>
                <button type="button" class="link-btn" onClick={() => (item.tpm ? clearTempDelta(item.yarn.id) : clearTempRate(item.yarn.id))}>Reset</button>
              </div>
            </Row>
          ))}
        </Section>
        ) : null}
      </Sheet>
    </>
  );
}

// One small ₹ box that keeps what is typed until you leave it. Empty and leaving clears.
// onSet(text) returns false when the value is refused; onClear() clears.
function TempBox({ value, placeholder, onSet, onClear, error, label, prefix = '₹', suffix = '/kg', empty = 'not set' }) {
  const [draft, setDraft] = useState(null);
  const active = value !== null && value !== undefined;
  const shown = draft !== null ? draft : active ? String(value) : '';
  const ph = placeholder === null || placeholder === undefined ? null : String(Math.round(placeholder * 100) / 100);
  function commit() {
    const v = (draft ?? '').trim();
    setDraft(null);
    if (v === '') {
      if (active) onClear();
      return;
    }
    if (!onSet(v)) toast(error, 'error');
  }
  return (
    <span class="temp-box">
    <span class="field-input compact">
      {prefix ? <span class="affix">{prefix}</span> : null}
      <input
        class="num"
        size={Math.max(3, shown.length, String(ph ?? '').length)}
        inputmode="decimal"
        value={shown}
        placeholder={ph === null ? empty : ph}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        aria-label={label}
      />
      {suffix ? <span class="affix">{suffix}</span> : null}
    </span>
      {active ? <TextButton onClick={() => { setDraft(null); onClear(); }}>Reset</TextButton> : null}
    </span>
  );
}

// Temporary rate input for a base yarn on the fabric page.
// temp: its temporary rate or null. placeholder: the rate it has without one.
export function TempRateRow({ yarn, temp, placeholder }) {
  return (
    <label class="row field cmp">
      <span class="row-label">Temporary rate <span class="hint">{yarn.name}</span></span>
      <TempBox value={temp} placeholder={placeholder} label={`Temporary rate for ${yarn.name}`} error="Temporary rate must be a number above zero"
        onSet={(v) => setTempRate(yarn.id, v)} onClear={() => clearTempRate(yarn.id)} />
    </label>
  );
}

// Temporary TPM rate on the fabric page, typed as its two parts (1.27.0): the delta (this TPM yarn only) and the base
// rate (a temporary rate on the base yarn, so it moves every yarn and fabric on that base). Rate = base + delta.
// t: { yarn, delta (master), tempDelta }. base: the base yarn or null. baseTemp: its temporary rate or null.
// baseMaster: its rate without a temporary one (the picked or current master rate) or null.
export function TempTpmRow({ t, base, baseTemp, baseMaster }) {
  const d = t.tempDelta ?? t.delta;
  const b = baseTemp ?? baseMaster;
  const active = t.tempDelta !== null || baseTemp !== null;
  return (
    <div class="row field cmp tpm-temp tpm-split">
      <div class="row-label">
        Temporary TPM rate <span class="hint">{t.yarn.name} · {b === null ? 'base has no rate' : `${fmt.rate(b)} + ${fmt.rate(d)} = ${fmt.rate(b + d)}/kg`}{active ? ' (temp)' : ''}</span>
      </div>
      <div class="tpm-boxes">
        <label class="tpm-box">
          <span class="tpm-box-label">Delta</span>
          <TempBox value={t.tempDelta} placeholder={t.delta} label={`Temporary delta for ${t.yarn.name}`} error="Delta must be zero or more"
            onSet={(v) => setTempDelta(t.yarn.id, v)} onClear={() => clearTempDelta(t.yarn.id)} />
        </label>
        {base ? (
          <label class="tpm-box">
            <span class="tpm-box-label">Base rate <span class="hint">{base.name}, every yarn on it</span></span>
            <TempBox value={baseTemp} placeholder={baseMaster} label={`Temporary base rate for ${t.yarn.name} (${base.name})`} error="Base rate must be a number above zero"
              onSet={(v) => setTempRate(base.id, v)} onClear={() => clearTempRate(base.id)} />
          </label>
        ) : null}
      </div>
    </div>
  );
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// What a base rate save reaches, for its confirm: the yarn, TPM yarns made from it, and fabrics using any of them.
function reachText(baseId) {
  const im = baseImpact(baseId);
  return ` That changes ${plural(im.yarns, 'yarn', 'yarns')}${im.tpmYarns ? ` (with ${plural(im.tpmYarns, 'TPM yarn', 'TPM yarns')} made from it)` : ''} and ${plural(im.fabrics, 'fabric', 'fabrics')}.`;
}

// Save to master for a TPM yarn's temporary rate: what was typed is saved — the delta, the base rate, or both.
// This view is the confirm step: it says what changes and how many yarns and fabrics move.
export function TpmSaveView({ item, onClose }) {
  const [busy, setBusy] = useState(false);
  const plan = tpmSavePlan(item.yarn.id, true);
  const baseName = item.base ? item.base.name : 'the base yarn';
  const im = plan.impact;
  const reach = !plan.ok || !im ? '' : !plan.saveBase
    ? `For everyone: only ${item.yarn.name} changes, in ${plural(im.fabrics, 'fabric', 'fabrics')}. ${baseName} keeps its rate.`
    : `For everyone: ${baseName} gets a new rate dated ${fmt.date(todayIst())}${plan.replacesToday !== null && plan.replacesToday !== undefined ? `, replacing today's ${fmt.rate(plan.replacesToday)}/kg` : ''}. That changes ${plural(im.yarns, 'yarn', 'yarns')} (${baseName} and ${plural(im.tpmYarns, 'TPM yarn', 'TPM yarns')} made from it) and ${plural(im.fabrics, 'fabric', 'fabrics')}.${plan.saveDelta ? ` The delta changes for ${item.yarn.name} only.` : ''}`;

  async function save() {
    setBusy(true);
    try {
      await saveTpmTempToMaster(item.yarn.id, true);
      onClose();
    } catch (e) {
      toast(e.message || 'Could not save the rate', 'error');
    }
    setBusy(false);
  }
  const both = plan.ok && plan.newBase !== null && plan.newBase !== undefined;

  return (
    <>
      <Section header={item.yarn.name} footer="The delta is the extra ₹ per kg for twisting. What you typed is saved: the delta, the base rate, or both.">
        <Row label="Delta" value={<span class={plan.saveDelta ? 'strong' : ''}>{fmt.rate(plan.newDelta)}/kg</span>} valueSub={plan.saveDelta ? `was ${fmt.rate(plan.oldDelta)}` : 'no change'} />
        <Row label={`${baseName} rate`} value={<span class={plan.saveBase ? 'strong' : ''}>{plan.newBase === null || plan.newBase === undefined ? 'not set' : `${fmt.rate(plan.newBase)}/kg`}</span>} valueSub={plan.saveBase ? `was ${plan.oldBase === null ? 'not set' : fmt.rate(plan.oldBase)}` : 'no change'} />
        {both ? <Row label={`${item.yarn.name} rate`} value={<span class="strong">{fmt.rate(plan.newBase + plan.newDelta)}/kg</span>} valueSub={item.masterRate === null ? undefined : `was ${fmt.rate(item.masterRate)}`} /> : null}
      </Section>
      {plan.ok ? <div class="notice tpm-reach">{reach} What was saved stops being temporary on this device.</div> : <div class="notice tpm-error">{plan.error}</div>}
      <div class="row temp-price-actions">
        <Button kind="secondary" onClick={onClose} disabled={busy}>Back</Button>
        <Button onClick={save} busy={busy} disabled={busy || !plan.ok}>Save to master</Button>
      </div>
    </>
  );
}

const rpmText = (v) => (v === null || v === undefined ? 'not set' : fmt.int(v));
const rpmPair = (sp, dp) => `single ${rpmText(sp)} · double ${rpmText(dp)}`;

function confirmRpmToMaster(fabric, t) {
  const parts = [];
  if (t.sp !== null && t.sp !== undefined) parts.push(`single panna ${fmt.int(t.sp)} (now ${rpmText(t.masterSp)})`);
  if (t.dp !== null && t.dp !== undefined) parts.push(`double panna ${fmt.int(t.dp)} (now ${rpmText(t.masterDp)})`);
  return askConfirm({
    title: `Save ${fabric.name}'s loom RPM?`,
    text: `Loom RPM ${parts.join(' and ')} becomes the master for everyone. The Planner's saved plans keep their own RPMs. The temporary RPM is removed afterwards.`,
    yes: 'Save RPM to master',
  });
}

// Fabric page: try another single or double panna RPM (device only), see what changes, or save it to master.
// calc: the page's calc (with any temporary RPM). master: the same without this fabric's temporary RPM.
// tiles: [{ width, panna, unit }] the loom widths the page shows (daily consumption unit), for the comparison.
export function TempRpmSection({ fabric, calc, master, unit, widths }) {
  const [busy, setBusy] = useState(false);
  const active = calc.rpmTemp;
  const t = getState().tempRpms[fabric.id] || {};
  const cmp = [];
  if (active && unit) {
    for (const w of widths) {
      const a = loomPerDay(master, fabric, unit, w.panna, w.width);
      const b = loomPerDay(calc, fabric, unit, w.panna, w.width);
      if (a.rpm === b.rpm) continue;
      const wl = w.width ? `${fmt.int(w.width)} cm` : w.panna === 2 ? 'double panna' : 'single panna';
      cmp.push([`Metres per loom · ${wl}`, b.mPerDay === null ? '—' : `${fmt.n(b.mPerDay, 0)} m/day`, a.mPerDay, b.mPerDay, (v) => `${fmt.n(v, 0)} m`]);
      const ra = loomRealisation(master, a), rb = loomRealisation(calc, b);
      if (rb !== null) cmp.push([`Loom realisation · ${wl}`, `${fmt.rs(rb, 0)} / day`, ra, rb, (v) => fmt.rs(v, 0)]);
    }
  }
  const diff = (a, b, f) => {
    if (a === null || b === null || a === undefined || b === undefined) return undefined;
    const d = b - a;
    if (Math.abs(d) < 1e-9) return 'no change';
    return `${d > 0 ? '+' : '−'}${f(Math.abs(d))} vs master`;
  };
  const cls = (a, b) => (a === null || b === null || a === undefined || b === undefined || Math.abs(b - a) < 1e-9 ? '' : b > a ? 'good' : 'bad');

  async function toMaster() {
    const item = { sp: num(t.sp), dp: num(t.dp), masterSp: calc.masterRpmSp, masterDp: calc.masterRpmDp };
    if (!(await confirmRpmToMaster(fabric, item))) return;
    setBusy(true);
    try {
      await saveTempRpmToMaster(fabric.id);
    } catch (e) {
      toast(e.message || 'Could not save the loom RPM', 'error');
    }
    setBusy(false);
  }

  return (
    <Section header="Try a loom RPM" id="sec-rpm" footer="This device only, until you reset it. Used on this fabric's pages and shares, not in the Planner." guide="temp-rpm">
      <label class="row field cmp rpm-field">
        <span class="row-main">
          <span class="row-label">Single panna RPM</span>
          <span class="row-sub">190 cm looms · master {rpmText(calc.masterRpmSp)}</span>
        </span>
        <TempBox value={calc.rpmTempSp ? calc.rpmSp : null} placeholder={calc.masterRpmSp} label={`Temporary single panna RPM for ${fabric.name}`} error="RPM must be a number above zero"
          prefix={null} suffix={null} empty="—" onSet={(v) => setTempRpm(fabric.id, 'sp', v)} onClear={() => clearTempRpm(fabric.id, 'sp')} />
      </label>
      <label class="row field cmp rpm-field">
        <span class="row-main">
          <span class="row-label">Double panna RPM</span>
          <span class="row-sub">280 cm looms · master {rpmText(calc.masterRpmDp)}</span>
        </span>
        <TempBox value={calc.rpmTempDp ? calc.rpmDp : null} placeholder={calc.masterRpmDp} label={`Temporary double panna RPM for ${fabric.name}`} error="RPM must be a number above zero"
          prefix={null} suffix={null} empty="—" onSet={(v) => setTempRpm(fabric.id, 'dp', v)} onClear={() => clearTempRpm(fabric.id, 'dp')} />
      </label>
      {cmp.map(([label, value, a, b, f]) => (
        <Row label={label} value={<span class={`strong ${cls(a, b)}`}>{value}</span>} valueSub={diff(a, b, f)} />
      ))}
      {active ? (
        <div class="row temp-price-actions">
          <Button kind="secondary" onClick={() => clearTempRpm(fabric.id)}>Reset to master</Button>
          <Button onClick={toMaster} busy={busy} disabled={busy}>Save to master</Button>
        </div>
      ) : null}
    </Section>
  );
}

function confirmPriceToMaster(fabric, price, masterPrice) {
  const m = masterPrice === null || masterPrice === undefined ? 'not set' : `${fmt.rs(masterPrice)}/m`;
  return askConfirm({
    title: `Save ${fabric.name}'s sale rate?`,
    text: `${fmt.rs(price)}/m becomes the selling price for everyone, with sale date ${fmt.date(todayIst())}. It is ${m} now. The temporary rate is removed afterwards.`,
    yes: `Save ${fmt.rs(price)}/m to master`,
  });
}

const STEP = 0.25;
const round2 = (v) => Math.round(v * 100) / 100;

// Fabric page: try another sale rate (device only), see what changes, or make it the master rate.
// master: fabricCalc without this fabric's temporary sale rate. unit: a unit with a cost per pick, or null.
export function TempPriceSection({ fabric, calc, master, unit, loom }) {
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const active = calc.priceTemp;
  const shown = draft !== null ? draft : active ? String(calc.price) : '';
  const base = active ? calc.price : calc.masterPrice;
  const rfd = calc.finish === 'RFD';
  const per = rfd ? 'RFD m' : 'm';
  const k = unit ? num(unit.cost_per_pick) : null;
  const breakEven = k !== null ? priceForPick(master, fabric, k) : null;
  const noLoss = priceForPick(master, fabric, 0);

  function commit() {
    const v = (draft ?? '').trim();
    setDraft(null);
    if (v === '') {
      if (active) clearTempPrice(fabric.id);
      return;
    }
    if (!setTempPrice(fabric.id, v)) toast('Temporary sale rate must be a number above zero', 'error');
  }
  const nudge = (d) => { setDraft(null); if (base !== null) setTempPrice(fabric.id, Math.max(STEP, round2(base + d))); };
  const setTo = (v) => { setDraft(null); if (v !== null) setTempPrice(fabric.id, Math.ceil(v / STEP) * STEP); };

  async function toMaster() {
    if (!(await confirmPriceToMaster(fabric, calc.price, calc.masterPrice))) return;
    setBusy(true);
    try {
      await saveTempPriceToMaster(fabric.id);
    } catch (e) {
      toast(e.message || 'Could not save the sale rate', 'error');
    }
    setBusy(false);
  }

  const profit = (c) => (k !== null && c.realisationNetPerPick !== null ? c.realisationNetPerPick - k : null);
  const loomDay = (c) => (loom && loom.mPerDay !== null && c.realisationNetPerPick !== null && c.ppi ? c.realisationNetPerPick * loom.mPerDay * c.ppi : null);
  const diff = (a, b, f) => {
    if (a === null || b === null) return undefined;
    const d = b - a;
    if (Math.abs(d) < 1e-9) return 'no change';
    return `${d > 0 ? '+' : '−'}${f(Math.abs(d))} vs master`;
  };
  const cls = (a, b) => (a === null || b === null || Math.abs(b - a) < 1e-9 ? '' : b > a ? 'good' : 'bad');
  const cmp = active ? [
    ['Realisation with VATAV', `${fmt.pick(calc.realisationNetPerPick)} / pick`, master.realisationNetPerPick, calc.realisationNetPerPick, fmt.pick],
    [`Realisation per ${per}`, fmt.rs(calc.realisationNetPerM), master.realisationNetPerM, calc.realisationNetPerM, fmt.rs],
    ...(k !== null ? [[`Profit at ${unit.name}`, `${fmt.signedPick(profit(calc))} / pick`, profit(master), profit(calc), fmt.pick]] : []),
    ...(loomDay(calc) !== null ? [[`Loom realisation${loom.width ? ` · ${fmt.int(loom.width)} cm` : ''}`, `${fmt.rs(loomDay(calc), 0)} / day`, loomDay(master), loomDay(calc), (v) => fmt.rs(v, 0)]] : []),
  ] : [];

  return (
    <Section
      header="Try a sale rate"
      id="sec-rates"
      footer="This device only, until you reset it."
      guide="temp-sale-rate"
    >
      <label class="row field cmp price-field">
        <span class="row-main">
          <span class="row-label">Try rate</span>
          <span class="row-sub">master {calc.masterPrice === null ? 'not set' : `${fmt.rs(calc.masterPrice)}/${per}`}</span>
        </span>
        <span class="field-input compact">
          <span class="affix">₹</span>
          <input
            class="num"
            style={{ width: `${Math.max(2, (shown || String(calc.masterPrice ?? 'per m')).length) + 0.5}ch` }}
            inputmode="decimal"
            value={shown}
            placeholder={calc.masterPrice === null ? `per ${per}` : String(calc.masterPrice)}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            aria-label={`Temporary sale rate for ${fabric.name}`}
          />
          <span class="affix">/{per}</span>
          {active ? <TextButton onClick={() => { setDraft(null); clearTempPrice(fabric.id); }}>Reset</TextButton> : null}
        </span>
      </label>
      <div class="row price-try">
        <div class="chips price-chips">
          <button type="button" class="chip" disabled={base === null} onClick={() => nudge(-1)} aria-label="Lower by 1 rupee">−₹1</button>
          <button type="button" class="chip" disabled={base === null} onClick={() => nudge(-STEP)} aria-label="Lower by 25 paise">−₹0.25</button>
          <button type="button" class="chip" disabled={base === null} onClick={() => nudge(STEP)} aria-label="Raise by 25 paise">+₹0.25</button>
          <button type="button" class="chip" disabled={base === null} onClick={() => nudge(1)} aria-label="Raise by 1 rupee">+₹1</button>
          {breakEven !== null ? <button type="button" class="chip" onClick={() => setTo(breakEven)} title={`Profit per pick is zero at ${unit.name} (cost ${fmt.pick(k)} per pick)`}>No profit · {fmt.rs(Math.ceil(breakEven / STEP) * STEP)}</button> : null}
          {noLoss !== null ? <button type="button" class="chip" onClick={() => setTo(noLoss)} title="Realisation with VATAV is zero: the sale rate only covers yarn and finishing costs">Covers cost · {fmt.rs(Math.ceil(noLoss / STEP) * STEP)}</button> : null}
        </div>
      </div>
      {cmp.map(([label, value, a, b, f]) => (
        <Row label={label} value={<span class={`strong ${cls(a, b)}`}>{value}</span>} valueSub={diff(a, b, f)} />
      ))}
      {active ? (
        <div class="row temp-price-actions">
          <Button kind="secondary" onClick={() => { setDraft(null); clearTempPrice(fabric.id); }}>Reset to master</Button>
          <Button onClick={toMaster} busy={busy} disabled={busy}>Save to master</Button>
        </div>
      ) : null}
    </Section>
  );
}
