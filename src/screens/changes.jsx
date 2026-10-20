import { useEffect, useState } from 'preact/hooks';
import { fetchLog, getIndex, useStore } from '../store.js';
import { go } from '../router.js';
import { Empty, Icon, IconButton, NavBar, Row, Section, Segmented, dayText, parseWhen, timeText } from '../ui.jsx';

// "Ishaan changed Natural Crape 67", "Divyam gave access to Ishaan"
export function entryTitle(e) {
  if (e.type === 'Access') {
    if (e.action === 'gave access') return `${e.who} gave access to ${e.item}`;
    if (e.action === 'removed access') return `${e.who} removed access for ${e.item}`;
    return `${e.who} ${e.action} ${e.item}`;
  }
  return `${e.who} ${e.action} ${e.item}`;
}

const PATH = { Fabric: (id) => `/fabric/${id}`, Yarn: (id) => `/yarn/${id}`, Unit: (id) => `/unit/${id}` };

function openable(e, idx) {
  if (!e.ref || e.action === 'deleted' || !PATH[e.type]) return null;
  const exists = { Fabric: idx.fabricsById, Yarn: idx.yarnsById, Unit: idx.unitsById }[e.type][e.ref];
  return exists ? () => go(PATH[e.type](e.ref)) : null;
}

// Every add, change and delete made through the app, newest first, from the Sheet's "Change log" tab.
export function Changes({ query = {} }) {
  const st = useStore();
  const idx = getIndex();
  const sheet = st.settings.mode === 'sheet';
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  const [who, setWho] = useState('all');
  const ref = query.ref || '';

  async function load() {
    setError('');
    try {
      setEntries(await fetchLog(ref ? 500 : 200));
    } catch (e) {
      setError(/Unknown action/.test(e.message) ? 'The script in your Google Sheet is an older version. Update it to see changes.' : e.message);
      setEntries([]);
    }
  }
  useEffect(() => {
    if (sheet) load();
  }, [sheet, st.settings.url, st.settings.key, ref]);

  const list = (entries || []).filter((e) => (!ref || e.ref === ref) && (who === 'all' || e.who === who));
  const names = [...new Set((entries || []).map((e) => e.who).filter(Boolean))];
  const days = [];
  for (const e of list) {
    const d = parseWhen(e.when);
    const day = d ? dayText(d) : 'Earlier';
    if (!days.length || days[days.length - 1].day !== day) days.push({ day, items: [] });
    days[days.length - 1].items.push({ e, d });
  }
  const item = ref ? idx.fabricsById[ref] || idx.yarnsById[ref] || idx.unitsById[ref] : null;
  const itemPath = !ref ? '/settings' : idx.fabricsById[ref] ? `/fabric/${ref}` : idx.yarnsById[ref] ? `/yarn/${ref}` : idx.unitsById[ref] ? `/unit/${ref}` : '/fabrics';
  const title = ref ? 'Changes' : 'Recent changes';

  return (
    <div>
      <NavBar
        title={title}
        backLabel={ref ? 'Back' : 'Settings'}
        backTo={itemPath}
        right={sheet ? <IconButton label="Reload changes" onClick={load}><Icon.refresh /></IconButton> : null}
      />
      {!sheet ? (
        <Empty title="No change history in demo" text="Changes are recorded in your Google Sheet. Connect it in Settings." />
      ) : (
        <>
          <div class="title-block" style={{ paddingTop: '4px' }}>
            <h1>{ref ? (item ? item.name : 'Changes') : title}</h1>
            <div class="title-sub">{ref ? 'Every edit made through the app' : 'Who added, changed or deleted what, newest first'}</div>
          </div>
          {names.length > 1 && !ref ? (
            <div class="row" style={{ background: 'transparent' }}>
              <div style={{ width: '100%' }}>
                <Segmented small label="Show changes by" options={[{ value: 'all', label: 'Everyone' }, ...names.map((n) => ({ value: n, label: n }))]} value={who} onChange={setWho} />
              </div>
            </div>
          ) : null}
          {entries === null ? (
            <div class="empty"><span class="spinner" aria-label="Loading" /></div>
          ) : error ? (
            <Empty title="Couldn't load changes" text={error} />
          ) : !list.length ? (
            <Empty title="No changes yet" text={ref ? 'Edits to this item will show here.' : 'Edits made in the app from now on will show here.'} />
          ) : (
            days.map((g) => (
              <Section header={g.day}>
                {g.items.map(({ e, d }) => (
                  <Row
                    label={entryTitle(e)}
                    sub={e.details || undefined}
                    value={d ? timeText(d) : e.when}
                    valueSub={e.type}
                    onClick={openable(e, idx) || undefined}
                  />
                ))}
              </Section>
            ))
          )}
        </>
      )}
    </div>
  );
}
