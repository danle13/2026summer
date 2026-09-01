/**
 * stockFaces.js — the library of strangers.
 *
 * Without this, the only impostors available for a single uploaded photo are
 * warped copies of that same face, and a warped nose is not a different nose —
 * it is the same nose with a filter on. The library fixes that by shipping real
 * photographic faces to borrow features from.
 *
 * Nobody in the library is a real person. Every image was produced by a
 * text-to-image model (see stock/manifest.json for provenance), which sidesteps
 * both the consent problem and the licensing problem of scraping portraits of
 * actual people off the web.
 *
 * The images arrive pre-aligned — square, eyes level — with their region
 * rectangles precomputed offline, so loading one costs a single image fetch and
 * no detection.
 */

import { faceFromBase } from './extract.js';
import { createCanvas } from '../lib/canvas.js';
import { makeRng, sample } from '../lib/random.js';

const MANIFEST_URL = new URL('../../stock/manifest.json', import.meta.url).href;

/** How many strangers to pull in for one deal. Enough variety, modest download. */
export const STRANGERS_PER_DEAL = 8;

let manifestPromise = null;
const faceCache = new Map();   // manifest id -> face record
let unavailable = false;

/**
 * Fetch the index of available strangers. Resolves to [] if the library cannot
 * be reached, which simply means the app falls back to warped decoys.
 */
export function loadManifest() {
  if (unavailable) return Promise.resolve([]);
  if (manifestPromise) return manifestPromise;

  manifestPromise = fetch(MANIFEST_URL)
    .then(response => {
      if (!response.ok) throw new Error(`stock manifest ${response.status}`);
      return response.json();
    })
    .then(data => data.faces || [])
    .catch(err => {
      console.info('[face-salad] stock face library unavailable:', err.message);
      unavailable = true;
      return [];
    });

  return manifestPromise;
}

/**
 * Load one stranger as a full face record, cutting its pieces on arrival.
 * Results are cached for the life of the page.
 */
async function loadFace(entry, index) {
  if (faceCache.has(entry.id)) return faceCache.get(entry.id);

  const url = new URL(`../../stock/${entry.file}`, import.meta.url).href;
  const image = await loadImage(url);

  // Draw into a canvas so downstream code has the same surface type it gets
  // from an uploaded photo.
  const { canvas, ctx } = createCanvas(image.naturalWidth, image.naturalHeight);
  ctx.drawImage(image, 0, 0);

  const face = faceFromBase({
    id: `stock:${entry.id}`,
    label: `Stranger ${index + 1}`,
    base: canvas,
    rel: entry.rel,
    stock: true,
  });

  faceCache.set(entry.id, face);
  return face;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

/**
 * Choose and load the strangers for one deal.
 *
 * Ranking happens on the manifest's precomputed tone values, so only the faces
 * actually chosen are downloaded — picking eight out of twenty-seven costs
 * eight small images, not the whole library.
 *
 * @param {object} opts
 * @param {{r:number,g:number,b:number}} opts.heroTone  colouring to match against
 * @param {'near'|'far'|'mixed'} opts.order   which end of the ranking to favour
 * @param {number} opts.seed                  changes the picks on a reshuffle
 * @param {number} [opts.count]
 * @returns {Promise<Array>} face records; [] when the library is unavailable
 */
export async function selectStrangers({ heroTone, order = 'mixed', seed = 1, count = STRANGERS_PER_DEAL }) {
  const entries = await loadManifest();
  if (!entries.length) return [];

  const rng = makeRng(seed >>> 0);
  const ranked = rankByTone(entries, heroTone, order);

  // Even for 'near'/'far', draw from a window rather than the exact top slice,
  // so two deals at the same difficulty are not identical.
  const window = order === 'mixed'
    ? ranked
    : ranked.slice(0, Math.min(ranked.length, Math.max(count + 3, Math.ceil(ranked.length * 0.6))));
  const chosen = sample(rng, window, count);

  const loaded = await Promise.all(
    chosen.map((entry, i) => loadFace(entry, i).catch(err => {
      console.warn('[face-salad] skipping stock face', entry.id, err.message);
      return null;
    })),
  );
  return loaded.filter(Boolean);
}

/**
 * Order the library by how close each face's colouring is to the hero's.
 *
 * Squared distance in plain RGB is crude, but skin tones sit on a fairly tight
 * curve and the ordering it produces matches what the eye calls "similar
 * colouring", which is all this has to do.
 */
function rankByTone(entries, heroTone, order) {
  if (!heroTone) return entries.slice();
  const scored = entries.map(entry => {
    const [r, g, b] = entry.tone || [128, 128, 128];
    return {
      entry,
      distance: (r - heroTone.r) ** 2 + (g - heroTone.g) ** 2 + (b - heroTone.b) ** 2,
    };
  });
  scored.sort((a, b) => a.distance - b.distance);
  if (order === 'far') scored.reverse();
  return scored.map(s => s.entry);
}

/**
 * Load specific faces by manifest id — used by the front page's "borrow
 * someone" row and by the studio's spare-parts shortcut.
 */
export async function loadStockFaces(ids) {
  const entries = await loadManifest();
  const wanted = ids
    .map(id => entries.findIndex(e => e.id === id))
    .filter(i => i >= 0)
    .map(i => [entries[i], i]);
  const loaded = await Promise.all(wanted.map(([entry, i]) => loadFace(entry, i).catch(() => null)));
  return loaded.filter(Boolean);
}

/** A stable, spread-out handful of ids for the front page to offer. */
export async function featuredIds(count = 3) {
  const entries = await loadManifest();
  if (!entries.length) return [];
  const step = Math.max(1, Math.floor(entries.length / count));
  return Array.from({ length: count }, (_, i) => entries[(i * step) % entries.length].id);
}
