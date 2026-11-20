// 1.24.0 bug fixes (audit A1, A5, A6, B8) with demo data.
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/preact';
import { App } from './app.jsx';
import { answer, confirmOpen } from './testUtil.js';
import { resetListState } from './listState.js';
import { resetDemo } from './store.js';
import { local } from './storage.js';
import { partOf } from './screens/planner.jsx';

beforeAll(() => {
  window.scrollTo = () => {};
});

beforeEach(async () => {
  cleanup();
  localStorage.clear();
  resetListState();
  window.confirm = () => true;
});

async function open(hash) {
  window.location.hash = hash;
  render(<App />);
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

describe('A1: Cancel asks before throwing away changes', () => {
  it('fabric editor: no question without changes; with changes, "stay" keeps the form and "discard" leaves', async () => {
    await open('#/fabric/f_crepe/edit');
    const name = await screen.findByLabelText('Quality name');
    fireEvent.input(name, { target: { value: 'Poly Crepe Changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    // the app's own sheet asks (1.26.0, B10); Keep editing stays
    expect(await answer(false)).toBe('Discard changes?');
    expect(screen.getByLabelText('Quality name').value).toBe('Poly Crepe Changed');
    // typing it back as it was: nothing to lose, no question
    fireEvent.input(screen.getByLabelText('Quality name'), { target: { value: 'Poly Crepe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirmOpen()).toBe(false);
    await waitFor(() => expect(screen.queryByLabelText('Quality name')).toBeNull());
  });

  it('fabric editor: discarding leaves, and saving never asks', async () => {
    await open('#/fabric/f_crepe/edit');
    fireEvent.input(await screen.findByLabelText('Quality name'), { target: { value: 'Poly Crepe X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await answer(true);
    await waitFor(() => expect(screen.queryByLabelText('Quality name')).toBeNull());
    cleanup();
    await open('#/fabric/f_crepe/edit');
    fireEvent.input(await screen.findByLabelText('Quality name'), { target: { value: 'Poly Crepe Saved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByLabelText('Quality name')).toBeNull());
    expect(confirmOpen()).toBe(false);
    await resetDemo();
  });

  it('the back gesture asks too, and staying keeps the form', async () => {
    await open('#/fabric/f_crepe');
    await screen.findByText('Poly Crepe 60 (RFD)', { selector: '.nav-title' }).catch(() => null);
    window.location.hash = '#/fabric/f_crepe/edit';
    fireEvent.input(await screen.findByLabelText('Quality name'), { target: { value: 'Gesture test' } });
    window.location.hash = '#/fabric/f_crepe'; // what a back gesture does to the address
    expect(await answer(false)).toBe('Discard changes?');
    expect(screen.getByLabelText('Quality name').value).toBe('Gesture test');
  });

  it('yarn and unit editors ask as well', async () => {
    await open('#/yarn/y_fdy75');
    const fields = await screen.findAllByRole('textbox');
    fireEvent.input(fields[0], { target: { value: 'Changed yarn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await answer(false)).toBe('Discard changes?');
    cleanup();
    await open('#/unit/u_2/edit');
    const unitFields = await screen.findAllByRole('textbox');
    fireEvent.input(unitFields[0], { target: { value: 'Changed unit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await answer(false)).toBe('Discard changes?');
  });
});

describe('A5, B8: small fixes', () => {
  it('Production centre note no longer mentions "all" figures', async () => {
    await open('#/fabric/f_crepe');
    await screen.findByText('Production centre');
    expect(document.body.textContent).not.toContain("'all' is for every loom");
  });

  it('icon buttons show their name on hover', async () => {
    await open('#/fabrics');
    await screen.findByText('Poly Crepe 60 (RFD)');
    const icons = [...document.querySelectorAll('button.icon-btn')];
    expect(icons.length).toBeGreaterThan(2);
    for (const b of icons) expect(b.getAttribute('title')).toBe(b.getAttribute('aria-label'));
  });
});

describe('A6: Planner tiles say when they cover only part of the plan', () => {
  it('partOf', () => {
    expect(partOf(12, 40)).toBe('12 of 40 looms');
    expect(partOf(40, 40)).toBe('');
    expect(partOf(0, 0)).toBe('');
  });

  it('the note comes before the tiles, and partial tiles say "10 of 20 looms"', async () => {
    await resetDemo();
    local.remove('fm.planner.v1');
    await open('#/planner');
    await screen.findByRole('heading', { name: 'Planner' });
    const add = async (group, name) => {
      fireEvent.click(screen.getByRole('button', { name: `Add a quality to ${group}` }));
      fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name.replace(/[()]/g, '\\$&')}`) }));
    };
    await add('190 cm Dobby', 'Poly Crepe 60 (RFD)');
    fireEvent.input(screen.getByLabelText('Looms Poly Crepe 60 (RFD) 190 cm Dobby'), { target: { value: '10' } });
    await add('280 cm Plain', 'Poly Crepe 60 (RFD)'); // no 280 cm RPM in master
    fireEvent.input(screen.getByLabelText('Looms Poly Crepe 60 (RFD) 280 cm Plain'), { target: { value: '10' } });
    await screen.findByText(/Enter the loom RPM for Poly Crepe 60 \(RFD\) on 280 cm Plain/);
    const note = document.querySelector('.notice');
    const tiles = document.querySelector('.ptiles');
    expect(note.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the four headline tiles: three of them cover only part of the plan; All figures shows the rest (B3)
    expect(document.querySelectorAll('.ptiles .t-part').length).toBe(3);
    fireEvent.click(screen.getByRole('button', { name: /^All figures/ }));
    const parts = [...document.querySelectorAll('.ptiles .t-part')];
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.every((p) => p.textContent === '10 of 20 looms')).toBe(true);
    const realTile = [...document.querySelectorAll('.ptiles .tile')].find((t) => t.textContent.startsWith('Plant realisation'));
    expect(realTile.querySelector('.t-part').textContent).toBe('10 of 20 looms');
    const loomsTile = [...document.querySelectorAll('.ptiles .tile')].find((t) => t.textContent.startsWith('Looms planned'));
    expect(loomsTile.querySelector('.t-part')).toBeNull();
    // entering the RPM covers every loom: the amber lines go
    fireEvent.input(screen.getByLabelText('RPM Poly Crepe 60 (RFD) 280 cm Plain'), { target: { value: '650' } });
    await waitFor(() => expect(document.querySelectorAll('.ptiles .t-part').length).toBe(0));
  });
});
