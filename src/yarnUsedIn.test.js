import { describe, it, expect } from 'vitest';
import { buildIndex } from './calc.js';
import { yarnFabricUses } from './screens/yarns.jsx';

const tables = {
  Yarns: [
    { id: 'b1', name: 'Viscose 120', kind: 'base' },
    { id: 't1', name: 'Viscose 1650 TPM', kind: 'tpm', base_yarn_id: 'b1' },
    { id: 't2', name: 'Viscose 2200 TPM', kind: 'tpm', base_yarn_id: 'b1' },
    { id: 'b2', name: 'Nylon 40', kind: 'base' },
  ],
  Fabrics: [
    { id: 'f1', name: 'Gajji Silk', reed_space_in: 64, finish: 'Greige' },
    { id: 'f2', name: 'Gajji Silk', reed_space_in: 41, finish: 'RFD' },
    { id: 'f3', name: 'Tissue', reed_space_in: 64 },
  ],
  FabricYarns: [
    { id: 'l1', fabric_id: 'f1', side: 'warp', yarn_id: 'b1' },
    { id: 'l2', fabric_id: 'f1', side: 'weft', yarn_id: 'b1' },
    { id: 'l3', fabric_id: 'f2', side: 'weft', yarn_id: 't1' },
    { id: 'l4', fabric_id: 'f3', side: 'warp', yarn_id: 'b2' },
    { id: 'l5', fabric_id: 'gone', side: 'warp', yarn_id: 'b1' },
  ],
};

describe('yarn page: used in fabrics', () => {
  const idx = buildIndex(tables);
  it('lists direct fabrics with sides, then fabrics through each TPM yarn', () => {
    const { uses, children } = yarnFabricUses('b1', idx);
    expect(uses.map((u) => [u.fabric.name, [...u.sides].sort().join('+'), u.via && u.via.name])).toEqual([
      ['Gajji Silk 64', 'warp+weft', null],
      ['Gajji Silk 41 (RFD)', 'weft', 'Viscose 1650 TPM'],
    ]);
    expect(children.map((c) => c.id)).toEqual(['t1', 't2']);
  });
  it('a TPM yarn lists only its own fabrics; missing fabrics are skipped', () => {
    expect(yarnFabricUses('t1', idx).uses.map((u) => u.fabric.id)).toEqual(['f2']);
    expect(yarnFabricUses('t2', idx).uses).toEqual([]);
    expect(yarnFabricUses('b2', idx).uses.map((u) => u.fabric.id)).toEqual(['f3']);
  });
});
