import { useMemo, useState } from 'preact/hooks';
import { fmt } from '../calc.js';
import { getIndex, useStore } from '../store.js';
import { go } from '../router.js';
import { Chip, Empty, NavBar } from '../ui.jsx';
import { HelpButton } from './guide.jsx';
import { computeRows } from './fabrics.jsx';

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
  return (
    <div>
      <NavBar large title="Ranking" right={<HelpButton screen="ranking" />} />
      <div class="chips">
        <Chip on={unitId === 'all'} onClick={() => setUnitId('all')}>Realisation · all</Chip>
        {units.map((u) => <Chip on={unitId === u.id} onClick={() => setUnitId(u.id)}>Profit · {u.name}</Chip>)}
      </div>
      <div class="list-meta">
        <span>{rows.length} fabrics</span>
        <span>{unit ? `Profit / pick at ${unit.name}` : 'Realisation / pick with VATAV'}</span>
      </div>
      {rows.length ? (
        <div class="group">
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
