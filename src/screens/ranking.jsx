import { useMemo, useState } from 'preact/hooks';
import { fmt } from '../calc.js';
import { getIndex, useStore } from '../store.js';
import { go } from '../router.js';
import { Chip, Empty, NavBar } from '../ui.jsx';
import { HelpButton } from './guide.jsx';
import { computeRows } from './fabrics.jsx';

// "top", or how far below the leader a fabric is: "−₹0.009 vs top"
export function gapText(v, top, i) {
  if (v === null || v === undefined || top === null || top === undefined) return '';
  if (i === 0) return 'top';
  const d = top - v;
  return Math.abs(d) < 0.0005 ? 'same as top' : `−${fmt.pick(d)} vs top`;
}

export function Ranking() {
  const st = useStore();
  const idx = getIndex();
  const [unitId, setUnitId] = useState('all');
  const units = (st.tables.Units || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const unit = unitId !== 'all' ? idx.unitsById[unitId] : null;
  const rows = useMemo(() => {
    const r = computeRows(idx, { unitId });
    const val = (x) => (unit ? x.profit && x.profit.profitPerPick : x.calc.realisationNetPerPick);
    return r.map((x) => ({ ...x, v: val(x) })).sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));
  }, [idx, unitId]);
  const max = Math.max(0, ...rows.map((r) => r.v ?? 0));
  const top = rows.length ? rows[0].v : null;
  return (
    <div>
      <NavBar large title="Ranking" right={<HelpButton screen="ranking" />} />
      <div class="chips">
        <Chip on={unitId === 'all'} onClick={() => setUnitId('all')}>Realisation · all</Chip>
        {units.map((u) => <Chip on={unitId === u.id} onClick={() => setUnitId(u.id)}>Profit · {u.name}</Chip>)}
      </div>
      <div class="list-meta rank-meta">
        <span>{rows.length} fabrics</span>
        <span>{unit ? `Profit / pick at ${unit.name}` : 'Realisation / pick with VATAV'}</span>
      </div>
      {rows.length ? (
        <div class="group rank-list">
          {rows.map((r, i) => (
            <button type="button" class="frow" onClick={() => go(`/fabric/${r.fabric.id}`)}>
              <span class="rank">{i + 1}</span>
              <div class="row-main">
                <div class="fname">{r.fabric.name}</div>
                <div class="fcon">{[r.calc.tfoClass, r.calc.finish, r.fabric.weave].filter(Boolean).join(' · ')}</div>
                <div class="bar-track"><div class="bar-fill" style={{ width: `${max > 0 && r.v > 0 ? Math.round((r.v / max) * 100) : 0}%` }} /></div>
              </div>
              <div class="fval">
                <div class={`big ${unit && r.v !== null ? (r.v >= 0 ? 'good' : 'bad') : ''}`}>{unit ? fmt.signedPick(r.v) : fmt.pick(r.v)}</div>
                <div class="small">{unit ? `${fmt.rs(r.profit.profitPerM)}/m` : `${fmt.rs(r.calc.realisationNetPerM)}/m`}</div>
                {/* the bars start at zero and the figures are close, so say the gap to the leader (C6) */}
                <div class="gap">{gapText(r.v, top, i)}</div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <Empty title="Nothing to rank yet" text={unit ? 'No fabrics are assigned to this unit.' : 'Add fabrics with a selling price.'} />
      )}
    </div>
  );
}
