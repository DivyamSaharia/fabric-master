// The OCR engine in the browser: Tesseract.js served from this site (public/ocr), loaded only when an import starts.
// The photo is drawn to a canvas on the phone and read there; nothing is uploaded anywhere.
import { makeOcr } from './ocrParams.js';
import { parseSheet } from './parse.js';

const MAX_SIDE = 2600;

// A photo file → { width, height, data } pixels (very large photos scaled down so the phone stays responsive).
export async function fileToPixels(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That file is not a picture the phone can open.'));
      el.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    return { width: w, height: h, data: d.data, canvas };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Pixels → a canvas (for OCR input and for showing a cell crop).
export function pixelsToCanvas(px) {
  const c = document.createElement('canvas');
  c.width = px.width;
  c.height = px.height;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.data), px.width, px.height), 0, 0);
  return c;
}

let workerPromise = null;

async function getWorker(onStatus) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const base = new URL('./ocr/', window.location.href).href;
      return createWorker('eng', 1, {
        workerPath: `${base}worker.min.js`,
        corePath: base,
        langPath: base.replace(/\/$/, ''),
        gzip: true,
        workerBlobURL: false,
        logger: (m) => {
          if (onStatus && m && m.status && /load|initializ/.test(m.status)) onStatus(m.status, m.progress);
        },
      });
    })().catch((e) => {
      workerPromise = null;
      throw e;
    });
  }
  return workerPromise;
}

export async function stopEngine() {
  if (!workerPromise) return;
  const p = workerPromise;
  workerPromise = null;
  try {
    (await p).terminate();
  } catch {
    // already gone
  }
}

// The whole read: file → parsed sheet. onProgress(stage, fraction): 'engine' while the OCR files load, 'reading' per row.
export async function readSheetPhoto(file, onProgress = () => {}) {
  const px = await fileToPixels(file);
  onProgress('engine', 0);
  let worker;
  try {
    worker = await getWorker((s, p) => onProgress('engine', p || 0));
  } catch (e) {
    throw new Error('Could not start the reader. Check the connection once so the app can cache it, then try again.');
  }
  onProgress('reading', 0);
  const parsed = await parseSheet(px, makeOcr(worker, pixelsToCanvas), { onProgress: (f) => onProgress('reading', f) });
  return { parsed, pixels: px };
}
