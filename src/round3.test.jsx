// 1.26.0 layout and design (audit round 3) with demo data. No figure changes here: these check layout only.
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/preact';
import { App } from './app.jsx';
import { answer, confirmOpen } from './testUtil.js';
import { resetListState } from './listState.js';
import { getState, resetDemo, setTempRate, clearAllTempRates } from './store.js';
import { local } from './storage.js';
import { gapText } from './screens/ranking.jsx';
import { slotLabelIn } from './machines.js';
import { rateLabel } from './describe.js';
import { buildIndex } from './calc.js';
import { sampleTables } from './sampleData.js';

beforeAll(() => {
  window.scrollTo = () => {};
});

beforeEach(async () => {
  cleanup();
  localStorage.clear();
  resetListState();
  window.confirm = vi.fn(() => true);
  await resetDemo();
});

async function open(hash) {
  window.location.hash = hash;
  render(<App />);
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

describe('B10: one in-app confirm sheet', () => {
  it('deleting a fabric asks in the app, names it on a red button, and Cancel keeps it', async () => {
    await open('#/fabric/f_pv');
    fireEvent.click(await screen.findByRole('button', { name: /Delete fabric/ }));
    await waitFor(() => expect(confirmOpen()).toBe(true));
    expect(document.querySelector('.confirm-btns .btn.danger-fill').textContent).toBe('Delete PV Plain 60');
    expect(await answer(false)).toBe('Delete PV Plain 60?');
    expect(getState().tables.Fabrics.some((f) => f.id === 'f_pv')).toBe(true);
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it('no screen calls the browser pop-up any more', async () => {
    const fs = await import('node:fs');
    const files = fs.readdirSync('src/screens').map((f) => `src/screens/${f}`).concat(['src/router.js', 'src/ui.jsx', 'src/store.js']);
    for (const f of files) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/window\.confirm\(/);
  });
});

describe('fabric page layout', () => {
  it('B2: no photo is one line, not an empty box', async () => {
    await open('#/fabric/f_crepe');
    await screen.findByText('Finishing · RFD');
    expect(document.querySelector('.hero')).toBeNull();
    expect(document.querySelector('.photo-add').textContent).toContain('No photos yet');
  });

  it('B1 a, b: jump buttons stay under the title; Construction, Beam length and History are folded and remembered', async () => {
    await open('#/fabric/f_geo');
    await screen.findByText('Finishing · RFD');
    const jump = document.querySelector('.navbar .jumpbar');
    expect([...jump.querySelectorAll('.chip')].map((c) => c.textContent)).toEqual(['Summary', 'Rates', 'Construction', 'Costing', 'Units', 'Production']);
    for (const h of ['Construction', 'Beam length', 'History']) expect(screen.getByRole('button', { name: `Show ${h}` })).toBeTruthy();
    expect(screen.queryByText('Total ends')).toBeNull();
    // the jump button opens a folded section
    fireEvent.click([...jump.querySelectorAll('.chip')].find((c) => c.textContent === 'Construction'));
    await screen.findByText('Total ends');
    expect(local.get('fm.fold.v1').construction).toBe(true);
    cleanup();
    await open('#/fabric/f_geo');
    await screen.findByText('Total ends');
  });

  it('B1 c: unit cards drop the warp and weft kg boxes; the Production centre keeps them', async () => {
    await open('#/fabric/f_moss'); // greige, no TPM, with an RPM: its unit cards had only warp and weft kg
    await screen.findByText('Production centre');
    const cards = [...document.querySelectorAll('.unit-card:not(.prod-card)')];
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c.textContent).not.toMatch(/kg\/day/);
    expect([...document.querySelectorAll('.prod-card')].some((c) => /Warp \/ day/.test(c.textContent))).toBe(true);
  });

  it('B11: Delete sits apart at the end', async () => {
    await open('#/fabric/f_crepe');
    await screen.findByText('Finishing · RFD');
    const zone = document.querySelector('.danger-zone');
    expect(zone.textContent).toContain('Delete fabric');
    expect(document.querySelector('.actions').textContent).not.toContain('Delete fabric');
  });

  it('B5: typed values and rate pickers sit in boxes; read-only rows do not', async () => {
    await open('#/fabric/f_crepe');
    await screen.findByText('Yarn rates');
    expect(screen.getByLabelText('Temporary sale rate for Poly Crepe 60 (RFD)').closest('.field-input')).not.toBeNull();
    expect(screen.getByLabelText('Rate for 75D Polyester FDY').closest('.field-input.select')).not.toBeNull();
  });

  it('C5: TPM badges are grey and bold, not amber', async () => {
    await open('#/fabric/f_crepe');
    const b = await screen.findByText('Weft TPM', { selector: '.badge' });
    expect(b.classList.contains('amber')).toBe(false);
    expect(b.classList.contains('tpm')).toBe(true);
  });
});

describe('B14: the Temporary rates strip stays under the top bar', () => {
  it('sits inside the sticky top bar, and its panel opens', async () => {
    setTempRate('y_tpm75', 172);
    await open('#/fabrics');
    const strip = await waitFor(() => {
      const s = document.querySelector('.navbar .temp-strip');
      expect(s).not.toBeNull();
      return s;
    });
    fireEvent.click(strip);
    await screen.findByText('Temporary rates');
    // B11: Save to master is a filled button, Reset a link
    expect(document.querySelector('.temp-actions .btn.primary').textContent).toBe('Save to master');
    expect(document.querySelector('.temp-actions .link-btn').textContent).toBe('Reset');
    clearAllTempRates();
  });
});

describe('lists', () => {
  it('B13: the line under ₹/pick is the same pattern on every row', async () => {
    await open('#/fabrics');
    await screen.findByText('PV Plain 60');
    const smalls = [...document.querySelectorAll('.frow .fval .small')].map((x) => x.textContent);
    expect(smalls.length).toBe(5);
    for (const t of smalls) expect(t).toMatch(/ without$|^no VATAV$/);
  });

  it('B9: on a phone the filter icon is gone (the chip stays)', async () => {
    await open('#/fabrics');
    await screen.findByText('PV Plain 60');
    expect(screen.queryByRole('button', { name: 'Filters' })).not.toBeNull(); // the chip
    expect(document.querySelector('.navbar button[aria-label="Filters"]')).toBeNull();
    expect(document.querySelector('.navbar button[aria-label="Settings"]')).not.toBeNull();
  });

  it('B15: a TPM yarn keeps base + delta on the left', () => {
    const idx = buildIndex(sampleTables());
    const r = rateLabel(idx.yarnsById.y_tpm75, idx);
    expect(r.sub).toBe('per kg');
    expect(r.basis).toBe('base ₹118 + ₹50');
  });

  it('C6: Ranking says the gap to the leader', async () => {
    expect(gapText(0.3, 0.3, 0)).toBe('top');
    expect(gapText(0.291, 0.3, 1)).toBe('−₹0.009 vs top');
    expect(gapText(0.3, 0.3, 1)).toBe('same as top');
    await open('#/ranking');
    await screen.findByText('PV Plain 60');
    const gaps = [...document.querySelectorAll('.fval .gap')].map((x) => x.textContent);
    expect(gaps[0]).toBe('top');
    expect(gaps.slice(1).every((g) => /vs top$|same as top/.test(g))).toBe(true);
  });

  it('B12: the loom make is dropped when the unit name says it', () => {
    const slot = { group: { make: 'Chinese', reed_width_cm: 190 } };
    expect(slotLabelIn({ name: 'Chinese AJ' }, slot)).toBe('Chinese AJ · 190 cm');
    expect(slotLabelIn({ name: 'Unit 2' }, { group: { make: 'Toyota', reed_width_cm: 280 } })).toBe('Unit 2 · Toyota · 280 cm');
  });
});

describe('B3: Planner headline tiles', () => {
  it('four tiles first, All figures for the rest; without ₹ the headline has no money tile', async () => {
    local.set('fm.planner.v1', {
      unitId: 'u_2', assignedOnly: false, showMoney: true,
      drafts: { u_2: { plan: { unitId: 'u_2', looms: [{ fabricId: 'f_crepe', groupId: 'lg1', looms: '12' }], sides: [{ yarnId: 'y_tpm75', typeId: 'tt1', sides: '6' }], receipts: [], settings: {}, soldAs: {} }, planId: null, name: '', date: '', savedSig: '' } },
    });
    await open('#/planner');
    await screen.findByRole('heading', { name: 'Planner' });
    const labels = () => [...document.querySelectorAll('.ptiles .tile .t-label')].map((x) => x.textContent);
    expect(labels()).toEqual(['Plant realisation', 'Plant profit', 'Net TPM balance', 'Looms planned']);
    // C7: Yarns short is the balance tile's second line, not a tile of its own
    expect(document.querySelector('.ptiles .t-second').textContent).toMatch(/of \d+ TPM yarns? short/);
    fireEvent.click(screen.getByRole('button', { name: /^All figures/ }));
    expect(labels().length).toBe(12);
    expect(labels()).not.toContain('Yarns short');
    fireEvent.click(screen.getByRole('button', { name: 'Fewer figures' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show revenue and ₹ figures' }));
    await waitFor(() => expect(labels()).toEqual(['Yarn used', 'Net TPM balance', 'Looms planned', 'Production']));
    // Clear plan is red and asks in the app
    const clear = screen.getByRole('button', { name: 'Clear plan' });
    expect(clear.classList.contains('danger')).toBe(true);
    fireEvent.click(clear);
    expect(await answer(false)).toBe('Clear the plan?');
  });
});

describe('laptop', () => {
  let orig;
  beforeAll(() => {
    orig = window.matchMedia;
    window.matchMedia = (q) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} });
  });
  afterAll(() => {
    window.matchMedia = orig;
  });

  it('B9, C8: no second Settings button in the top bar; the hint is in sentence case with the shortcuts', async () => {
    await open('#/fabrics');
    await screen.findByText('Fabric Database');
    expect(document.querySelector('.navbar button[aria-label="Settings"]')).toBeNull();
    const hint = document.querySelector('.list-meta .plain');
    expect(hint.textContent).toBe('Click a heading to sort. Press / to search, Ctrl+S to save a form.');
  });
});
