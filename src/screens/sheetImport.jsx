// Planning sheet photo → working plan. Opened from the TFO planner. Reads the photo on the phone (no upload),
// shows every row with what it matched, asks only where unsure, lets you pick the RPM per row
// (sheet speed, target speed, master or typed) and puts the looms into the working plan.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { fabricLabel, fmt, num } from '../calc.js';
import { groupLabel, masterLoomRpm } from '../planner.js';
import { countChecks } from '../sheetImport/parse.js';
import { aliasText, applyImport, checkRpm, codeFree, defaultSource, matchRow, membersWithoutCode, noteWithCode, placeLooms, widthGroups } from '../sheetImport/match.js';
import { fitsGroup } from '../planner.js';
import { loadSheetNames, saveImportMemory, toast } from '../store.js';
import { Badge, Button, SearchPicker, Sheet } from '../ui.jsx';

const SKIP = '__skip';

// The cell as it appears in the photo, so you can see what was read.
function Crop({ pixels, rect, h = 28 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !pixels || !pixels.canvas || !rect) return;
    const w = rect.x1 - rect.x0, hh = rect.y1 - rect.y0;
    const c = ref.current;
    c.width = w;
    c.height = hh;
    c.getContext('2d').drawImage(pixels.canvas, rect.x0, rect.y0, w, hh, 0, 0, w, hh);
  }, [pixels, rect]);
  if (!rect) return null;
  return <canvas ref={ref} class="crop" style={{ height: `${h}px` }} aria-hidden="true" />;
}

const HOW = {
  alias: ['Remembered', 'teal'],
  code: ['Code match', 'teal'],
  name: ['Name match', ''],
  ask: ['Choose', 'amber'],
  none: ['Not in master', 'amber'],
};

export function SheetImport({ open, onClose, idx, unitId, list, plan, onApply }) {
  const [stage, setStage] = useState('pick'); // pick | reading | review
  const [progress, setProgress] = useState({ step: '', f: 0 });
  const [result, setResult] = useState(null); // { parsed, pixels }
  const [error, setError] = useState('');
  const [picks, setPicks] = useState({}); // key → quality id | SKIP
  const [looms, setLooms] = useState({}); // key → text
  const [rpm, setRpm] = useState({}); // key → { source, manual }
  const [codes, setCodes] = useState({}); // key → false when unticked
  const [showZero, setShowZero] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const groups = (idx.loomGroupsByUnit[unitId] || []).slice();
  const [aliases, setAliases] = useState([]); // names you confirmed before (kept in their own spreadsheet)

  useEffect(() => {
    if (open) loadSheetNames(unitId).then(setAliases).catch(() => {});
  }, [open, unitId]);

  useEffect(() => {
    if (!open) {
      setStage('pick');
      setResult(null);
      setError('');
      setPicks({});
      setLooms({});
      setRpm({});
      setCodes({});
      setShowZero(false);
      import('../sheetImport/engine.js').then((m) => m.stopEngine()).catch(() => {});
    }
  }, [open]);

  async function onFile(file) {
    if (!file) return;
    setError('');
    setStage('reading');
    setProgress({ step: 'engine', f: 0 });
    try {
      const { readSheetPhoto } = await import('../sheetImport/engine.js');
      const res = await readSheetPhoto(file, (step, f) => setProgress({ step, f }));
      if (res.parsed.problems.length && !res.parsed.sections.length) {
        setError(res.parsed.problems.join(' '));
        setStage('pick');
        return;
      }
      setResult(res);
      setStage('review');
    } catch (e) {
      setError(e.message || 'Could not read the photo.');
      setStage('pick');
    }
  }

  // ---------- the rows, matched ----------
  const rows = useMemo(() => {
    if (!result) return [];
    const out = [];
    for (const s of result.parsed.sections) {
      s.rows.forEach((r, i) => {
        const key = `${s.width}:${i}`;
        if (r.kind === 'stopped') {
          out.push({ key, width: s.width, r, stopped: true });
          return;
        }
        const m = matchRow(r.name, s.width, list, groups, aliases);
        out.push({ key, width: s.width, r, m });
      });
    }
    return out;
  }, [result, aliases]);

  const loomsOf = (row) => {
    const t = looms[row.key];
    if (t === undefined) return row.r.planning ?? 0;
    const v = num(t);
    return v === null ? null : v;
  };
  const qOf = (row) => {
    const p = picks[row.key];
    if (p === SKIP) return null;
    const id = p ?? (row.m && row.m.pick ? row.m.pick.id : null);
    return id ? list.find((q) => q.id === id) || null : null;
  };
  const skipped = (row) => picks[row.key] === SKIP;

  const active = rows.filter((row) => !row.stopped && (loomsOf(row) ?? 1) > 0);
  const zero = rows.filter((row) => !row.stopped && loomsOf(row) === 0);
  const stopped = rows.filter((row) => row.stopped);

  // looms per loom group (needs every active row matched)
  const placed = useMemo(() => {
    const ready = active.filter((row) => qOf(row) && (loomsOf(row) ?? 0) > 0).map((row) => ({ key: row.key, q: qOf(row), looms: loomsOf(row), width: row.width }));
    return placeLooms(ready, groups);
  }, [active.map((r) => `${r.key}=${picks[r.key] ?? ''}:${looms[r.key] ?? ''}`).join('|'), result]);
  const placesOf = (row) => placed.filter((p) => p.key === row.key);

  // RPM per row
  const rpmOf = (row) => {
    const q = qOf(row);
    const first = placesOf(row)[0];
    const g = first ? groups.find((x) => x.id === first.groupId) : widthGroups(groups, row.width).find((x) => q && fitsGroup(q, x));
    const master = q && g ? masterLoomRpm(q, g) : null;
    const image = row.r.current ?? null;
    const target = row.r.target ?? null;
    const st = rpm[row.key] || {};
    const source = st.source || defaultSource({ image, master });
    const raw = source === 'image' ? image : source === 'target' ? target : source === 'master' ? master : st.manual ?? '';
    const check = checkRpm(raw === null ? '' : raw, { width: row.width, master, image });
    const lowConf = source === 'image' && row.r.currentConf !== null && row.r.currentConf < 70;
    return { master, image, target, source, raw, check, lowConf };
  };

  // merges: two sheet rows ending on the same quality and group
  const sameAs = (row) => {
    const q = qOf(row);
    if (!q) return [];
    return active.filter((o) => o.key !== row.key && o.width === row.width && qOf(o) && qOf(o).id === q.id);
  };

  const checks = result ? countChecks({ ...result.parsed, sections: result.parsed.sections.map((s) => ({ ...s, rows: s.rows.map((r, i) => ({ ...r, planning: r.kind === 'stopped' ? r.planning : loomsOf({ key: `${s.width}:${i}`, r }) ?? 0 })) })) }, fleetBy(groups)) : null;

  const needQuality = active.filter((row) => !qOf(row) && !skipped(row));
  const needLooms = active.filter((row) => loomsOf(row) === null || !Number.isInteger(loomsOf(row)) || loomsOf(row) < 0);
  const needRpm = active.filter((row) => qOf(row) && rpmOf(row).check.error);
  const blocking = needQuality.length + needLooms.length + needRpm.length;
  const nWarn = active.filter((row) => qOf(row) && (rpmOf(row).check.warnings.length || rpmOf(row).lowConf)).length;
  const imported = active.filter((row) => qOf(row));
  const stoppedBy = Object.fromEntries((checks ? checks.sizes : []).map((s) => [s.width, stopped.filter((r) => r.width === s.width).reduce((a, r) => a + (r.r.planning ?? 0), 0)]));

  async function apply() {
    setBusy(true);
    try {
      const entries = [];
      for (const row of imported) {
        const q = qOf(row);
        const value = rpmOf(row).check.value;
        for (const p of placesOf(row)) entries.push({ fabricId: q.id, groupId: p.groupId, looms: p.looms, rpm: value });
      }
      const next = applyImport(plan, entries, list, groups);
      // remember answers and add missing codes (best effort: the plan goes in either way)
      const memAliases = imported.filter((row) => !(row.m.how === 'alias' && picks[row.key] === undefined)).map((row) => ({ width: row.width, text: aliasText(row.r.name), fabricId: qOf(row).id, fabricName: qOf(row).fabric ? fabricLabel(qOf(row).fabric) : '' }));
      const memCodes = [];
      for (const row of imported) {
        const q = qOf(row);
        const code = row.m.sheet.code;
        if (codes[row.key] === false || !code || !codeFree(code, list, q)) continue;
        for (const f of membersWithoutCode(q)) if (!memCodes.some((c) => c.fabricId === f.id)) memCodes.push({ fabricId: f.id, design_note: noteWithCode(row.r.name, code) });
      }
      onApply(next, { looms: imported.reduce((a, r) => a + (loomsOf(r) || 0), 0), qualities: imported.length, stopped: Object.values(stoppedBy).reduce((a, b) => a + b, 0) });
      onClose();
      try {
        await saveImportMemory({ unitId, aliases: memAliases, codes: memCodes });
      } catch (e) {
        toast(`Plan imported. ${e.message}`, 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  const title = stage === 'review' ? 'Check the import' : 'Import from sheet photo';
  const footer = stage === 'review' ? (
    <div class="imp-foot">
      <div class={`imp-count ${blocking ? "warn" : ""}`}>
        {blocking
          ? [needQuality.length ? `${needQuality.length} need a quality` : '', needLooms.length ? `${needLooms.length} need looms` : '', needRpm.length ? `${needRpm.length} need an RPM` : ''].filter(Boolean).join(' · ')
          : `${imported.length} qualities ready${nWarn ? ` · ${nWarn} to glance at` : ''}`}
      </div>
      <Button busy={busy} disabled={!!blocking || !imported.length} onClick={apply}>Put in working plan</Button>
    </div>
  ) : null;

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {stage === 'pick' ? (
        <section class="section">
          <div class="imp-pick">
            <p>Upload a screenshot or photo of the daily planning sheet. It is read on this phone; nothing is uploaded.</p>
            <input ref={fileRef} type="file" accept="image/*" class="visually-hidden" aria-label="Planning sheet photo" onChange={(e) => onFile(e.currentTarget.files && e.currentTarget.files[0])} />
            <Button onClick={() => fileRef.current && fileRef.current.click()}>Choose photo</Button>
            {error ? <div class="notice" style={{ margin: '12px 0 0' }}>{error}</div> : null}
          </div>
          <p class="section-footer">Reads the PLANNING column of SIZE 190 and SIZE 280, the current and target speeds, and NO PROGRAM (stopped looms). The first import loads the reader (about 7 MB) once; later ones work offline.</p>
        </section>
      ) : null}

      {stage === 'reading' ? (
        <section class="section">
          <div class="imp-pick">
            <p>{progress.step === 'engine' ? 'Starting the reader…' : 'Reading the sheet…'}</p>
            <div class="imp-bar"><div style={{ width: `${Math.round((progress.step === 'engine' ? progress.f * 0.2 : 0.2 + progress.f * 0.8) * 100)}%` }} /></div>
          </div>
        </section>
      ) : null}

      {stage === 'review' && result ? (
        <>
          <CountBanner checks={checks} problems={result.parsed.problems} />
          {plan.looms.length ? <p class="imp-note">This replaces the {plan.looms.length} {plan.looms.length === 1 ? 'quality' : 'qualities'} in the working plan. TFO sides, receipts and TFO settings stay.</p> : null}
          {result.parsed.sections.map((s) => (
            <section class="section">
              <h2 class="section-header">Size {s.width} · {fmt.int(active.filter((r) => r.width === s.width).reduce((a, r) => a + (loomsOf(r) || 0), 0))} looms planned · {fmt.int(stoppedBy[s.width] || 0)} stopped</h2>
              <div class="group">
                {active.filter((row) => row.width === s.width).map((row) => (
                  <ImportRow
                    row={row}
                    pixels={result.pixels}
                    list={list}
                    groups={groups}
                    q={qOf(row)}
                    skipped={skipped(row)}
                    loomsText={looms[row.key] ?? String(row.r.planning ?? '')}
                    loomsBad={needLooms.includes(row)}
                    places={placesOf(row)}
                    r={qOf(row) ? rpmOf(row) : null}
                    rpmState={rpm[row.key] || {}}
                    merged={sameAs(row)}
                    codeOn={codes[row.key] !== false}
                    onPick={(v) => setPicks((p) => ({ ...p, [row.key]: v }))}
                    onLooms={(v) => setLooms((p) => ({ ...p, [row.key]: v }))}
                    onRpm={(patch) => setRpm((p) => ({ ...p, [row.key]: { ...(p[row.key] || {}), ...patch } }))}
                    onCode={(v) => setCodes((p) => ({ ...p, [row.key]: v }))}
                  />
                ))}
                {stopped.filter((row) => row.width === s.width).map((row) => (
                  <div class="imp-row stopped">
                    <div class="imp-top"><div class="imp-name">No program</div><Badge>{fmt.int(row.r.planning ?? 0)} looms stopped</Badge></div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {zero.length ? (
            <section class="section">
              <button type="button" class="link-btn" onClick={() => setShowZero(!showZero)}>{showZero ? 'Hide' : 'Show'} {zero.length} {zero.length === 1 ? 'quality' : 'qualities'} with no looms planned</button>
              {showZero ? (
                <div class="group" style={{ marginTop: '8px' }}>
                  {zero.map((row) => (
                    <div class="imp-row muted">
                      <div class="imp-top"><div class="imp-name">{row.r.name}</div><span class="pline-meta">{row.width} · 0</span></div>
                      <div class="imp-crop"><Crop pixels={result.pixels} rect={row.r.rect.planning} h={22} /><button type="button" class="link-btn" onClick={() => setLooms((p) => ({ ...p, [row.key]: '' }))}>Not 0? Enter looms</button></div>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}
          <p class="section-footer">Confirmed names are remembered for the next photo. Codes from the sheet are added to fabrics that have none in their design note.</p>
          {footer}
        </>
      ) : null}
    </Sheet>
  );
}

function fleetBy(groups) {
  const out = {};
  for (const g of groups) {
    const w = num(g.reed_width_cm);
    if (w === null) continue;
    const k = Math.abs(w - 190) <= 15 ? 190 : Math.abs(w - 280) <= 15 ? 280 : w;
    out[k] = (out[k] || 0) + (num(g.looms) || 0);
  }
  return out;
}

function CountBanner({ checks, problems }) {
  if (!checks) return null;
  const bad = checks.sizes.filter((s) => !s.okTotal);
  const fleetBad = checks.sizes.filter((s) => s.okTotal && !s.okFleet);
  return (
    <>
      {bad.length ? (
        <div class="notice">{bad.map((s) => `Size ${s.width}: rows add up to ${s.sum} looms but the TOTAL row says ${s.total}. Check the looms below.`).join(' ')}</div>
      ) : (
        <div class="banner">{checks.sizes.map((s) => `${s.width}: ${s.sum} looms`).join(' · ')}{checks.grandTotal !== null ? ` · total ${checks.grandTotal}` : ''} — matches the sheet</div>
      )}
      {fleetBad.length ? <div class="notice">{fleetBad.map((s) => `Size ${s.width} has ${s.sum} looms on the sheet; the unit's loom groups have ${s.fleet}.`).join(' ')}</div> : null}
      {problems.length ? <div class="notice">{problems.join(' ')}</div> : null}
    </>
  );
}

function ImportRow({ row, pixels, list, groups, q, skipped, loomsText, loomsBad, places, r, rpmState, merged, codeOn, onPick, onLooms, onRpm, onCode }) {
  const m = row.m;
  const [label, tone] = picksBadge(m, q, skipped);
  const wg = widthGroups(groups, row.width);
  const fit = list.filter((x) => wg.some((g) => fitsGroup(x, g)));
  const sugg = m.options.filter((x) => fit.includes(x));
  const opt = (x) => ({ value: x.id, label: `${x.label} · ${x.fabric.weave || 'Plain'}` });
  const options = [
    ...(sugg.length ? [{ group: 'Closest', options: sugg.map(opt) }] : []),
    { group: 'All qualities that fit', options: fit.filter((x) => !sugg.includes(x)).map(opt) },
    { group: 'Or', options: [{ value: SKIP, label: 'Skip this row (not in the plan)' }] },
  ];
  const lowLooms = row.r.planningConf !== null && row.r.planningConf < 70;
  const code = m.sheet.code;
  const canCode = q && code && membersWithoutCode(q).length && codeFree(code, list, q);
  const srcOpts = r ? [
    ...(r.image !== null ? [{ value: 'image', k: 'Sheet', v: r.image }] : []),
    ...(r.target !== null ? [{ value: 'target', k: 'Target', v: r.target }] : []),
    ...(r.master !== null ? [{ value: 'master', k: 'Master', v: r.master }] : []),
    { value: 'manual', k: 'Type', v: r.source === 'manual' && r.check.value ? r.check.value : '…' },
  ] : [];
  const showNameCrop = m.how === 'ask' || m.how === 'none' || (row.r.nameConf ?? 100) < 80;
  return (
    <div class={`imp-row ${skipped ? 'muted' : ''}`}>
      <div class="imp-top">
        <div style={{ minWidth: 0 }}>
          <div class="imp-name">{row.r.name || '(name not read)'}</div>
          {showNameCrop ? <Crop pixels={pixels} rect={row.r.rect.name} h={22} /> : null}
        </div>
        <Badge kind={tone || undefined}>{label}</Badge>
      </div>

      <div class="imp-line">
        <span class="imp-k">Quality</span>
        <div class="imp-v"><SearchPicker value={skipped ? SKIP : q ? q.id : ''} label={`Quality for ${row.r.name}`} title={`${row.r.name} · ${row.width}`} placeholder={m.how === 'none' ? 'Not found: pick or skip' : 'Choose the quality'} searchHint="Search qualities" options={options} onChange={onPick} /></div>
      </div>

      {!skipped ? (
        <>
          <div class="imp-line">
            <span class="imp-k">Looms</span>
            <div class="imp-v imp-looms">
              <input class={`pbox imp-num ${loomsBad ? 'need' : ''}`} type="text" inputmode="numeric" aria-label={`Looms ${row.r.name}`} value={loomsText} onInput={(e) => onLooms(e.currentTarget.value)} />
              {loomsBad ? <span class="imp-err">Whole number of looms</span> : null}
              {lowLooms ? <span class="imp-warn">Check: <Crop pixels={pixels} rect={row.r.rect.planning} h={22} /></span> : null}
              {places.length ? <span class="pline-meta">{places.map((p) => `${p.looms} on ${groupLabel(groups.find((g) => g.id === p.groupId))}${p.overflow ? ' (plain group full)' : ''}`).join(' · ')}</span> : null}
            </div>
          </div>

          {q && r ? (
            <div class="imp-line">
              <span class="imp-k">RPM</span>
              <div class="imp-v">
                <div class="rpm-opts" role="group" aria-label={`RPM source ${row.r.name}`}>
                  {srcOpts.map((o) => (
                    <button type="button" class={r.source === o.value ? 'on' : ''} aria-pressed={r.source === o.value ? 'true' : 'false'} aria-label={o.k} onClick={() => onRpm({ source: o.value })}>
                      <span class="rpm-k">{o.k}</span>
                      <span class="rpm-v">{o.v}</span>
                    </button>
                  ))}
                </div>
                {r.source === 'manual' ? (
                  <input class={`pbox imp-num ${r.check.error ? 'need' : ''}`} type="text" inputmode="numeric" placeholder="RPM" aria-label={`RPM ${row.r.name}`} value={rpmState.manual ?? ''} onInput={(e) => onRpm({ manual: e.currentTarget.value })} style={{ marginTop: '8px' }} autofocus />
                ) : null}
                {r.check.error ? <div class="imp-err">{r.check.error}</div> : null}
                {r.check.warnings.map((w) => <div class="imp-warn">{w}</div>)}
                {r.lowConf ? <div class="imp-warn">Sheet speed read with low confidence: <Crop pixels={pixels} rect={row.r.rect.current} h={22} /></div> : null}
              </div>
            </div>
          ) : null}

          {merged.length ? <div class="imp-info">Same quality as {merged.map((o) => o.r.name).join(', ')}: looms are added together on one plan row, RPM weighted by looms.</div> : null}
          {canCode ? (
            <label class="imp-info imp-check">
              <input type="checkbox" checked={codeOn} onChange={(e) => onCode(e.currentTarget.checked)} />
              <span>Add code {code} to {q.label} (design note “{noteWithCode(row.r.name, code)}”)</span>
            </label>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function picksBadge(m, q, skipped) {
  if (skipped) return ['Skipped', ''];
  if (q && m.pick && q.id === m.pick.id) return HOW[m.how];
  if (q) return ['Your pick', 'teal'];
  return HOW[m.how] || HOW.ask;
}
