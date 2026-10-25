// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildIndex } from '../calc.js';
import { qualities } from '../planner.js';
import { applyImport, checkRpm, defaultSource, matchRow, nameWords, noteWithCode, placeLooms, similarity } from './match.js';
import { countChecks, readInt, splitName, columnRoles, isNoProgram } from './parse.js';

// Fabrics as in the live Sheet on 25 Oct 2026 (the fields matching uses), Weavelon 2 loom groups.
const F = (id, name, weave, note, rs, finish = 'Greige', extra = {}) => ({ id, name, weave, design_note: note, reed_space_in: rs, finish, ppi: 80, ...extra });
function idx() {
  return buildIndex({
    Units: [{ id: 'u2', name: 'Weavelon 2', has_tfo: true, loom_eff_pct: 93 }],
    LoomGroups: [
      { id: 'g190p', unit_id: 'u2', make: 'Toyota', reed_width_cm: 190, shedding: 'Plain', looms: 16 },
      { id: 'g280d', unit_id: 'u2', make: 'Toyota', reed_width_cm: 280, shedding: 'Dobby', looms: 14 },
      { id: 'g190d', unit_id: 'u2', make: 'Toyota', reed_width_cm: 190, shedding: 'Dobby', looms: 24 },
      { id: 'g280p', unit_id: 'u2', make: 'Toyota', reed_width_cm: 280, shedding: 'Plain', looms: 18 },
    ],
    Fabrics: [
      F('ot49', 'Organza Twill', 'Dobby', '', 49, 'Greige', { loom_rpm: 1004, loom_rpm_dp: 700 }),
      F('rt54', 'Rangila Twill', 'Dobby', 'Rangila Twill (5404)', 54, 'Greige', { loom_rpm: 1000, loom_rpm_dp: 650 }),
      F('nc53', 'Natural Crape', 'Plain', 'Natural Crape Small (3601)', 52.5, 'Greige', { loom_rpm: 1026, loom_rpm_dp: 672 }),
      F('nc67', 'Natural Crape', 'Plain', 'Natural Crape-L-67 (3802)', 67, 'Greige', { loom_rpm: 1041 }),
      F('gs64', 'Gajji Silk', 'Dobby', 'Gajji Silk (6101)', 64, 'Greige', { loom_rpm: 998, loom_rpm_dp: 700 }),
      F('gs73', 'Gajji Silk', 'Dobby', 'Gajji Silk-73 (8902)', 73),
      F('gs41', 'Gajji Silk', 'Dobby', 'Gajji Silk-L-41 (8802)', 41, 'Greige', { loom_rpm_dp: 843 }),
      F('sb70', 'Salsa Butty', 'Dobby', 'Salsa Butty-70 (5923)', 70, 'RFD'),
      F('sb54', 'Salsa Butty', 'Dobby', 'Salsa Butty-54 (5908)', 54, 'RFD', { loom_rpm_dp: 604 }),
      F('sa54', 'Salsa', 'Plain', 'Salsa Anmol-54 (5902)', 54, 'Greige', { loom_rpm: 998, loom_rpm_dp: 679 }),
      F('ti64', 'Tissue', 'Plain', 'Tissue Big (6801)', 64),
      F('tg50', 'Tissue Gold', 'Plain', 'Tissue (6402)', 50),
      F('nc74', 'Natural Crape', 'Plain', 'Natural Crape-L-67 (3802)', 74, 'Greige', { loom_rpm: 1041 }),
      F('ot50', 'Organza Twill', 'Dobby', '', 50, 'Greige', { loom_rpm: 1004, loom_rpm_dp: 700 }),
      F('gs64r', 'Gajji Silk', 'Dobby', 'Gajji Silk (6101)', 64, 'RFD'),
      F('nc53r', 'Natural Crape', 'Plain', 'Natural Crape Small (3601)', 52.5, 'RFD'),
      F('bs48', 'Bright Satin', 'Dobby', '', 48, 'Greige', { loom_rpm_dp: 650 }),
      F('gl50', 'Glass', 'Plain', 'Glass small (1201)', 50, 'RFD'),
      F('sm49', 'Sindoor Muslin', 'Plain', '', 49),
    ],
  });
}

// Exactly what the OCR read from the 22 Oct 2026 sheet (rows with looms planned).
const SHEET = {
  190: [['RANGILA TWILL(5404)', 4], ['PASHMINA TWILL(9701)', 8], ['ORGANZA TWILL(4801)', 8], ['NATURAL CRAPE SMALL', 10], ['NATURAL CRAPE-74', 2]],
  280: [['SALSA ANMOL-54(5902)', 4], ['SALSA BUTTY-54(5908)', 1], ['RANGILA TWILL(5405)', 7], ['PASHMINA TWILL(9701)', 1], ['BRIGHT SATIN-48(0402)', 3]],
};

describe('reading cells', () => {
  it('splits code and RS off a sheet name', () => {
    expect(splitName('SALSA ANMOL-54(5902)')).toMatchObject({ base: 'SALSA ANMOL', rs: 54, code: '5902' });
    expect(splitName('ORGANZA TWILL(A801)')).toMatchObject({ base: 'ORGANZA TWILL', rs: null, code: '4801' });
    expect(splitName('NATURAL CRAPE SMALL')).toMatchObject({ base: 'NATURAL CRAPE SMALL', rs: null, code: null });
    expect(splitName('NATURAL CRAPE-74')).toMatchObject({ base: 'NATURAL CRAPE', rs: 74, code: null });
  });
  it('reads numbers and the NO PROGRAM row', () => {
    expect(readInt('1,000')).toBe(1000);
    expect(readInt('')).toBe(null);
    expect(readInt('1O')).toBe(10);
    expect(isNoProgram('NO PROGRAM')).toBe(true);
    expect(isNoProgram('N0 PR0GRAM')).toBe(true);
    expect(isNoProgram('NATURAL CRAPE')).toBe(false);
  });
  it('finds columns from header words, not PRIPOSE PLANNING', () => {
    const h = ['RUNNING 22/10/2026', 'QUALITY', 'DATE-/\nREED', '0.10.2026\nPLANNING', 'PRIPOSE\nPLANNIN\nG', 'BEAM', 'FABRIC', 'PENDING', 'CURREN\nT SPEED', 'TARGET\nSPEED', 'REMARK'];
    expect(columnRoles(h)).toEqual({ name: 0, planning: 3, current: 8, target: 9 });
  });
  it('checks counts against TOTAL rows and the loom groups', () => {
    const parsed = { sections: [{ width: 190, total: 40, rows: [{ planning: 32 }, { planning: 8 }] }, { width: 280, total: 32, rows: [{ planning: 15 }, { planning: 16 }] }], grandTotal: 72 };
    const c = countChecks(parsed, { 190: 40, 280: 32 });
    expect(c.sizes[0]).toMatchObject({ sum: 40, okTotal: true, okFleet: true });
    expect(c.sizes[1]).toMatchObject({ sum: 31, okTotal: false, okFleet: false });
    expect(c.okGrand).toBe(false);
  });
});

describe('matching the 22 Oct sheet to the master', () => {
  const ix = idx();
  const list = qualities(ix);
  const groups = ix.loomGroupsByUnit.u2;
  const m = (name, w, aliases) => matchRow(name, w, list, groups, aliases);

  it('normalises names', () => {
    expect(nameWords('Gajji Silk-L-41 (8802)')).toBe('GAJJI SILK');
    expect(nameWords('GAJI SILK(6101)')).toBe('GAJJI SILK');
    expect(similarity('NATURAL CRAPE', 'NATURAL CRAPE')).toBe(1);
  });

  it('pre-selects sure matches', () => {
    expect(m('RANGILA TWILL(5404)', 190)).toMatchObject({ how: 'code', pick: { id: 'rt54' } });
    expect(m('NATURAL CRAPE SMALL', 190).pick.id).toBe('nc53');
    expect(m('NATURAL CRAPE-74', 190).pick.id).toBe('nc74');
    expect(m('SALSA ANMOL-54(5902)', 280)).toMatchObject({ how: 'code', pick: { id: 'sa54' } });
    expect(m('SALSA BUTTY-54(5908)', 280).pick.id).toBe('sb54');
    expect(m('RANGILA TWILL(5405)', 280).pick.id).toBe('rt54');
    expect(m('BRIGHT SATIN-48(0402)', 280).pick.id).toBe('bs48');
    expect(m('GAJI SILK(6101)', 190).pick.id).toBe('gs64');
  });

  it('asks when two qualities fit equally (Organza Twill 49 / 50)', () => {
    const r = m('ORGANZA TWILL(4801)', 190);
    expect(r.how).toBe('ask');
    expect(r.options.slice(0, 2).map((q) => q.id).sort()).toEqual(['ot49', 'ot50']);
  });

  it('finds nothing for a quality not in the master (Pashmina Twill)', () => {
    expect(['none', 'ask']).toContain(m('PASHMINA TWILL(9701)', 190).how);
    expect(m('PASHMINA TWILL(9701)', 190).pick).toBe(null);
  });

  it('uses a confirmed alias first, per width', () => {
    const aliases = [{ width_cm: 190, sheet_text: 'ORGANZA TWILL(4801)', fabric_id: 'ot50' }];
    expect(m('ORGANZA TWILL (4801)', 190, aliases)).toMatchObject({ how: 'alias', pick: { id: 'ot50' } });
    expect(m('ORGANZA TWILL(4801)', 280, aliases).how).toBe('ask');
  });

  it('two different sheet names / codes can map to the same fabric', () => {
    // 5909 is not in the master; 5902 is. Both are Salsa 54 once the first is confirmed.
    const aliases = [{ width_cm: 280, sheet_text: 'SALSA ANMOL-54(5909)', fabric_id: 'sa54' }];
    expect(m('SALSA ANMOL-54(5909)', 280, aliases)).toMatchObject({ how: 'alias', pick: { id: 'sa54' } });
    expect(m('SALSA ANMOL-54(5902)', 280, aliases)).toMatchObject({ how: 'code', pick: { id: 'sa54' } });
    // Natural Crape Small without a code and with 3601 both land on Natural Crape 53
    expect(m('NATURAL CRAPE SMALL', 280).pick.id).toBe('nc53');
    expect(m('NATURAL CRAPE SMALL(3601)', 280).pick.id).toBe('nc53');
  });

  it('one code shared by different fabrics never decides on its own', () => {
    // 3802 sits on both Natural Crape 67 and Natural Crape 74 in the master: the RS decides, or it asks
    expect(m('NATURAL CRAPE-67(3802)', 190).pick.id).toBe('nc67');
    expect(m('NATURAL CRAPE-74(3802)', 190).pick.id).toBe('nc74');
    const noRs = m('NATURAL CRAPE(3802)', 190);
    expect(noRs.how).toBe('ask');
    expect(noRs.options.slice(0, 2).map((q) => q.id).sort()).toEqual(['nc67', 'nc74']);
    // aliases are per full sheet text, so confirming one name does not drag the other along
    const aliases = [{ width_cm: 190, sheet_text: 'NATURAL CRAPE-67(3802)', fabric_id: 'nc67' }];
    expect(m('NATURAL CRAPE-74(3802)', 190, aliases).pick.id).toBe('nc74');
    // a code sitting on a different name is not taken: 5404 written against Organza Twill stays Organza
    expect(m('ORGANZA TWILL(5404)', 190).pick?.id).not.toBe('rt54');
  });

  it('places looms: dobby on dobby groups, plain on plain, plain overflow on dobby', () => {
    const rows = [
      { key: 'a', q: list.find((q) => q.id === 'rt54'), looms: 4, width: 190 },
      { key: 'b', q: list.find((q) => q.id === 'nc53'), looms: 10, width: 190 },
      { key: 'c', q: list.find((q) => q.id === 'nc74'), looms: 8, width: 190 },
      { key: 'd', q: list.find((q) => q.id === 'sa54'), looms: 4, width: 280 },
    ];
    const placed = placeLooms(rows, groups);
    const at = (k, g) => placed.filter((p) => p.key === k && p.groupId === g).reduce((s, p) => s + p.looms, 0);
    expect(at('a', 'g190d')).toBe(4);
    expect(at('b', 'g190p') + at('c', 'g190p')).toBe(16); // plain group full
    expect(at('b', 'g190d') + at('c', 'g190d')).toBe(2); // 2 plain looms run on dobby looms
    expect(placed.find((p) => p.overflow)).toBeTruthy();
    expect(at('d', 'g280p')).toBe(4);
  });
});

describe('RPM', () => {
  it('defaults: sheet speed, else master, else typed', () => {
    expect(defaultSource({ image: 650, master: 700 })).toBe('image');
    expect(defaultSource({ image: null, master: 700 })).toBe('master');
    expect(defaultSource({ image: null, master: null })).toBe('manual');
  });
  it('errors block, ranges and a 20% gap only warn', () => {
    expect(checkRpm('', { width: 190 }).error).toBe('Enter an RPM');
    expect(checkRpm('9a0', { width: 190 }).error).toBe('Numbers only');
    expect(checkRpm('900.5', { width: 190 }).error).toBe('Whole number only');
    expect(checkRpm('0', { width: 190 }).error).toBe('Must be more than 0');
    const ok = checkRpm('900', { width: 190, master: 1000 });
    expect(ok).toMatchObject({ value: 900, error: null, warnings: [] });
    expect(checkRpm('790', { width: 190, master: 1000 }).warnings).toEqual(['-21% from master 1000']);
    expect(checkRpm('1400', { width: 190, master: 1300 }).warnings[0]).toMatch(/Unusual for 190 cm/);
  });
});

describe('into the plan', () => {
  const ix = idx();
  const list = qualities(ix);
  const groups = ix.loomGroupsByUnit.u2;
  it('replaces looms and loom settings, keeps TFO inputs, stores only RPMs that differ from master', () => {
    const plan = { unitId: 'u2', looms: [{ fabricId: 'gs64', groupId: 'g190d', looms: '6' }], sides: [{ yarnId: 'y1', typeId: 't1', sides: '4' }], receipts: [{ yarnId: 'y1', kg: '50' }], settings: { 'rpm:gs64:g190d': 950, 'eff:gs64:g190d': 90, 'tfoEff:t1': 75 }, soldAs: { 'gs64:g190d': 'rfd' } };
    const next = applyImport(plan, [
      { fabricId: 'rt54', groupId: 'g280d', looms: 7, rpm: 650 }, // = master → not stored
      { fabricId: 'sa54', groupId: 'g280p', looms: 4, rpm: 700 }, // master 679 → stored
      { fabricId: 'nc53', groupId: 'g190p', looms: 6, rpm: 1000 },
      { fabricId: 'nc53', groupId: 'g190p', looms: 4, rpm: 900 }, // same quality + group: summed, weighted RPM
    ], list, groups);
    expect(next.looms).toEqual([
      { fabricId: 'rt54', groupId: 'g280d', looms: '7' },
      { fabricId: 'sa54', groupId: 'g280p', looms: '4' },
      { fabricId: 'nc53', groupId: 'g190p', looms: '10' },
    ]);
    expect(next.settings).toEqual({ 'tfoEff:t1': 75, 'rpm:sa54:g280p': 700, 'rpm:nc53:g190p': 960 });
    expect(next.sides).toEqual(plan.sides);
    expect(next.receipts).toEqual(plan.receipts);
    expect(next.soldAs).toEqual({});
  });
  it('writes a missing code in the master style', () => {
    expect(noteWithCode('BRIGHT SATIN-48(0402)', '0402')).toBe('Bright Satin-48 (0402)');
    expect(noteWithCode('ORGANZA TWILL(4801)', '4801')).toBe('Organza Twill (4801)');
  });
});

export { SHEET };
