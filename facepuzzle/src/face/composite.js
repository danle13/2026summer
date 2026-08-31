/**
 * composite.js — puts a face back together.
 *
 * The base is always the hero's own crop; each slot then gets whatever piece is
 * currently selected, scaled into that hero's own proportions. That last part
 * matters: a guest's nose is drawn into the *hero's* nose rectangle, so a tall
 * face borrowing from a round one still ends up looking like a face.
 */

import { SLOTS, SLOT_BY_ID } from './slots.js';
import { pieceSurface } from './extract.js';
import { createCanvas, cloneCanvas, harmonize, drawCover, featherEllipse } from '../lib/canvas.js';
import { TAU } from '../lib/geometry.js';

/** Harmonising is the expensive step, so memoise it per piece/target/strength. */
const blendCache = new Map();
const CACHE_LIMIT = 400;

function blendedSurface(piece, style, skin, strength) {
  const bucket = Math.round(strength * 20) / 20;
  const key = `${piece.id}|${style}|${bucket}|${Math.round(skin.r)},${Math.round(skin.g)},${Math.round(skin.b)}`;
  const hit = blendCache.get(key);
  if (hit) return hit;

  const surface = pieceSurface(piece, style);
  const result = bucket > 0 ? harmonize(cloneCanvas(surface), skin, bucket) : surface;

  if (blendCache.size > CACHE_LIMIT) blendCache.clear();
  blendCache.set(key, result);
  return result;
}

export const clearBlendCache = () => blendCache.clear();

/**
 * @param {object} opts
 * @param {object} opts.hero
 * @param {Record<string,Array>} opts.bin      option lists per slot
 * @param {Record<string,string>} opts.selection  slot id -> piece id
 * @param {'soft'|'jigsaw'} [opts.style]
 * @param {number} [opts.blend]   0..1 colour matching strength
 * @param {number} [opts.size]    output square size
 * @param {boolean} [opts.seams]  outline each piece
 * @param {Set<string>} [opts.only] restrict to these slots (rest shows the original)
 * @returns {HTMLCanvasElement}
 */
export function renderComposite({
  hero, bin, selection, style = 'soft', blend = 0.5, size = 720, seams = false, only = null, into = null,
}) {
  // Reuse the caller's canvas when it fits — the studio re-composites on every
  // slider tick and a fresh 720² buffer each time is needless garbage.
  let canvas, ctx;
  if (into && into.width === size && into.height === size) {
    canvas = into;
    ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
  } else {
    ({ canvas, ctx } = createCanvas(size, size));
  }
  const scale = size / hero.base.width;

  ctx.drawImage(hero.base, 0, 0, size, size);

  for (const slot of SLOTS) {
    if (only && !only.has(slot.id)) continue;
    const options = bin?.[slot.id];
    if (!options?.length) continue;

    const piece = options.find(p => p.id === selection[slot.id]) || options.find(p => p.real) || options[0];
    const rel = hero.rel[slot.id];
    const target = {
      x: rel.x * size,
      y: rel.y * size,
      w: rel.w * size,
      h: rel.h * size,
    };

    // An untouched piece is already in the base at full resolution. Re-drawing
    // it from a 224px cut would only add a resampling blur and a faint ring
    // where the feather lands, so leave the original showing through. Jigsaw
    // mode still draws it — there the cut edge is the point.
    const untouched = piece.real && style === 'soft';
    if (!untouched) {
      const surface = blendedSurface(piece, style, hero.skin[slot.id], blend);
      ctx.drawImage(surface, target.x, target.y, target.w, target.h);
    }

    if (seams) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.55)';
      ctx.setLineDash([6 * scale, 5 * scale]);
      ctx.lineWidth = Math.max(1, 1.6 * scale);
      ctx.beginPath();
      ctx.ellipse(target.x + target.w / 2, target.y + target.h / 2, target.w / 2, target.h / 2, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  return canvas;
}

/**
 * The face with every feature punched out — the board you drop pieces onto in
 * Scatter mode.
 */
export function renderPunched(hero, size = 720, { dim = 0.45, hole = HOLE_SCALE } = {}) {
  const { canvas, ctx } = createCanvas(size, size);
  ctx.drawImage(hero.base, 0, 0, size, size);

  // Drain some colour so the empty board reads as "waiting" rather than "done".
  ctx.save();
  ctx.globalAlpha = dim;
  ctx.globalCompositeOperation = 'saturation';
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  ctx.globalCompositeOperation = 'destination-out';
  for (const slot of SLOTS) {
    const rect = holeRect(hero.rel[slot.id], size, hole);
    // The gradient has to live in the same scaled space as the shape it fills,
    // or the fade lands nowhere near the ellipse.
    ctx.save();
    ctx.translate(rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.scale(rect.w / 2, rect.h / 2);
    const grad = ctx.createRadialGradient(0, 0, 0.55, 0, 0, 1);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

/**
 * Feature regions deliberately overlap — a brow piece carries some eyelid with
 * it — but a *board* of overlapping holes is unreadable and makes drop targets
 * fight each other. Shrink each one about its own centre.
 */
export const HOLE_SCALE = 0.74;

export function holeRect(rel, size, scale = HOLE_SCALE) {
  const w = rel.w * size * scale;
  const h = rel.h * size * scale;
  return {
    x: (rel.x + rel.w / 2) * size - w / 2,
    y: (rel.y + rel.h / 2) * size - h / 2,
    w, h,
  };
}

/**
 * A single option, drawn on a soft plate so a dark eyebrow doesn't vanish into
 * the panel background.
 */
export function renderPieceThumb(piece, { style = 'soft', size = 128, plate = true } = {}) {
  const aspect = SLOT_BY_ID[piece.slot]?.aspect ?? 1;
  const w = aspect >= 1 ? size : Math.round(size * aspect);
  const h = aspect >= 1 ? Math.round(size / aspect) : size;
  const { canvas, ctx } = createCanvas(w, h);

  if (plate) {
    // The piece's own average, lifted a quarter of the way to white: close
    // enough that the feathered edge disappears, light enough that a dark brow
    // still reads against it.
    const lift = v => Math.round(v + (255 - v) * 0.25);
    const { r, g, b } = piece.tint;
    ctx.fillStyle = `rgb(${lift(r)},${lift(g)},${lift(b)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  drawCover(ctx, pieceSurface(piece, style), { x: 0, y: 0, w: canvas.width, h: canvas.height });
  return canvas;
}

/**
 * Circular portrait used for the face tabs and the fridge.
 */
export function renderAvatar(faceOrCanvas, size = 96) {
  const src = faceOrCanvas.base || faceOrCanvas;
  const { canvas, ctx } = createCanvas(size, size);
  drawCover(ctx, src, { x: 0, y: 0, w: size, h: size });
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, TAU);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

/**
 * Frame a composite for sharing: the picture, a caption, and a small mark so a
 * screenshot in a group chat still says where it came from.
 */
export function renderShareCard(source, { title, subtitle, accent = '#e6502f' } = {}) {
  const W = 900;
  const pad = 34;
  const captionH = subtitle ? 132 : 96;
  const { canvas, ctx } = createCanvas(W, W + captionH);

  ctx.fillStyle = '#fbf5ec';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.drawImage(source, 0, 0, W, W);

  ctx.fillStyle = '#241f1c';
  ctx.font = '800 40px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(truncate(ctx, title || 'Face Salad', W - pad * 2), pad, W + 56);

  if (subtitle) {
    ctx.fillStyle = '#5c534c';
    ctx.font = '600 24px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
    ctx.fillText(truncate(ctx, subtitle, W - pad * 2), pad, W + 94);
  }

  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(W - pad - 14, W + captionH / 2 - 6, 14, 0, TAU);
  ctx.fill();

  return canvas;
}

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

/** Round, feathered version of a piece for the drag layer in Scatter. */
export function renderLoosePiece(piece, style, size = 160) {
  const surface = pieceSurface(piece, style);
  const { canvas, ctx } = createCanvas(size, Math.round((size * surface.height) / surface.width));
  ctx.drawImage(surface, 0, 0, canvas.width, canvas.height);
  if (style === 'soft') featherEllipse(canvas, { feather: 0.3, inset: 0 });
  return canvas;
}
