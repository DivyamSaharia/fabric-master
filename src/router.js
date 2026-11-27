import { useEffect, useRef, useState } from 'preact/hooks';
import { askConfirm } from './confirm.js';
import { dropSheetEntry } from './sheetHistory.js';

let depth = 0;

// ---------- leaving a form with unsaved changes ----------
// An editor sets a guard while it is open. Cancel, Back, a tab, or the phone's back gesture then asks first,
// in the app's own confirm sheet. "Discard" goes on with the move that was stopped (retry).
let guard = null; // { ok(): true when there is nothing to lose, allow(): stop asking, message }
let ours = false; // the next hashchange comes from go / back / replace, already asked
let skipNext = false; // the next hashchange is us undoing a back gesture the person cancelled

function mayLeave(retry) {
  if (!guard) return true;
  if (guard.ok()) {
    guard = null;
    return true;
  }
  const g = guard;
  // noHistory: this sheet opens while a back gesture is being undone (history.forward below), so it adds no history entry
  askConfirm({ title: g.message, text: 'What you changed on this form is not saved yet.', yes: 'Discard changes', no: 'Keep editing', danger: true, noHistory: true }).then((yes) => {
    if (!yes) return;
    g.allow();
    if (guard === g) guard = null;
    if (retry) retry();
  });
  return false;
}

if (typeof window !== 'undefined') {
  // registered when this module loads, so it runs before the screen's own listener and can stop it
  window.addEventListener('hashchange', (e) => {
    if (skipNext) {
      skipNext = false;
      e.stopImmediatePropagation();
      return;
    }
    if (ours) {
      ours = false;
      return;
    }
    if (!mayLeave(() => {
      ours = true;
      history.back();
    })) {
      // back gesture or browser Back while the form has changes: stay on the form while the sheet asks
      skipNext = true;
      e.stopImmediatePropagation();
      history.forward();
    }
  });
}

// isDirty: true while the form differs from what it opened with. Returns allow(): call it just before leaving after
// a successful save, so the question isn't asked.
export function useLeaveGuard(isDirty, message = 'Discard changes?') {
  const dirty = useRef(isDirty);
  const allowed = useRef(false);
  dirty.current = isDirty;
  useEffect(() => {
    const g = { ok: () => allowed.current || !dirty.current, allow: () => { allowed.current = true; }, message };
    guard = g;
    const onUnload = (e) => {
      if (!allowed.current && dirty.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      if (guard === g) guard = null;
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);
  return () => {
    allowed.current = true;
  };
}

export function parse(hash) {
  const raw = (hash || '').replace(/^#\/?/, '');
  const [p, q = ''] = raw.split('?');
  const path = p.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(q));
  return { path: path.length ? path : ['fabrics'], query };
}

export function useRoute() {
  const [hash, setHash] = useState(typeof location !== 'undefined' ? location.hash : '');
  useEffect(() => {
    const f = () => setHash(location.hash);
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return parse(hash);
}

export function go(path) {
  if (!mayLeave(() => go(path))) return;
  const next = path.startsWith('/') ? path : `/${path}`;
  depth += 1;
  if (location.hash !== `#${next}`) ours = true;
  location.hash = next;
  window.scrollTo(0, 0);
}

export function replace(path) {
  if (!mayLeave(() => replace(path))) return;
  const url = `${location.pathname}${location.search}#${path.startsWith('/') ? path : `/${path}`}`;
  // a pop-up's history entry on top is taken off first, so the page's own entry is the one replaced (sheetHistory.js)
  dropSheetEntry(() => {
    history.replaceState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    window.scrollTo(0, 0);
  });
}

export function back(fallback) {
  if (!mayLeave(() => back(fallback))) return;
  if (depth > 0) {
    depth -= 1;
    dropSheetEntry(() => {
      ours = true;
      history.back();
    });
  } else {
    replace(fallback);
  }
}

// Switching tabs resets the stack.
export function tab(path) {
  if (!mayLeave(() => tab(path))) return;
  depth = 0;
  replace(path);
}
