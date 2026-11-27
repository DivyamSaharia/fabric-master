// 1.35.0: the back gesture closes the open sheet; a sheet closed another way leaves a spent entry that the next
// sheet reuses. (Real-browser runs of the gesture, the pass-through and the pull-down are in the release notes.)
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { Sheet, ConfirmHost } from './ui.jsx';
import { askConfirm } from './confirm.js';
import { _sheetHistory } from './sheetHistory.js';

function Demo() {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setA(true)}>open a</button>
      <Sheet open={a} onClose={() => setA(false)} title="A">
        <button type="button" onClick={() => setB(true)}>open b</button>
        <Sheet open={b} onClose={() => setB(false)} title="B"><p>inner</p></Sheet>
      </Sheet>
      <ConfirmHost />
    </div>
  );
}

const popped = () => new Promise((r) => window.addEventListener('popstate', () => setTimeout(r, 0), { once: true }));
const sheets = () => screen.queryAllByRole('dialog').map((d) => d.getAttribute('aria-label'));

beforeEach(() => {
  cleanup();
  history.replaceState(null, '');
  _sheetHistory.reset();
});

describe('sheet history', () => {
  it('opening adds one entry; back closes the sheet', async () => {
    render(<Demo />);
    const n = history.length;
    fireEvent.click(screen.getByText('open a'));
    await waitFor(() => expect(sheets()).toEqual(['A']));
    expect(history.length).toBe(n + 1);
    expect(history.state.fmSheet).toBeTruthy();
    const p = popped();
    history.back();
    await p;
    await waitFor(() => expect(sheets()).toEqual([]));
    expect(history.state).toBeNull();
  });
  it('closed with ✕ the entry stays as spent and the next sheet reuses it', async () => {
    render(<Demo />);
    fireEvent.click(screen.getByText('open a'));
    await waitFor(() => expect(_sheetHistory.open).toHaveLength(1));
    const n = history.length;
    const first = history.state.fmSheet;
    fireEvent.click(screen.getAllByLabelText('Close')[1]);
    await waitFor(() => expect(sheets()).toEqual([]));
    expect(history.state.fmSheet).toBe(first);
    expect(_sheetHistory.open).toHaveLength(0);
    fireEvent.click(screen.getByText('open a'));
    await waitFor(() => expect(sheets()).toEqual(['A']));
    expect(history.length).toBe(n);
    expect(history.state.fmSheet).not.toBe(first);
  });
  it('two sheets: back closes the top one only, then the other', async () => {
    render(<Demo />);
    fireEvent.click(screen.getByText('open a'));
    await waitFor(() => expect(sheets()).toEqual(['A']));
    fireEvent.click(screen.getByText('open b'));
    await waitFor(() => expect(sheets()).toEqual(['A', 'B']));
    await waitFor(() => expect(_sheetHistory.open).toHaveLength(2));
    let p = popped();
    history.back();
    await p;
    await waitFor(() => expect(sheets()).toEqual(['A']));
    p = popped();
    history.back();
    await p;
    await waitFor(() => expect(sheets()).toEqual([]));
  });
  it('a confirm over a sheet: back answers no and the sheet under it stays', async () => {
    render(<Demo />);
    fireEvent.click(screen.getByText('open a'));
    await waitFor(() => expect(_sheetHistory.open).toHaveLength(1));
    const ans = askConfirm({ title: 'Sure?', yes: 'Yes' });
    await waitFor(() => expect(sheets()).toEqual(['A', 'Sure?']));
    await waitFor(() => expect(_sheetHistory.open).toHaveLength(2)); // its entry is added just after it shows
    const p = popped();
    history.back();
    await p;
    expect(await ans).toBe(false);
    await waitFor(() => expect(sheets()).toEqual(['A']));
  });
  it('the unsaved-changes question adds no entry; back while it is over a sheet answers no and keeps the sheet', async () => {
    render(<Demo />);
    fireEvent.click(screen.getByText('open a'));
    await waitFor(() => expect(_sheetHistory.open).toHaveLength(1));
    const n = history.length;
    const mine = history.state.fmSheet;
    const ans = askConfirm({ title: 'Discard changes?', yes: 'Discard', noHistory: true });
    await waitFor(() => expect(sheets()).toEqual(['A', 'Discard changes?']));
    await new Promise((r) => setTimeout(r, 40)); // the sheet registers itself just after it shows
    expect(history.length).toBe(n);
    const p = popped();
    history.back();
    await p;
    expect(await ans).toBe(false);
    await waitFor(() => expect(sheets()).toEqual(['A']));
    expect(history.state.fmSheet).toBe(mine);
  });
});
