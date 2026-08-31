/**
 * slots.js — the parts bin. One entry per swappable region of a face; the order
 * of this array is also the back-to-front paint order in the compositor.
 *
 * `short` is the chip label, `noun` the same thing in prose — "left eye" reads
 * where a lower-cased "L eye" does not.
 *
 * `aspect` is width/height of the extracted piece. `pad` grows the raw landmark
 * bounding box before cutting — brows and mouths in particular need a lot of
 * vertical slack or the piece lands as a floating strip with no skin around it.
 */

export const SLOTS = [
  {
    id: 'hair',  label: 'Hair line', short: 'Hair', noun: 'hair line', emoji: '💇',
    aspect: 1.85, pad: { x: 0.05, y: 0.30 }, feather: 0.62,
    hint: 'forehead and the hair above it',
  },
  {
    id: 'chin',  label: 'Jaw & chin', short: 'Jaw', noun: 'jaw', emoji: '🦴',
    aspect: 1.45, pad: { x: 0.03, y: 0.14 }, feather: 0.58,
    hint: 'the line of the jaw',
  },
  {
    id: 'browL', label: 'Left eyebrow', short: 'L brow', noun: 'left eyebrow', emoji: '🤨',
    aspect: 1.75, pad: { x: 0.26, y: 0.85 }, feather: 0.58, side: 'L', pairs: 'browR',
    hint: 'the brow on the left of the picture',
  },
  {
    id: 'browR', label: 'Right eyebrow', short: 'R brow', noun: 'right eyebrow', emoji: '🤨',
    aspect: 1.75, pad: { x: 0.26, y: 0.85 }, feather: 0.58, side: 'R', pairs: 'browL',
    hint: 'the brow on the right of the picture',
  },
  {
    id: 'eyeL',  label: 'Left eye', short: 'L eye', noun: 'left eye', emoji: '👁️',
    aspect: 1.55, pad: { x: 0.24, y: 0.62 }, feather: 0.50, side: 'L', pairs: 'eyeR',
    hint: 'the eye on the left of the picture',
  },
  {
    id: 'eyeR',  label: 'Right eye', short: 'R eye', noun: 'right eye', emoji: '👁️',
    aspect: 1.55, pad: { x: 0.24, y: 0.62 }, feather: 0.50, side: 'R', pairs: 'eyeL',
    hint: 'the eye on the right of the picture',
  },
  {
    id: 'nose',  label: 'Nose', short: 'Nose', noun: 'nose', emoji: '👃',
    aspect: 0.92, pad: { x: 0.16, y: 0.14 }, feather: 0.54,
    hint: 'the whole nose',
  },
  {
    id: 'mouth', label: 'Mouth', short: 'Mouth', noun: 'mouth', emoji: '👄',
    aspect: 1.5, pad: { x: 0.18, y: 0.55 }, feather: 0.54,
    hint: 'lips and the skin around them',
  },
];

export const SLOT_IDS = SLOTS.map(s => s.id);
export const SLOT_BY_ID = Object.fromEntries(SLOTS.map(s => [s.id, s]));

/** Slots whose pieces can stand in for each other once mirrored. */
export function mirrorPartner(id) {
  return SLOT_BY_ID[id]?.pairs ?? null;
}
