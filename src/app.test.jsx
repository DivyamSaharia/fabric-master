import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/preact';
import { App } from './app.jsx';
import { sampleTables } from './sampleData.js';
import { whatsappText, fileName } from './export/exports.js';
import { buildIndex, fabricCalc } from './calc.js';

beforeAll(() => {
  window.scrollTo = () => {};
  window.confirm = () => true;
});

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

async function open(hash) {
  window.location.hash = hash;
  render(<App />);
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

describe('every screen renders with demo data', () => {
  it('fabric list ranks by realisation per pick', async () => {
    await open('#/fabrics');
    await screen.findByText('Poly Crepe 60');
    // list shows realisation with VATAV, and without it underneath when VATAV is set
    expect(screen.getByText('₹0.242')).toBeTruthy();
    expect(screen.getByText(/₹0\.258\s+without/)).toBeTruthy();
    expect(screen.getByText(/Demo data on this device/)).toBeTruthy();
    const names = [...document.querySelectorAll('.fname')].map((n) => n.textContent);
    expect(names.length).toBe(5);
  });

  it('home screen carries the Hanuman logo and app name', async () => {
    await open('#/fabrics');
    await screen.findByRole('heading', { name: 'Fabric Database' });
    expect(screen.getByText('Hanuman')).toBeTruthy();
    expect(screen.getByAltText('Hanuman logo').getAttribute('src')).toBe('./logo.svg');
  });

  it('search and unit switcher narrow the list', async () => {
    await open('#/fabrics');
    await screen.findByText('Poly Crepe 60');
    fireEvent.input(screen.getByPlaceholderText('Search quality or yarn'), { target: { value: 'geor' } });
    await waitFor(() => expect(document.querySelectorAll('.fname').length).toBe(1));
    fireEvent.input(screen.getByPlaceholderText('Search quality or yarn'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Chinese AJ' }));
    await waitFor(() => expect([...document.querySelectorAll('.fname')].map((n) => n.textContent).sort()).toEqual(['PV Plain 60', 'Poly Crepe 60']));
  });

  it('fabric detail shows RFD cost, profit per unit and spindles for each TFO type', async () => {
    await open('#/fabric/f_crepe');
    await screen.findByText('Finishing · RFD');
    expect(screen.getAllByText(/22\.59/).length).toBeGreaterThan(0);
    // single panna uses the fabric's RPM and the unit's loom efficiency; no double panna RPM is set
    expect(screen.getAllByText('M/C 1–12').length).toBeGreaterThan(0);
    expect(screen.getByText('130 spindles')).toBeTruthy();
    expect(screen.getByText('112 spindles')).toBeTruthy();
    expect(screen.getAllByText('Set double panna RPM on the fabric').length).toBeGreaterThan(0);
    expect(screen.getByText('+₹0.042 / pick')).toBeTruthy();
    expect(screen.getByText('Realisation without VATAV')).toBeTruthy();
    expect(screen.getByText('Realisation with VATAV')).toBeTruthy();
    expect(screen.getByText('3% · −₹1.35 / m')).toBeTruthy();
  });

  it('edit form shows the live result and saves', async () => {
    await open('#/fabric/f_crepe/edit');
    await screen.findByText('Edit fabric');
    expect(document.querySelector('.result-bar').textContent).toContain('₹0.258');
    expect(document.querySelector('.result-bar').textContent).toContain('₹0.242');
    fireEvent.input(screen.getByLabelText('VATAV'), { target: { value: '0' } });
    await waitFor(() => expect(document.querySelector('.result-bar').textContent).not.toContain('₹0.242'));
    fireEvent.input(screen.getByLabelText('Selling price'), { target: { value: '50' } });
    await waitFor(() => expect(document.querySelector('.result-bar').textContent).not.toContain('₹0.258'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('fm.demo.v1')).Fabrics.find((f) => f.id === 'f_crepe').price).toBe('50'));
  });

  it('duplicate for new RS scales ends, width and sale rate', async () => {
    localStorage.setItem('fm.demo.v1', JSON.stringify(sampleTables()));
    await open('#/fabric/f_crepe');
    fireEvent.click(await screen.findByText('Duplicate for new RS'));
    fireEvent.input(screen.getByLabelText('New RS'), { target: { value: '72' } });
    await screen.findByText('6,000 → 7,200');
    expect(screen.getByText('Poly Crepe 72')).toBeTruthy();
    fireEvent.click(document.querySelector('.sheet-foot button'));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('fm.demo.v1')).Fabrics.length).toBe(6));
    const db = JSON.parse(localStorage.getItem('fm.demo.v1'));
    const copy = db.Fabrics.find((f) => f.id !== 'f_crepe' && f.name === 'Poly Crepe');
    expect(copy.reed_space_in).toBe(72);
    expect(copy.price).toBe(54);
    expect(copy.greige_width_in).toBe(68.4);
    expect('base_name' in copy).toBe(false);
    expect(db.FabricYarns.find((l) => l.fabric_id === copy.id && l.side === 'warp').ends).toBe(7200);
    expect(db.Assignments.filter((a) => a.fabric_id === copy.id).length).toBe(3);
  });

  it('new fabric form', async () => {
    await open('#/fabric/new');
    await screen.findByText('New fabric');
    expect(screen.getByText('Add warp yarn')).toBeTruthy();
  });

  it('yarn list and TPM yarn form', async () => {
    await open('#/yarns');
    await screen.findByText('75D TPM 2000 S/Z');
    expect(screen.getByText('₹168')).toBeTruthy();
    expect(screen.getAllByText('per kg · base ₹118 + ₹50').length).toBeGreaterThan(0);
    cleanup();
    await open('#/yarn/y_tpm75');
    await screen.findByText('Twist direction');
    expect(screen.getByRole('button', { name: 'S/Z' }).getAttribute('aria-pressed')).toBe('true');
    // TPM yarns ask for a delta, not a rate
    expect(screen.getByLabelText('Delta').value).toBe('50');
    expect(screen.queryByLabelText('Rate')).toBeNull();
    expect(screen.getByText('base ₹118 + delta ₹50')).toBeTruthy();
    fireEvent.input(screen.getByLabelText('Delta'), { target: { value: '60' } });
    await waitFor(() => expect(screen.getByText('base ₹118 + delta ₹60')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('fm.demo.v1')).Yarns.find((y) => y.id === 'y_tpm75').tpm_delta).toBe(60));
  });

  it('deletes a yarn rate and falls back to the older one', async () => {
    const demo = sampleTables();
    demo.YarnRates.push({ id: 'r_old', yarn_id: 'y_fdy75', rate: 110, effective_date: '2026-09-01' });
    localStorage.setItem('fm.demo.v1', JSON.stringify(demo));
    await open('#/yarn/y_fdy75');
    await screen.findByText('Rate history');
    expect(screen.getByText('From 2026-10-01 · in use')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Delete rate from 2026-10-01'));
    await waitFor(() => expect(JSON.parse(localStorage.getItem('fm.demo.v1')).YarnRates.some((r) => r.id === 'r1')).toBe(false));
    await waitFor(() => expect(screen.getByLabelText('Rate').value).toBe('110'));
  });

  it('deletes older rates and keeps the one in use', async () => {
    const demo = sampleTables();
    demo.YarnRates.push({ id: 'r_a', yarn_id: 'y_fdy75', rate: 110, effective_date: '2026-09-01' }, { id: 'r_b', yarn_id: 'y_fdy75', rate: 105, effective_date: '2026-08-01' });
    localStorage.setItem('fm.demo.v1', JSON.stringify(demo));
    await open('#/yarn/y_fdy75');
    fireEvent.click(await screen.findByText('Delete older rates'));
    await waitFor(() => {
      const left = JSON.parse(localStorage.getItem('fm.demo.v1')).YarnRates.filter((r) => r.yarn_id === 'y_fdy75');
      expect(left.map((r) => r.id)).toEqual(['r1']);
    });
  });

  it('an edit screen opened straight from its link starts from the saved values', async () => {
    localStorage.setItem('fm.demo.v1', JSON.stringify(sampleTables()));
    window.location.hash = '#/yarn/y_fdy75';
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Rate').value).toBe('118'));
    expect(screen.getByLabelText('Count').value).toBe('75');
    cleanup();
    window.location.hash = '#/fabric/f_crepe/edit';
    render(<App />);
    // the form holds the stored name, without the RS
    await waitFor(() => expect(screen.getByLabelText('Quality name').value).toBe('Poly Crepe'));
    cleanup();
    window.location.hash = '#/unit/u_2/edit';
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('Cost per pick').value).toBe('0.2'));
  });

  it('unit page shows spindle requirement for every TFO type', async () => {
    await open('#/unit/u_2');
    await screen.findByText('Spindle requirement · per loom');
    const cards = [...document.querySelectorAll('.unit-card')].map((c) => c.textContent);
    expect(cards.some((t) => t.includes('Poly Crepe 60') && t.includes('M/C 1–12') && t.includes('M/C 13–16'))).toBe(true);
    expect(cards.some((t) => t.includes('Georgette 60') && t.includes('warp') && t.includes('weft'))).toBe(true);
  });

  it('unit list, unit edit, ranking and settings', async () => {
    await open('#/units');
    await screen.findByText('Unit 2');
    cleanup();
    await open('#/unit/u_2/edit');
    await screen.findByText('TFO types');
    cleanup();
    await open('#/ranking');
    await screen.findByText('Profit · Unit 2');
    cleanup();
    await open('#/settings');
    await screen.findByText('Data source');
  });
});

describe('TFO planner', () => {
  it('lists dated plans with their verdict, and the unit page links to them', async () => {
    await open('#/plans');
    await screen.findByText('Wed, 21 Oct 2026');
    expect(screen.getByText('Short 786 spindles')).toBeTruthy();
    expect(screen.getByText(/42 looms · 24 sides given out/)).toBeTruthy();
    cleanup();
    await open('#/unit/u_2');
    await screen.findByText('Latest · 21 Oct 2026');
    expect(screen.getByText('12 machines · 24 sides · 6,048 spindles · 90% efficiency (unit default)')).toBeTruthy();
  });

  it('plan page shows the spindle balance per yarn', async () => {
    await open('#/plan/p1');
    await screen.findByText('Spindle balance by yarn');
    const cards = [...document.querySelectorAll('.unit-card')].map((c) => c.textContent);
    expect(cards[0]).toContain('60D TPM 2400 S/Z');
    expect(cards[0]).toContain('−786');
    expect(cards.some((t) => t.includes('75D TPM 2000 S/Z') && t.includes('+116'))).toBe(true);
    expect(screen.getByText('Job work')).toBeTruthy();
    expect(screen.getByText('16 of 24')).toBeTruthy();
  });

  it('editing sides updates the balance live and saves', async () => {
    await open('#/plan/p1/edit');
    await screen.findByText('Balance as you edit');
    const sides = screen.getAllByLabelText('Number of sides');
    fireEvent.input(sides[2], { target: { value: '12' } });
    await screen.findByText(/M\/C 13–16: 12 sides given out, only 8 on 4 machines|\+222/);
    fireEvent.input(sides[2], { target: { value: '8' } });
    fireEvent.input(sides[0], { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Spindle balance by yarn');
    const t = JSON.parse(localStorage.getItem('fm.demo.v1'));
    expect(t.PlanTfo.find((l) => l.id === 'pt1').sides).toBe(9);
    expect(t.PlanTfo).toHaveLength(3);
  });

  it('copies a plan to a new date', async () => {
    await open('#/plan/p1');
    await screen.findByText('Spindle balance by yarn');
    fireEvent.click(screen.getByText('Copy to a new date'));
    fireEvent.input(screen.getByLabelText('Date'), { target: { value: '2026-11-01' } });
    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Nov plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create copy' }));
    await screen.findByText('Sun, 1 Nov 2026');
    const t = JSON.parse(localStorage.getItem('fm.demo.v1'));
    const copy = t.TfoPlans.find((p) => p.plan_date === '2026-11-01');
    expect(copy.name).toBe('Nov plan');
    expect(t.PlanLooms.filter((l) => l.plan_id === copy.id)).toHaveLength(3);
    expect(t.PlanTfo.filter((l) => l.plan_id === copy.id)).toHaveLength(3);
    expect(t.PlanOutside.filter((l) => l.plan_id === copy.id)).toHaveLength(1);
  });
});

describe('exports', () => {
  it('WhatsApp text carries spec and price, not costs', () => {
    const idx = buildIndex(sampleTables());
    const f = idx.fabricsById.f_crepe;
    const t = whatsappText(f, fabricCalc(f, idx), idx);
    expect(t).toContain('*Poly Crepe 60* (RFD)');
    expect(t).toContain('Reed × Pick: 100 × 80');
    expect(t).toContain('Weft: 75D TPM 2000 S/Z (2S:2Z)');
    expect(t).toContain('Price ₹45.00 / m');
    expect(t).not.toMatch(/realisation|RM cost/i);
  });
  it('file names follow YYYY-MM-DD_descriptive-name.ext', () => {
    expect(fileName('Poly Crepe 60', 'spec', 'pdf')).toMatch(/^\d{4}-\d{2}-\d{2}_poly-crepe-60_spec\.pdf$/);
  });
});

describe('laptop layout', () => {
  let orig;
  beforeAll(() => {
    orig = window.matchMedia;
    window.matchMedia = (q) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} });
  });
  afterAll(() => {
    window.matchMedia = orig;
  });

  it('shows the sidebar instead of the tab bar, and fabrics as a sortable table', async () => {
    await open('#/fabrics');
    await screen.findByText('Fabric Database');
    expect(document.querySelector('.tabbar')).toBeNull();
    expect(document.querySelector('.sidebar').textContent).toContain('Demo data on this device');
    const names = () => [...document.querySelectorAll('.ftable tbody .tname')].map((n) => n.textContent);
    await waitFor(() => expect(names().length).toBe(5));
    // default order matches the phone list: realisation with VATAV, highest first
    const phone = computeOrder();
    expect(names()).toEqual(phone);
    fireEvent.click(screen.getByRole('button', { name: /^Quality/ }));
    await waitFor(() => expect(names()).toEqual([...phone].sort((a, b) => a.localeCompare(b))));
    fireEvent.click(screen.getByRole('button', { name: /^Quality/ }));
    await waitFor(() => expect(names()).toEqual([...phone].sort((a, b) => b.localeCompare(a))));
  });

  it('opens a fabric from the table in two columns, and Escape closes a dialog', async () => {
    await open('#/fabrics');
    await waitFor(() => expect(document.querySelectorAll('.ftable tbody tr').length).toBe(5));
    fireEvent.click(document.querySelector('.ftable tbody tr'));
    await waitFor(() => expect(document.querySelectorAll('.detail-cols > .col').length).toBe(2));
    fireEvent.click(screen.getAllByText('Export or share')[0]);
    await waitFor(() => expect(document.querySelector('.sheet')).not.toBeNull());
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.sheet')).toBeNull());
  });

  it('yarns show as a table with rates', async () => {
    await open('#/yarns');
    await waitFor(() => expect(document.querySelectorAll('.ftable tbody tr').length).toBe(10));
    const row = [...document.querySelectorAll('.ftable tbody tr')].find((r) => r.textContent.includes('75D TPM 2000 S/Z'));
    expect(row.textContent).toContain('168.00');
    expect(row.textContent).toContain('base ₹118 + ₹50');
  });

  it('plan page shows the balance as a table', async () => {
    await open('#/plan/p1');
    await waitFor(() => expect(document.querySelectorAll('.plan-table tbody tr').length).toBe(3));
    expect(document.querySelector('.plan-table tbody tr').textContent).toContain('60D TPM 2400 S/Z');
    expect(document.querySelector('.sidebar').textContent).toContain('Planner');
  });

  it('"/" jumps to the search box', async () => {
    await open('#/fabrics');
    await screen.findByText('Fabric Database');
    fireEvent.keyDown(document.body, { key: '/' });
    expect(document.activeElement).toBe(document.querySelector('input[data-search]'));
  });
});

function computeOrder() {
  const idx = buildIndex(sampleTables());
  return Object.values(idx.fabricsById)
    .map((f) => ({ name: f.name, v: fabricCalc(f, idx).realisationNetPerPick }))
    .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity))
    .map((x) => x.name);
}
