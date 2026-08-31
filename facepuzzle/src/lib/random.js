/**
 * random.js — deterministic randomness. Decoys are generated from a seed so a
 * given face always falls apart the same way; a reshuffle just bumps the seed.
 */

/** mulberry32: tiny, fast, good enough for jiggling noses around. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turn any string into a 32-bit seed (FNV-1a). */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const randInt   = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
export const randFloat = (rng, lo, hi) => lo + rng() * (hi - lo);

/** Random value in [-hi,-lo] ∪ [lo,hi] — for warps that must be *visible*. */
export function randSigned(rng, lo, hi) {
  const magnitude = randFloat(rng, lo, hi);
  return rng() < 0.5 ? -magnitude : magnitude;
}

export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

export function shuffle(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Pick `n` distinct items (or as many as exist). */
export function sample(rng, arr, n) {
  return shuffle(rng, arr).slice(0, Math.min(n, arr.length));
}

let counter = 0;
export const uid = (prefix = 'id') => `${prefix}_${(counter++).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
