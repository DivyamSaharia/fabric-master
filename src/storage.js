// Browser storage with in-memory fallback (private mode, previews, blocked storage).
const memory = new Map();

export const local = {
  get(key, fallback = null) {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? (memory.has(key) ? memory.get(key) : fallback) : JSON.parse(v);
    } catch {
      return memory.has(key) ? memory.get(key) : fallback;
    }
  },
  set(key, value) {
    memory.set(key, value);
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* memory only */
    }
  },
  remove(key) {
    memory.delete(key);
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

// Small IndexedDB key-value store for photo data URLs.
const DB = 'fabric-master';
const STORE = 'blobs';
let dbPromise = null;
const blobMemory = new Map();

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export const blobs = {
  async get(key) {
    if (blobMemory.has(key)) return blobMemory.get(key);
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const req = db.transaction(STORE).objectStore(STORE).get(key);
        req.onsuccess = () => {
          if (req.result) blobMemory.set(key, req.result);
          resolve(req.result || null);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  },
  async set(key, value) {
    blobMemory.set(key, value);
    const db = await openDb();
    if (!db) return;
    await new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      } catch {
        resolve();
      }
    });
  },
  async remove(key) {
    blobMemory.delete(key);
    const db = await openDb();
    if (!db) return;
    await new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      } catch {
        resolve();
      }
    });
  },
};

// The copy of your tables kept on this device, shown at once when the app opens and when there is no signal.
// Kept in IndexedDB (much more room than localStorage, which the copy used before 1.24.0). Each write reports
// whether it worked, so Settings can say when the copy could not be kept.
const COPY_KEY = 'tables-copy';
const OLD_COPY_KEY = 'fm.cache.v1';

function idbDo(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!db) {
          reject(new Error('This browser has no device storage (IndexedDB)'));
          return;
        }
        try {
          const tx = db.transaction(STORE, mode);
          const req = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(req ? req.result : undefined);
          tx.onerror = () => reject(tx.error || new Error('Device storage refused the copy'));
          tx.onabort = () => reject(tx.error || new Error('Device storage refused the copy'));
        } catch (e) {
          reject(e);
        }
      }),
  );
}

const why = (e) => String((e && (e.name === 'QuotaExceededError' ? 'This device is out of storage space for the app' : e.message)) || e || 'Unknown reason');

export const savedCopy = {
  // { tables, meta, at, version } or null
  async get() {
    let v = null;
    try {
      v = await idbDo('readonly', (s) => s.get(COPY_KEY));
    } catch {
      v = null;
    }
    const old = local.get(OLD_COPY_KEY);
    const ok = (x) => x && x.tables;
    if (ok(v) && ok(old)) return (Date.parse(old.at) || 0) > (Date.parse(v.at) || 0) ? old : v; // the newer one
    return ok(v) ? v : ok(old) ? old : null;
  },
  // Returns { ok, where, error }. Falls back to localStorage when IndexedDB is not there or refuses.
  async set(value) {
    let idbError = null;
    try {
      await idbDo('readwrite', (s) => s.put(value, COPY_KEY));
      try {
        window.localStorage.removeItem(OLD_COPY_KEY); // frees the old copy's space
      } catch {
        /* ignore */
      }
      memory.delete(OLD_COPY_KEY);
      return { ok: true, where: 'device storage' };
    } catch (e) {
      idbError = e;
    }
    try {
      window.localStorage.setItem(OLD_COPY_KEY, JSON.stringify(value));
      idbDo('readwrite', (s) => s.delete(COPY_KEY)).catch(() => {}); // never leave an older copy that could win
      return { ok: true, where: 'browser storage' };
    } catch (e) {
      // one plain reason: running out of space is the one that matters to the person
      const full = [idbError, e].find((x) => x && x.name === 'QuotaExceededError');
      return { ok: false, error: why(full || idbError || e) };
    }
  },
  async remove() {
    local.remove(OLD_COPY_KEY);
    try {
      await idbDo('readwrite', (s) => s.delete(COPY_KEY));
    } catch {
      /* nothing kept */
    }
  },
};

// Asks the browser not to clear the app's storage when the device runs low (no prompt on iPhone or Android).
export function keepStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch {
    /* not supported */
  }
}
