/**
 * store.js — one mutable state object plus a subscribe/notify pair. Views read
 * `state` directly and call actions; actions notify. That is the whole
 * architecture, and at this size it is plenty.
 */

import { SLOTS, SLOT_IDS } from './face/slots.js';
import { buildPartsBin, countReal, DIFFICULTIES } from './face/decoys.js';
import { selectStrangers } from './face/stockFaces.js';
import { clearBlendCache } from './face/composite.js';
import { readPrefs, writePrefs } from './lib/storage.js';
import { makeRng, hashSeed, pick } from './lib/random.js';

const DEFAULT_PREFS = {
  style: 'soft',        // 'soft' | 'jigsaw'
  blend: 0.7,           // colour-match strength
  difficulty: 'tricky',
  chaos: false,         // allow doodles and cross-part nonsense
  perSlot: 6,
  seams: false,
};

export const state = {
  faces: [],            // every uploaded face, in arrival order
  strangers: [],        // faces borrowed from the bundled library for this deal
  strangersLoading: false,
  heroId: null,         // whose face is being rebuilt
  bin: {},              // slot id -> Piece[]
  selection: {},        // slot id -> piece id
  mode: 'intro',
  seed: 1,
  prefs: readPrefs(DEFAULT_PREFS),
  busy: null,           // { label, sub } while a face is being processed
};

/* ------------------------------------------------------------ subscribers */

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let notifyQueued = false;
const pendingReasons = new Set();

/**
 * Batch notifications to one frame; sliders fire fast. Every distinct reason
 * raised during that frame is still delivered — an action that changes two
 * things (adds a face *and* switches mode) must not have one of them swallowed.
 */
export function notify(reason = 'change') {
  pendingReasons.add(reason);
  if (notifyQueued) return;
  notifyQueued = true;
  requestAnimationFrame(() => {
    notifyQueued = false;
    const reasons = Array.from(pendingReasons);
    pendingReasons.clear();
    for (const each of reasons) notifyNow(each);
  });
}

/** Immediate variant, for things that must land before the next paint. */
export function notifyNow(reason = 'change') {
  for (const fn of listeners) {
    try { fn(state, reason); } catch (err) { console.error('[face-salad] listener failed', err); }
  }
}

/* --------------------------------------------------------------- selectors */

export const hero   = () => state.faces.find(f => f.id === state.heroId) || state.faces[0] || null;
export const guests = () => state.faces.filter(f => f.id !== state.heroId);
export const hasFaces = () => state.faces.length > 0;

export const truthCount = () => countReal(state.selection, state.bin);

/* ----------------------------------------------------------------- actions */

export function setBusy(label, sub = '') {
  state.busy = label ? { label, sub } : null;
  notifyNow('busy');
}

export function addFace(face, { makeHero = false } = {}) {
  state.faces.push(face);
  if (makeHero || !state.heroId) state.heroId = face.id;
  rebuildBin({ reseed: true });
  notify('faces');
  refreshStrangers();
  return face;
}

export function removeFace(id) {
  const index = state.faces.findIndex(f => f.id === id);
  if (index < 0) return;
  state.faces.splice(index, 1);
  if (state.heroId === id) state.heroId = state.faces[0]?.id ?? null;
  clearBlendCache();
  rebuildBin({ reseed: true });
  notify('faces');
  refreshStrangers();
}

export function setHero(id) {
  if (state.heroId === id) return;
  state.heroId = id;
  rebuildBin({ reseed: true });
  notify('hero');
  refreshStrangers();   // a new hero wants strangers matched to *their* colouring
}

/**
 * Regenerate the options for every slot. Called whenever anything that feeds
 * the decoy generator changes.
 */
/**
 * Pull a fresh set of strangers for the current hero and difficulty, then
 * rebuild the bin around them.
 *
 * The library is fetched over the network, so this is fire-and-forget: the bin
 * is built immediately from whatever is on hand (warped decoys on a cold start)
 * and rebuilt when the real faces arrive. A token guards against an older,
 * slower fetch overwriting a newer deal.
 */
let strangerToken = 0;

export function refreshStrangers() {
  const current = hero();
  if (!current) return Promise.resolve();

  const token = ++strangerToken;
  state.strangersLoading = true;
  notify('strangers');

  const profile = DIFFICULTIES[state.prefs.difficulty] || DIFFICULTIES.tricky;
  return selectStrangers({
    heroTone: current.tone,
    order: profile.strangerOrder,
    seed: state.seed,
  }).then(faces => {
    if (token !== strangerToken) return;   // superseded by a newer deal
    state.strangers = faces;
    state.strangersLoading = false;
    rebuildBin({ keepSelection: true });
    notify('bin');
  }).catch(err => {
    if (token !== strangerToken) return;
    console.warn('[face-salad] could not load strangers:', err);
    state.strangersLoading = false;
    notify('strangers');
  });
}

export function rebuildBin({ reseed = false, keepSelection = false } = {}) {
  const current = hero();
  if (!current) { state.bin = {}; state.selection = {}; return; }
  if (reseed) state.seed = (state.seed * 1103515245 + 12345) >>> 0;

  const previous = keepSelection ? { ...state.selection } : null;

  state.bin = buildPartsBin({
    hero: current,
    guests: guests(),
    strangers: state.strangers,
    perSlot: state.prefs.perSlot,
    difficulty: state.prefs.difficulty,
    chaos: state.prefs.chaos,
    seed: state.seed,
  });

  state.selection = {};
  for (const slot of SLOTS) {
    const options = state.bin[slot.id] || [];
    const kept = previous && options.find(p => p.id === previous[slot.id]);
    state.selection[slot.id] = (kept || options.find(p => p.real) || options[0])?.id ?? null;
  }
}

export function selectPiece(slotId, pieceId) {
  if (state.selection[slotId] === pieceId) return;
  state.selection[slotId] = pieceId;
  notify('selection');
}

/** Roll the dice on every slot. `avoidReal` keeps it from landing on the truth. */
export function randomizeSelection({ avoidReal = false } = {}) {
  const rng = makeRng(hashSeed(`shuffle:${Date.now()}`));
  for (const slotId of SLOT_IDS) {
    const options = state.bin[slotId] || [];
    if (!options.length) continue;
    const pool = avoidReal && options.length > 1 ? options.filter(p => !p.real) : options;
    state.selection[slotId] = pick(rng, pool).id;
  }
  notify('selection');
}

export function resetSelection() {
  for (const slotId of SLOT_IDS) {
    const real = (state.bin[slotId] || []).find(p => p.real);
    if (real) state.selection[slotId] = real.id;
  }
  notify('selection');
}

export function setPref(key, value) {
  if (state.prefs[key] === value) return;
  state.prefs[key] = value;
  writePrefs({ [key]: value });

  // Anything that changes what a decoy *is* needs a fresh bin.
  if (key === 'difficulty' || key === 'chaos' || key === 'perSlot') {
    rebuildBin({ reseed: true, keepSelection: false });
  }
  // Difficulty also decides *which* strangers get borrowed.
  if (key === 'difficulty') refreshStrangers();
  if (key === 'blend' || key === 'style') clearBlendCache();
  notify(`pref:${key}`);
}

export function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  writePrefs({ lastMode: mode });
  notify('mode');
}
