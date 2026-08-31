/**
 * effects.js — the two bits of celebratory nonsense the game needs.
 */

import { reducedMotion } from '../lib/dom.js';

const COLORS = ['#e6502f', '#f0b429', '#2fa87c', '#7b5bd6', '#4a9fd8'];

/**
 * A short burst of paper. Skipped entirely for visitors who asked for less
 * motion — they still get the score, just not the parade.
 *
 * @param {{count?: number, origin?: {x:number,y:number}, spread?: number}} [opts]
 */
export function confetti({ count = 90, origin, spread = 1 } = {}) {
  if (reducedMotion()) return;

  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  document.body.appendChild(layer);

  const cx = origin?.x ?? window.innerWidth / 2;
  const cy = origin?.y ?? window.innerHeight * 0.34;
  const bits = [];

  for (let i = 0; i < count; i++) {
    const bit = document.createElement('i');
    const size = 6 + Math.random() * 8;
    Object.assign(bit.style, {
      position: 'absolute',
      left: `${cx}px`,
      top: `${cy}px`,
      width: `${size}px`,
      height: `${size * (0.4 + Math.random() * 0.8)}px`,
      background: COLORS[i % COLORS.length],
      borderRadius: Math.random() < 0.4 ? '50%' : '2px',
      willChange: 'transform, opacity',
    });
    layer.appendChild(bit);

    const angle = (Math.random() * Math.PI * 2);
    const speed = (5 + Math.random() * 11) * spread;
    bits.push({
      node: bit,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 6,
      spin: (Math.random() - 0.5) * 22,
      rot: 0,
      x: 0, y: 0,
      life: 1,
    });
  }

  let raf = 0;
  const start = performance.now();
  const tick = now => {
    const age = now - start;
    for (const bit of bits) {
      bit.vy += 0.42;             // gravity
      bit.vx *= 0.992;            // drag
      bit.x += bit.vx;
      bit.y += bit.vy;
      bit.rot += bit.spin;
      bit.life = Math.max(0, 1 - age / 2200);
      bit.node.style.transform = `translate(${bit.x}px, ${bit.y}px) rotate(${bit.rot}deg)`;
      bit.node.style.opacity = String(bit.life);
    }
    if (age < 2300) raf = requestAnimationFrame(tick);
    else { cancelAnimationFrame(raf); layer.remove(); }
  };
  raf = requestAnimationFrame(tick);
}

/** Shake an element to say "no". */
export function shake(node) {
  if (!node || reducedMotion()) return;
  node.classList.remove('shake');
  void node.offsetWidth; // restart the animation
  node.classList.add('shake');
  setTimeout(() => node.classList.remove('shake'), 420);
}
