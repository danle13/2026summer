/**
 * samples.js — three painted stand-in portraits so the app is playable before
 * anyone trusts it with a photo of their mum.
 *
 * They are drawn, not photographed, so no face detector is involved: each one
 * hands back the four anchor points it was built around and goes straight down
 * the same pipeline a hand-placed face uses.
 */

import { createCanvas } from '../lib/canvas.js';
import { makeRng, hashSeed, randFloat, pick } from '../lib/random.js';
import { TAU } from '../lib/geometry.js';

const W = 560, H = 700;

export const SAMPLE_PRESETS = [
  { id: 'pip',   label: 'Pip',   skin: [236, 197, 168], hair: '#3a2a1f', eye: '#4a6b8a', wide: 1.00, long: 1.00 },
  { id: 'nova',  label: 'Nova',  skin: [142, 100, 72],  hair: '#1d1512', eye: '#3b2a1e', wide: 1.07, long: 0.95 },
  { id: 'wren',  label: 'Wren',  skin: [206, 160, 132], hair: '#7c4a24', eye: '#4b6f4a', wide: 0.93, long: 1.06 },
];

/**
 * @param {string} id one of SAMPLE_PRESETS
 * @returns {{canvas: HTMLCanvasElement, anchors: object, label: string}}
 */
export function drawSampleFace(id) {
  const preset = SAMPLE_PRESETS.find(p => p.id === id) || SAMPLE_PRESETS[0];
  const rng = makeRng(hashSeed(preset.id));
  const { canvas, ctx } = createCanvas(W, H);

  const skin = preset.skin;
  const rgb = (arr, shift = 0, alpha = 1) =>
    `rgba(${clamp255(arr[0] + shift)},${clamp255(arr[1] + shift)},${clamp255(arr[2] + shift)},${alpha})`;

  // Studio backdrop.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#cfd8d6');
  bg.addColorStop(1, '#9fada9');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2;
  const headCy = H * 0.46;
  const headRx = W * 0.30 * preset.wide;
  const headRy = H * 0.30 * preset.long;

  // Neck and shoulders.
  ctx.fillStyle = rgb(skin, -26);
  ctx.beginPath();
  ctx.roundRect(cx - headRx * 0.42, headCy + headRy * 0.5, headRx * 0.84, H, 40);
  ctx.fill();
  ctx.fillStyle = '#4b5a63';
  ctx.beginPath();
  ctx.ellipse(cx, H * 1.02, W * 0.52, H * 0.2, 0, 0, TAU);
  ctx.fill();

  // Hair behind the head.
  ctx.fillStyle = preset.hair;
  ctx.beginPath();
  ctx.ellipse(cx, headCy - headRy * 0.16, headRx * 1.14, headRy * 1.1, 0, 0, TAU);
  ctx.fill();

  // Head.
  const face = ctx.createRadialGradient(cx - headRx * 0.3, headCy - headRy * 0.35, headRx * 0.1, cx, headCy, headRx * 1.35);
  face.addColorStop(0, rgb(skin, 18));
  face.addColorStop(0.6, rgb(skin, 0));
  face.addColorStop(1, rgb(skin, -42));
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.ellipse(cx, headCy, headRx, headRy, 0, 0, TAU);
  ctx.fill();

  // Jaw shadow, so the chin piece has something to be.
  ctx.fillStyle = rgb(skin, -30, 0.5);
  ctx.beginPath();
  ctx.ellipse(cx, headCy + headRy * 0.58, headRx * 0.72, headRy * 0.30, 0, 0, Math.PI);
  ctx.fill();

  // Ears.
  for (const side of [-1, 1]) {
    ctx.fillStyle = rgb(skin, -14);
    ctx.beginPath();
    ctx.ellipse(cx + side * headRx * 0.98, headCy + headRy * 0.06, headRx * 0.11, headRy * 0.17, 0, 0, TAU);
    ctx.fill();
  }

  const eyeY = headCy - headRy * 0.10;
  const eyeDx = headRx * 0.40;
  const eyeRx = headRx * 0.19;
  const eyeRy = headRy * 0.085;

  // Brows.
  ctx.strokeStyle = preset.hair;
  ctx.lineWidth = headRy * 0.055;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const bx = cx + side * eyeDx;
    const by = eyeY - headRy * 0.19;
    ctx.beginPath();
    ctx.moveTo(bx - eyeRx * 1.05, by + headRy * 0.022);
    ctx.quadraticCurveTo(bx, by - headRy * 0.055, bx + eyeRx * 1.05, by + headRy * 0.012);
    ctx.stroke();
  }

  // Eyes.
  for (const side of [-1, 1]) {
    const ex = cx + side * eyeDx;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx, eyeRy, 0, 0, TAU);
    ctx.fillStyle = '#f4f0ea';
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = preset.eye;
    ctx.beginPath();
    ctx.arc(ex + side * eyeRx * 0.04, eyeY, eyeRy * 0.92, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#181310';
    ctx.beginPath();
    ctx.arc(ex + side * eyeRx * 0.04, eyeY, eyeRy * 0.42, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.beginPath();
    ctx.arc(ex + side * eyeRx * 0.04 - eyeRy * 0.3, eyeY - eyeRy * 0.32, eyeRy * 0.2, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(40,30,25,.75)';
    ctx.lineWidth = headRy * 0.016;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, eyeRx, eyeRy, 0, 0, TAU);
    ctx.stroke();
  }

  // Nose.
  const noseTipY = headCy + headRy * 0.28;
  ctx.strokeStyle = rgb(skin, -52, 0.75);
  ctx.lineWidth = headRy * 0.026;
  ctx.beginPath();
  ctx.moveTo(cx - headRx * 0.05, eyeY + headRy * 0.06);
  ctx.quadraticCurveTo(cx - headRx * 0.13, noseTipY - headRy * 0.02, cx - headRx * 0.02, noseTipY);
  ctx.stroke();
  ctx.fillStyle = rgb(skin, -60, 0.85);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * headRx * 0.10, noseTipY + headRy * 0.012, headRx * 0.035, headRy * 0.018, side * 0.35, 0, TAU);
    ctx.fill();
  }

  // Mouth.
  const mouthY = headCy + headRy * 0.55;
  const mouthW = headRx * 0.42;
  ctx.fillStyle = `rgba(${clamp255(skin[0] - 40)},${clamp255(skin[1] - 78)},${clamp255(skin[2] - 66)},.92)`;
  ctx.beginPath();
  ctx.moveTo(cx - mouthW, mouthY);
  ctx.quadraticCurveTo(cx, mouthY - headRy * 0.055, cx + mouthW, mouthY);
  ctx.quadraticCurveTo(cx, mouthY + headRy * 0.105, cx - mouthW, mouthY);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,30,26,.55)';
  ctx.lineWidth = headRy * 0.012;
  ctx.beginPath();
  ctx.moveTo(cx - mouthW, mouthY);
  ctx.quadraticCurveTo(cx, mouthY + headRy * 0.02, cx + mouthW, mouthY);
  ctx.stroke();

  // Fringe on top, so the "hair" piece is not just forehead.
  ctx.fillStyle = preset.hair;
  ctx.beginPath();
  ctx.moveTo(cx - headRx * 1.06, headCy - headRy * 0.30);
  ctx.quadraticCurveTo(cx - headRx * 0.5, headCy - headRy * 1.15, cx + headRx * 0.2, headCy - headRy * 0.98);
  ctx.quadraticCurveTo(cx + headRx * 1.1, headCy - headRy * 0.85, cx + headRx * 1.02, headCy - headRy * 0.18);
  ctx.quadraticCurveTo(cx + headRx * 0.55, headCy - headRy * 0.62, cx - headRx * 0.05, headCy - headRy * 0.55);
  ctx.quadraticCurveTo(cx - headRx * 0.72, headCy - headRy * 0.48, cx - headRx * 1.06, headCy - headRy * 0.30);
  ctx.fill();

  addFilmGrain(ctx, rng);

  return {
    canvas,
    label: preset.label,
    anchors: {
      eyeL: { x: cx - eyeDx, y: eyeY },
      eyeR: { x: cx + eyeDx, y: eyeY },
      noseTip: { x: cx, y: noseTipY },
      mouth: { x: cx, y: mouthY },
    },
  };
}

/** A whisper of noise stops the flat vector shapes reading as clip art. */
function addFilmGrain(ctx, rng) {
  ctx.save();
  ctx.globalAlpha = 0.045;
  for (let i = 0; i < 5200; i++) {
    ctx.fillStyle = pick(rng, ['#fff', '#000', '#b09070']);
    ctx.fillRect(randFloat(rng, 0, W), randFloat(rng, 0, H), 1.6, 1.6);
  }
  ctx.restore();
}

const clamp255 = v => Math.max(0, Math.min(255, Math.round(v)));
