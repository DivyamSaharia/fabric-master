// The app against the real Code.gs (in-memory Sheet): owner gives access, edits carry names.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/preact';
import { loadCodeGs } from '../backend/mockGas.js';
import { sampleTables } from './sampleData.js';
import { App } from './app.jsx';
import { inviteText } from './screens/settings.jsx';

let gas;
let ownerKey;
let ishaan;

beforeAll(() => {
  window.scrollTo = () => {};
  window.confirm = () => true;
  gas = loadCodeGs();
  ownerKey = gas.ctx.setup();
  gas.post({ action: 'renamePerson', key: ownerKey, id: 'owner', name: 'Divyam' });
  const t = sampleTables();
  gas.post({ action: 'batch', key: ownerKey, ops: Object.entries(t).filter(([, r]) => r.length).map(([table, rows]) => ({ op: 'upsert', table, rows })) });
  ishaan = gas.post({ action: 'addPerson', key: ownerKey, name: 'Ishaan' }).person;
  const f = gas.post({ action: 'bootstrap', key: ownerKey }).tables.Fabrics.find((x) => x.id === 'f_geo');
  gas.post({ action: 'batch', key: ishaan.key, ops: [{ op: 'upsert', table: 'Fabrics', rows: [{ ...f, price: 60 }] }] });
  globalThis.fetch = async (_url, init) => ({ json: async () => gas.post(JSON.parse(init.body)) });
});

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

async function openAs(key, hash) {
  localStorage.setItem('fm.settings.v1', JSON.stringify({ mode: 'sheet', url: 'https://script.google.com/macros/s/x/exec', key }));
  window.location.hash = hash;
  render(<App />);
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

describe('people with access', () => {
  it('fabric page shows who last edited it and who added it', async () => {
    await openAs(ownerKey, '#/fabric/f_geo');
    await screen.findByText('History');
    expect(screen.getByText('Ishaan')).toBeTruthy();
    expect(screen.getByText('Divyam')).toBeTruthy();
    expect(screen.getByText('All changes to this fabric')).toBeTruthy();
  });

  it('owner sees who has access and can add a person', async () => {
    await openAs(ownerKey, '#/settings');
    await screen.findByText('People with access');
    expect(screen.getByText('Divyam (you)')).toBeTruthy();
    await screen.findByText('Ishaan');
    fireEvent.click(screen.getByText('Give someone access'));
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Aman' } });
    fireEvent.click(screen.getByText('Make their key'));
    await screen.findByText('Send setup on WhatsApp');
    const keyText = document.querySelector('.key-text').textContent;
    expect(keyText).toMatch(/^[0-9a-f]{40}$/);
    expect(gas.post({ action: 'ping', key: keyText }).me).toEqual({ name: 'Aman', role: 'editor' });
  });

  it('an editor sees their name but not the people list', async () => {
    await openAs(ishaan.key, '#/settings');
    await screen.findByText('Signed in as');
    expect(screen.getByText('Editor')).toBeTruthy();
    expect(screen.queryByText('People with access')).toBeNull();
    expect(screen.queryByText('Open the Google Sheet')).toBeNull();
  });

  it('recent changes lists who changed what', async () => {
    await openAs(ishaan.key, '#/changes');
    await screen.findByText('Ishaan changed Georgette 60 (RFD)');
    expect(screen.getByText('Price 58 → 60')).toBeTruthy();
    expect(screen.getByText('Divyam gave access to Ishaan')).toBeTruthy();
  });

  it('a removed person is signed out and their saved copy is cleared', async () => {
    const tmp = gas.post({ action: 'addPerson', key: ownerKey, name: 'Temp' }).person;
    await openAs(tmp.key, '#/fabrics');
    await screen.findByText('Georgette 60 (RFD)');
    expect(localStorage.getItem('fm.cache.v1')).toBeTruthy();
    gas.post({ action: 'removePerson', key: ownerKey, id: tmp.id });
    cleanup();
    await openAs(tmp.key, '#/fabrics');
    await waitFor(() => expect(localStorage.getItem('fm.cache.v1')).toBeNull());
    expect(screen.queryByText('Georgette 60 (RFD)')).toBeNull();
  });

  it('the setup message carries the app link, URL and key', () => {
    const text = inviteText({ name: 'Ishaan', key: 'abc123' }, 'https://script.google.com/x/exec', 'https://divyamsaharia.github.io/fabric-master/');
    expect(text).toContain('https://divyamsaharia.github.io/fabric-master/');
    expect(text).toContain('https://script.google.com/x/exec');
    expect(text).toContain('abc123');
  });
});
