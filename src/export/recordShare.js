// Test helper: records what the Basic PDF draws (text calls and tables) and what the Basic Excel holds, so a
// share can be compared with a saved copy and searched for money figures. Used by basicShare.test.jsx only.
import { vi } from 'vitest';
import { preloadExports } from './exports.js';
import { today } from '../schema.js';

const norm = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'string' ? x.split(today()).join('<today>') : x)));

export async function recordPdf(run) {
  const libs = await preloadExports();
  const calls = [];
  const Real = libs.jsPDF;
  const realTable = libs.autoTable;
  libs.jsPDF = function Recording(...args) {
    const d = new Real(...args);
    const text = d.text.bind(d);
    d.text = (t, ...rest) => { calls.push(['text', t]); return text(t, ...rest); };
    d.addImage = () => d;
    d.output = () => new Blob(['pdf'], { type: 'application/pdf' });
    return d;
  };
  libs.autoTable = (doc, o) => {
    calls.push(['table', o.head || null, o.body]);
    doc.lastAutoTable = { finalY: (o.startY || 0) + 10 };
  };
  URL.createObjectURL = () => 'blob:x';
  URL.revokeObjectURL = () => {};
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    await run();
  } finally {
    click.mockRestore();
    libs.jsPDF = Real;
    libs.autoTable = realTable;
  }
  return norm(calls);
}

export async function recordXlsx(run) {
  const { XLSX } = await preloadExports();
  let blob = null;
  URL.createObjectURL = (b) => { blob = b; return 'blob:x'; };
  URL.revokeObjectURL = () => {};
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    await run();
  } finally {
    click.mockRestore();
  }
  const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  return norm(Object.fromEntries(wb.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' })])));
}
