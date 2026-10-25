import { useEffect, useState } from 'preact/hooks';
import { getIndex, me, people, refresh, resetDemo, saveSettings, testConnection, toast, useStore } from '../store.js';
import { back, go } from '../router.js';
import { Button, Field, Icon, NavBar, Row, Section, Segmented, Sheet, useWide, whenText } from '../ui.jsx';
import { exportListXlsx, openWhatsAppText } from '../export/exports.js';
import { computeRows } from './fabrics.jsx';

export const APP_VERSION = '1.13.1';

// What to send someone so they can open the app on their own phone or laptop.
export function inviteText(person, url, appUrl) {
  return [
    `Hanuman Fabric Database: access for ${person.name}`,
    '',
    `1. Open this link in Safari on iPhone, or Chrome on a laptop:`,
    appUrl,
    '2. On iPhone: Share, then Add to Home Screen, and open the app from the icon.',
    '3. Tap the gear for Settings, choose Google Sheet and paste these two:',
    '',
    'Web app URL:',
    url,
    '',
    'API key:',
    person.key,
    '',
    '4. Tap Save and reload data.',
    '',
    'This key is only for you. Please do not forward it.',
  ].join('\n');
}

async function copy(text, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast('Copy is not available here', 'error');
  }
}

// Owner only: one key per person, so each edit carries a name and one person can be removed alone.
function People() {
  const st = useStore();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [open, setOpen] = useState(null);
  const [rename, setRename] = useState('');
  const [busy, setBusy] = useState('');
  const appUrl = typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : '';

  async function load() {
    setError('');
    try {
      setList(await people.list());
    } catch (e) {
      setError(e.message);
      setList([]);
    }
  }
  useEffect(() => {
    load();
  }, [st.settings.url, st.settings.key]);

  async function add() {
    setBusy('add');
    try {
      const person = await people.add(name);
      setAdding(false);
      setName('');
      await load();
      setRename(person.name);
      setOpen(person);
      toast(`Key made for ${person.name}`);
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy('');
  }

  async function saveName() {
    setBusy('rename');
    try {
      const next = await people.rename(open.id, rename);
      setList(next);
      setOpen(next.find((p) => p.id === open.id) || null);
      if (open.id === 'owner') await refresh();
      toast('Name saved');
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy('');
  }

  async function remove() {
    if (!window.confirm(`Remove ${open.name}'s access? Their key stops working straight away. Everyone else keeps theirs.`)) return;
    setBusy('remove');
    try {
      setList(await people.remove(open.id));
      toast(`${open.name} no longer has access`);
      setOpen(null);
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy('');
  }

  const others = (list || []).filter((p) => p.role !== 'owner');
  return (
    <>
      <Section
        header="People with access"
        footer="Each person gets their own key, so their edits carry their name. Removing someone stops only their key. What they already loaded on their phone is cleared the next time it tries to sync."
      >
        {list === null ? <Row label="Loading…" /> : null}
        {error ? <Row label="Couldn't load the list" sub={/Unknown action/.test(error) ? 'The script in your Google Sheet is an older version. Update it first.' : error} /> : null}
        {(list || []).map((p) => (
          <Row
            label={p.role === 'owner' ? `${p.name} (you)` : p.name}
            sub={p.role === 'owner' ? (p.name === 'Owner' ? 'Owner · tap to set your name' : 'Owner') : p.added_at ? `Added ${whenText(p.added_at)}` : 'Editor'}
            onClick={() => {
              setRename(p.name);
              setOpen(p);
            }}
            chevron
          />
        ))}
        {list && !error ? (
          <button type="button" class="add-row" onClick={() => { setName(''); setAdding(true); }}>
            <Icon.plus size={20} />Give someone access
          </button>
        ) : null}
      </Section>

      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Give someone access"
        footer={<Button busy={busy === 'add'} disabled={!name.trim()} onClick={add}>Make their key</Button>}
      >
        <Section footer={`Their edits will show this name. ${others.length ? `Already on the list: ${others.map((p) => p.name).join(', ')}.` : ''}`}>
          <Field label="Name" value={name} onInput={setName} placeholder="e.g. Ishaan" autofocus />
        </Section>
      </Sheet>

      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? open.name : ''}>
        {open ? (
          <>
            <Section header="Their key" footer={open.role === 'owner' ? 'This is your own key. Use it only on your own devices.' : 'Send the setup message on WhatsApp, or copy it. It has the app link, the web app URL and this key.'}>
              <div class="row"><div class="row-main"><div class="key-text">{open.key}</div></div></div>
              {open.role !== 'owner' ? (
                <Row label="Send setup on WhatsApp" onClick={() => openWhatsAppText(inviteText(open, st.settings.url, appUrl))} chevron />
              ) : null}
              <Row label="Copy setup message" onClick={() => copy(inviteText(open, st.settings.url, appUrl), 'Setup message copied')} chevron />
              <Row label="Copy key only" onClick={() => copy(open.key, 'Key copied')} chevron />
            </Section>
            <Section header="Name" footer="Changes come in under this name from now on. Earlier entries in the change log keep the old one.">
              <Field label="Name" value={rename} onInput={setRename} />
            </Section>
            <div class="actions">
              <Button kind="secondary" busy={busy === 'rename'} disabled={!rename.trim() || rename.trim() === open.name} onClick={saveName}>Save name</Button>
              {open.role !== 'owner' ? (
                <Button kind="danger" busy={busy === 'remove'} onClick={remove}><Icon.trash size={20} /> Remove access</Button>
              ) : null}
            </div>
          </>
        ) : null}
      </Sheet>
    </>
  );
}

export function Settings() {
  const st = useStore();
  const wide = useWide();
  const [mode, setMode] = useState(st.settings.mode || 'demo');
  const [url, setUrl] = useState(st.settings.url || '');
  const [key, setKey] = useState(st.settings.key || '');
  const [busy, setBusy] = useState('');
  const dirty = mode !== st.settings.mode || url !== st.settings.url || key !== st.settings.key;

  async function test() {
    setBusy('test');
    try {
      const r = await testConnection(url.trim(), key.trim());
      toast(`Connected to ${r.spreadsheetName || 'your Sheet'}`);
    } catch (e) {
      toast(e.message, 'error');
    }
    setBusy('');
  }

  async function apply() {
    if (mode === 'sheet' && (!url.trim() || !key.trim())) {
      toast('Paste the web app URL and the API key first', 'error');
      return;
    }
    setBusy('save');
    await saveSettings({ mode, url: url.trim(), key: key.trim() });
    setBusy('');
    toast(mode === 'sheet' ? 'Using your Google Sheet' : 'Using demo data');
  }

  const who = me();
  const editor = !!who && who.role !== 'owner';
  const sync = st.status.lastSync ? new Date(st.status.lastSync).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
  return (
    <div>
      <NavBar title="Settings" backLabel="Fabrics" backTo="/fabrics" />
      <Section header="Data source" footer={mode === 'demo' ? 'Demo keeps sample data on this device only. Nothing reaches your Drive.' : 'Paste the URL and key shown after deploying the script in your Sheet (see SETUP.md).'}>
        <div class="row"><div style={{ width: '100%' }}><Segmented label="Data source" options={[{ value: 'demo', label: 'Demo on this device' }, { value: 'sheet', label: 'Google Sheet' }]} value={mode} onChange={setMode} /></div></div>
        {mode === 'sheet' ? (
          <>
            <Field label="Web app URL" value={url} onInput={setUrl} placeholder="https://script.google.com/…/exec" type="url" />
            <Field label="API key" value={key} onInput={setKey} placeholder="From the Sheet's menu" />
          </>
        ) : null}
      </Section>
      <div class="actions">
        {mode === 'sheet' ? <Button kind="secondary" busy={busy === 'test'} onClick={test} disabled={!url || !key}>Test connection</Button> : null}
        <Button busy={busy === 'save'} disabled={!dirty} onClick={apply}>{dirty ? 'Save and reload data' : 'Saved'}</Button>
      </div>

      <Section header="Status">
        <Row label="Connected to" value={st.settings.mode === 'sheet' ? st.meta.spreadsheetName || 'Google Sheet' : 'Demo data'} />
        {who ? <Row label="Signed in as" value={who.name} valueSub={who.role === 'owner' ? 'Owner' : 'Editor'} /> : null}
        <Row label="Last loaded" value={sync} />
        {st.status.error ? <Row label="Last error" sub={st.status.error} /> : null}
        <Row label="Reload from the Sheet" onClick={async () => { setBusy('refresh'); await refresh(); setBusy(''); toast('Reloaded'); }} value={busy === 'refresh' ? <span class="spinner" /> : undefined} chevron />
        {st.settings.mode === 'sheet' ? <Row label="Recent changes" sub="Who added, changed or deleted what" onClick={() => go('/changes')} chevron /> : null}
        {/* the Sheet and folders sit in the owner's Drive; other people can't open them */}
        {editor ? null : (
          <>
            {st.meta.spreadsheetUrl ? <Row label="Open the Google Sheet" onClick={() => window.open(st.meta.spreadsheetUrl, '_blank')} chevron /> : null}
            {st.meta.photosFolderUrl ? <Row label="Open the photos folder" onClick={() => window.open(st.meta.photosFolderUrl, '_blank')} chevron /> : null}
            {st.meta.exportsFolderUrl ? <Row label="Open the exports folder" onClick={() => window.open(st.meta.exportsFolderUrl, '_blank')} chevron /> : null}
          </>
        )}
      </Section>

      {who && who.role === 'owner' && st.settings.mode === 'sheet' ? <People /> : null}

      <Section header="Data" footer="Bulk import: paste rows straight into the Sheet's tabs, keeping the header row. The app picks them up on the next reload.">
        <Row label="Export all fabrics to Excel" onClick={async () => {
          try {
            await exportListXlsx(computeRows(getIndex()), getIndex(), null);
          } catch (e) {
            toast(e.message, 'error');
          }
        }} chevron />
        {st.settings.mode !== 'sheet' ? (
          <Row label="Reset demo data" danger onClick={async () => {
            if (!window.confirm('Replace the demo data on this device with the original sample?')) return;
            await resetDemo();
            toast('Demo data reset');
          }} />
        ) : null}
      </Section>

      <Section header="About" footer="Realisation per pick = (selling price − RM cost with shortage − finishing cost) ÷ picks. With VATAV, the VATAV discount is also taken off the price. Profit per pick = realisation with VATAV − the unit's cost per pick.">
        <Row label="Version" value={APP_VERSION} />
        {wide ? (
          <Row label="Install on this laptop" sub="In Chrome or Edge, click the install icon at the right of the address bar. The app then opens in its own window." />
        ) : (
          <Row label="Add to Home Screen" sub="In Safari: Share, then Add to Home Screen. The app then opens full-screen." />
        )}
        <Row label="Phone and laptop" sub="Every device reads and writes the same Google Sheet. The app reloads it when you come back to it and every minute while it is open. Each edit is saved under the name of the key that made it." />
      </Section>
      <div class="actions"><Button kind="secondary" onClick={() => back('/fabrics')}>Done</Button></div>
    </div>
  );
}
