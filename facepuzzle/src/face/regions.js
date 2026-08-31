/**
 * regions.js — turns "where the features are" into "which rectangles to cut".
 *
 * Two entry points produce the same shape of result:
 *   • buildFromLandmarks() — 478 mesh points from the detector.
 *   • buildFromAnchors()   — four points a human clicked, or that a synthetic
 *                            sample face already knows about.
 *
 * Both funnel through the same framing maths so a hand-placed face crops
 * identically to a detected one, and pieces from either can be swapped freely.
 */

import { SLOTS, SLOT_BY_ID } from './slots.js';
import {
  MP_LEFT_EYE, MP_RIGHT_EYE, MP_LEFT_BROW, MP_RIGHT_BROW,
  MP_LIPS, MP_NOSE, MP_FACE_OVAL, MP_JAW, MP_FOREHEAD,
  MP_NOSE_TIP, MP_MOUTH_CENTER, groupPoints, pointAt,
} from './landmarkIndices.js';
import { bbox, centroid, padRect, fitAspect, dist, angleBetween, clamp } from '../lib/geometry.js';

/**
 * How big the square face crop is, as a multiple of the distance between the
 * pupils. 3.1 comfortably clears the jaw and leaves room for hair.
 */
const FACE_BOX_SCALE = 3.15;
/** How far below the eye line to centre that crop, again in eye-distances. */
const FACE_BOX_DROP = 0.42;

/**
 * @typedef {{x:number,y:number,w:number,h:number}} Rect
 * @typedef {{rect: Rect, angle: number}} Region
 * @typedef {{box: Rect, roll: number, eyeDist: number, regions: Record<string, Region>,
 *            anchors: object, quality: string}} FaceGeometry
 */

/** Square crop + roll, derived from the four anchors every path can supply. */
function frameFromAnchors({ eyeL, eyeR, noseTip, mouth }) {
  const eyeDist = Math.max(8, dist(eyeL, eyeR));
  const roll = angleBetween(eyeL, eyeR);
  const eyeMid = { x: (eyeL.x + eyeR.x) / 2, y: (eyeL.y + eyeR.y) / 2 };

  // Slide the crop centre down the face's own axis rather than screen-down, so
  // a tilted head still gets a centred crop.
  const down = { x: -Math.sin(-roll), y: Math.cos(-roll) };
  const size = eyeDist * FACE_BOX_SCALE;
  const cx = eyeMid.x + down.x * eyeDist * FACE_BOX_DROP;
  const cy = eyeMid.y + down.y * eyeDist * FACE_BOX_DROP;

  return {
    box: { x: cx - size / 2, y: cy - size / 2, w: size, h: size },
    roll, eyeDist, eyeMid,
    anchors: { eyeL, eyeR, noseTip, mouth },
  };
}

/** Grow a raw feature bbox by its slot's padding and lock it to the aspect. */
function shapeRegion(slotId, raw, roll) {
  const slot = SLOT_BY_ID[slotId];
  const padded = padRect(raw, slot.pad.x, slot.pad.y);
  const rect = fitAspect(padded, slot.aspect);
  return { rect, angle: roll };
}

/* ------------------------------------------------------- landmark pathway */

/**
 * @param {Array<{x:number,y:number,z:number}>} landmarks normalized mesh points
 * @param {number} width  source pixel width
 * @param {number} height source pixel height
 * @returns {FaceGeometry}
 */
export function buildFromLandmarks(landmarks, width, height) {
  const grab = idx => groupPoints(landmarks, idx, width, height);

  const eyeGroupA = grab(MP_LEFT_EYE);
  const eyeGroupB = grab(MP_RIGHT_EYE);
  const browGroupA = grab(MP_LEFT_BROW);
  const browGroupB = grab(MP_RIGHT_BROW);

  // Assign sides by picture position, never by the model's naming.
  const [eyeGroupLeft, eyeGroupRight] =
    centroid(eyeGroupA).x <= centroid(eyeGroupB).x ? [eyeGroupA, eyeGroupB] : [eyeGroupB, eyeGroupA];
  const [browGroupLeft, browGroupRight] =
    centroid(browGroupA).x <= centroid(browGroupB).x ? [browGroupA, browGroupB] : [browGroupB, browGroupA];

  const lips = grab(MP_LIPS);
  const nose = grab(MP_NOSE);
  const oval = grab(MP_FACE_OVAL);
  const jaw  = grab(MP_JAW);
  const brow = grab(MP_FOREHEAD);

  const frame = frameFromAnchors({
    eyeL: centroid(eyeGroupLeft),
    eyeR: centroid(eyeGroupRight),
    noseTip: pointAt(landmarks, MP_NOSE_TIP, width, height) || centroid(nose),
    mouth: pointAt(landmarks, MP_MOUTH_CENTER, width, height) || centroid(lips),
  });

  // The mesh stops at the visible hairline, so the "hair" piece is the forehead
  // band pushed upward by half an eye-distance to catch the fringe.
  const foreheadBox = bbox(brow);
  const hairRaw = {
    x: foreheadBox.x,
    y: foreheadBox.y - frame.eyeDist * 0.55,
    w: foreheadBox.w,
    h: foreheadBox.h + frame.eyeDist * 0.55,
  };

  // Jaw bbox alone hugs the outline too tightly; drop it a little to include
  // the underside of the chin.
  const jawBox = bbox(jaw);
  const chinRaw = { ...jawBox, h: jawBox.h + frame.eyeDist * 0.12 };

  const regions = {
    hair:  shapeRegion('hair',  hairRaw, frame.roll),
    chin:  shapeRegion('chin',  chinRaw, frame.roll),
    browL: shapeRegion('browL', bbox(browGroupLeft), frame.roll),
    browR: shapeRegion('browR', bbox(browGroupRight), frame.roll),
    eyeL:  shapeRegion('eyeL',  bbox(eyeGroupLeft), frame.roll),
    eyeR:  shapeRegion('eyeR',  bbox(eyeGroupRight), frame.roll),
    nose:  shapeRegion('nose',  bbox(nose), frame.roll),
    mouth: shapeRegion('mouth', bbox(lips), frame.roll),
  };

  return { ...frame, regions, oval, quality: 'detected' };
}

/* --------------------------------------------------------- anchor pathway */

/**
 * Derive every region from four clicked points using average face proportions.
 * Everything is expressed in eye-distances (`d`) and placed along the face's
 * own axes, so it survives a tilted head.
 *
 * @param {{eyeL:{x,y}, eyeR:{x,y}, noseTip:{x,y}, mouth:{x,y}}} anchors
 * @returns {FaceGeometry}
 */
export function buildFromAnchors(anchors) {
  const frame = frameFromAnchors(anchors);
  const d = frame.eyeDist;
  const cos = Math.cos(frame.roll), sin = Math.sin(frame.roll);

  // Local axes: `right` runs eye-to-eye, `down` is perpendicular to it.
  const right = { x: cos, y: sin };
  const down  = { x: -sin, y: cos };
  const at = (origin, alongRight, alongDown) => ({
    x: origin.x + right.x * alongRight * d + down.x * alongDown * d,
    y: origin.y + right.y * alongRight * d + down.y * alongDown * d,
  });
  const box = (center, w, h) => ({ x: center.x - (w * d) / 2, y: center.y - (h * d) / 2, w: w * d, h: h * d });

  const { eyeL, eyeR, noseTip, mouth } = anchors;
  const eyeMid = frame.eyeMid;

  const raw = {
    hair:  box(at(eyeMid, 0, -0.92), 1.95, 0.95),
    chin:  box(at(mouth, 0, 0.62), 1.55, 0.80),
    browL: box(at(eyeL, 0, -0.34), 0.62, 0.22),
    browR: box(at(eyeR, 0, -0.34), 0.62, 0.22),
    eyeL:  box(eyeL, 0.52, 0.28),
    eyeR:  box(eyeR, 0.52, 0.28),
    nose:  box(at(noseTip, 0, -0.16), 0.52, 0.62),
    mouth: box(mouth, 0.78, 0.40),
  };

  const regions = {};
  for (const slot of SLOTS) regions[slot.id] = shapeRegion(slot.id, raw[slot.id], frame.roll);

  return { ...frame, regions, oval: null, quality: 'estimated' };
}

/**
 * Sanity check before we commit to a geometry: the crop has to actually overlap
 * the picture, and the eyes have to be far enough apart to cut usable pieces.
 */
export function validateGeometry(geo, width, height) {
  if (!geo || !Number.isFinite(geo.eyeDist)) return 'That does not look like a face yet.';
  if (geo.eyeDist < 24) return 'That face is a little small to cut up — try a closer photo.';
  const cx = geo.box.x + geo.box.w / 2;
  const cy = geo.box.y + geo.box.h / 2;
  if (cx < 0 || cy < 0 || cx > width || cy > height) return 'The face seems to sit outside the picture.';
  return null;
}
export const rollDegrees = geo => clamp((geo.roll * 180) / Math.PI, -90, 90);
