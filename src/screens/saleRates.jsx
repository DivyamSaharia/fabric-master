import { useState } from 'preact/hooks';
import { fmt, unitProfit } from '../calc.js';
import { pastRateView } from '../saleRates.js';
import { deleteSaleRates, getIndex, toast } from '../store.js';
import { askConfirm } from '../confirm.js';
import { Icon, IconButton, Section, Sheet } from '../ui.jsx';

const when = (h) => (h.date ? fmt.date(h.date) : 'no date');

const signed = (v, f) => (v === null || v === undefined || !isFinite(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${f(Math.abs(v))}`);

// One past sale rate on its own date: realisation at that rate with the yarn rates of that date, next to the
// rate in use at today's yarn rates. View only.
export function PastRateSheet({ fabric, h, inUse, rfd, onClose }) {
  if (!h) return null;
  const idx = getIndex();
  const per = rfd ? 'RFD m' : 'm';
  const v = pastRateView(fabric, h, idx);
  const t = v.then, n = v.now;
  const unit = (idx.assignmentsByFabric[fabric.id] || []).map((a) => idx.unitsById[a.unit_id]).find((u) => u && unitProfit(n, u).costPerPick !== null) || null;
  const pt = unit ? unitProfit(t, unit) : null;
  const pn = unit ? unitProfit(n, unit) : null;
  const early = v.yarns.filter((y) => y.early);
  const none = v.yarns.filter((y) => y.none);
  const lines = [
    ['Sale rate', fmt.rs(t.price), fmt.rs(n.price), signed(n.price === null || t.price === null ? null : t.price - n.price, fmt.rs)],
    ['Realisation per pick, with VATAV', fmt.pick(t.realisationNetPerPick), fmt.pick(n.realisationNetPerPick), signed(t.realisationNetPerPick === null || n.realisationNetPerPick === null ? null : t.realisationNetPerPick - n.realisationNetPerPick, fmt.pick)],
    ['Realisation per pick, without VATAV', fmt.pick(t.realisationPerPick), fmt.pick(n.realisationPerPick), signed(t.realisationPerPick === null || n.realisationPerPick === null ? null : t.realisationPerPick - n.realisationPerPick, fmt.pick)],
    [`Realisation per ${per}, with VATAV`, fmt.rs(t.realisationNetPerM), fmt.rs(n.realisationNetPerM), signed(t.realisationNetPerM === null || n.realisationNetPerM === null ? null : t.realisationNetPerM - n.realisationNetPerM, fmt.rs)],
    [`Raw material cost per ${per}`, fmt.rs(t.rmPerSaleM), fmt.rs(n.rmPerSaleM), signed(t.rmPerSaleM === null || n.rmPerSaleM === null ? null : t.rmPerSaleM - n.rmPerSaleM, fmt.rs)],
    ...(rfd ? [[`Total cost per ${per} (raw material + finishing)`, fmt.rs(t.rfdCost), fmt.rs(n.rfdCost), signed(t.rfdCost === null || n.rfdCost === null ? null : t.rfdCost - n.rfdCost, fmt.rs)]] : []),
    ...(unit ? [[`Profit per pick at ${unit.name}`, fmt.pick(pt.profitPerPick), fmt.pick(pn.profitPerPick), signed(pt.profitPerPick === null || pn.profitPerPick === null ? null : pt.profitPerPick - pn.profitPerPick, fmt.pick)]] : []),
  ];
  const thenHead = h.date ? fmt.date(h.date) : 'This rate';
  return (
    <Sheet open onClose={onClose} title={`${fmt.rs(h.rate)} · ${when(h)}`}>
      <div class="past-rate">
        <p class="past-foot past-top">Sale rate per {rfd ? 'RFD metre' : 'metre'}{h.saved ? ` · saved ${h.saved}` : ''}{h.inUse ? ' · the rate in use' : ' · a past rate'}. Realisation at this rate, with the yarn rates of {v.dated ? 'its date' : 'today (it has no sale date)'}.</p>
        <div class="tiles">
          <div class="tile accent">
            <div class="t-label">With VATAV{t.vatavPct ? ` (${fmt.n(t.vatavPct, t.vatavPct % 1 ? 1 : 0)}%)` : ''}</div>
            <div class="t-value">{fmt.pick(t.realisationNetPerPick)}</div>
            <div class="t-sub">per pick · {fmt.rs(t.realisationNetPerM)}/{per}</div>
          </div>
          <div class="tile">
            <div class="t-label">Without VATAV</div>
            <div class="t-value">{fmt.pick(t.realisationPerPick)}</div>
            <div class="t-sub">per pick · {fmt.rs(t.realisationPerM)}/{per}</div>
          </div>
        </div>
        <div class={`notice rates-note${v.dated && (v.changed || early.length) ? ' temp-note' : ''}`} data-past-note>
          <span>
            {!v.dated
              ? 'This rate has no sale date, so today’s yarn rates are used.'
              : v.changed
                ? `Yarn rates have changed since ${fmt.date(h.date)} (${v.changed} of ${v.yarns.length} ${v.yarns.length === 1 ? 'yarn' : 'yarns'}). These figures use the rates of that date.`
                : `Yarn rates are the same today as on ${fmt.date(h.date)}.`}
            {early.length ? ` No rate on or before that date for ${early.map((y) => y.yarn.name).join(', ')}: the earliest rate it has is used.` : ''}
            {none.length ? ` No rate at all for ${none.map((y) => y.yarn.name).join(', ')}, so cost figures are blank.` : ''}
          </span>
        </div>
        <h3 class="past-h">{h.inUse ? 'At the yarn rates of its date, and at today’s yarn rates' : 'This rate on its date, and the rate in use at today’s yarn rates'}</h3>
        <table class="past-table">
          <thead><tr><th /><th>{thenHead}</th><th>{h.inUse ? 'Today' : `In use today${inUse ? ` (${fmt.rs(inUse.rate)})` : ''}`}</th><th>Difference</th></tr></thead>
          <tbody>{lines.map((r) => <tr><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td></tr>)}</tbody>
        </table>
        <p class="past-foot">Difference = the first column minus the second. A minus means the figure is lower in the first column.{unit ? ` Profit uses ${unit.name}’s cost per pick.` : ''}</p>
        <h3 class="past-h">Yarn rates, ₹ per kg</h3>
        <table class="past-table">
          <thead><tr><th /><th>{v.dated ? thenHead : 'Used'}</th><th>Today</th><th>Difference</th></tr></thead>
          <tbody>
            {v.yarns.map((y) => (
              <tr class={y.changed ? 'moved' : ''}>
                <td>{y.yarn.name}{y.tpm.length ? <div class="row-sub">base of {y.tpm.map((x) => x.name).join(', ')}</div> : null}{y.thenRate !== null && y.thenDate ? <div class="row-sub">{y.early ? 'earliest rate, from ' : 'rate from '}{fmt.date(y.thenDate)}{y.changed && y.nowDate ? ` · today’s from ${fmt.date(y.nowDate)}` : ''}</div> : null}</td>
                <td>{fmt.rate(y.thenRate)}</td>
                <td>{fmt.rate(y.nowRate)}</td>
                <td>{y.changed ? signed(y.thenRate - y.nowRate, fmt.rate) : y.none ? '—' : 'same'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="past-foot">View only, nothing is saved. Only sale rates and yarn rates carry dates: construction, shortage, VATAV %, finishing charges, TPM deltas and the unit’s cost per pick are as they stand today. Temporary rates on this device are left out.</p>
      </div>
    </Sheet>
  );
}

// Sale rate history on the fabric page: tap a rate to see realisation at it on its date (view only),
// or delete rates. Deleting the rate in use brings back the next older one, for everyone.
export function SaleRatesSection({ fabric, hist, rfd }) {
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null);
  if (!hist.length) return null;
  const per = rfd ? 'RFD m' : 'm';
  const real = hist.filter((h) => !h.virtual);
  const inUse = hist.find((h) => h.inUse) || null;
  const older = real.filter((h) => !h.inUse);
  const viewed = view ? hist.find((h) => h.id === view) || null : null;

  async function remove(rows) {
    const list = rows.map((h) => `${fmt.rs(h.rate)} from ${when(h)}`).join(', ');
    const goesInUse = rows.some((h) => h.inUse);
    const left = real.filter((h) => !rows.includes(h));
    const after = goesInUse
      ? left.length
        ? `${fmt.rs(left[0].rate)} from ${when(left[0])} becomes the selling price again.`
        : 'This fabric will have no selling price.'
      : 'It is removed for everyone. The selling price stays as it is.';
    if (!(await askConfirm({ title: `Delete ${list}?`, text: after, yes: rows.length === 1 ? 'Delete sale rate' : `Delete ${rows.length} sale rates`, danger: true }))) return;
    setBusy(true);
    try {
      await deleteSaleRates(fabric.id, rows.map((h) => h.id));
      setView(null);
    } catch (e) {
      toast(e.message || 'Could not delete', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      id="sec-sale-rates"
      header="Sale rate history"
      footer="Every price change is kept as its own row. Tap a rate to see its realisation at the yarn rates of its date. Delete the rate in use and the next older one applies, for everyone."
    >
      {!inUse ? (
        <div class="row"><div class="row-main"><div class="row-label">No selling price set</div><div class="row-sub">Add one with Edit, or tap a rate below to see its realisation.</div></div></div>
      ) : null}
      {hist.map((h) => (
        <div class="row row-split">
          <button type="button" class="row-main row-tap" aria-label={`See realisation at ${fmt.rs(h.rate)} from ${when(h)}${h.saved ? `, saved ${h.saved}` : ''}${h.inUse ? ', in use' : ''}`} onClick={() => setView(h.id)}>
            <div class="row-label">{fmt.rs(h.rate)} / {per}</div>
            <div class="row-sub">From {when(h)}{h.saved ? ` · saved ${h.saved}` : ''}{h.inUse ? ' · in use' : ''}{h.virtual ? ' · the fabric’s price, not in the history' : ''}</div>
          </button>
          <span class="row-chevron"><Icon.chevron size={13} /></span>
          {h.virtual ? null : (
            <IconButton label={`Delete sale rate from ${when(h)}`} disabled={busy} onClick={() => remove([h])}>
              <span class="bad"><Icon.trash size={20} /></span>
            </IconButton>
          )}
        </div>
      ))}
      {older.length > 1 ? (
        <button type="button" class="add-row danger" disabled={busy} onClick={() => remove(older)}>
          <Icon.trash size={20} />Delete older rates
        </button>
      ) : null}
      <PastRateSheet fabric={fabric} h={viewed} inUse={inUse} rfd={rfd} onClose={() => setView(null)} />
    </Section>
  );
}
