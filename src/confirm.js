// One in-app confirm sheet for the whole app (audit B10), in place of the browser's own pop-up.
// askConfirm({ title, text, yes, no, danger }) resolves true when the person taps the yes button.
// noHistory: the sheet adds no history entry (only the router's unsaved-changes question; see sheetHistory.js).
// ConfirmHost (ui.jsx) draws it; it lives here so the router can ask too without importing screens.
let current = null;
const subs = new Set();
const emit = () => subs.forEach((f) => f());

export function askConfirm(opts) {
  return new Promise((resolve) => {
    if (current) current.resolve(false);
    current = { no: 'Cancel', ...opts, resolve };
    emit();
  });
}

export function answerConfirm(yes) {
  const c = current;
  current = null;
  emit();
  if (c) c.resolve(!!yes);
}

export const confirmState = () => current;

export function onConfirm(f) {
  subs.add(f);
  return () => subs.delete(f);
}
