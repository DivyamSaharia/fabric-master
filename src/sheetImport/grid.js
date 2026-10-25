// Planning sheet photo → table grid. Pure functions over RGBA pixels ({ width, height, data }), so they run the same
// in the browser (canvas ImageData) and in tests (pngjs). No OCR here: this finds the ruled lines, splits the table
// into rows and cells, tells merged rows (SIZE 190 / SIZE 280) and pink rows (header, sizes, totals) from data rows,
// and prepares each cell as a clean black-on-white image for the OCR engine.

const DARK = 110; // a ruled line pixel (grid lines are near black; red text is lighter than this on average)

const lum = (d, i) => (d[i] + d[i + 1] + d[i + 2]) / 3;

// Runs of consecutive indices merged into their centre (a 2–3 px thick line counts once).
function centres(list, gap = 3) {
  const out = [];
  let start = null, prev = null;
  for (const v of list) {
    if (start === null) start = v;
    else if (v - prev > gap) {
      out.push(Math.round((start + prev) / 2));
      start = v;
    }
    prev = v;
  }
  if (start !== null) out.push(Math.round((start + prev) / 2));
  return out;
}

// The longest unbroken dark run along a row or column (a ruled line is long and unbroken; a column of digits is not).
function longestRun(img, fixed, horizontal, from, to) {
  const { width: W, data: d } = img;
  let best = 0, run = 0;
  for (let t = from; t < to; t++) {
    const i = horizontal ? (fixed * W + t) * 4 : (t * W + fixed) * 4;
    if (lum(d, i) < DARK) {
      run++;
      if (run > best) best = run;
    } else run = 0;
  }
  return best;
}

// Horizontal and vertical ruled lines of the table.
export function findLines(img) {
  const { width: W, height: H } = img;
  const ys = [];
  for (let y = 0; y < H; y++) if (longestRun(img, y, true, 0, W) > W * 0.6) ys.push(y);
  const yLines = centres(ys);
  if (yLines.length < 3) return { xs: [], ys: yLines };
  const top = yLines[0], bottom = yLines[yLines.length - 1];
  const xs = [];
  // A column line runs through most of the table body (the header and the SIZE rows are merged, so count dark
  // pixels below the header instead of asking for one unbroken run; a column of digits stays far below this).
  const bodyTop = yLines[1];
  const { data: d } = img;
  for (let x = 0; x < W; x++) {
    let dark = 0;
    for (let y = bodyTop; y <= bottom; y++) if (lum(d, (y * W + x) * 4) < DARK) dark++;
    if (dark > (bottom - bodyTop) * 0.7) xs.push(x);
  }
  return { xs: centres(xs), ys: yLines, top, bottom };
}

// Is there a ruled line at x across the middle of the band y0..y1? (no line = merged cell)
function hasVLine(img, x, y0, y1) {
  const { width: W, data: d } = img;
  const mid = Math.round((y0 + y1) / 2);
  for (let dx = -2; dx <= 2; dx++) {
    const xx = x + dx;
    if (xx < 0 || xx >= W) continue;
    let dark = 0;
    for (let y = mid - 4; y <= mid + 4; y++) if (lum(d, (y * W + xx) * 4) < DARK) dark++;
    if (dark >= 7) return true;
  }
  return false;
}

// Background colour of a cell: the most common light colour inside it (text pixels ignored).
export function background(img, x0, y0, x1, y1) {
  const { width: W, data: d } = img;
  const counts = new Map();
  const step = Math.max(1, Math.floor((x1 - x0) / 40));
  for (let y = y0 + 3; y < y1 - 3; y += 2) {
    for (let x = x0 + 3; x < x1 - 3; x += step) {
      const i = (y * W + x) * 4;
      if (lum(d, i) < 170) continue;
      const k = `${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  let best = null, n = -1;
  for (const [k, c] of counts) if (c > n) { best = k; n = c; }
  if (!best) return [255, 255, 255];
  return best.split(',').map((v) => Number(v) * 16 + 8);
}

// Pink / rose fill (header, SIZE rows, TOTAL rows) vs white data rows.
export const isTinted = ([r, g, b]) => r - Math.min(g, b) > 25;

// Rows of the table: each with its band, whether its cells are merged across the table, and whether it is tinted.
export function tableRows(img, lines) {
  const { xs, ys } = lines;
  const rows = [];
  for (let i = 0; i + 1 < ys.length; i++) {
    const y0 = ys[i], y1 = ys[i + 1];
    if (y1 - y0 < 8) continue;
    const inner = xs.slice(1, -1);
    const present = inner.filter((x) => hasVLine(img, x, y0, y1)).length;
    const merged = inner.length > 0 && present <= Math.floor(inner.length * 0.2);
    const bg = background(img, xs[0], y0, xs[1] ?? img.width, y1);
    rows.push({ index: rows.length, y0, y1, merged, tinted: isTinted(bg), bg });
  }
  return rows;
}

// Share of ink pixels inside a cell (borders trimmed). A blank cell is ~0.
export function inkShare(img, x0, y0, x1, y1, pad = 4) {
  const { width: W, data: d } = img;
  let ink = 0, all = 0;
  for (let y = y0 + pad; y < y1 - pad; y++) {
    for (let x = x0 + pad; x < x1 - pad; x++) {
      all++;
      if (lum(d, (y * W + x) * 4) < 160) ink++;
    }
  }
  return all ? ink / all : 0;
}

// A cell cut out, cleaned to black text on white, trimmed to its ink with a margin and scaled up so text is
// ~40 px tall (what the OCR engine reads best). Returns { width, height, data } or null when the cell is blank.
export function cellImage(img, x0, y0, x1, y1, { pad = 4, targetText = 40 } = {}) {
  const { width: W, data: d } = img;
  const ax = x0 + pad, ay = y0 + pad, bx = x1 - pad, by = y1 - pad;
  let minX = bx, minY = by, maxX = ax - 1, maxY = ay - 1;
  for (let y = ay; y < by; y++) {
    for (let x = ax; x < bx; x++) {
      if (lum(d, (y * W + x) * 4) < 160) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY - minY < 3) return null;
  const textH = maxY - minY + 1;
  const scale = Math.max(1, Math.min(6, targetText / textH));
  const margin = 12;
  const cw = Math.round((maxX - minX + 1) * scale) + margin * 2;
  const ch = Math.round(textH * scale) + margin * 2;
  const out = new Uint8ClampedArray(cw * ch * 4).fill(255);
  // Smooth (bilinear) enlargement of the grey levels, then a contrast stretch: dark-red and black text both end up
  // near black, pink and white backgrounds white, and the anti-aliased edges keep the digit shapes (8 vs 3).
  const g = (x, y) => lum(d, (y * W + x) * 4);
  const tone = (v) => (v <= 90 ? 0 : v >= 215 ? 255 : Math.round(((v - 90) / 125) * 255));
  const sx0 = Math.max(0, minX - 2), sy0 = Math.max(0, minY - 2), sx1 = Math.min(W - 1, maxX + 2), sy1 = Math.min(img.height - 1, maxY + 2);
  for (let y = 0; y < ch - margin * 2; y++) {
    const fy = Math.min(sy1, Math.max(sy0, minY + (y + 0.5) / scale - 0.5));
    const y0i = Math.floor(fy), y1i = Math.min(sy1, y0i + 1), ty = fy - y0i;
    for (let x = 0; x < cw - margin * 2; x++) {
      const fx = Math.min(sx1, Math.max(sx0, minX + (x + 0.5) / scale - 0.5));
      const x0i = Math.floor(fx), x1i = Math.min(sx1, x0i + 1), tx = fx - x0i;
      const v = (g(x0i, y0i) * (1 - tx) + g(x1i, y0i) * tx) * (1 - ty) + (g(x0i, y1i) * (1 - tx) + g(x1i, y1i) * tx) * ty;
      const o = ((y + margin) * cw + (x + margin)) * 4;
      out[o] = out[o + 1] = out[o + 2] = tone(v);
    }
  }
  return { width: cw, height: ch, data: out };
}

// The raw (uncleaned) cell, for showing you exactly what the app saw.
export function cropRaw(img, x0, y0, x1, y1) {
  const { width: W, data: d } = img;
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) out.set(d.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, data: out };
}
