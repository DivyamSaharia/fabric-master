import { useEffect, useState } from 'preact/hooks';

let depth = 0;

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
  depth += 1;
  location.hash = path.startsWith('/') ? path : `/${path}`;
  window.scrollTo(0, 0);
}

export function replace(path) {
  const url = `${location.pathname}${location.search}#${path.startsWith('/') ? path : `/${path}`}`;
  history.replaceState(null, '', url);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  window.scrollTo(0, 0);
}

export function back(fallback) {
  if (depth > 0) {
    depth -= 1;
    history.back();
  } else {
    replace(fallback);
  }
}

// Switching tabs resets the stack.
export function tab(path) {
  depth = 0;
  replace(path);
}
