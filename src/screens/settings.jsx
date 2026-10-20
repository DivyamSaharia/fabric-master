import { useState } from 'preact/hooks';
import { getIndex, refresh, resetDemo, saveSettings, testConnection, toast, useStore } from '../store.js';
import { back } from '../router.js';
import { Button, Field, NavBar, Row, Section, Segmented, useWide } from '../ui.jsx';
import { exportListXlsx } from '../export/exports.js';
import { computeRows } from './fabrics.jsx';

export const APP_VERSION = '1.1.0';

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
        <Row label="Last loaded" value={sync} />
        {st.status.error ? <Row label="Last error" sub={st.status.error} /> : null}
        <Row label="Reload from the Sheet" onClick={async () => { setBusy('refresh'); await refresh(); setBusy(''); toast('Reloaded'); }} value={busy === 'refresh' ? <span class="spinner" /> : undefined} chevron />
        {st.meta.spreadsheetUrl ? <Row label="Open the Google Sheet" onClick={() => window.open(st.meta.spreadsheetUrl, '_blank')} chevron /> : null}
        {st.meta.photosFolderUrl ? <Row label="Open the photos folder" onClick={() => window.open(st.meta.photosFolderUrl, '_blank')} chevron /> : null}
        {st.meta.exportsFolderUrl ? <Row label="Open the exports folder" onClick={() => window.open(st.meta.exportsFolderUrl, '_blank')} chevron /> : null}
      </Section>

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
        <Row label="Phone and laptop" sub="Both read and write the same Google Sheet. The app reloads it when you come back to it and every minute while it is open." />
      </Section>
      <div class="actions"><Button kind="secondary" onClick={() => back('/fabrics')}>Done</Button></div>
    </div>
  );
}
