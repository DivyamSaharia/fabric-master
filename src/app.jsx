import { useEffect } from 'preact/hooks';
import { init, setPendingShare, startAutoSync, useStore } from './store.js';
import { shareFile } from './export/exports.js';
import { useRoute } from './router.js';
import { Sidebar, TabBar, useWide } from './ui.jsx';
import { FabricDetail, FabricEdit, FabricList } from './screens/fabrics.jsx';
import { YarnEdit, YarnList } from './screens/yarns.jsx';
import { UnitDetail, UnitEdit, UnitList } from './screens/units.jsx';
import { Ranking } from './screens/ranking.jsx';
import { Settings } from './screens/settings.jsx';
import { Changes } from './screens/changes.jsx';

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
    case 'settings':
      return { tab: 'fabrics', modal: true, el: <Settings /> };
    case 'changes':
      return { tab: 'fabrics', modal: true, el: <Changes key={query.ref || 'all'} query={query} /> };
    default:
      return { tab: 'fabrics', el: <FabricList query={query} /> };
  }
}

// "/" jumps to the search box on a laptop, unless you are already typing somewhere.
// Cmd/Ctrl+S presses the Save button of the form on screen.
function onShortcut(e) {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's') {
    const save = [...document.querySelectorAll('.navbar .text-btn')].find((b) => b.textContent.trim() === 'Save' && !b.disabled);
    if (save) {
      e.preventDefault();
      save.click();
    }
    return;
  }
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
  const box = document.querySelector('input[data-search]');
  if (box) {
    e.preventDefault();
    box.focus();
  }
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
  const r = resolve(route);
  return (
    <div class={`shell ${wide ? 'wide' : ''}`}>
      {wide ? <Sidebar active={r.tab} settingsOpen={route.path[0] === 'settings' || route.path[0] === 'changes'} /> : null}
      <div class={`app ${r.modal ? 'no-tabs' : ''}`}>{r.el}</div>
      {r.modal || wide ? null : <TabBar active={r.tab} />}
      {st.toast ? <div class={`toast ${st.toast.kind === 'error' ? 'error' : ''}`} role="status">{st.toast.message}</div> : null}
      {st.pendingShare ? (
        <div class="toast" role="status" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>{st.pendingShare.file.name} is ready</span>
          <button type="button" class="text-btn bold" style={{ color: '#a6ce38', height: '32px' }} onClick={async () => {
            const p = st.pendingShare;
            setPendingShare(null);
            try {
              await shareFile(p.file, p.title);
            } catch {
              /* user can retry from the export sheet */
            }
          }}>Share</button>
          <button type="button" class="text-btn" style={{ color: '#ffffff', height: '32px' }} aria-label="Dismiss" onClick={() => setPendingShare(null)}>✕</button>
        </div>
      ) : null}
    </div>
  );
}
