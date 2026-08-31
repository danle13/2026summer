/**
 * landmarkIndices.js — the handful of MediaPipe FaceMesh vertex groups this app
 * cares about, out of the 478 the model returns.
 *
 * A note on naming: MediaPipe labels groups from the *subject's* point of view,
 * so `MP_LEFT_EYE` shows up on the right-hand side of the picture. Nothing
 * downstream relies on that — regions.js assigns sides by comparing x, so a
 * mirrored selfie or a swapped constant can't quietly put a brow on the wrong
 * eye.
 */

export const MP_RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
export const MP_LEFT_EYE  = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];

export const MP_RIGHT_BROW = [70, 63, 105, 66, 107, 46, 53, 52, 65, 55];
export const MP_LEFT_BROW  = [300, 293, 334, 296, 336, 276, 283, 282, 295, 285];

export const MP_LIPS = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
  409, 270, 269, 267, 0, 37, 39, 40, 185,
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308,
];

export const MP_NOSE = [
  168, 6, 197, 195, 5, 4, 1, 19, 94, 2,
  98, 97, 326, 327, 115, 344, 220, 440, 45, 275,
  131, 360, 49, 279, 48, 278, 64, 294,
];

export const MP_FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
  378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
  162, 21, 54, 103, 67, 109,
];

/** Jaw line and chin — everything on the oval from ear level down. */
export const MP_JAW = [
  132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361,
];

/** Brow line up to the hairline the mesh can see. */
export const MP_FOREHEAD = [10, 338, 297, 332, 284, 251, 21, 54, 103, 67, 109, 151, 9];

/** Single landmarks worth naming. */
export const MP_NOSE_TIP     = 1;
export const MP_CHIN_BOTTOM  = 152;
export const MP_FOREHEAD_TOP = 10;
export const MP_MOUTH_CENTER = 13;

/** Pull a group out of the flat landmark array, scaled into pixel space. */
export function groupPoints(landmarks, indices, width, height) {
  const out = [];
  for (const i of indices) {
    const p = landmarks[i];
    if (!p) continue;
    out.push({ x: p.x * width, y: p.y * height });
  }
  return out;
}

export function pointAt(landmarks, index, width, height) {
  const p = landmarks[index];
  return p ? { x: p.x * width, y: p.y * height } : null;
}
