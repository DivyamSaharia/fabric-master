import { describe, it, expect, beforeAll, vi } from 'vitest';
import { commit, getState, init, refresh, startAutoSync } from './store.js';

// A fake Google Sheet web app: bootstrap returns the rows as they were when the
// request arrived; a "gate" can hold the reply back to mimic a slow network.
const server = { Fabrics: [{ id: 'f1', name: 'Gajji Silk', reed_space_in: 64 }] };
let gate = null;
let calls = { bootstrap: 0, batch: 0 };

beforeAll(async () => {
  global.fetch = vi.fn(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.action === 'bootstrap') {
      calls.bootstrap += 1;
      const snap = JSON.parse(JSON.stringify(server));
      const wait = gate;
      if (wait) await wait;
      return { json: async () => ({ ok: true, tables: snap, meta: {} }) };
    }
    if (body.action === 'batch') {
      calls.batch += 1;
      for (const op of body.ops) {
        if (op.op === 'upsert') server[op.table] = [...(server[op.table] || []).filter((r) => !op.rows.some((x) => x.id === r.id)), ...op.rows];
      }
      return { json: async () => ({ ok: true, ops: body.ops }) };
    }
    return { json: async () => ({ ok: true }) };
  });
  localStorage.clear();
  localStorage.setItem('fm.settings.v1', JSON.stringify({ mode: 'sheet', url: 'https://script.example/exec', key: 'test' }));
  await init();
});

describe('phone and laptop stay in step through the Sheet', () => {
  it('loads what the other device saved', async () => {
    expect(getState().tables.Fabrics.map((f) => f.id)).toEqual(['f1']);
    server.Fabrics.push({ id: 'f2', name: 'Tissue', reed_space_in: 64 }); // saved on the other device
    await refresh();
    expect(getState().tables.Fabrics.map((f) => f.id)).toEqual(['f1', 'f2']);
  });

  it('a reload that started before a save does not undo the save', async () => {
    let release;
    gate = new Promise((r) => { release = r; });
    const slow = refresh(); // reads the Sheet before the save below
    gate = null;
    await commit([{ op: 'upsert', table: 'Fabrics', rows: [{ id: 'f3', name: 'Salsa', reed_space_in: 54 }] }]);
    expect(getState().tables.Fabrics.some((f) => f.id === 'f3')).toBe(true);
    release();
    await slow;
    expect(getState().tables.Fabrics.map((f) => f.id).sort()).toEqual(['f1', 'f2', 'f3']);
  });

  it('reloads when the app comes back into view', async () => {
    const stop = startAutoSync({ staleMs: 0, everyMs: 600000 });
    const before = calls.bootstrap;
    server.Fabrics.push({ id: 'f4', name: 'Rangila Twill', reed_space_in: 54 });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(getState().tables.Fabrics.some((f) => f.id === 'f4')).toBe(true));
    expect(calls.bootstrap).toBe(before + 1);
    stop();
  });
});
