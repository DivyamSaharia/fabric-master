import { useEffect, useRef, useState } from 'preact/hooks';
import { backendMode, getIndex, getPhoto, refresh, useStore } from './store.js';
import { back, go, tab } from './router.js';

// Laptop layout from this width up; phones and narrow windows keep the iPhone layout.
export const WIDE_QUERY = '(min-width: 1024px)';
const wideMq = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(WIDE_QUERY) : null);

export function useWide() {
  const [wide, setWide] = useState(() => {
    const mq = wideMq();
    return mq ? mq.matches : false;
  });
  useEffect(() => {
    const mq = wideMq();
    if (!mq) return undefined;
    const f = () => setWide(mq.matches);
    f();
    if (mq.addEventListener) mq.addEventListener('change', f);
    else mq.addListener(f);
    return () => (mq.removeEventListener ? mq.removeEventListener('change', f) : mq.removeListener(f));
  }, []);
  return wide;
}

// ---------- icons (inline stroke SVG) ----------
const S = (props) => <svg width={props.size || 24} height={props.size || 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={props.w || 1.8} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{props.children}</svg>;
export const Icon = {
  back: (p) => <S {...p} w={2.2}><path d="M15 5l-7 7 7 7" /></S>,
  plus: (p) => <S {...p} w={2}><path d="M12 5v14M5 12h14" /></S>,
  gear: (p) => <S {...p}><circle cx="12" cy="12" r="3.2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></S>,
  filter: (p) => <S {...p}><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></S>,
  share: (p) => <S {...p}><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5" /><path d="M6 11H5v10h14V11h-1" /></S>,
  search: (p) => <S {...p} w={2.4}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></S>,
  chevron: (p) => <S {...p} w={3}><path d="M9 5l7 7-7 7" /></S>,
  close: (p) => <S {...p} w={3}><path d="M6 6l12 12M18 6L6 18" /></S>,
  check: (p) => <S {...p} w={2.6}><path d="M5 12.5l4.5 4.5L19 7.5" /></S>,
  camera: (p) => <S {...p}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></S>,
  trash: (p) => <S {...p}><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" /></S>,
  copy: (p) => <S {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></S>,
  pdf: (p) => <S {...p}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 13h6M9 17h6" /></S>,
  chat: (p) => <S {...p}><path d="M4 20l1.5-4.2A8 8 0 1 1 8.4 18.6z" /></S>,
  grid: (p) => <S {...p}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M4 15h16M10 4v16" /></S>,
  fabrics: (p) => <S {...p}><rect x="4" y="9" width="16" height="11" rx="2" /><path d="M6.5 6h11M9 3h6" /></S>,
  yarns: (p) => <S {...p}><path d="M9 3h6l3.5 18h-13z" /><path d="M7.8 9h8.4M6.8 14.5h10.4" /></S>,
  units: (p) => <S {...p}><path d="M3 21V11l5 3v-3l5 3v-3l5 3V4h3v17z" /></S>,
  ranking: (p) => <S {...p} w={2.2}><path d="M5 20v-8M12 20V5M19 20v-5" /></S>,
  refresh: (p) => <S {...p}><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" /></S>,
};

// ---------- layout ----------
// The phone's home screen shows the Hanuman logo and app name in place of the large title.
export function BrandHero() {
  return (
    <div class="brand-hero">
      <img src="./logo.svg" alt="Hanuman logo" width="56" height="56" />
      <div>
        <div class="bh-top">Hanuman</div>
        <h1>Fabric Database</h1>
      </div>
    </div>
  );
}

export function NavBar({ title, backLabel, backTo, onBack, left, right, large, hero }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const f = () => setScrolled(window.scrollY > (large ? 44 : 2));
    f();
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, [large]);
  const backBtn = backLabel ? (
    <button type="button" class="nav-back" onClick={onBack || (() => back(backTo || '/fabrics'))}>
      <Icon.back />
      <span>{backLabel}</span>
    </button>
  ) : null;
  return (
    <>
      <header class={`navbar ${scrolled ? 'scrolled' : ''}`}>
        <div class="nav-side">{left || backBtn}</div>
        <div class={`nav-title ${large && !scrolled ? 'hidden' : ''}`}>{title}</div>
        <div class="nav-side right">{right}</div>
      </header>
      {large ? hero || <h1 class="large-title">{title}</h1> : null}
    </>
  );
}

export const IconButton = ({ label, onClick, children, disabled }) => (
  <button type="button" class="icon-btn" aria-label={label} onClick={onClick} disabled={disabled}>
    {children}
  </button>
);

export const TextButton = ({ onClick, children, bold, disabled, danger }) => (
  <button type="button" class={`text-btn ${bold ? 'bold' : ''} ${danger ? 'danger' : ''}`} onClick={onClick} disabled={disabled}>
    {children}
  </button>
);

export function Section({ header, footer, children, flush }) {
  return (
    <section class="section">
      {header ? <h2 class="section-header">{header}</h2> : null}
      <div class={`group ${flush ? 'flush' : ''}`}>{children}</div>
      {footer ? <p class="section-footer">{footer}</p> : null}
    </section>
  );
}

export function Row({ label, sub, value, valueSub, onClick, chevron, strong, accent, danger, children }) {
  const inner = (
    <>
      <div class="row-main">
        <div class={`row-label ${strong ? 'strong' : ''} ${danger ? 'danger' : ''}`}>{label}</div>
        {sub ? <div class="row-sub">{sub}</div> : null}
        {children}
      </div>
      {value !== undefined || valueSub ? (
        <div class="row-value">
          <div class={`${strong ? 'strong' : ''} ${accent ? 'accent-text' : ''}`}>{value}</div>
          {valueSub ? <div class="row-sub">{valueSub}</div> : null}
        </div>
      ) : null}
      {chevron ? <span class="row-chevron"><Icon.chevron size={13} /></span> : null}
    </>
  );
  return onClick ? (
    <button type="button" class="row" onClick={onClick}>{inner}</button>
  ) : (
    <div class="row">{inner}</div>
  );
}

export function Field({ label, hint, value, onInput, type = 'text', inputmode, prefix, suffix, placeholder, required, autofocus }) {
  const ref = useRef(null);
  useEffect(() => {
    if (autofocus && ref.current) ref.current.focus();
  }, [autofocus]);
  return (
    <label class="row field">
      <span class="row-label">
        {label}
        {required ? <span class="req"> *</span> : null}
        {hint ? <span class="hint"> {hint}</span> : null}
      </span>
      <span class="field-input">
        {prefix ? <span class="affix">{prefix}</span> : null}
        <input
          ref={ref}
          class={prefix || suffix ? 'num' : undefined}
          size={prefix || suffix ? Math.max(2, String(value ?? '').length, String(placeholder || '').length) : undefined}
          type={type}
          inputmode={inputmode}
          value={value ?? ''}
          placeholder={placeholder}
          onInput={(e) => onInput(e.currentTarget.value)}
          aria-label={label}
        />
        {suffix ? <span class="affix">{suffix}</span> : null}
      </span>
    </label>
  );
}

export const NumField = (props) => <Field {...props} inputmode="decimal" />;

export function SelectField({ label, value, onChange, options, placeholder = 'Choose', required }) {
  return (
    <label class="row field">
      <span class="row-label">
        {label}
        {required ? <span class="req"> *</span> : null}
      </span>
      <span class="field-input select">
        <select value={value ?? ''} onChange={(e) => onChange(e.currentTarget.value)} aria-label={label}>
          <option value="">{placeholder}</option>
          {options.map((o) =>
            o.group ? (
              <optgroup label={o.group}>{o.options.map((x) => <option value={x.value}>{x.label}</option>)}</optgroup>
            ) : (
              <option value={o.value}>{o.label}</option>
            ),
          )}
        </select>
        <Icon.chevron size={12} />
      </span>
    </label>
  );
}

export function Segmented({ options, value, onChange, small, label }) {
  return (
    <div class={`segmented ${small ? 'small' : ''}`} role="group" aria-label={label}>
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return (
          <button type="button" aria-pressed={value === v ? 'true' : 'false'} class={value === v ? 'on' : ''} onClick={() => onChange(v)}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ label, value, onChange }) {
  return (
    <div class="row">
      <div class="row-main"><div class="row-label">{label}</div></div>
      <button type="button" class={`switch ${value ? 'on' : ''}`} aria-pressed={value ? 'true' : 'false'} aria-label={label} onClick={() => onChange(!value)}>
        <span />
      </button>
    </div>
  );
}

export const Badge = ({ kind = 'gray', children }) => <span class={`badge ${kind}`}>{children}</span>;

export function classBadge(tfoClass) {
  return <Badge kind={tfoClass === 'Non-TPM' ? 'gray' : 'amber'}>{tfoClass}</Badge>;
}

export function Chip({ on, onClick, children }) {
  return (
    <button type="button" class={`chip ${on ? 'on' : ''}`} aria-pressed={on ? 'true' : 'false'} onClick={onClick}>
      {children}
    </button>
  );
}

export function Sheet({ open, onClose, title, children, footer }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape' && closeRef.current) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  if (!open) return null;
  return (
    <div class="sheet-layer">
      <button type="button" class="sheet-backdrop" aria-label="Close" onClick={onClose} />
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div class="grabber" aria-hidden="true" />
        <div class="sheet-head">
          <h2>{title}</h2>
          <button type="button" class="close-btn" aria-label="Close" onClick={onClose}>
            <span><Icon.close size={13} /></span>
          </button>
        </div>
        <div class="sheet-body">{children}</div>
        {footer ? <div class="sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export const Button = ({ onClick, children, kind = 'primary', disabled, busy }) => (
  <button type="button" class={`btn ${kind}`} onClick={onClick} disabled={disabled || busy}>
    {busy ? <span class="spinner" aria-hidden="true" /> : null}
    {children}
  </button>
);

const TABS = [
  { id: 'fabrics', label: 'Fabrics', icon: Icon.fabrics },
  { id: 'yarns', label: 'Yarns', icon: Icon.yarns },
  { id: 'units', label: 'Units', icon: Icon.units },
  { id: 'ranking', label: 'Ranking', icon: Icon.ranking },
];

function syncText(st) {
  if (st.syncing) return 'Syncing…';
  const at = st.status.lastSync ? new Date(st.status.lastSync) : null;
  if (!at || Number.isNaN(at.getTime())) return st.status.loading ? 'Loading…' : 'Not synced yet';
  const sameDay = at.toDateString() === new Date().toDateString();
  const time = at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `Synced ${sameDay ? time : `${at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`}`;
}

// Laptop navigation: replaces the bottom tab bar on wide screens.
export function Sidebar({ active, settingsOpen }) {
  const st = useStore();
  const idx = getIndex();
  const counts = {
    fabrics: Object.keys(idx.fabricsById).length,
    yarns: Object.keys(idx.yarnsById).length,
    units: Object.keys(idx.unitsById).length,
  };
  const demo = backendMode() === 'demo';
  return (
    <aside class="sidebar" aria-label="Sections">
      <div class="sb-brand">
        <img class="sb-logo" src="./logo.svg" alt="Hanuman logo" width="46" height="46" />
        <div class="sb-name">
          <div class="sb-name-top">Hanuman</div>
          <div class="sb-name-main">Fabric Database</div>
        </div>
      </div>
      <nav class="sb-nav">
        {TABS.map((t) => (
          <button type="button" class={`sb-item ${active === t.id && !settingsOpen ? 'on' : ''}`} aria-current={active === t.id && !settingsOpen ? 'page' : undefined} onClick={() => tab(`/${t.id}`)}>
            <t.icon size={20} />
            <span class="sb-label">{t.label}</span>
            {counts[t.id] !== undefined ? <span class="sb-count">{counts[t.id]}</span> : null}
          </button>
        ))}
      </nav>
      <div class="sb-foot">
        <button type="button" class={`sb-item ${settingsOpen ? 'on' : ''}`} onClick={() => go('/settings')}>
          <Icon.gear size={20} />
          <span class="sb-label">Settings</span>
        </button>
        <div class={`sb-sync ${st.status.error ? 'error' : ''}`}>
          <div class="sb-sync-text">
            <div>{demo ? 'Demo data on this device' : 'Google Sheet'}</div>
            <div class="sb-sync-sub">{st.status.error ? 'Last sync failed' : demo ? 'Connect your Sheet in Settings' : syncText(st)}</div>
          </div>
          <button type="button" class="icon-btn" aria-label="Reload from the Sheet" onClick={() => refresh()} disabled={st.syncing}>
            {st.syncing ? <span class="spinner" aria-hidden="true" /> : <Icon.refresh size={20} />}
          </button>
        </div>
      </div>
    </aside>
  );
}

export function TabBar({ active }) {
  return (
    <nav class="tabbar" aria-label="Tabs">
      {TABS.map((t) => (
        <button type="button" class={active === t.id ? 'on' : ''} aria-current={active === t.id ? 'page' : undefined} onClick={() => tab(`/${t.id}`)}>
          <t.icon size={26} />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

// Woven swatch placeholder, colour picked from the id so each fabric keeps its own.
const SWATCH = ['#D8CDBE', '#E3C6C9', '#9AA6B2', '#A8AE8C', '#8FB3AE', '#C9B79C', '#B4A7C6', '#C7D3DD'];
export function Swatch({ seed = '', size = 56, radius = 10 }) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return <div class="swatch" aria-hidden="true" style={{ width: size === '100%' ? '100%' : `${size}px`, height: size === '100%' ? '100%' : `${size}px`, borderRadius: `${radius}px`, backgroundColor: SWATCH[h % SWATCH.length] }} />;
}

export function PhotoImg({ photo, size = 'thumb', alt, class: cls }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    if (photo) getPhoto(photo, size).then((s) => live && setSrc(s)).catch(() => {});
    return () => {
      live = false;
    };
  }, [photo && photo.id, size]);
  if (!src) return <Swatch seed={photo ? photo.fabric_id : ''} size="100%" radius={0} />;
  return <img class={cls} src={src} alt={alt || ''} />;
}

export function Empty({ title, text, action }) {
  return (
    <div class="empty">
      <div class="empty-title">{title}</div>
      {text ? <div class="empty-text">{text}</div> : null}
      {action || null}
    </div>
  );
}

export function SearchBox({ value, onInput, placeholder }) {
  return (
    <label class="search">
      <Icon.search size={16} />
      <input type="search" data-search value={value} placeholder={placeholder} aria-label={placeholder} onInput={(e) => onInput(e.currentTarget.value)} />
    </label>
  );
}
