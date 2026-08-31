/**
 * canvas.js — every pixel operation in the app. Pieces are plain <canvas>
 * elements with an alpha channel; masking, warping and tinting are all just
 * canvases in, canvases out, so nothing here needs to know what a face is.
 */

import { clamp, TAU } from './geometry.js';

/** @returns {{canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D}} */
export function createCanvas(w, h, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width  = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d', { willReadFrequently: !!opts.readback });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

export function cloneCanvas(src) {
  const { canvas, ctx } = createCanvas(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  return canvas;
}

/** Downscale a decoded image so later per-pixel work stays cheap. */
export function normalizeSource(image, maxDim = 1600) {
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const { canvas, ctx } = createCanvas(w * scale, h * scale);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Draw `src` into `ctx` filling `rect` like CSS `object-fit: cover`. */
export function drawCover(ctx, src, rect) {
  const sr = src.width / src.height;
  const dr = rect.w / rect.h;
  let sw = src.width, sh = src.height, sx = 0, sy = 0;
  if (sr > dr) { sw = src.height * dr; sx = (src.width - sw) / 2; }
  else         { sh = src.width / dr;  sy = (src.height - sh) / 2; }
  ctx.drawImage(src, sx, sy, sw, sh, rect.x, rect.y, rect.w, rect.h);
}

/**
 * Cut a rectangle out of a source canvas, optionally rotated about its centre,
 * rendered into a fresh canvas of `outW × outH`.
 */
export function cropRect(src, rect, { angle = 0, outW, outH, margin = 0 } = {}) {
  const w = outW || Math.round(rect.w);
  const h = outH || Math.round(rect.h);
  const { canvas, ctx } = createCanvas(w, h);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const sw = rect.w * (1 + margin);
  const sh = rect.h * (1 + margin);

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(w / sw, h / sh);
  ctx.rotate(-angle);
  ctx.translate(-cx, -cy);
  ctx.drawImage(src, 0, 0);
  ctx.restore();
  return canvas;
}

/* ------------------------------------------------------------------ masks */

/**
 * Soft elliptical vignette — the default "seamless" piece edge. `feather` is
 * the fraction of the radius that fades (0 = hard edge, 1 = pure gradient).
 */
export function featherEllipse(canvas, { feather = 0.42, inset = 0.02 } = {}) {
  const { width: w, height: h } = canvas;
  const mask = createCanvas(w, h);
  const rx = (w / 2) * (1 - inset);
  const ry = (h / 2) * (1 - inset);

  mask.ctx.save();
  mask.ctx.translate(w / 2, h / 2);
  mask.ctx.scale(rx, ry);
  // Offsets here run across the *fade band*, not the whole radius. A smooth
  // ramp matters: a sharp shoulder shows up as a visible disc on flat skin.
  const grad = mask.ctx.createRadialGradient(0, 0, Math.max(0, 1 - feather), 0, 0, 1);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.92)');
  grad.addColorStop(0.75, 'rgba(0,0,0,0.58)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  mask.ctx.fillStyle = grad;
  mask.ctx.fillRect(-1, -1, 2, 2);
  mask.ctx.restore();

  const ctx = canvas.getContext('2d');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask.canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

/**
 * Build a classic jigsaw outline. Each entry of `tabs` is -1 (notch), 0 (flat)
 * or 1 (knob) for the top / right / bottom / left edge.
 *
 * The knob is a circle of radius `r` whose centre sits `k` outside the edge, so
 * the arc sweeps more than 180° and produces the pinched neck people expect.
 * Edges are sampled into a polyline, which sidesteps every arc-direction and
 * transform subtlety at a cost of a few dozen points.
 */
export function jigsawPath(w, h, tabs = [0, 0, 0, 0], { inset = 0.14, r = 0.15, k = 0.085 } = {}) {
  const x0 = w * inset, y0 = h * inset;
  const x1 = w * (1 - inset), y1 = h * (1 - inset);
  const corners = [
    [{ x: x0, y: y0 }, { x: x1, y: y0 }], // top    — outward normal is -y
    [{ x: x1, y: y0 }, { x: x1, y: y1 }], // right  — outward normal is +x
    [{ x: x1, y: y1 }, { x: x0, y: y1 }], // bottom — outward normal is +y
    [{ x: x0, y: y1 }, { x: x0, y: y0 }], // left   — outward normal is -x
  ];

  const pts = [];
  corners.forEach(([a, b], i) => {
    const dir = tabs[i] || 0;
    const ux = b.x - a.x, uy = b.y - a.y;
    const len = Math.hypot(ux, uy);
    const nx = uy / len, ny = -ux / len; // right-hand normal, points outward here

    const at = (t, off) => ({
      x: a.x + ux * t + nx * off * len,
      y: a.y + uy * t + ny * off * len,
    });

    if (!dir) { pts.push(at(0, 0), at(1, 0)); return; }

    const half = Math.sqrt(Math.max(0, r * r - k * k)); // neck half-width
    pts.push(at(0, 0), at(0.5 - half, 0));

    // Sample the knob arc. Angles are measured in the local (t, offset) frame.
    const start = Math.atan2(-k, -half);
    const end   = Math.atan2(-k,  half);
    const sweep = TAU - (end - start);       // the long way round, through the tip
    const STEPS = 34;
    for (let s = 0; s <= STEPS; s++) {
      const ang = start - sweep * (s / STEPS);
      pts.push(at(0.5 + Math.cos(ang) * r, (k + Math.sin(ang) * r) * dir));
    }
    pts.push(at(0.5 + half, 0), at(1, 0));
  });

  const path = new Path2D();
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
  path.closePath();
  return path;
}

/** Clip a canvas to a jigsaw outline and give it a printed cardboard edge. */
export function applyJigsawMask(canvas, tabs, { stroke = 'rgba(255,255,255,.85)', lineWidth = 2 } = {}) {
  const path = jigsawPath(canvas.width, canvas.height, tabs);
  const cut = createCanvas(canvas.width, canvas.height);
  cut.ctx.fillStyle = '#000';
  cut.ctx.fill(path);

  const ctx = canvas.getContext('2d');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(cut.canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  if (stroke) {
    ctx.save();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.stroke(path);
    ctx.restore();
  }
  return canvas;
}

/* ----------------------------------------------------------------- colour */

/**
 * Average colour of the opaque pixels, optionally restricted to a centred
 * fraction of the canvas. Used both to recolour transplanted parts and to read
 * the skin tone of the face they are landing on.
 */
export function meanColor(canvas, { region = 0.7, minAlpha = 40 } = {}) {
  const w = canvas.width, h = canvas.height;
  const rw = Math.max(1, Math.round(w * region));
  const rh = Math.max(1, Math.round(h * region));
  const rx = Math.round((w - rw) / 2);
  const ry = Math.round((h - rh) / 2);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { data } = ctx.getImageData(rx, ry, rw, rh);

  let r = 0, g = 0, b = 0, n = 0;
  // Stride by 2px in each direction; a mean does not need every sample.
  for (let y = 0; y < rh; y += 2) {
    for (let x = 0; x < rw; x += 2) {
      const i = (y * rw + x) * 4;
      if (data[i + 3] < minAlpha) continue;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  if (!n) return { r: 128, g: 128, b: 128 };
  return { r: r / n, g: g / n, b: b / n };
}

/**
 * Average colour of the *outer band* of a piece — the skin around the feature
 * rather than the feature itself.
 *
 * This is what matters when transplanting: a nose piece's overall mean is
 * dragged around by the nostrils, and a mouth's by the lips, so matching those
 * to the destination's skin overcorrects and leaves a grey smear. Matching the
 * border instead lands the surrounding skin on the destination's tone and lets
 * the feature keep its own contrast.
 */
export function ringColor(canvas, { hole = 0.62 } = {}) {
  const ring = createCanvas(64, 64);
  ring.ctx.drawImage(canvas, 0, 0, 64, 64);
  ring.ctx.globalCompositeOperation = 'destination-out';
  ring.ctx.beginPath();
  ring.ctx.ellipse(32, 32, 32 * hole, 32 * hole, 0, 0, Math.PI * 2);
  ring.ctx.fill();
  ring.ctx.globalCompositeOperation = 'source-over';
  return meanColor(ring.canvas, { region: 1 });
}

/**
 * Nudge a piece toward a target colour so a transplanted nose stops looking
 * like a sticker. Multiply pulls the tone, a light screen pass keeps highlights
 * from muddying.
 */
export function harmonize(canvas, target, strength = 0.5) {
  if (strength <= 0) return canvas;
  const s = clamp(strength, 0, 1);
  const source = ringColor(canvas);

  // Per-channel gain, applied directly to the pixels. Doing this with canvas
  // blend modes instead looks tempting and is a trap: `multiply` can only ever
  // darken, so lifting a dark piece onto light skin needs a `screen` pass,
  // which adds the same amount to every channel and drains the colour out of
  // the result. A plain multiply per channel is what white balance actually is.
  const gain = {
    r: 1 + (clamp(target.r / Math.max(1, source.r), 0.4, 2.6) - 1) * s,
    g: 1 + (clamp(target.g / Math.max(1, source.g), 0.4, 2.6) - 1) * s,
    b: 1 + (clamp(target.b / Math.max(1, source.b), 0.4, 2.6) - 1) * s,
  };

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;
  // Precompute the 256-entry curve per channel rather than multiplying per pixel.
  const curves = [lut(gain.r), lut(gain.g), lut(gain.b)];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    data[i]     = curves[0][data[i]];
    data[i + 1] = curves[1][data[i + 1]];
    data[i + 2] = curves[2][data[i + 2]];
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * A 256-entry lookup for one channel gain, with a soft shoulder near white so
 * a strong lift rolls off instead of clipping to a flat highlight.
 */
function lut(gain) {
  const table = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const lifted = v * gain;
    table[v] = lifted <= 200 ? lifted : 200 + (255 - 200) * (1 - Math.exp(-(lifted - 200) / 55));
  }
  return table;
}


/**
 * Apply a CSS filter string to a canvas, returning a new one. Cheap way to get
 * hue rotation, contrast and blur without touching ImageData.
 */
export function filtered(src, filter) {
  const { canvas, ctx } = createCanvas(src.width, src.height);
  ctx.filter = filter;
  ctx.drawImage(src, 0, 0);
  ctx.filter = 'none';
  return canvas;
}

export function flipH(src) {
  const { canvas, ctx } = createCanvas(src.width, src.height);
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return canvas;
}

export function rotated(src, angle, scale = 1) {
  const { canvas, ctx } = createCanvas(src.width, src.height);
  ctx.translate(src.width / 2, src.height / 2);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return canvas;
}

/* ------------------------------------------------------------------ warps */

/**
 * Squeeze or swell the middle of a piece. Rows are redrawn one strip at a time
 * with a horizontal scale that follows a sine hump, which is enough to turn a
 * nose into a *different* nose without it reading as a filter.
 */
export function warpBulge(src, amount = 0.2, axis = 'x') {
  const { canvas, ctx } = createCanvas(src.width, src.height);
  const STRIPS = 72;
  const along = axis === 'x' ? src.height : src.width;
  const step = along / STRIPS;

  for (let i = 0; i < STRIPS; i++) {
    const t = (i + 0.5) / STRIPS;
    const factor = 1 + amount * Math.sin(Math.PI * t);
    if (axis === 'x') {
      const sy = i * step;
      const w = src.width * factor;
      ctx.drawImage(src, 0, sy, src.width, step + 1,
                    (src.width - w) / 2, sy, w, step + 1);
    } else {
      const sx = i * step;
      const h = src.height * factor;
      ctx.drawImage(src, sx, 0, step + 1, src.height,
                    sx, (src.height - h) / 2, step + 1, h);
    }
  }
  return canvas;
}

/** Lean a piece sideways — a surprisingly strong "that isn't quite them" cue. */
export function warpShear(src, amount = 0.12) {
  const { canvas, ctx } = createCanvas(src.width, src.height);
  ctx.translate(src.width / 2, src.height / 2);
  ctx.transform(1, 0, amount, 1, 0, 0);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return canvas;
}

/** Non-uniform rescale inside the same frame (keeps the piece registered). */
export function rescale(src, sx, sy = sx) {
  const { canvas, ctx } = createCanvas(src.width, src.height);
  ctx.translate(src.width / 2, src.height / 2);
  ctx.scale(sx, sy);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return canvas;
}

/* ------------------------------------------------------------------ output */

export function canvasToBlob(canvas, type = 'image/png', quality = 0.94) {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

export async function downloadCanvas(canvas, filename) {
  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Decode a File/Blob into an <img> that is safe to draw immediately. */
export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not read ${file.name || 'that image'}`)); };
    img.src = url;
  });
}
