import { useState } from 'preact/hooks';
import { fmt } from '../calc.js';
import { activeTempRates, clearAllTempRates, clearTempRate, saveTempRateToMaster, setTempRate, toast, useStore } from '../store.js';
import { Button, Icon, Row, Section, Sheet, TextButton } from '../ui.jsx';

// Strip across the top of every screen while any temporary yarn rate is on, with the panel to reset them.
export function TempRatesStrip() {
  const st = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = Object.keys(st.tempRates).length ? activeTempRates() : [];
  if (!list.length) return null;

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

  return (
    <>
      <button type="button" class="temp-strip" onClick={() => setOpen(true)}>
        <span>{list.length === 1 ? '1 temporary yarn rate active' : `${list.length} temporary yarn rates active`}</span>
        <span class="temp-strip-go">View<Icon.chevron size={11} /></span>
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Temporary yarn rates"
        footer={<Button kind="secondary" onClick={() => { clearAllTempRates(); setOpen(false); }}>Reset all</Button>}
      >
        <Section footer="Set on this device only, to try a different price. The yarn master and the Sheet are not changed, so these figures differ from everyone else's.">
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
