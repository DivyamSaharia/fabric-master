import { useEffect, useState } from 'preact/hooks';
import { askConfirm } from '../confirm.js';
import { fmt, num, priceForPick } from '../calc.js';
import {
  activeTempPrices, activeTempRates, clearAllTempPrices, clearAllTempRates, clearTempPrice, clearTempRate,
  getState, saveTempPriceToMaster, saveTempRateToMaster, saveTpmTempToMaster, setTempPrice, setTempRate, toast, todayIst, tpmSavePlan, useStore,
} from '../store.js';
import { Button, Icon, NumField, Row, Section, Segmented, Sheet, TextButton } from '../ui.jsx';

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

function stripLabel(list, prices) {
  return [
    list.length ? (list.length === 1 ? '1 temporary yarn rate' : `${list.length} temporary yarn rates`) : '',
    prices.length ? (prices.length === 1 ? '1 temporary sale rate' : `${prices.length} temporary sale rates`) : '',
  ].filter(Boolean).join(' · ');
}

// Strip under the top bar of every screen while any temporary rate is on.
export function TempRatesStrip() {
  const st = useStore();
  const list = Object.keys(st.tempRates).length ? activeTempRates() : [];
  const prices = Object.keys(st.tempPrices).length ? activeTempPrices() : [];
  if (!list.length && !prices.length) return null;
  return (
    <button type="button" class="temp-strip" onClick={() => setPanelOpen(true)}>
      <span>{stripLabel(list, prices)} active</span>
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
  const list = Object.keys(st.tempRates).length ? activeTempRates() : [];
  const prices = Object.keys(st.tempPrices).length ? activeTempPrices() : [];
  if (!list.length && !prices.length) return null;

  async function toMaster(item) {
    if (item.tpm) {
      setTpmItem(item);
      return;
    }
    const m = item.masterRate === null ? 'no rate' : `${fmt.rate(item.masterRate)}/kg`;
    const ok = await askConfirm({
      title: `Save ${item.yarn.name} to master?`,
      text: `${fmt.rate(item.rate)}/kg becomes today's rate in the yarn master, for everyone. It is ${m} now. The temporary rate is removed afterwards.`,
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
        footer={<Button kind="secondary" onClick={() => { clearAllTempRates(); clearAllTempPrices(); setOpen(false); }}>Reset all</Button>}
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
        {list.length ? (
        <Section header={prices.length ? 'Yarn rates' : undefined} footer="This device only. The yarn master is not changed until you save.">
          {list.map((item) => (
            <Row
              label={item.yarn.name}
              sub={item.tpm
                ? `TPM yarn · master ${item.masterBase === null ? `${item.base ? item.base.name : 'base'} has no rate` : `${fmt.rate(item.masterBase)} + ${fmt.rate(item.delta)} = ${fmt.rate(item.masterRate)}/kg`}`
                : item.masterRate === null ? 'No master rate' : `Master ${fmt.rate(item.masterRate)}/kg`}
              value={<span class="strong">{fmt.rate(item.rate)}/kg</span>}
              valueSub="temporary"
            >
              <div class="temp-actions">
                <Button kind="primary small" onClick={() => toMaster(item)} disabled={busy}>Save to master</Button>
                <button type="button" class="link-btn" onClick={() => clearTempRate(item.yarn.id)}>Reset</button>
              </div>
            </Row>
          ))}
        </Section>
        ) : null}
      </Sheet>
    </>
  );
}

// Per-yarn temporary rate input on the fabric page. Empty and leaving the field clears it.
// yarn: a base yarn or a TPM yarn. temp: its temporary rate or null. placeholder: the rate it has without one.
export function TempRateRow({ yarn, temp, placeholder, tpm }) {
  const [draft, setDraft] = useState(null);
  const active = temp !== null && temp !== undefined;
  const shown = draft !== null ? draft : active ? String(temp) : '';
  const ph = placeholder === null || placeholder === undefined ? null : String(Math.round(placeholder * 100) / 100);

  function commit() {
    const v = (draft ?? '').trim();
    setDraft(null);
    if (v === '') {
      if (active) clearTempRate(yarn.id);
      return;
    }
    if (!setTempRate(yarn.id, v)) toast('Temporary rate must be a number above zero', 'error');
  }

  return (
    <label class={`row field cmp${tpm ? ' tpm-temp' : ''}`}>
      <span class="row-label">
        {tpm ? 'Temporary TPM rate' : 'Temporary rate'} <span class="hint">{yarn.name}{tpm && !active ? ' · base + delta now' : ''}{tpm && active ? ' · overrides base + delta' : ''}</span>
      </span>
      <span class="field-input compact">
        <span class="affix">₹</span>
        <input
          class="num"
          size={Math.max(3, shown.length, String(ph ?? '').length)}
          inputmode="decimal"
          value={shown}
          placeholder={ph === null ? 'per kg' : ph}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          aria-label={`Temporary rate for ${yarn.name}`}
        />
        <span class="affix">/kg</span>
        {active ? <TextButton onClick={() => { setDraft(null); clearTempRate(yarn.id); }}>Reset</TextButton> : null}
      </span>
    </label>
  );
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Save to master for a temporary rate typed on a TPM yarn: change the delta, the base rate, or both.
// This view is the confirm step: it says what changes and how many yarns and fabrics move.
export function TpmSaveView({ item, onClose }) {
  // delta only changes the least; with no base rate yet, only "both" can work
  const [mode, setMode] = useState(item.masterBase === null ? 'both' : 'delta');
  const [baseDraft, setBaseDraft] = useState(item.masterBase === null ? '' : String(item.masterBase));
  const [busy, setBusy] = useState(false);
  const plan = tpmSavePlan(item.yarn.id, mode, baseDraft);
  const baseName = item.base ? item.base.name : 'the base yarn';
  const baseTemp = item.base ? getState().tempRates[item.base.id] ?? null : null;
  const im = plan.impact;
  const reach = !plan.ok || !im ? '' : mode === 'delta'
    ? `For everyone: only ${item.yarn.name} changes, in ${plural(im.fabrics, 'fabric', 'fabrics')}. ${baseName} keeps its rate.`
    : `For everyone: ${baseName} gets a new rate dated ${fmt.date(todayIst())}${plan.replacesToday !== null && plan.replacesToday !== undefined ? `, replacing today's ${fmt.rate(plan.replacesToday)}/kg` : ''}. That changes ${plural(im.yarns, 'yarn', 'yarns')} (${baseName} and ${plural(im.tpmYarns, 'TPM yarn', 'TPM yarns')} made from it) and ${plural(im.fabrics, 'fabric', 'fabrics')}.`;
  const tempNote = baseTemp === null ? '' : mode === 'delta'
    ? ` ${baseName} still has a temporary rate of ${fmt.rate(baseTemp)}/kg on this device, so ${item.yarn.name} will show ${fmt.rate(baseTemp + (plan.newDelta ?? 0))}/kg here until you reset it.`
    : ` The temporary rate on ${baseName} (${fmt.rate(baseTemp)}/kg) is removed too.`;

  async function save() {
    setBusy(true);
    try {
      await saveTpmTempToMaster(item.yarn.id, mode, baseDraft);
      onClose();
    } catch (e) {
      toast(e.message || 'Could not save the rate', 'error');
    }
    setBusy(false);
  }

  return (
    <>
      <Section header={item.yarn.name}>
        <Row label="Temporary rate" value={<span class="strong">{fmt.rate(item.rate)}/kg</span>} valueSub="this device" />
        <Row label="Master now" value={item.masterBase === null ? 'No base rate' : `${fmt.rate(item.masterBase)} + ${fmt.rate(item.delta)} = ${fmt.rate(item.masterRate)}/kg`} valueSub={`${baseName} + delta`} />
      </Section>
      <Section header="What to change in the master" footer={`The delta is the extra ₹ per kg for twisting. ${mode === 'delta' ? 'The base rate stays. The delta becomes the temporary rate minus the base rate.' : mode === 'base' ? 'The delta stays. The base rate becomes the temporary rate minus the delta.' : 'Type the new base rate. The delta is what is left of the temporary rate.'}`}>
        <div class="row"><div class="seg-fill"><Segmented label="What to change" options={[{ value: 'delta', label: 'Delta only' }, { value: 'base', label: 'Base rate' }, { value: 'both', label: 'Both' }]} value={mode} onChange={setMode} /></div></div>
        {mode === 'both' ? <NumField label={`New rate · ${baseName}`} hint="per kg" prefix="₹" value={baseDraft} onInput={setBaseDraft} /> : null}
      </Section>
      <Section header="After saving" footer={plan.ok ? `The temporary rate on ${item.yarn.name} is removed afterwards.${tempNote}` : null}>
        {plan.ok ? (
          <>
            <Row label={`${baseName} rate`} value={<span class={plan.newBase !== plan.oldBase ? 'strong' : ''}>{fmt.rate(plan.newBase)}/kg</span>} valueSub={plan.newBase !== plan.oldBase ? `was ${plan.oldBase === null ? 'not set' : fmt.rate(plan.oldBase)}` : 'no change'} />
            <Row label="Delta" value={<span class={plan.newDelta !== plan.oldDelta ? 'strong' : ''}>{fmt.rate(plan.newDelta)}/kg</span>} valueSub={plan.newDelta !== plan.oldDelta ? `was ${fmt.rate(plan.oldDelta)}` : 'no change'} />
            <Row label={`${item.yarn.name} rate`} value={<span class="strong">{fmt.rate(plan.newBase + plan.newDelta)}/kg</span>} />
          </>
        ) : (
          <div class="notice tpm-error">{plan.error}</div>
        )}
      </Section>
      {plan.ok ? <div class="notice tpm-reach">{reach}</div> : null}
      <div class="row temp-price-actions">
        <Button kind="secondary" onClick={onClose} disabled={busy}>Back</Button>
        <Button onClick={save} busy={busy} disabled={busy || !plan.ok}>Save to master</Button>
      </div>
    </>
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
