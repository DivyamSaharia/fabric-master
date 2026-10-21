// Loom-group beam slots and TFO machine counts, used by the fabric and unit screens.
// (The old TFO planner that lived here was removed in 1.8.0; planning is now the separate TFO Planner app.)
//
// Every TFO machine has 2 sides; spindles per side default to 252.
import { num } from './calc.js';

export const SIDES_PER_MACHINE = 2;
export const DEFAULT_SPINDLES_PER_SIDE = 252;

export const spindlesPerSide = (type) => num(type && type.spindles_per_side) ?? DEFAULT_SPINDLES_PER_SIDE;

// Sides and spindles a TFO type has in total. Null when the machine count isn't set.
export function typeCapacity(type) {
  const machines = num(type && type.machines);
  if (machines === null) return { machines: null, sides: null, spindles: null, perSide: spindlesPerSide(type) };
  const sides = machines * SIDES_PER_MACHINE;
  return { machines, sides, spindles: sides * spindlesPerSide(type), perSide: spindlesPerSide(type) };
}

// Beam length slots for a fabric: one per unit, make and reed width (machine length).
// A dobby fabric only runs on dobby looms; any other fabric runs on every loom of that
// width, so a plain and a dobby group of the same width share one slot (one length entered).
export function beamSlots(weave, unitIds, idx) {
  const dobbyOnly = String(weave || '').toLowerCase() === 'dobby';
  const slots = [];
  for (const uid of unitIds) {
    const unit = idx.unitsById[uid];
    if (!unit) continue;
    for (const group of idx.loomGroupsByUnit[uid] || []) {
      if (dobbyOnly && String(group.shedding || '').toLowerCase() !== 'dobby') continue;
      const key = `${uid}|${String(group.make || '').trim().toLowerCase()}|${num(group.reed_width_cm) ?? ''}`;
      let slot = slots.find((x) => x.key === key);
      if (!slot) slots.push((slot = { key, unit, group, groupIds: [] }));
      slot.groupIds.push(group.id);
    }
  }
  return slots.sort((x, y) => String(x.unit.name).localeCompare(String(y.unit.name)));
}

export const slotLabel = (slot) => [slot.group.make, num(slot.group.reed_width_cm) ? `${num(slot.group.reed_width_cm)} cm` : null].filter(Boolean).join(' · ') || 'Loom group';

// Beam length (m) of a saved fabric per slot; length is null when not set.
export function beamRowsOf(fabricId, idx) {
  const fabric = idx.fabricsById[fabricId];
  const beams = idx.beamsByFabric[fabricId] || [];
  const unitIds = (idx.assignmentsByFabric[fabricId] || []).map((a) => a.unit_id);
  return beamSlots(fabric && fabric.weave, unitIds, idx).map((slot) => {
    const b = beams.find((x) => slot.groupIds.includes(x.loom_group_id) && num(x.beam_length_m) !== null);
    return { ...slot, length: b ? num(b.beam_length_m) : null };
  });
}

export const groupLabel = (g) => (g ? [g.make, num(g.reed_width_cm) ? `${num(g.reed_width_cm)} cm` : null, g.shedding].filter(Boolean).join(' · ') || 'Loom group' : 'Loom group deleted');
