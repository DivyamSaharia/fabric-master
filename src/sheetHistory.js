// The phone's back gesture (or the browser's Back) closes the open pop-up sheet instead of leaving the page (1.35.0).
// Opening a sheet adds one history entry on the same address. Back removes that entry and the sheet closes.
// A sheet closed any other way (✕, Done, a tap outside, a swipe down, Esc) leaves its entry behind as "spent":
// nothing is undone at that moment, so nothing can race with the next sheet or the next page. The next sheet
// reuses a spent entry, and a back gesture that lands on one is passed straight on, so no gesture is ever wasted.
// The confirm sheet has an entry like any other, so back answers it "no". Only the router's unsaved-changes
// question opens with history={false} (it appears while a back gesture is being undone); back while it is on top
// of a sheet answers it "no" as well.

const open = []; // sheets that own a history entry, oldest first: { id, close() }
let seq = 0;
let ready = false;
let lastTop = null; // the sheet id on the history entry we are on (null on an ordinary entry)
let lastHash = '';
let topOther = null; // set by ui.jsx: () => close() of a history={false} sheet when one is on top, else null

const hasWindow = () => typeof window !== 'undefined' && typeof history !== 'undefined';
const top = () => {
  try {
    const s = history.state;
    return s && s.fmSheet ? s.fmSheet : null;
  } catch {
    return null;
  }
};
const put = (how, id) => {
  try {
    history[how]({ fmSheet: id }, '');
    lastTop = id;
    lastHash = location.hash;
    return true;
  } catch {
    return false; // history not available (very old browser, a locked-down frame): sheets still work without it
  }
};

function onPop() {
  const was = lastTop;
  const s = top();
  lastTop = s;
  const moved = location.hash !== lastHash;
  lastHash = location.hash;
  // A sheet's entry shares its page's address, so stepping back off one never changes the address. If the address
  // changed, this is ordinary navigation (a new page, or back onto a spent entry): the router handles it.
  if (moved) return;
  if (was === null) return; // left an ordinary entry
  const other = topOther ? topOther() : null;
  if (other) {
    // a confirm sheet is on top: back answers it "no", and the entry that was left is put back
    put('pushState', was);
    other();
    return;
  }
  const at = open.findIndex((x) => x.id === s);
  const popped = at >= 0 ? open.slice(at + 1) : open.slice();
  if (popped.length) {
    for (const x of popped.reverse()) shut(x);
    return;
  }
  if (at >= 0) {
    // a spent entry above an open sheet went: the gesture closes that sheet (its own entry becomes the spent one)
    shut(open[at], true);
    return;
  }
  // a spent entry with nothing open: pass the gesture on to the page
  history.back();
}

function shut(x, keepEntry) {
  if (!x.close) {
    // the sheet can't close right now (it is saving): give it its entry back
    if (!keepEntry) put('pushState', x.id);
    return;
  }
  const i = open.indexOf(x);
  if (i >= 0) open.splice(i, 1);
  x.close();
}

function start() {
  if (ready || !hasWindow()) return;
  ready = true;
  lastTop = top();
  lastHash = location.hash;
  window.addEventListener('popstate', onPop);
  window.addEventListener('hashchange', () => { lastTop = top(); lastHash = location.hash; });
}

// from the first moment, so a spent entry left by a reload (a sheet was open) is passed over too
start();

export function setTopOther(fn) {
  topOther = fn;
}

// A sheet opened: returns its handle. getClose() gives the sheet's current onClose (or nothing while it can't close).
export function sheetOpened(getClose) {
  if (!hasWindow()) return null;
  start();
  seq += 1;
  const me = { id: `${Date.now().toString(36)}${seq}`, get close() { return getClose(); } };
  const t = top();
  const spent = t !== null && !open.some((x) => x.id === t);
  if (!put(spent ? 'replaceState' : 'pushState', me.id)) return null;
  open.push(me);
  return me;
}

// A sheet closed (any way). Its entry, if still there, stays as a spent one.
export function sheetClosed(me) {
  if (!me) return;
  const i = open.indexOf(me);
  if (i >= 0) open.splice(i, 1);
}

// tests
export const _sheetHistory = { open, top, reset: () => { open.length = 0; lastTop = top(); lastHash = location.hash; } };
