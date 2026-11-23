import { useEffect } from 'preact/hooks';
import { init, setPendingShare, startAutoSync, useStore } from './store.js';
import { shareFile } from './export/exports.js';
import { tab, useRoute } from './router.js';
import { ConfirmHost, Sidebar, TabBar, setNavStrip, useWide } from './ui.jsx';
import { FabricDetail, FabricEdit, FabricList } from './screens/fabrics.jsx';
import { YarnEdit, YarnList } from './screens/yarns.jsx';
import { UnitDetail, UnitEdit, UnitList } from './screens/units.jsx';
import { Ranking } from './screens/ranking.jsx';
import { Planner } from './screens/planner.jsx';
import { Settings } from './screens/settings.jsx';
import { Changes } from './screens/changes.jsx';
import { TempRatesPanel, TempRatesStrip } from './screens/tempRates.jsx';
import { Guide } from './screens/guide.jsx';
import { SearchSheet, SidebarSearch } from './screens/search.jsx';
import { notePlace, openSearch, TAB_PLACES } from './search.js';
import { getIndex } from './store.js';

// The Temporary rates strip sits inside every top bar, so it stays in view while you scroll (B14).
setNavStrip(TempRatesStrip);

function resolve({ path, query }) {
  const [a, b, c] = path;
  switch (a) {
    case 'fabric':
      if (b === 'new') return { tab: 'fabrics', modal: true, el: <FabricEdit key="new" /> };
      if (c === 'edit') return { tab: 'fabrics', modal: true, el: <FabricEdit key={`e${b}`} id={b} /> };
      return { tab: 'fabrics', el: <FabricDetail key={b} id={b} /> };
    case 'yarns':
      return { tab: 'yarns', el: <YarnList /> };
    case 'yarn':
      return { tab: 'yarns', modal: true, el: <YarnEdit key={`${b}${query.kind || ''}`} id={b} query={query} /> };
    case 'units':
      return { tab: 'units', el: <UnitList /> };
    case 'unit':
      if (b === 'new') return { tab: 'units', modal: true, el: <UnitEdit key="new" /> };
      if (c === 'edit') return { tab: 'units', modal: true, el: <UnitEdit key={`e${b}`} id={b} /> };
      return { tab: 'units', el: <UnitDetail key={b} id={b} /> };
    case 'ranking':
      return { tab: 'ranking', el: <Ranking /> };
    case 'planner':
      return { tab: 'planner', el: <Planner /> };
    case 'guide':
      return { tab: 'guide', modal: true, el: <Guide key={b || 'home'} topic={b} /> };
    case 'settings':
      return { tab: 'fabrics', modal: true, el: <Settings /> };
    case 'changes':
      return { tab: 'fabrics', modal: true, el: <Changes key={query.ref || 'all'} query={query} /> };
    default:
      return { tab: 'fabrics', el: <FabricList query={query} /> };
  }
}

// Keys (1.27.0, like the CFM dashboard): / or Ctrl/⌘ K opens the search; 1–5 open the tabs; g then f searches
// fabrics, g then y yarns; Esc closes (in the search box). Ctrl/⌘ S presses the Save button of the form on screen.
// Letters and numbers do nothing while you type in a box or a sheet is open.
let gAt = 0;
function onShortcut(e) {
  if (e.defaultPrevented) return;
  const k = e.key || '';
  if ((e.metaKey || e.ctrlKey) && !e.altKey && k.toLowerCase() === 's') {
    const save = [...document.querySelectorAll('.navbar .text-btn')].find((b) => b.textContent.trim() === 'Save' && !b.disabled);
    if (save) {
      e.preventDefault();
      save.click();
    }
    return;
  }
  const sheet = document.querySelector('.sheet-layer, .gs-sheet');
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && k.toLowerCase() === 'k') {
    if (sheet && !sheet.classList.contains('gs-sheet')) return;
    e.preventDefault();
    openSearch('');
    return;
  }
  const t = e.target;
  const typing = t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
  if (e.metaKey || e.ctrlKey || e.altKey || typing || sheet) {
    gAt = 0;
    return;
  }
  if (k === '/') {
    e.preventDefault();
    gAt = 0;
    openSearch('');
    return;
  }
  if (k === 'g') {
    gAt = Date.now();
    return;
  }
  if ((k === 'f' || k === 'y') && gAt && Date.now() - gAt < 1500) {
    gAt = 0;
    e.preventDefault();
    openSearch(k === 'f' ? 'fabric ' : 'yarn ');
    return;
  }
  gAt = 0;
  if (/^[1-5]$/.test(k)) {
    const id = TAB_PLACES[Number(k) - 1][0];
    e.preventDefault();
    if (location.hash === `#/${id}`) window.scrollTo(0, 0);
    else tab(`/${id}`);
  }
}

// The place on screen, for Favourites and Recent.
function placeOf(route) {
  const [a, b, c] = route.path;
  const idx = getIndex();
  const t = TAB_PLACES.find(([id]) => id === a);
  if (t && !b) return { id: `t:${a}`, kind: 'Tab', label: t[1], sub: '', go: `/${a}` };
  if (c) return null;
  if (a === 'fabric' && idx.fabricsById[b]) return { id: `f:${b}`, kind: 'Fabric', label: idx.fabricsById[b].name, go: `/fabric/${b}` };
  if (a === 'yarn' && idx.yarnsById[b]) return { id: `y:${b}`, kind: 'Yarn', label: idx.yarnsById[b].name, go: `/yarn/${b}` };
  if (a === 'unit' && idx.unitsById[b]) return { id: `u:${b}`, kind: 'Unit', label: idx.unitsById[b].name, go: `/unit/${b}` };
  return null;
}

export function App() {
  const st = useStore();
  const route = useRoute();
  const wide = useWide();
  useEffect(() => {
    init();
    const stop = startAutoSync();
    window.addEventListener('keydown', onShortcut);
    return () => {
      stop();
      window.removeEventListener('keydown', onShortcut);
    };
  }, []);
  const placeKey = route.path.join('/');
  const ready = !st.status.loading;
  useEffect(() => {
    if (ready) notePlace(placeOf(route));
  }, [placeKey, ready]);
  const r = resolve(route);
  return (
    <div class={`shell ${wide ? 'wide' : ''}`}>
      {wide ? <Sidebar active={r.tab} settingsOpen={route.path[0] === 'settings' || route.path[0] === 'changes'} search={<SidebarSearch />} /> : null}
      <div class={`app ${r.modal ? 'no-tabs' : ''}`}>
        {r.el}
        <TempRatesPanel />
      </div>
      {r.modal || wide ? null : <TabBar active={r.tab} />}
      <SearchSheet />
      <ConfirmHost />
      {st.toast ? <div class={`toast ${st.toast.kind === 'error' ? 'error' : ''}`} role="status">{st.toast.message}</div> : null}
      {st.pendingShare ? (
        <div class="toast share" role="status">
          <span>{st.pendingShare.file.name} is ready</span>
          <button type="button" class="text-btn bold" onClick={async () => {
            const p = st.pendingShare;
            setPendingShare(null);
            try {
              await shareFile(p.file, p.title);
            } catch {
              /* user can retry from the export sheet */
            }
          }}>Share</button>
          <button type="button" class="text-btn dismiss" aria-label="Dismiss" onClick={() => setPendingShare(null)}>✕</button>
        </div>
      ) : null}
    </div>
  );
}
