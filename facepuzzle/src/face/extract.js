/**
 * extract.js — takes a photo plus a geometry and produces the object the rest
 * of the app plays with: an upright square crop of the face, plus one cut-out
 * "piece" per slot.
 *
 * Everything downstream works in the *base frame* — a square canvas with the
 * eyes level and the head centred. Pieces are cut from that frame rather than
 * from the original photo, so a piece from a tilted snapshot drops cleanly onto
 * a face from a straight-on one.
 */

import { SLOTS, SLOT_BY_ID } from './slots.js';
import {
  createCanvas, cropRect, featherEllipse, applyJigsawMask,
  meanColor, channelStats, drawCover,
} from '../lib/canvas.js';
import { makeRng, hashSeed, uid } from '../lib/random.js';

/** Side of the square face crop, in pixels. Plenty for a 1024px composite. */
export const BASE_SIZE = 720;
/** Longest edge of an individual piece. */
export const PIECE_MAX = 224;

/**
 * @typedef {object} Piece
 * @property {string} id
 * @property {string} slot          which slot it can fill
 * @property {string} faceId        the face it was cut from
 * @property {string} faceLabel     human name for that face
 * @property {boolean} real         true only for an untouched piece in its own slot
 * @property {string} kind          'real' | 'twin' | 'mirror' | 'guest' | 'tone' | 'wander' | 'doodle'
 * @property {string} note          short human explanation, shown after a reveal
 * @property {HTMLCanvasElement} raw unmasked crop
 * @property {{r:number,g:number,b:number}} tint average colour
 * @property {number[]} tabs        jigsaw edge directions
 */

/**
 * Cut a face into its pieces.
 *
 * @param {{id?:string,label:string,source:HTMLCanvasElement,geometry:object}} input
 * @returns {object} face record
 */
export function extractFace({ id = uid('face'), label, source, geometry }) {
  return assembleFace({
    id, label, source, geometry,
    base: renderBase(source, geometry),
    rel: relativeRegions(geometry),
  });
}

/**
 * Build a face from an already-aligned base frame and its region rectangles.
 *
 * The stock library ships exactly that: square crops with the eyes levelled and
 * a manifest of `rel` rectangles computed offline by tools/build_stock_faces.py.
 * Loading one therefore needs no detector, no alignment pass and no network
 * beyond the image itself.
 */
export function faceFromBase({ id = uid('face'), label, base, rel, stock = false }) {
  return assembleFace({ id, label, base, rel, stock });
}

/** Shared tail of both paths: cut the pieces and measure the skin. */
function assembleFace({ id, label, base, rel, source = null, geometry = null, stock = false }) {
  const rng = makeRng(hashSeed(id));
  const pieces = {};
  const skin = {};

  for (const slot of SLOTS) {
    const region = rel[slot.id];
    pieces[slot.id] = cutPiece({
      base, region, slot, faceId: id, faceLabel: label, rng,
      kind: 'real', real: true, note: 'The genuine article',
    });
    skin[slot.id] = sampleSkinAround(base, region);
  }

  return {
    id, label, source, geometry, base, rel, pieces, skin, stock,
    tone: averageTone(skin),
    thumb: makeThumb(base),
    createdAt: Date.now(),
  };
}

/* ------------------------------------------------------------- base frame */

/** Draw the square, de-rotated face crop. */
function renderBase(source, geometry) {
  const { box, roll } = geometry;
  const { canvas, ctx } = createCanvas(BASE_SIZE, BASE_SIZE);
  const scale = BASE_SIZE / box.w;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  // Fill behind the face first: a photo cropped near its edge would otherwise
  // leave transparent wedges once the crop is rotated.
  ctx.save();
  ctx.filter = 'blur(18px) saturate(.8)';
  drawCover(ctx, source, { x: -40, y: -40, w: BASE_SIZE + 80, h: BASE_SIZE + 80 });
  ctx.restore();

  ctx.save();
  ctx.translate(BASE_SIZE / 2, BASE_SIZE / 2);
  ctx.scale(scale, scale);
  ctx.rotate(-roll);
  ctx.translate(-cx, -cy);
  ctx.drawImage(source, 0, 0);
  ctx.restore();

  return canvas;
}

/**
 * Map each world-space region into the base frame, as 0..1 fractions.
 * The crop already removed the roll, so regions come out axis-aligned.
 */
function relativeRegions(geometry) {
  const { box, roll, regions } = geometry;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const cos = Math.cos(roll), sin = Math.sin(roll);

  const out = {};
  for (const [slotId, region] of Object.entries(regions)) {
    const rcx = region.rect.x + region.rect.w / 2;
    const rcy = region.rect.y + region.rect.h / 2;
    const dx = rcx - cx, dy = rcy - cy;
    // Rotate by -roll into the upright frame, then normalise by the box size.
    const rx = dx * cos + dy * sin;
    const ry = -dx * sin + dy * cos;
    out[slotId] = {
      x: (rx - region.rect.w / 2) / box.w + 0.5,
      y: (ry - region.rect.h / 2) / box.h + 0.5,
      w: region.rect.w / box.w,
      h: region.rect.h / box.h,
    };
  }
  return out;
}

/* ----------------------------------------------------------------- pieces */

export function pieceCanvasSize(slot) {
  const aspect = SLOT_BY_ID[slot.id ? slot.id : slot]?.aspect ?? slot.aspect ?? 1;
  return aspect >= 1
    ? { w: PIECE_MAX, h: Math.round(PIECE_MAX / aspect) }
    : { w: Math.round(PIECE_MAX * aspect), h: PIECE_MAX };
}

/** Cut one rectangle out of a base frame and wrap it as a Piece. */
function cutPiece({ base, region, slot, faceId, faceLabel, rng, kind, real, note }) {
  const { w, h } = pieceCanvasSize(slot);
  const px = {
    x: region.x * base.width,
    y: region.y * base.height,
    w: region.w * base.width,
    h: region.h * base.height,
  };
  const raw = cropRect(base, px, { outW: w, outH: h });

  return makePiece({
    slot: slot.id, faceId, faceLabel, raw, kind, real, note,
    tabs: randomTabs(rng),
  });
}

/** Wrap an already-rendered canvas as a Piece (used by decoys and doodles). */
export function makePiece({ slot, faceId, faceLabel, raw, kind, real = false, note = '', tabs }) {
  return {
    id: uid('piece'),
    slot, faceId, faceLabel, raw,
    kind, real, note,
    tabs: tabs || [1, -1, 1, -1],
    tint: meanColor(raw, { region: 0.6 }),
    _surfaces: new Map(),
  };
}

const randomTabs = rng => Array.from({ length: 4 }, () => (rng() < 0.5 ? -1 : 1));

/**
 * The drawable form of a piece, cut to the requested edge style. Results are
 * memoised because the studio re-composites on every slider nudge.
 *
 * @param {Piece} piece
 * @param {'soft'|'jigsaw'|'raw'} style
 */
export function pieceSurface(piece, style = 'soft') {
  if (style === 'raw') return piece.raw;
  const cached = piece._surfaces.get(style);
  if (cached) return cached;

  const { canvas, ctx } = createCanvas(piece.raw.width, piece.raw.height);
  ctx.drawImage(piece.raw, 0, 0);

  if (style === 'jigsaw') applyJigsawMask(canvas, piece.tabs);
  else featherEllipse(canvas, { feather: SLOT_BY_ID[piece.slot]?.feather ?? 0.42 });

  piece._surfaces.set(style, canvas);
  return canvas;
}

/* ------------------------------------------------------------------ extras */

/**
 * Colour statistics of the skin just outside a region — the target a
 * transplanted piece is re-lit toward. Sampling the ring rather than the region
 * itself keeps lips and eyebrows from dragging the average somewhere strange.
 */
function sampleSkinAround(base, region) {
  const pad = 0.35;
  const outer = {
    x: (region.x - region.w * pad) * base.width,
    y: (region.y - region.h * pad) * base.height,
    w: region.w * (1 + pad * 2) * base.width,
    h: region.h * (1 + pad * 2) * base.height,
  };
  const ring = cropRect(base, outer, { outW: 64, outH: 64 });

  // Knock a hole in the middle so only the surrounding skin is measured.
  const ctx = ring.getContext('2d');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.ellipse(32, 32, 20, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  return channelStats(ring, { region: 1 });
}

/** One skin colour for the whole face — how strangers get matched to a hero. */
function averageTone(skin) {
  const values = Object.values(skin);
  const sum = values.reduce(
    (acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b }),
    { r: 0, g: 0, b: 0 },
  );
  const n = Math.max(1, values.length);
  return { r: sum.r / n, g: sum.g / n, b: sum.b / n };
}

function makeThumb(base) {
  const { canvas, ctx } = createCanvas(96, 96);
  drawCover(ctx, base, { x: 0, y: 0, w: 96, h: 96 });
  return canvas;
}
