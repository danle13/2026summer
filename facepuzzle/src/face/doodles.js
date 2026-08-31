/**
 * doodles.js — hand-drawn cartoon parts, generated procedurally.
 *
 * These are the deliberately silly options: nobody will mistake a doodled nose
 * for a real one, which is exactly the point in Studio. They are drawn onto a
 * disc of the destination face's own skin tone so they still sit on a face
 * instead of floating in a white box.
 */

import { createCanvas } from '../lib/canvas.js';
import { randFloat, randInt, pick } from '../lib/random.js';
import { TAU } from '../lib/geometry.js';

const INK = '#2b2320';

/**
 * @param {string} slot   slot id the doodle must fill
 * @param {{w:number,h:number}} size
 * @param {function} rng
 * @param {{r:number,g:number,b:number}} skin  tone to sit the doodle on
 * @returns {{canvas: HTMLCanvasElement, note: string}}
 */
export function drawDoodle(slot, size, rng, skin) {
  const { canvas, ctx } = createCanvas(size.w, size.h);
  paintSkinDisc(ctx, size, skin, rng);

  ctx.save();
  ctx.translate(size.w / 2, size.h / 2);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;

  const draw = DOODLES[slot] || DOODLES.nose;
  const note = draw(ctx, size, rng);
  ctx.restore();

  return { canvas, note };
}

function paintSkinDisc(ctx, size, skin, rng) {
  const wobble = randFloat(rng, 0.92, 1.02);
  const grad = ctx.createRadialGradient(
    size.w / 2, size.h * 0.42, size.w * 0.1,
    size.w / 2, size.h / 2, size.w * 0.62,
  );
  const base = `${Math.round(skin.r)},${Math.round(skin.g)},${Math.round(skin.b)}`;
  grad.addColorStop(0, `rgba(${base},1)`);
  grad.addColorStop(0.72, `rgba(${base},.98)`);
  grad.addColorStop(1, `rgba(${base},0)`);
  ctx.fillStyle = grad;
  ctx.save();
  ctx.translate(size.w / 2, size.h / 2);
  ctx.scale(1, wobble);
  ctx.beginPath();
  ctx.ellipse(0, 0, size.w / 2, size.h / 2, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/* Each drawer works in a centred coordinate system and returns a caption. */

const DOODLES = {
  nose(ctx, { w, h }, rng) {
    const style = pick(rng, ['button', 'roman', 'snout', 'beak']);
    ctx.lineWidth = Math.max(3, w * 0.045);
    const s = randFloat(rng, 0.7, 1);
    ctx.beginPath();
    if (style === 'button') {
      ctx.moveTo(-w * 0.02, -h * 0.28 * s);
      ctx.quadraticCurveTo(w * 0.12 * s, 0, -w * 0.02, h * 0.14 * s);
      ctx.quadraticCurveTo(-w * 0.14 * s, h * 0.2 * s, -w * 0.16 * s, h * 0.06 * s);
    } else if (style === 'roman') {
      ctx.moveTo(-w * 0.06, -h * 0.34 * s);
      ctx.lineTo(w * 0.14 * s, h * 0.06 * s);
      ctx.quadraticCurveTo(w * 0.02, h * 0.24 * s, -w * 0.16 * s, h * 0.12 * s);
    } else if (style === 'snout') {
      ctx.ellipse(0, h * 0.04, w * 0.24 * s, h * 0.2 * s, 0, 0, TAU);
    } else {
      ctx.moveTo(-w * 0.16, -h * 0.3 * s);
      ctx.quadraticCurveTo(w * 0.3 * s, -h * 0.02, -w * 0.04, h * 0.26 * s);
    }
    ctx.stroke();

    // Nostrils.
    ctx.beginPath();
    const nr = w * randFloat(rng, 0.03, 0.055);
    ctx.ellipse(-w * 0.1, h * 0.18, nr, nr * 0.7, 0.3, 0, TAU);
    ctx.ellipse(w * 0.1, h * 0.18, nr, nr * 0.7, -0.3, 0, TAU);
    ctx.fill();
    return `A doodled ${style} nose`;
  },

  mouth(ctx, { w, h }, rng) {
    const mood = pick(rng, ['grin', 'smirk', 'pout', 'gasp', 'squiggle']);
    ctx.lineWidth = Math.max(3, w * 0.035);
    ctx.beginPath();
    if (mood === 'grin') {
      ctx.moveTo(-w * 0.26, -h * 0.02);
      ctx.quadraticCurveTo(0, h * 0.32, w * 0.26, -h * 0.02);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-w * 0.26, -h * 0.02);
      ctx.lineTo(w * 0.26, -h * 0.02);
    } else if (mood === 'smirk') {
      ctx.moveTo(-w * 0.24, h * 0.08);
      ctx.quadraticCurveTo(w * 0.02, h * 0.2, w * 0.26, -h * 0.12);
    } else if (mood === 'pout') {
      ctx.ellipse(0, h * 0.04, w * 0.13, h * 0.17, 0, 0, TAU);
    } else if (mood === 'gasp') {
      ctx.ellipse(0, h * 0.04, w * 0.2, h * 0.26, 0, 0, TAU);
    } else {
      ctx.moveTo(-w * 0.28, 0);
      for (let i = 1; i <= 6; i++) {
        ctx.lineTo(-w * 0.28 + (w * 0.56 * i) / 6, (i % 2 ? -1 : 1) * h * 0.12);
      }
    }
    ctx.stroke();
    return `A doodled ${mood}`;
  },

  eyeL(ctx, size, rng) { return eye(ctx, size, rng); },
  eyeR(ctx, size, rng) { return eye(ctx, size, rng); },

  browL(ctx, size, rng) { return brow(ctx, size, rng); },
  browR(ctx, size, rng) { return brow(ctx, size, rng); },

  hair(ctx, { w, h }, rng) {
    const style = pick(rng, ['spikes', 'curls', 'fringe', 'bald']);
    ctx.lineWidth = Math.max(4, w * 0.022);
    if (style === 'spikes') {
      ctx.beginPath();
      const n = randInt(rng, 5, 9);
      for (let i = 0; i <= n; i++) {
        const x = -w * 0.42 + (w * 0.84 * i) / n;
        ctx.lineTo(x, i % 2 ? -h * 0.34 : h * 0.02);
      }
      ctx.stroke();
    } else if (style === 'curls') {
      for (let i = 0; i < randInt(rng, 5, 8); i++) {
        ctx.beginPath();
        ctx.arc(-w * 0.36 + (w * 0.72 * i) / 6, -h * 0.1, h * randFloat(rng, 0.1, 0.18), Math.PI, TAU);
        ctx.stroke();
      }
    } else if (style === 'fringe') {
      ctx.beginPath();
      ctx.moveTo(-w * 0.44, -h * 0.3);
      ctx.quadraticCurveTo(0, h * 0.26, w * 0.44, -h * 0.3);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(w * 0.16, -h * 0.12, h * 0.1, 0, TAU); // a single defiant hair's shine
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -h * 0.05);
      ctx.quadraticCurveTo(w * 0.05, -h * 0.4, w * 0.12, -h * 0.22);
      ctx.stroke();
    }
    return `Doodled ${style} hair`;
  },

  chin(ctx, { w, h }, rng) {
    const style = pick(rng, ['beard', 'cleft', 'stubble', 'goatee']);
    ctx.lineWidth = Math.max(3, w * 0.028);
    if (style === 'beard') {
      ctx.beginPath();
      ctx.moveTo(-w * 0.3, -h * 0.2);
      ctx.quadraticCurveTo(0, h * 0.42, w * 0.3, -h * 0.2);
      ctx.stroke();
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        const x = -w * 0.24 + (w * 0.48 * i) / 6;
        ctx.moveTo(x, h * 0.02);
        ctx.lineTo(x + randFloat(rng, -6, 6), h * randFloat(rng, 0.18, 0.3));
        ctx.stroke();
      }
    } else if (style === 'cleft') {
      ctx.beginPath();
      ctx.moveTo(0, h * 0.02);
      ctx.lineTo(0, h * 0.2);
      ctx.stroke();
    } else if (style === 'goatee') {
      ctx.beginPath();
      ctx.ellipse(0, h * 0.14, w * 0.1, h * 0.19, 0, 0, TAU);
      ctx.fill();
    } else {
      for (let i = 0; i < 40; i++) {
        ctx.beginPath();
        ctx.arc(randFloat(rng, -w * 0.3, w * 0.3), randFloat(rng, -h * 0.05, h * 0.28), 1.6, 0, TAU);
        ctx.fill();
      }
    }
    return `A doodled ${style}`;
  },
};

function eye(ctx, { w, h }, rng) {
  const style = pick(rng, ['wide', 'sleepy', 'wink', 'starry', 'googly']);
  ctx.lineWidth = Math.max(3, w * 0.035);
  const rx = w * randFloat(rng, 0.2, 0.28);
  const ry = h * randFloat(rng, 0.16, 0.26);

  if (style === 'wink') {
    ctx.beginPath();
    ctx.moveTo(-rx, 0);
    ctx.quadraticCurveTo(0, ry * 0.9, rx, 0);
    ctx.stroke();
    return 'A doodled wink';
  }

  ctx.beginPath();
  ctx.ellipse(0, 0, rx, style === 'sleepy' ? ry * 0.55 : ry, 0, 0, TAU);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  const pr = Math.min(rx, ry) * (style === 'googly' ? 0.42 : 0.6);
  const offset = style === 'googly' ? randFloat(rng, -rx * 0.35, rx * 0.35) : 0;
  ctx.fillStyle = INK;
  ctx.arc(offset, style === 'sleepy' ? ry * 0.1 : 0, pr, 0, TAU);
  ctx.fill();

  if (style === 'starry') {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-pr * 0.35, -pr * 0.35, pr * 0.34, 0, TAU);
    ctx.fill();
  }
  return `A doodled ${style} eye`;
}

function brow(ctx, { w, h }, rng) {
  const style = pick(rng, ['caterpillar', 'arch', 'angry', 'thin', 'wiggle']);
  ctx.lineWidth = Math.max(3, h * (style === 'caterpillar' ? 0.34 : style === 'thin' ? 0.08 : 0.18));
  ctx.beginPath();
  const half = w * 0.3;
  if (style === 'arch')       { ctx.moveTo(-half, h * 0.08); ctx.quadraticCurveTo(0, -h * 0.3, half, h * 0.08); }
  else if (style === 'angry') { ctx.moveTo(-half, -h * 0.14); ctx.lineTo(half, h * 0.14); }
  else if (style === 'wiggle') {
    ctx.moveTo(-half, 0);
    for (let i = 1; i <= 5; i++) ctx.lineTo(-half + (half * 2 * i) / 5, (i % 2 ? -1 : 1) * h * 0.1);
  } else { ctx.moveTo(-half, 0); ctx.quadraticCurveTo(0, -h * 0.14, half, h * 0.02); }
  ctx.stroke();
  return `A doodled ${style} brow`;
}
