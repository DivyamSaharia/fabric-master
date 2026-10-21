// Sample data for demo mode. Fabric names are stored without the RS (the app adds it).
// Poly Crepe (75D x 75D) matches the worked example in the scope doc;
// the other fabrics, unit names and rates are illustrative placeholders.
const now = '2026-10-18T00:00:00.000Z';
const d = '2026-10-01';

export function sampleTables() {
  return {
    Yarns: [
      { id: 'y_fdy75', name: '75D Polyester FDY', kind: 'base', material: 'Polyester', form: 'FDY', count: 75, count_unit: 'D', filaments: 36, lustre: 'SD' },
      { id: 'y_fdy60', name: '60D Polyester FDY', kind: 'base', material: 'Polyester', form: 'FDY', count: 60, count_unit: 'D', filaments: 24, lustre: 'SD' },
      { id: 'y_fdy50', name: '50D Polyester FDY', kind: 'base', material: 'Polyester', form: 'FDY', count: 50, count_unit: 'D', filaments: 24, lustre: 'BR' },
      { id: 'y_fdy100', name: '100D Polyester FDY', kind: 'base', material: 'Polyester', form: 'FDY', count: 100, count_unit: 'D', filaments: 48, lustre: 'SD' },
      { id: 'y_ny40', name: '40D Nylon', kind: 'base', material: 'Nylon', form: 'FDY', count: 40, count_unit: 'D', filaments: 34 },
      { id: 'y_vis30', name: '30s Viscose', kind: 'base', material: 'Viscose', form: 'Spun', count: 30, count_unit: 'Ne' },
      { id: 'y_pv30', name: '30s PV', kind: 'base', material: 'Poly-viscose', form: 'Spun', count: 30, count_unit: 'Ne' },
      { id: 'y_tpm75', name: '75D TPM 2000 S/Z', kind: 'tpm', base_yarn_id: 'y_fdy75', tpm: 2000, twist: 'S/Z', tpm_delta: 50 },
      { id: 'y_tpm60', name: '60D TPM 2400 S/Z', kind: 'tpm', base_yarn_id: 'y_fdy60', tpm: 2400, twist: 'S/Z', tpm_delta: 50 },
      { id: 'y_tpm100', name: '100D TPM 1800 S/Z', kind: 'tpm', base_yarn_id: 'y_fdy100', tpm: 1800, twist: 'S/Z', tpm_delta: 50 },
    ],
    YarnRates: [
      { id: 'r1', yarn_id: 'y_fdy75', rate: 118, effective_date: d },
      { id: 'r2', yarn_id: 'y_fdy60', rate: 125, effective_date: d },
      { id: 'r3', yarn_id: 'y_fdy50', rate: 132, effective_date: d },
      { id: 'r4', yarn_id: 'y_fdy100', rate: 112, effective_date: d },
      { id: 'r5', yarn_id: 'y_ny40', rate: 265, effective_date: d },
      { id: 'r6', yarn_id: 'y_vis30', rate: 230, effective_date: d },
      { id: 'r7', yarn_id: 'y_pv30', rate: 185, effective_date: d },
    ],
    Units: [
      { id: 'u_2', name: 'Unit 2', type: 'Airjet', cost_per_pick: 0.2, has_tfo: true, tfo_default_eff: 90, loom_eff_pct: 85, notes: 'Toyota airjet' },
      { id: 'u_caj', name: 'Chinese AJ', type: 'Airjet', cost_per_pick: 0.185, has_tfo: false, tfo_default_eff: '', loom_eff_pct: 85, notes: '' },
      { id: 'u_wj', name: 'Waterjet', type: 'Waterjet', cost_per_pick: 0.165, has_tfo: false, tfo_default_eff: '', loom_eff_pct: 85, notes: '' },
    ],
    LoomGroups: [
      { id: 'lg1', unit_id: 'u_2', make: 'Toyota', reed_width_cm: 190, shedding: 'Dobby', looms: 24 },
      { id: 'lg2', unit_id: 'u_2', make: 'Toyota', reed_width_cm: 280, shedding: 'Plain', looms: 40 },
    ],
    TfoTypes: [
      { id: 'tt1', unit_id: 'u_2', name: 'M/C 1–12', machines: 12, spindles_per_side: 252 },
      { id: 'tt2', unit_id: 'u_2', name: 'M/C 13–16', machines: 4, spindles_per_side: 252 },
    ],
    TfoSpeeds: [
      { id: 'sp1', unit_id: 'u_2', tfo_type_id: 'tt1', yarn_id: 'y_tpm75', rpm: 18000, efficiency: 90 },
      { id: 'sp2', unit_id: 'u_2', tfo_type_id: 'tt2', yarn_id: 'y_tpm75', rpm: 21000, efficiency: 90 },
      { id: 'sp3', unit_id: 'u_2', tfo_type_id: 'tt1', yarn_id: 'y_tpm60', rpm: 17000, efficiency: 90 },
      { id: 'sp4', unit_id: 'u_2', tfo_type_id: 'tt2', yarn_id: 'y_tpm60', rpm: 20000, efficiency: 90 },
      { id: 'sp5', unit_id: 'u_2', tfo_type_id: 'tt1', yarn_id: 'y_tpm100', rpm: 18000, efficiency: 90 },
      { id: 'sp6', unit_id: 'u_2', tfo_type_id: 'tt2', yarn_id: 'y_tpm100', rpm: 21000, efficiency: 90 },
    ],
    Fabrics: [
      { id: 'f_crepe', name: 'Poly Crepe', weave: 'Plain', design_note: '', end_use: 'Kurtis, sarees', reed: 100, ppi: 80, reed_space_in: 60, greige_width_in: 57, warp_shortage_pct: 2, weft_shortage_pct: 2, price: 45, vatav_pct: 3, finish: 'RFD', rfd_shortage_pct: 8, processing_charge: 7.5, brokering_pct: 1, loom_rpm: 800, loom_eff_pct: 85, created_at: now },
      { id: 'f_geo', name: 'Georgette', weave: 'Plain', design_note: '', end_use: 'Sarees, dupattas', reed: 120, ppi: 96, reed_space_in: 60, greige_width_in: 56, warp_shortage_pct: 3, weft_shortage_pct: 3, price: 58, vatav_pct: 3, finish: 'RFD', rfd_shortage_pct: 10, processing_charge: 8, brokering_pct: 1, loom_rpm: 700, loom_eff_pct: 80, created_at: now },
      { id: 'f_pv', name: 'PV Plain', weave: 'Plain', design_note: '', end_use: 'Kurtis', reed: 76, ppi: 68, reed_space_in: 60, greige_width_in: 58, warp_shortage_pct: 2.5, weft_shortage_pct: 2, price: 39, finish: 'Greige', created_at: now },
      { id: 'f_vn', name: 'Viscose Nylon Dobby', weave: 'Dobby', design_note: 'Small diamond, 16-shaft repeat', end_use: 'Dress, ethnic wear', reed: 88, ppi: 72, reed_space_in: 60, greige_width_in: 57, warp_shortage_pct: 3, weft_shortage_pct: 2, price: 46, vatav_pct: 2, finish: 'Greige', created_at: now },
      { id: 'f_moss', name: 'Moss Crepe', weave: 'Cam', design_note: 'Crepe weave', end_use: 'Garments', reed: 96, ppi: 84, reed_space_in: 60, greige_width_in: 57, warp_shortage_pct: 2, weft_shortage_pct: 2, price: 36, finish: 'Greige', loom_rpm: 750, loom_eff_pct: 85, created_at: now },
    ],
    FabricYarns: [
      { id: 'l1', fabric_id: 'f_crepe', side: 'warp', yarn_id: 'y_fdy75', ends: 6000, sort: 1 },
      { id: 'l2', fabric_id: 'f_crepe', side: 'weft', yarn_id: 'y_tpm75', parts: 1, pattern: '2S:2Z', sort: 2 },
      { id: 'l3', fabric_id: 'f_geo', side: 'warp', yarn_id: 'y_tpm60', ends: 7200, sort: 1 },
      { id: 'l4', fabric_id: 'f_geo', side: 'weft', yarn_id: 'y_tpm60', parts: 1, pattern: '2S:2Z', sort: 2 },
      { id: 'l5', fabric_id: 'f_pv', side: 'warp', yarn_id: 'y_pv30', ends: 4560, sort: 1 },
      { id: 'l6', fabric_id: 'f_pv', side: 'weft', yarn_id: 'y_fdy75', parts: 1, sort: 2 },
      { id: 'l7', fabric_id: 'f_vn', side: 'warp', yarn_id: 'y_ny40', ends: 5280, sort: 1 },
      { id: 'l8', fabric_id: 'f_vn', side: 'weft', yarn_id: 'y_vis30', parts: 1, sort: 2 },
      { id: 'l9', fabric_id: 'f_moss', side: 'warp', yarn_id: 'y_fdy50', ends: 5760, sort: 1 },
      { id: 'l10', fabric_id: 'f_moss', side: 'weft', yarn_id: 'y_tpm100', parts: 1, pattern: '2S:2Z', sort: 2 },
    ],
    Assignments: [
      { id: 'a1', fabric_id: 'f_crepe', unit_id: 'u_2' },
      { id: 'a2', fabric_id: 'f_crepe', unit_id: 'u_caj' },
      { id: 'a3', fabric_id: 'f_crepe', unit_id: 'u_wj' },
      { id: 'a4', fabric_id: 'f_geo', unit_id: 'u_2' },
      { id: 'a5', fabric_id: 'f_pv', unit_id: 'u_caj' },
      { id: 'a6', fabric_id: 'f_vn', unit_id: 'u_2' },
      { id: 'a7', fabric_id: 'f_moss', unit_id: 'u_2' },
      { id: 'a8', fabric_id: 'f_moss', unit_id: 'u_wj' },
    ],
    Photos: [],
    TfoPlans: [
      { id: 'p1', unit_id: 'u_2', plan_date: '2026-10-21', name: 'Current running', notes: '', created_at: now },
    ],
    PlanLooms: [
      { id: 'pl1', plan_id: 'p1', loom_group_id: 'lg2', fabric_id: 'f_crepe', looms: 20, panna: 1, rpm: '', sort: 1 },
      { id: 'pl2', plan_id: 'p1', loom_group_id: 'lg2', fabric_id: 'f_moss', looms: 12, panna: 1, rpm: '', sort: 2 },
      { id: 'pl3', plan_id: 'p1', loom_group_id: 'lg1', fabric_id: 'f_geo', looms: 10, panna: 1, rpm: '', sort: 3 },
    ],
    PlanTfo: [
      { id: 'pt1', plan_id: 'p1', tfo_type_id: 'tt1', yarn_id: 'y_tpm75', sides: 10, sort: 1 },
      { id: 'pt2', plan_id: 'p1', tfo_type_id: 'tt1', yarn_id: 'y_tpm100', sides: 6, sort: 2 },
      { id: 'pt3', plan_id: 'p1', tfo_type_id: 'tt2', yarn_id: 'y_tpm60', sides: 8, sort: 3 },
    ],
    PlanOutside: [
      { id: 'po1', plan_id: 'p1', yarn_id: 'y_tpm75', kg_per_day: 20, source: 'Job work', sort: 1 },
    ],
  };
}
