// Tab names and columns of the Google Sheet. Keep in sync with backend/Code.gs.
export const TABLES = {
  Yarns: ['id', 'name', 'kind', 'base_yarn_id', 'material', 'form', 'count', 'count_unit', 'filaments', 'lustre', 'tpm', 'twist', 'tpm_delta', 'notes', 'updated_at', 'updated_by'],
  YarnRates: ['id', 'yarn_id', 'rate', 'effective_date', 'updated_at', 'updated_by'],
  Units: ['id', 'name', 'type', 'cost_per_pick', 'has_tfo', 'tfo_default_eff', 'loom_eff_pct', 'notes', 'updated_at', 'updated_by'],
  LoomGroups: ['id', 'unit_id', 'make', 'reed_width_cm', 'shedding', 'looms', 'updated_at', 'updated_by'],
  TfoTypes: ['id', 'unit_id', 'name', 'machines', 'spindles_per_side', 'efficiency', 'updated_at', 'updated_by'],
  TfoSpeeds: ['id', 'unit_id', 'tfo_type_id', 'yarn_id', 'rpm', 'efficiency', 'updated_at', 'updated_by'],
  Fabrics: ['id', 'name', 'weave', 'design_note', 'end_use', 'reed', 'ppi', 'reed_space_in', 'greige_width_in', 'warp_shortage_pct', 'weft_shortage_pct', 'price', 'vatav_pct', 'finish', 'rfd_shortage_pct', 'processing_charge', 'brokering_pct', 'loom_rpm', 'loom_rpm_dp', 'loom_eff_pct', 'notes', 'created_at', 'updated_at', 'updated_by', 'created_by'],
  FabricYarns: ['id', 'fabric_id', 'side', 'yarn_id', 'ends', 'parts', 'pattern', 'sort', 'updated_at', 'updated_by'],
  Assignments: ['id', 'fabric_id', 'unit_id', 'updated_at', 'updated_by'],
  Photos: ['id', 'fabric_id', 'file_id', 'thumb_file_id', 'caption', 'is_cover', 'created_at', 'updated_at', 'updated_by'],
  // Dated TFO plans: what each loom group runs, how TFO sides are given out, and twisted yarn bought in.
  TfoPlans: ['id', 'unit_id', 'plan_date', 'name', 'running', 'notes', 'created_at', 'updated_at', 'updated_by', 'created_by'],
  PlanLooms: ['id', 'plan_id', 'loom_group_id', 'fabric_id', 'looms', 'panna', 'rpm', 'sort', 'updated_at', 'updated_by'],
  PlanTfo: ['id', 'plan_id', 'tfo_type_id', 'yarn_id', 'sides', 'sort', 'updated_at', 'updated_by'],
  PlanOutside: ['id', 'plan_id', 'yarn_id', 'kg_per_day', 'source', 'sort', 'updated_at', 'updated_by'],
  // Stock: kind 'yarn' = twisted yarn in stock (yarn_id, qty kg/day to use); kind 'beam' = beams in stock (fabric_id, qty beams).
  PlanStock: ['id', 'plan_id', 'kind', 'yarn_id', 'fabric_id', 'qty', 'sort', 'updated_at', 'updated_by'],
};

export const TABLE_NAMES = Object.keys(TABLES);

export function emptyTables() {
  return Object.fromEntries(TABLE_NAMES.map((t) => [t, []]));
}

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
