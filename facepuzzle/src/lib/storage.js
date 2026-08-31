/**
 * storage.js — the fridge door. Saved creations live in IndexedDB as PNG
 * blobs, which keeps them off any server and out of localStorage's ~5MB cap.
 * Every call degrades to a no-op if the browser refuses (private mode, quota),
 * because losing a saved doodle should never break the app.
 */

const DB_NAME = 'face-salad';
const DB_VERSION = 1;
const STORE = 'creations';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB blocked'));
  }).catch(err => { dbPromise = null; throw err; });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let result;
    try { result = fn(store); } catch (err) { reject(err); return; }
    transaction.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

/** @returns {Promise<string|null>} the new id, or null if storage is unavailable */
export async function saveCreation({ blob, title, meta }) {
  try {
    const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    await tx('readwrite', store => store.put({ id, blob, title, meta, createdAt: Date.now() }));
    return id;
  } catch (err) {
    console.warn('[face-salad] could not save creation:', err);
    return null;
  }
}

/** Newest first. Returns [] rather than throwing when storage is off. */
export async function listCreations() {
  try {
    const rows = await tx('readonly', store => store.getAll());
    return (rows || []).sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    console.warn('[face-salad] could not read creations:', err);
    return [];
  }
}

export async function deleteCreation(id) {
  try { await tx('readwrite', store => store.delete(id)); return true; }
  catch { return false; }
}

export async function clearCreations() {
  try { await tx('readwrite', store => store.clear()); return true; }
  catch { return false; }
}

/** Small, non-critical preferences — sliders, last mode, jigsaw on/off. */
const PREF_KEY = 'face-salad:prefs';

export function readPrefs(fallback = {}) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; }
  catch { return { ...fallback }; }
}

export function writePrefs(patch) {
  try {
    const next = { ...readPrefs(), ...patch };
    localStorage.setItem(PREF_KEY, JSON.stringify(next));
    return next;
  } catch { return patch; }
}
