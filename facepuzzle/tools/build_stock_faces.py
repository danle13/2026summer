#!/usr/bin/env python3
"""
Step 2 of the stock-face build: detect a face in each sliced cell, align it, and
write out the exact artefacts the browser needs at runtime.

The geometry here is a deliberate port of src/face/regions.js and
src/face/extract.js. Anything that changes there has to change here too, or a
stock face's pieces will not line up with a photo the visitor supplies. Keeping
the two in step is the price of shipping faces that need no detector to load.

Outputs, per accepted face:
  <out>/<id>.webp        the aligned square base frame
  <out>/manifest.json    per-face `rel` rectangles, tone and provenance

Usage:  python3 build_stock_faces.py <cell-dir> <out-dir> [--size 512]
"""
import argparse, json, math, pathlib, sys
import numpy as np
from PIL import Image, ImageFilter

import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

# --- these arrays mirror src/face/landmarkIndices.js -----------------------
MP_RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
MP_LEFT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466]
MP_RIGHT_BROW = [70, 63, 105, 66, 107, 46, 53, 52, 65, 55]
MP_LEFT_BROW = [300, 293, 334, 296, 336, 276, 283, 282, 295, 285]
MP_LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37,
           39, 40, 185, 78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308]
MP_NOSE = [168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 97, 326, 327, 115, 344, 220, 440,
           45, 275, 131, 360, 49, 279, 48, 278, 64, 294]
MP_JAW = [132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361]
MP_FOREHEAD = [10, 338, 297, 332, 284, 251, 21, 54, 103, 67, 109, 151, 9]
NOSE_TIP, MOUTH_CENTER = 1, 13

# --- these mirror src/face/slots.js ---------------------------------------
SLOTS = {
    'hair':  dict(aspect=1.85, pad=(0.05, 0.30)),
    'chin':  dict(aspect=1.45, pad=(0.03, 0.14)),
    'browL': dict(aspect=1.75, pad=(0.26, 0.85)),
    'browR': dict(aspect=1.75, pad=(0.26, 0.85)),
    'eyeL':  dict(aspect=1.55, pad=(0.24, 0.62)),
    'eyeR':  dict(aspect=1.55, pad=(0.24, 0.62)),
    'nose':  dict(aspect=0.92, pad=(0.16, 0.14)),
    'mouth': dict(aspect=1.50, pad=(0.18, 0.55)),
}
FACE_BOX_SCALE = 3.15   # regions.js
FACE_BOX_DROP = 0.42    # regions.js

MODEL_URL = ('https://storage.googleapis.com/mediapipe-models/face_landmarker/'
             'face_landmarker/float16/1/face_landmarker.task')

# --- acceptance thresholds -------------------------------------------------
MIN_EYE_DIST = 84       # px in the source cell; below this the crop is mush
MAX_ROLL_DEG = 11
MAX_YAW_RATIO = 0.16    # asymmetry of nose-to-eye distances
MIN_INSIDE = 0.82       # fraction of the face box that must be real pixels


def group(landmarks, idx, w, h):
    return np.array([[landmarks[i].x * w, landmarks[i].y * h] for i in idx])


def bbox(points):
    x0, y0 = points.min(axis=0)
    x1, y1 = points.max(axis=0)
    return [x0, y0, x1 - x0, y1 - y0]


def pad_rect(rect, fx, fy):
    x, y, w, h = rect
    dx, dy = w * fx, h * fy
    return [x - dx, y - dy, w + dx * 2, h + dy * 2]


def fit_aspect(rect, aspect):
    x, y, w, h = rect
    current = w / h
    if abs(current - aspect) < 1e-4:
        return [x, y, w, h]
    if current < aspect:
        nw = h * aspect
        return [x - (nw - w) / 2, y, nw, h]
    nh = w / aspect
    return [x, y - (nh - h) / 2, w, nh]


def build_geometry(landmarks, w, h):
    """Faithful port of buildFromLandmarks()."""
    eye_a, eye_b = group(landmarks, MP_LEFT_EYE, w, h), group(landmarks, MP_RIGHT_EYE, w, h)
    brow_a, brow_b = group(landmarks, MP_LEFT_BROW, w, h), group(landmarks, MP_RIGHT_BROW, w, h)

    # Sides are assigned by picture position, never by the model's naming.
    eye_l, eye_r = (eye_a, eye_b) if eye_a[:, 0].mean() <= eye_b[:, 0].mean() else (eye_b, eye_a)
    brow_l, brow_r = (brow_a, brow_b) if brow_a[:, 0].mean() <= brow_b[:, 0].mean() else (brow_b, brow_a)

    lips = group(landmarks, MP_LIPS, w, h)
    nose = group(landmarks, MP_NOSE, w, h)
    jaw = group(landmarks, MP_JAW, w, h)
    brow_band = group(landmarks, MP_FOREHEAD, w, h)

    c_l, c_r = eye_l.mean(axis=0), eye_r.mean(axis=0)
    eye_dist = max(8.0, float(np.hypot(*(c_r - c_l))))
    roll = math.atan2(c_r[1] - c_l[1], c_r[0] - c_l[0])
    eye_mid = (c_l + c_r) / 2

    down = np.array([-math.sin(-roll), math.cos(-roll)])
    size = eye_dist * FACE_BOX_SCALE
    centre = eye_mid + down * eye_dist * FACE_BOX_DROP
    box = [centre[0] - size / 2, centre[1] - size / 2, size, size]

    fb = bbox(brow_band)
    hair_raw = [fb[0], fb[1] - eye_dist * 0.55, fb[2], fb[3] + eye_dist * 0.55]
    jb = bbox(jaw)
    chin_raw = [jb[0], jb[1], jb[2], jb[3] + eye_dist * 0.12]

    raw = {
        'hair': hair_raw, 'chin': chin_raw,
        'browL': bbox(brow_l), 'browR': bbox(brow_r),
        'eyeL': bbox(eye_l), 'eyeR': bbox(eye_r),
        'nose': bbox(nose), 'mouth': bbox(lips),
    }
    regions = {k: fit_aspect(pad_rect(v, *SLOTS[k]['pad']), SLOTS[k]['aspect'])
               for k, v in raw.items()}

    nose_tip = np.array([landmarks[NOSE_TIP].x * w, landmarks[NOSE_TIP].y * h])
    yaw_ratio = abs(np.hypot(*(nose_tip - c_l)) - np.hypot(*(nose_tip - c_r))) / eye_dist

    return dict(box=box, roll=roll, eye_dist=eye_dist, regions=regions,
                yaw_ratio=float(yaw_ratio))


def relative_regions(geo):
    """Port of relativeRegions() — regions expressed inside the upright crop."""
    bx, by, bw, bh = geo['box']
    cx, cy = bx + bw / 2, by + bh / 2
    cos, sin = math.cos(geo['roll']), math.sin(geo['roll'])
    out = {}
    for slot, (rx, ry, rw, rh) in geo['regions'].items():
        rcx, rcy = rx + rw / 2, ry + rh / 2
        dx, dy = rcx - cx, rcy - cy
        ux = dx * cos + dy * sin
        uy = -dx * sin + dy * cos
        out[slot] = dict(
            x=round((ux - rw / 2) / bw + 0.5, 5),
            y=round((uy - rh / 2) / bh + 0.5, 5),
            w=round(rw / bw, 5),
            h=round(rh / bh, 5),
        )
    return out


def render_base(image, geo, size):
    """Port of renderBase(): blurred backdrop, then the de-rotated square crop."""
    bx, by, bw, _ = geo['box']
    cx, cy = bx + bw / 2, by + bw / 2
    scale = size / bw

    # Backdrop, so a crop running off the edge of the cell has something behind it.
    backdrop = image.resize((size, size), Image.LANCZOS).filter(ImageFilter.GaussianBlur(18))

    # PIL's affine takes the inverse map: output (x, y) -> source coordinates.
    inv = 1 / scale
    cos, sin = math.cos(-geo['roll']), math.sin(-geo['roll'])
    a, b = cos * inv, sin * inv
    c = cx - (size / 2) * a - (size / 2) * b
    d, e = -sin * inv, cos * inv
    f = cy - (size / 2) * d - (size / 2) * e

    warped = image.transform((size, size), Image.AFFINE, (a, b, c, d, e, f),
                             resample=Image.BICUBIC, fillcolor=None)

    # Anything the affine could not fill is transparent-ish black; mask it in.
    mask = Image.new('L', image.size, 255).transform(
        (size, size), Image.AFFINE, (a, b, c, d, e, f), resample=Image.BICUBIC, fillcolor=0)
    out = backdrop.copy()
    out.paste(warped, (0, 0), mask)
    return out, mask


def inside_fraction(mask):
    return float(np.asarray(mask).mean() / 255)


def tone_of(base, rel):
    """Mean colour of both cheeks — used to sort and describe the library."""
    pixels = np.asarray(base.convert('RGB')).astype(np.float32)
    h, w, _ = pixels.shape
    eye, nose = rel['eyeL'], rel['nose']
    y0 = int((eye['y'] + eye['h'] * 0.9) * h)
    y1 = int((nose['y'] + nose['h'] * 0.8) * h)
    patches = []
    for x0f, x1f in ((0.16, 0.30), (0.70, 0.84)):
        patch = pixels[max(0, y0):max(1, y1), int(x0f * w):int(x1f * w)]
        if patch.size:
            patches.append(patch.reshape(-1, 3))
    if not patches:
        return [128, 128, 128]
    return [int(v) for v in np.concatenate(patches).mean(axis=0)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cells')
    ap.add_argument('out')
    ap.add_argument('--size', type=int, default=512)
    ap.add_argument('--model', default='face_landmarker.task')
    ap.add_argument('--quality', type=int, default=82)
    args = ap.parse_args()

    model_path = pathlib.Path(args.model)
    if not model_path.exists():
        sys.exit(f'missing model: download {MODEL_URL} to {model_path}')

    out_dir = pathlib.Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    landmarker = mp_vision.FaceLandmarker.create_from_options(
        mp_vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(model_path)),
            running_mode=mp_vision.RunningMode.IMAGE,
            num_faces=2,
        ))

    records, rejected = [], {}
    for cell_path in sorted(pathlib.Path(args.cells).glob('*.png')):
        image = Image.open(cell_path).convert('RGB')
        w, h = image.size
        result = landmarker.detect(mp.Image(
            image_format=mp.ImageFormat.SRGB, data=np.asarray(image)))

        def reject(why):
            rejected[why] = rejected.get(why, 0) + 1

        if not result.face_landmarks:
            reject('no face'); continue
        if len(result.face_landmarks) > 1:
            reject('multiple faces'); continue

        geo = build_geometry(result.face_landmarks[0], w, h)
        if geo['eye_dist'] < MIN_EYE_DIST:
            reject('face too small'); continue
        if abs(math.degrees(geo['roll'])) > MAX_ROLL_DEG:
            reject('rolled'); continue
        if geo['yaw_ratio'] > MAX_YAW_RATIO:
            reject('turned away'); continue

        base, mask = render_base(image, geo, args.size)
        if inside_fraction(mask) < MIN_INSIDE:
            reject('crop runs off the edge'); continue

        rel = relative_regions(geo)
        face_id = cell_path.stem
        base.save(out_dir / f'{face_id}.webp', quality=args.quality, method=6)
        records.append(dict(
            id=face_id,
            sheet=face_id.split('_r')[0],
            rel=rel,
            tone=tone_of(base, rel),
            eyeDist=round(geo['eye_dist'], 1),
            roll=round(math.degrees(geo['roll']), 2),
        ))

    (out_dir / 'manifest.json').write_text(json.dumps(records, indent=1))
    print(f'accepted {len(records)} / {len(records) + sum(rejected.values())}')
    for why, n in sorted(rejected.items(), key=lambda kv: -kv[1]):
        print(f'  rejected {n:>3}  {why}')


if __name__ == '__main__':
    main()
