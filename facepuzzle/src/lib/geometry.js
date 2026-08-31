/**
 * geometry.js — rectangles and points. Every "part" of a face is ultimately a
 * rect in source-image pixels plus a rotation, so this is the shared vocabulary.
 */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const TAU   = Math.PI * 2;

/** Degrees to radians. Warp amounts read better in degrees. */
export const rad = d => (d * Math.PI) / 180;


/** Axis-aligned bounding box of a list of {x,y}. */
export function bbox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function centroid(points) {
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  return { x: sx / points.length, y: sy / points.length };
}

/** Grow a rect by a fraction of its own size (or absolute px when `abs`). */
export function padRect(rect, fx, fy = fx, abs = false) {
  const dx = abs ? fx : rect.w * fx;
  const dy = abs ? fy : rect.h * fy;
  return { x: rect.x - dx, y: rect.y - dy, w: rect.w + dx * 2, h: rect.h + dy * 2 };
}

/** Force a rect to a given aspect ratio by growing the short side. */
export function fitAspect(rect, aspect) {
  const current = rect.w / rect.h;
  if (Math.abs(current - aspect) < 1e-4) return { ...rect };
  if (current < aspect) {
    const w = rect.h * aspect;
    return { x: rect.x - (w - rect.w) / 2, y: rect.y, w, h: rect.h };
  }
  const h = rect.w / aspect;
  return { x: rect.x, y: rect.y - (h - rect.h) / 2, w: rect.w, h };
}

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const angleBetween = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
