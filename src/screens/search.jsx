// The app's one search (1.27.0), like the CFM dashboard's. Laptop: a box under the logo in the side menu, results
// drop below it. Phone: a full-screen sheet from the search button in the top bar. Keys: / or Ctrl/⌘ K opens it,
// ↑ ↓ move, Enter opens, Esc clears and then closes. Empty, it shows Favourites and Recent.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { getIndex, useStore } from '../store.js';
import { go, parse } from '../router.js';
import { buildSearchIndex, favourites, notePlace, recentPlaces, searchPlaces } from '../search.js';
import { Icon, openSection, useWide } from '../ui.jsx';

const currentFabric = () => {
  const r = parse(typeof location !== 'undefined' ? location.hash : '');
  return r.path[0] === 'fabric' && r.path[1] && r.path[1] !== 'new' && !r.path[2] ? r.path[1] : null;
};

// Open a place: its screen, then (for a fabric section) open and scroll to the section.
export function openPlace(it) {
  if (!it) return;
  if (it.search) return;
  notePlace(it);
  const here = `#${it.go}` === location.hash;
  if (!here) go(it.go);
  if (it.section) {
    const tryScroll = (n) => {
      const el = document.getElementById(it.section);
      if (!el) {
        if (n < 20) setTimeout(() => tryScroll(n + 1), 50);
        return;
      }
      openSection(it.section);
      requestAnimationFrame(() => {
        const h = document.querySelector('.navbar');
        const top = el.getBoundingClientRect().top + window.scrollY - (h ? h.offsetHeight : 0) - 6;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
      });
    };
    tryScroll(0);
  }
}

function ResultRow({ it, on, onPick, onHover, compact }) {
  if (compact) {
    return (
      <button type="button" class={`gs-row compact${on ? ' on' : ''}`} aria-selected={on ? 'true' : 'false'} role="option" onMouseDown={(e) => e.preventDefault()} onClick={onPick} onMouseEnter={onHover}>
        <span class="gs-main">
          <span class="gs-label">{it.label}</span>
          <span class="gs-sub">{[it.kind, it.sub].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
    );
  }
  return (
    <button type="button" class={`gs-row${on ? ' on' : ''}`} aria-selected={on ? 'true' : 'false'} role="option" onMouseDown={(e) => e.preventDefault()} onClick={onPick} onMouseEnter={onHover}>
      <span class="gs-main">
        <span class="gs-label">{it.label}</span>
        {it.sub ? <span class="gs-sub">{it.sub}</span> : null}
      </span>
      <span class="gs-kind">{it.kind}</span>
    </button>
  );
}

// The box and its results; used in the side menu and in the phone sheet.
function SearchPanel({ text, setText, onDone, autofocus, inputRef, compact }) {
  useStore();
  const idx = getIndex();
  const fabricId = currentFabric();
  const items = useMemo(() => buildSearchIndex(idx, fabricId), [idx, fabricId]);
  const results = text.trim() ? searchPlaces(items, text) : [];
  const [sel, setSel] = useState(-1);
  const [favOpen, setFavOpen] = useState(false);
  useEffect(() => setSel(-1), [text]);
  const fav = text.trim() ? [] : favourites();
  const rec = text.trim() ? [] : recentPlaces();
  const rows = text.trim() ? results : [...(favOpen ? fav : []), ...rec];
  const pick = (it) => {
    if (!it) return;
    if (it.search) {
      setText(it.search);
      return;
    }
    if (text.trim()) notePlace({ id: `q:${text.trim().toLowerCase()}`, kind: 'Search', label: text.trim(), sub: 'search again', search: text.trim() });
    openPlace(it);
    setText('');
    onDone();
  };
  function onKey(e) {
    if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); setSel((s) => (s + 1) % rows.length); }
    else if (e.key === 'ArrowUp' && rows.length) { e.preventDefault(); setSel((s) => (s - 1 + rows.length) % rows.length); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows.length) pick(rows[sel < 0 ? 0 : sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (text) setText(''); else onDone(true); }
  }
  let i = -1;
  const row = (it) => {
    i += 1;
    const k = i;
    return <ResultRow it={it} compact={compact} on={k === sel} onPick={() => pick(it)} onHover={() => setSel(k)} />;
  };
  return (
    <div class="gs-panel">
      <label class="gs-box">
        <Icon.search size={16} />
        <input
          ref={inputRef}
          type="search"
          value={text}
          autofocus={autofocus}
          placeholder={compact ? 'Search' : 'Search fabrics, yarns, screens'}
          aria-label="Search the app"
          role="combobox"
          aria-expanded={rows.length ? 'true' : 'false'}
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={onKey}
        />
      </label>
      <div class="gs-results" role="listbox" aria-label="Search results">
        {text.trim() ? (
          results.length ? results.map(row) : <div class="gs-none">Nothing found for “{text.trim()}”. Try fewer letters, or a yarn count like 75d.</div>
        ) : (
          <>
            <button type="button" class="gs-head gs-fold" aria-expanded={favOpen ? 'true' : 'false'} onMouseDown={(e) => e.preventDefault()} onClick={() => setFavOpen(!favOpen)}>
              Favourites <span class="gs-fold-mark">{favOpen ? 'Hide' : `Show${fav.length ? ` ${fav.length}` : ''}`}</span>
            </button>
            {favOpen ? (fav.length ? fav.map(row) : <div class="gs-none">None yet. The 5 places you open most over 30 days show here.</div>) : null}
            <div class="gs-head">Recent</div>
            {rec.length ? rec.map(row) : <div class="gs-none">Nothing yet. Places you open show here.</div>}
            {compact ? <div class="gs-keys">Keys: 1–5 open the tabs · / or Ctrl K (⌘ K on a Mac) opens this search · g then f finds a fabric, g then y a yarn · Esc closes</div> : null}
          </>
        )}
      </div>
    </div>
  );
}

// Laptop: in the side menu, under the logo. Results show while the box has focus.
export function SidebarSearch() {
  const [text, setText] = useState('');
  const [focus, setFocus] = useState(false);
  const ref = useRef(null);
  const box = useRef(null);
  useEffect(() => {
    const f = (e) => {
      setText(e.detail || '');
      setFocus(true);
      requestAnimationFrame(() => ref.current && ref.current.focus());
    };
    window.addEventListener('fm-open-search', f);
    const el = box.current;
    const fin = () => setFocus(true);
    const fout = (e) => { if (!el.contains(e.relatedTarget)) setFocus(false); };
    el.addEventListener('focusin', fin);
    el.addEventListener('focusout', fout);
    return () => {
      window.removeEventListener('fm-open-search', f);
      el.removeEventListener('focusin', fin);
      el.removeEventListener('focusout', fout);
    };
  }, []);
  return (
    <div ref={box} class={`sb-search${focus ? ' open' : ''}`}>
      <SearchPanel compact text={text} setText={setText} inputRef={ref} onDone={() => { setFocus(false); if (ref.current) ref.current.blur(); }} />
    </div>
  );
}

// Phone: a full-screen sheet.
export function SearchSheet() {
  const wide = useWide();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (wide) return undefined;
    const f = (e) => {
      setText(e.detail || '');
      setOpen(true);
    };
    window.addEventListener('fm-open-search', f);
    return () => window.removeEventListener('fm-open-search', f);
  }, [wide]);
  useEffect(() => {
    if (open) requestAnimationFrame(() => ref.current && ref.current.focus());
  }, [open]);
  if (!open || wide) return null;
  return (
    <div class="gs-sheet" role="dialog" aria-modal="true" aria-label="Search">
      <div class="gs-sheet-head">
        <span class="gs-sheet-title">Search</span>
        <button type="button" class="text-btn bold" onClick={() => setOpen(false)}>Done</button>
      </div>
      <SearchPanel text={text} setText={setText} inputRef={ref} onDone={() => setOpen(false)} />
    </div>
  );
}
