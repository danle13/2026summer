/**
 * decoys.js — fills the parts bin with noses that aren't theirs.
 *
 * The whole game hinges on this file. A bin of obviously-cartoon decoys is
 * funny but trivial; a bin of near-identical warps is impossible. So decoys
 * come in named *kinds*, each with a different flavour of wrongness, and the
 * difficulty setting decides how hard the warps push.
 *
 *   real    the untouched piece — exactly one per slot
 *   guest   the same feature from another person you uploaded  ← the best ones
 *   twin    their own feature, reshaped until it isn't theirs
 *   mirror  their other eyebrow, flipped over
 *   tone    their own feature, recoloured
 *   wander  a different feature entirely, squashed to fit (chaos)
 *   doodle  hand-drawn cartoon (chaos)
 */

import { SLOTS, SLOT_BY_ID, mirrorPartner } from './slots.js';
import { makePiece, pieceCanvasSize } from './extract.js';
import { drawDoodle } from './doodles.js';
import {
  cloneCanvas, createCanvas, rescale, warpBulge, warpShear, rotated,
  filtered, flipH, drawCover,
} from '../lib/canvas.js';
import { makeRng, hashSeed, randSigned, pick, shuffle } from '../lib/random.js';
import { rad } from '../lib/geometry.js';

/**
 * How hard each difficulty pushes a "twin". Ranges are magnitudes; the sign is
 * chosen per-decoy, and a minimum is enforced so no twin comes out identical to
 * the original.
 */
export const DIFFICULTIES = {
  gentle: {
    label: 'Gentle', blurb: 'Obvious once you look',
    scale: [0.16, 0.30], bulge: [0.20, 0.38], shear: [0.10, 0.20],
    rotate: [5, 12], hue: [10, 24], bright: [0.08, 0.16],
  },
  tricky: {
    label: 'Tricky', blurb: 'You will second-guess yourself',
    scale: [0.07, 0.15], bulge: [0.09, 0.19], shear: [0.04, 0.09],
    rotate: [2, 5], hue: [4, 10], bright: [0.03, 0.08],
  },
  brutal: {
    label: 'Brutal', blurb: 'Only a parent could tell',
    scale: [0.03, 0.07], bulge: [0.04, 0.09], shear: [0.015, 0.045],
    rotate: [1, 2.5], hue: [1, 4], bright: [0.01, 0.035],
  },
};

export const DIFFICULTY_IDS = Object.keys(DIFFICULTIES);

/**
 * Build the option list for every slot.
 *
 * @param {object}   opts
 * @param {object}   opts.hero        the face being rebuilt — its pieces are the real ones
 * @param {object[]} opts.guests      other loaded faces, if any
 * @param {number}   opts.perSlot     how many options each slot should offer
 * @param {string}   opts.difficulty  key of DIFFICULTIES
 * @param {boolean}  opts.chaos       allow wander/doodle decoys
 * @param {number}   opts.seed        reshuffling bumps this
 * @returns {Record<string, import('./extract.js').Piece[]>}
 */
export function buildPartsBin({ hero, guests = [], perSlot = 6, difficulty = 'tricky', chaos = false, seed = 1 }) {
  const profile = DIFFICULTIES[difficulty] || DIFFICULTIES.tricky;
  const bin = {};

  for (const slot of SLOTS) {
    const rng = makeRng(hashSeed(`${hero.id}:${slot.id}:${seed}:${difficulty}:${chaos}`));
    const options = [hero.pieces[slot.id]];

    // 1. Real people first — nothing beats an actual different nose.
    for (const guest of guestPiecesFor(slot.id, guests, rng)) {
      if (options.length >= perSlot) break;
      options.push(guest);
    }

    // 2. Their other side, mirrored. Uncanny in the best way.
    const partner = mirrorPartner(slot.id);
    if (partner && hero.pieces[partner] && options.length < perSlot && rng() < 0.85) {
      options.push(mirrorDecoy(hero, slot.id, partner));
    }

    // 3. Chaos options, when the visitor asked for them.
    if (chaos) {
      if (options.length < perSlot) options.push(doodleDecoy(hero, slot, rng));
      if (options.length < perSlot && rng() < 0.7) options.push(wanderDecoy(hero, slot, rng));
    }

    // 4. Fill whatever is left with reshaped versions of their own feature.
    let guard = 0;
    while (options.length < perSlot && guard++ < 40) {
      options.push(twinDecoy(hero, slot, rng, profile));
    }

    bin[slot.id] = shuffle(rng, options);
  }

  return bin;
}

/* ------------------------------------------------------------ decoy kinds */

function guestPiecesFor(slotId, guests, rng) {
  // Two guests per slot at most, so an upload of six people doesn't crowd out
  // every other kind of wrongness.
  return shuffle(rng, guests)
    .filter(face => face.pieces[slotId])
    .slice(0, 2)
    .map(face => ({
      ...face.pieces[slotId],
      id: `${face.pieces[slotId].id}@guest`,
      real: false,
      kind: 'guest',
      note: `${face.label}'s actual ${SLOT_BY_ID[slotId].noun}`,
    }));
}

function mirrorDecoy(hero, slotId, partnerId) {
  const source = hero.pieces[partnerId];
  return makePiece({
    slot: slotId,
    faceId: hero.id,
    faceLabel: hero.label,
    raw: flipH(cloneCanvas(source.raw)),
    kind: 'mirror',
    note: `Their ${SLOT_BY_ID[partnerId].noun}, flipped over`,
    tabs: source.tabs.slice().reverse(),
  });
}

/**
 * A reshaped copy of the real piece. Warps compose: a stretch, then a swell,
 * then a lean, then a small rotation and colour shift. Each one is small; the
 * stack is what makes it read as a different person's feature.
 */
function twinDecoy(hero, slot, rng, profile) {
  const source = hero.pieces[slot.id];
  let canvas = cloneCanvas(source.raw);
  const notes = [];

  const sx = 1 + randSigned(rng, ...profile.scale);
  const sy = 1 + randSigned(rng, ...profile.scale) * 0.8;
  canvas = rescale(canvas, sx, sy);
  notes.push(`${sx > 1 ? 'wider' : 'narrower'} by ${Math.abs(Math.round((sx - 1) * 100))}%`);

  if (rng() < 0.8) {
    const bulge = randSigned(rng, ...profile.bulge);
    canvas = warpBulge(canvas, bulge, rng() < 0.5 ? 'x' : 'y');
    notes.push(bulge > 0 ? 'swollen in the middle' : 'pinched in the middle');
  }

  if (rng() < 0.6) {
    const shear = randSigned(rng, ...profile.shear);
    canvas = warpShear(canvas, shear);
    notes.push('leaning');
  }

  if (rng() < 0.7) {
    const turn = randSigned(rng, ...profile.rotate);
    canvas = rotated(canvas, rad(turn));
    notes.push(`tilted ${Math.abs(turn).toFixed(1)}°`);
  }

  const hue = randSigned(rng, ...profile.hue);
  const bright = 1 + randSigned(rng, ...profile.bright);
  canvas = filtered(canvas, `hue-rotate(${hue.toFixed(1)}deg) brightness(${bright.toFixed(3)}) saturate(${(1 + randSigned(rng, 0.02, 0.12)).toFixed(3)})`);

  return makePiece({
    slot: slot.id,
    faceId: hero.id,
    faceLabel: hero.label,
    raw: canvas,
    kind: 'twin',
    note: `Their own ${slot.noun}, ${notes.slice(0, 2).join(' and ')}`,
    tabs: source.tabs.map(t => (rng() < 0.4 ? -t : t)),
  });
}

/** A feature from somewhere else on the same face, squashed into this slot. */
function wanderDecoy(hero, slot, rng) {
  const others = SLOTS.filter(s => s.id !== slot.id && s.id !== mirrorPartner(slot.id));
  const donor = pick(rng, others);
  const size = pieceCanvasSize(slot);
  const { canvas, ctx } = createCanvas(size.w, size.h);
  drawCover(ctx, hero.pieces[donor.id].raw, { x: 0, y: 0, w: size.w, h: size.h });

  return makePiece({
    slot: slot.id,
    faceId: hero.id,
    faceLabel: hero.label,
    raw: rng() < 0.5 ? flipH(canvas) : canvas,
    kind: 'wander',
    note: `Their ${donor.noun}, wearing a ${slot.noun} costume`,
    tabs: [1, 1, -1, -1],
  });
}

function doodleDecoy(hero, slot, rng) {
  const size = pieceCanvasSize(slot);
  const { canvas, note } = drawDoodle(slot.id, size, rng, hero.skin[slot.id]);
  return makePiece({
    slot: slot.id,
    faceId: hero.id,
    faceLabel: 'Nobody',
    raw: canvas,
    kind: 'doodle',
    note,
    tabs: [-1, 1, 1, -1],
  });
}

/* ---------------------------------------------------------------- helpers */

export const KIND_LABELS = {
  real:   { text: 'REAL',   tone: 'ok'    },
  guest:  { text: 'GUEST',  tone: 'grape' },
  twin:   { text: 'WARPED', tone: 'warn'  },
  mirror: { text: 'MIRROR', tone: 'warn'  },
  tone:   { text: 'TINTED', tone: 'warn'  },
  wander: { text: 'WRONG',  tone: 'bad'   },
  doodle: { text: 'DRAWN',  tone: 'bad'   },
};

/** Count how many slots currently hold the genuine piece. */
export function countReal(selection, bin) {
  let real = 0, total = 0;
  for (const slot of SLOTS) {
    const options = bin[slot.id];
    if (!options?.length) continue;
    total++;
    const chosen = options.find(p => p.id === selection[slot.id]);
    if (chosen?.real) real++;
  }
  return { real, total };
}
