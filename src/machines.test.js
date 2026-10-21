import { describe, it, expect } from 'vitest';
import { sampleTables } from './sampleData.js';
import { buildIndex } from './calc.js';
import { beamRowsOf, beamSlots, typeCapacity } from './machines.js';

const idxOf = (t = sampleTables()) => buildIndex(t);

describe('typeCapacity', () => {
  it('has 2 sides a machine and 252 spindles a side unless set', () => {
    expect(typeCapacity({ machines: 12 })).toMatchObject({ sides: 24, spindles: 6048, perSide: 252 });
    expect(typeCapacity({ machines: 4, spindles_per_side: 240 })).toMatchObject({ sides: 8, spindles: 1920 });
    expect(typeCapacity({}).sides).toBeNull();
  });
});

describe('beam length', () => {
  it('lists every loom group of the assigned units, blank when not set', () => {
    const idx = idxOf();
    const rows = beamRowsOf('f_geo', idx);
    expect(rows.map((r) => [r.group.id, r.length])).toEqual([['lg1', 4000], ['lg2', null]]);
    expect(beamRowsOf('f_moss', idx).find((r) => r.group.id === 'lg2').length).toBe(6000);
  });

  it('a dobby fabric sees dobby looms only; other fabrics share one length across plain and dobby of a width', () => {
    const t = sampleTables();
    t.LoomGroups.push({ id: 'lg3', unit_id: 'u_2', make: 'Toyota', reed_width_cm: 190, shedding: 'Plain', looms: 8 });
    const idx = idxOf(t);
    const dobby = beamSlots('Dobby', ['u_2'], idx);
    expect(dobby.map((x) => x.groupIds)).toEqual([['lg1']]);
    const plain = beamSlots('Plain', ['u_2'], idx);
    expect(plain.map((x) => x.groupIds.sort())).toEqual([['lg1', 'lg3'], ['lg2']]);
  });
});
