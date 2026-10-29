import { useState } from 'preact/hooks';
import { fmt, num, priceForPick } from '../calc.js';
import {
  activeTempPrices, activeTempRates, clearAllTempPrices, clearAllTempRates, clearTempPrice, clearTempRate,
  saveTempPriceToMaster, saveTempRateToMaster, setTempPrice, setTempRate, toast, todayIst, useStore,
} from '../store.js';
import { Button, Icon, Row, Section, Sheet, TextButton } from '../ui.jsx';

// Strip across the top of every screen while any temporary yarn rate is on, with the panel to reset them.
export function TempRatesStrip() {
  const st = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = Object.keys(st.tempRates).length ? activeTempRates() : [];
  const prices = Object.keys(st.tempPrices).length ? activeTempPrices() : [];
  if (!list.length && !prices.length) return null;
  const label = [
    list.length ? (list.length === 1 ? '1 temporary yarn rate' : `${list.length} temporary yarn rates`) : '',
    prices.length ? (prices.length === 1 ? '1 temporary sale rate' : `${prices.length} temporary sale rates`) : '',
  ].filter(Boolean).join(' · ');

  async function toMaster(item) {
    const m = item.masterRate === null ? 'no rate' : `${fmt.rate(item.masterRate)}/kg`;
    if (!window.confirm(`Save ${fmt.rate(item.rate)}/kg as today's rate for ${item.yarn.name} in the yarn master? It is ${m} now. The temporary rate is removed afterwards.`)) return;
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
      <button type="button" class="temp-strip" onClick={() => setOpen(true)}>
        <span>{label} active</span>
        <span class="temp-strip-go">View<Icon.chevron size={11} /></span>
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Temporary rates"
        footer={<Button kind="secondary" onClick={() => { clearAllTempRates(); clearAllTempPrices(); setOpen(false); }}>Reset all</Button>}
      >
        {prices.length ? (
          <Section header="Sale rates" footer="Set on this device only. Save to master makes it the fabric's selling price for everyone, with today's sale date.">
            {prices.map((item) => (
              <Row
                label={item.fabric.name}
                sub={item.masterPrice === null ? 'No master sale rate' : `Master ${fmt.rs(item.masterPrice)}`}
                value={<span class="strong">{fmt.rs(item.price)}/{item.fabric.finish === 'RFD' ? 'RFD m' : 'm'}</span>}
                valueSub="temporary"
              >
                <div class="temp-actions">
                  <TextButton onClick={() => clearTempPrice(item.fabric.id)}>Reset</TextButton>
                  <TextButton onClick={() => priceToMaster(item)} disabled={busy}>Save to master</TextButton>
                </div>
              </Row>
            ))}
          </Section>
        ) : null}
        {list.length ? (
        <Section header={prices.length ? 'Yarn rates' : undefined} footer="Set on this device only, to try a different price. The yarn master and the Sheet are not changed, so these figures differ from everyone else's.">
          {list.map((item) => (
            <Row
              label={item.yarn.name}
              sub={item.masterRate === null ? 'No master rate' : `Master ${fmt.rate(item.masterRate)}/kg`}
              value={<span class="strong">{fmt.rate(item.rate)}/kg</span>}
              valueSub="temporary"
            >
              <div class="temp-actions">
                <TextButton onClick={() => clearTempRate(item.yarn.id)}>Reset</TextButton>
                <TextButton onClick={() => toMaster(item)} disabled={busy}>Save to master</TextButton>
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
export function TempRateRow({ src }) {
  const [draft, setDraft] = useState(null);
  const active = src.temp !== null && src.temp !== undefined;
  const shown = draft !== null ? draft : active ? String(src.temp) : '';
  const master = src.dates.length ? src.dates[0].rate : null;

  function commit() {
    const v = (draft ?? '').trim();
    setDraft(null);
    if (v === '') {
      if (active) clearTempRate(src.yarn.id);
      return;
    }
    if (!setTempRate(src.yarn.id, v)) toast('Temporary rate must be a number above zero', 'error');
  }

  return (
    <label class="row field">
      <span class="row-label">
        Temporary rate <span class="hint">{src.yarn.name}</span>
      </span>
      <span class="field-input">
        <span class="affix">₹</span>
        <input
          class="num"
          size={Math.max(3, shown.length, String(master ?? '').length)}
          inputmode="decimal"
          value={shown}
          placeholder={master === null ? 'per kg' : String(master)}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          aria-label={`Temporary rate for ${src.yarn.name}`}
        />
        <span class="affix">/kg</span>
        {active ? <TextButton onClick={() => { setDraft(null); clearTempRate(src.yarn.id); }}>Reset</TextButton> : null}
      </span>
    </label>
  );
}

function confirmPriceToMaster(fabric, price, masterPrice) {
  const m = masterPrice === null || masterPrice === undefined ? 'not set' : `${fmt.rs(masterPrice)}/m`;
  return Promise.resolve(window.confirm(`Save ${fmt.rs(price)}/m as the selling price of ${fabric.name}, with sale date ${fmt.date(todayIst())}? It is ${m} now. Everyone will see the new rate. The temporary rate is removed afterwards.`));
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
      footer={`Type a temporary sale rate to see how every figure changes. It stays on this device only, for this fabric, until you reset it; the fabric list, Ranking, Planner and files use it too.${active ? ` Save to master makes it the selling price for everyone, with sale date ${fmt.date(todayIst())}.` : ''}`}
    >
      <label class="row field price-field">
        <span class="row-main">
          <span class="row-label">Try rate</span>
          <span class="row-sub">master {calc.masterPrice === null ? 'not set' : `${fmt.rs(calc.masterPrice)}/${per}`}</span>
        </span>
        <span class="field-input">
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
