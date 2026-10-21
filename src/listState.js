// Fabric list search, unit and filters. Lives outside the screen so it survives
// opening a fabric and coming back, and is saved on the device until removed.
import { local } from './storage.js';

const KEY = 'fm.fabricList.v1';
let state = null;
let scrollY = 0;

export const savedScroll = () => scrollY;
export const saveScroll = (y) => { scrollY = y; };

export function loadListState(defaults) {
  if (!state) {
    const s = local.get(KEY, null);
    state = {
      search: typeof s?.search === 'string' ? s.search : '',
      unitId: typeof s?.unitId === 'string' ? s.unitId : 'all',
      filters: { ...defaults, ...(s && typeof s.filters === 'object' && s.filters ? s.filters : {}) },
    };
  }
  return state;
}

export function saveListState(next) {
  state = next;
  local.set(KEY, next);
}

// Forget everything (tests).
export function resetListState() {
  state = null;
  scrollY = 0;
  local.remove(KEY);
}
