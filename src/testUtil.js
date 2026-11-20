// Test helpers for the app's own confirm sheet (1.26.0: it replaced window.confirm).
import { expect } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/preact';

const sheetButtons = () => document.querySelectorAll('.confirm-btns .btn');

// Waits for the confirm sheet, returns its title, then taps yes (the first button) or no.
export async function answer(yes = true) {
  await waitFor(() => expect(sheetButtons().length).toBe(2));
  const title = document.querySelector('.sheet[role="dialog"] .sheet-head h2:not(:empty)');
  const all = [...document.querySelectorAll('.sheet')];
  const host = all.find((s) => s.querySelector('.confirm-btns'));
  const t = host ? host.querySelector('.sheet-head h2').textContent : title ? title.textContent : '';
  fireEvent.click(sheetButtons()[yes ? 0 : 1]);
  return t;
}

export const confirmOpen = () => sheetButtons().length === 2;
