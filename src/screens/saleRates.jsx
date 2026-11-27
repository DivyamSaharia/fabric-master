import { useState } from 'preact/hooks';
import { fmt } from '../calc.js';
import { deleteSaleRates, toast } from '../store.js';
import { askConfirm } from '../confirm.js';
import { Icon, IconButton, Section } from '../ui.jsx';

const when = (h) => (h.date ? fmt.date(h.date) : 'no date');

// Sale rate history on the fabric page: pick an older rate to view the page at it (view only),
// or delete rates. Deleting the rate in use brings back the next older one, for everyone.
export function SaleRatesSection({ fabric, hist, pick, setPick, tempOn, rfd }) {
  const [busy, setBusy] = useState(false);
  if (!hist.length) return null;
  const per = rfd ? 'RFD m' : 'm';
  const real = hist.filter((h) => !h.virtual);
  const inUse = hist.find((h) => h.inUse) || null;
  const older = real.filter((h) => !h.inUse);
  const value = pick && hist.some((h) => h.id === pick) ? pick : inUse ? inUse.id : '';

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
      setPick(null);
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
      footer={tempOn ? 'A temporary sale rate is on, so older rates can’t be picked. Reset it first.' : 'Pick an older rate to see the page at it (view only, nothing is saved). Delete the rate in use and the next older one applies, for everyone.'}
    >
      {!inUse ? (
        <div class="row"><div class="row-main"><div class="row-label">No selling price set</div><div class="row-sub">Add one with Edit, or pick a rate below to view the page at it.</div></div></div>
      ) : null}
      {hist.length > 1 || !inUse ? (
        <label class="row field stacked">
          <span class="row-label">View at</span>
          <span class="field-input select">
            <select disabled={tempOn || busy} value={value} onChange={(e) => setPick(!e.currentTarget.value || e.currentTarget.value === (inUse && inUse.id) ? null : e.currentTarget.value)} aria-label="Sale rate to view at">
              {inUse ? null : <option value="">No selling price set (current)</option>}
              {hist.map((h) => <option value={h.id}>{`${when(h)} · ${fmt.rs(h.rate)}/${per}${h.inUse ? ' (current)' : ''}`}</option>)}
            </select>
            <Icon.chevron size={12} />
          </span>
        </label>
      ) : null}
      {hist.map((h) => (
        <div class="row">
          <div class="row-main">
            <div class="row-label">{fmt.rs(h.rate)} / {per}</div>
            <div class="row-sub">From {when(h)}{h.inUse ? ' · in use' : ''}{h.virtual ? ' · the fabric’s price, not in the history' : ''}</div>
          </div>
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
    </Section>
  );
}
