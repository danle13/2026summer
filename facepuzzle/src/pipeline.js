/**
 * pipeline.js — photo in, cut-up face out.
 *
 * Order of operations:
 *   1. decode and downscale the image
 *   2. ask the detector for landmarks
 *   3. if that fails or finds nothing, ask the *human* for four points
 *   4. build the geometry, cut the pieces
 *
 * A group photo is a gift: every face the detector finds becomes its own entry
 * in the parts bin, which is the fastest way to get real decoys.
 */

import { normalizeSource, loadImageFromFile } from './lib/canvas.js';
import { detectFaces, detectorStatus, DETECTOR_STATUS } from './face/detector.js';
import { buildFromLandmarks, buildFromAnchors, validateGeometry } from './face/regions.js';
import { extractFace } from './face/extract.js';
import { uid } from './lib/random.js';

/** Never ingest a whole class photo — the parts bin gets unusable. */
const MAX_FACES_PER_IMAGE = 6;

export class IngestError extends Error {}
export class IngestCancelled extends Error {}

/**
 * @param {object} opts
 * @param {File|HTMLImageElement|HTMLCanvasElement} opts.input
 * @param {string} [opts.label]
 * @param {(canvas: HTMLCanvasElement, reason: string) => Promise<object|null>} opts.requestAnchors
 *        Shown when detection can't help. Resolve with anchors, or null to cancel.
 * @param {(label: string, sub?: string) => void} [opts.onProgress]
 * @returns {Promise<Array<object>>} one face record per face found
 */
export async function ingest({ input, label, requestAnchors, onProgress = () => {} }) {
  onProgress('Reading the picture…');
  const source = await toCanvas(input);

  onProgress('Looking for a face…', detectorStatus() === DETECTOR_STATUS.loading
    ? 'first run downloads a small model'
    : '');

  let landmarkSets = [];
  try {
    landmarkSets = await detectFaces(source);
  } catch (err) {
    console.warn('[face-salad] detector error, falling back to manual', err);
  }

  const baseLabel = label || nameFrom(input);

  if (landmarkSets.length) {
    onProgress('Cutting it up…');
    const faces = [];
    for (const [index, points] of landmarkSets.slice(0, MAX_FACES_PER_IMAGE).entries()) {
      const geometry = buildFromLandmarks(points, source.width, source.height);
      if (validateGeometry(geometry, source.width, source.height)) continue;
      faces.push(extractFace({
        id: uid('face'),
        label: landmarkSets.length > 1 ? `${baseLabel} ${index + 1}` : baseLabel,
        source,
        geometry,
      }));
    }
    if (faces.length) return faces;
  }

  // Nothing automatic worked — hand it to the person at the keyboard.
  const reason = detectorStatus() === DETECTOR_STATUS.unavailable
    ? "Automatic face-finding isn't available here, so let's do it by hand — it takes ten seconds."
    : "I couldn't spot a face in that one. Point me at the important bits and we're away.";

  const anchors = await requestAnchors(source, reason);
  if (!anchors) throw new IngestCancelled('cancelled');

  const geometry = buildFromAnchors(anchors);
  const problem = validateGeometry(geometry, source.width, source.height);
  if (problem) throw new IngestError(problem);

  onProgress('Cutting it up…');
  return [extractFace({ id: uid('face'), label: baseLabel, source, geometry })];
}

/* ---------------------------------------------------------------- helpers */

async function toCanvas(input) {
  if (input instanceof HTMLCanvasElement) return normalizeSource(input);
  if (input instanceof HTMLImageElement) return normalizeSource(input);
  if (typeof File !== 'undefined' && input instanceof Blob) {
    if (input.type && !input.type.startsWith('image/')) {
      throw new IngestError(`${input.name || 'That file'} is not an image.`);
    }
    const image = await loadImageFromFile(input);
    return normalizeSource(image);
  }
  throw new IngestError('I do not know how to read that.');
}

/** A friendly default name: "aunt-jo.jpg" becomes "Aunt Jo". */
function nameFrom(input) {
  const raw = input?.name;
  if (!raw) return 'Mystery guest';
  const stem = raw.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
  if (!stem || /^(img|image|photo|dsc|pxl|screenshot)[\s\d]*$/i.test(stem)) return 'Mystery guest';
  return stem.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 24);
}
