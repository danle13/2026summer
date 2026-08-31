/**
 * detector.js — optional automatic face finding via MediaPipe Face Landmarker.
 *
 * This is deliberately a *nice to have*. The model and its wasm runtime come
 * from a CDN, which may be blocked, slow, or simply unavailable offline, so
 * every failure path resolves to `null` and the caller falls back to asking the
 * user to click four points. The app is fully playable either way.
 */

const TASKS_VERSION = '0.10.14';
const BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/vision_bundle.mjs`;
const WASM_ROOT  = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VERSION}/wasm`;
const MODEL_URL  = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/** Give up rather than leave someone staring at a spinner. */
const LOAD_TIMEOUT_MS = 14000;

export const DETECTOR_STATUS = {
  idle: 'idle',
  loading: 'loading',
  ready: 'ready',
  unavailable: 'unavailable',
};

let status = DETECTOR_STATUS.idle;
let landmarkerPromise = null;
let landmarker = null;

export const detectorStatus = () => status;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);
}

/**
 * Load the landmarker once. Concurrent callers share the same promise, and a
 * failed load is remembered so we don't retry the CDN on every upload.
 *
 * @returns {Promise<object|null>}
 */
export function ensureDetector() {
  if (landmarker) return Promise.resolve(landmarker);
  if (status === DETECTOR_STATUS.unavailable) return Promise.resolve(null);
  if (landmarkerPromise) return landmarkerPromise;

  status = DETECTOR_STATUS.loading;
  landmarkerPromise = withTimeout(loadLandmarker(), LOAD_TIMEOUT_MS, 'Face model')
    .then(instance => {
      landmarker = instance;
      status = DETECTOR_STATUS.ready;
      return instance;
    })
    .catch(err => {
      status = DETECTOR_STATUS.unavailable;
      console.info('[face-salad] automatic detection unavailable, falling back to manual:', err.message);
      return null;
    });

  return landmarkerPromise;
}

async function loadLandmarker() {
  const vision = await import(/* @vite-ignore */ BUNDLE_URL);
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);

  const options = delegate => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'IMAGE',
    numFaces: 6,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });

  // GPU is meaningfully faster but unavailable on plenty of machines; CPU is a
  // perfectly good backup for a handful of stills.
  try {
    return await vision.FaceLandmarker.createFromOptions(fileset, options('GPU'));
  } catch (gpuError) {
    console.info('[face-salad] GPU delegate refused, retrying on CPU:', gpuError.message);
    return await vision.FaceLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

/**
 * Find faces in a canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Array<Array<{x:number,y:number,z:number}>>>} landmark sets,
 *          biggest face first, or [] when detection is unavailable or empty.
 */
export async function detectFaces(canvas) {
  const instance = await ensureDetector();
  if (!instance) return [];

  let result;
  try {
    result = instance.detect(canvas);
  } catch (err) {
    console.warn('[face-salad] detection threw, treating as no-face:', err);
    return [];
  }

  const sets = result?.faceLandmarks || [];
  // Sort by on-screen area so "the face" means the one in the foreground.
  return sets
    .map(points => ({ points, area: spreadOf(points) }))
    .sort((a, b) => b.area - a.area)
    .map(entry => entry.points);
}

function spreadOf(points) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return (maxX - minX) * (maxY - minY);
}

/** Warm the model up while the visitor is still reading the landing page. */
export function prewarmDetector() {
  if (status === DETECTOR_STATUS.idle) {
    // requestIdleCallback keeps the fetch off the critical path.
    const kick = () => { ensureDetector(); };
    if ('requestIdleCallback' in window) requestIdleCallback(kick, { timeout: 2500 });
    else setTimeout(kick, 1200);
  }
}
