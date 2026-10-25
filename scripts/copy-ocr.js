// Copies the OCR engine (Tesseract.js worker, LSTM cores, English data) into public/ocr so the app serves it
// itself: no CDN, works offline once cached, and no photo or data leaves the phone. Runs before every build.
import fs from 'fs';
import path from 'path';

const out = path.resolve('public/ocr');
fs.mkdirSync(out, { recursive: true });
const files = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];
for (const [from, to] of files) fs.copyFileSync(path.resolve(from), path.join(out, to));
console.log(`OCR files copied to public/ocr (${files.length})`);
