// Tab names and columns of the Google Sheet. Keep in sync with backend/Code.gs.
export const TABLES = {
  Yarns: ['id', 'name', 'kind', 'base_yarn_id', 'material', 'form', 'count', 'count_unit', 'filaments', 'lustre', 'tpm', 'twist', 'tpm_delta', 'notes', 'updated_at'],
  YarnRates: ['id', 'yarn_id', 'rate', 'effective_date', 'updated_at'],
  Units: ['id', 'name', 'type', 'cost_per_pick', 'has_tfo', 'tfo_default_eff', 'loom_eff_pct', 'notes', 'updated_at'],
  LoomGroups: ['id', 'unit_id', 'make', 'reed_width_cm', 'shedding', 'looms', 'updated_at'],
  TfoTypes: ['id', 'unit_id', 'name', 'updated_at'],
  TfoSpeeds: ['id', 'unit_id', 'tfo_type_id', 'yarn_id', 'rpm', 'efficiency', 'updated_at'],
  Fabrics: ['id', 'name', 'weave', 'design_note', 'end_use', 'reed', 'ppi', 'reed_space_in', 'greige_width_in', 'warp_shortage_pct', 'weft_shortage_pct', 'price', 'vatav_pct', 'finish', 'rfd_shortage_pct', 'processing_charge', 'brokering_pct', 'loom_rpm', 'loom_rpm_dp', 'loom_eff_pct', 'notes', 'created_at', 'updated_at'],
  FabricYarns: ['id', 'fabric_id', 'side', 'yarn_id', 'ends', 'parts', 'pattern', 'sort', 'updated_at'],
  Assignments: ['id', 'fabric_id', 'unit_id', 'updated_at'],
  Photos: ['id', 'fabric_id', 'file_id', 'thumb_file_id', 'caption', 'is_cover', 'created_at', 'updated_at'],
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
