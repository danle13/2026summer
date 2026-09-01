/**
 * main.js — bootstrap and traffic control.
 *
 * Owns the top bar, the file input, the busy overlay, and which view is
 * mounted. Views get an `app` object with the handful of things they can't do
 * for themselves (open a file picker, change mode, save to the fridge).
 */

import { $, $$, clear } from './lib/dom.js';
import { canvasToBlob } from './lib/canvas.js';
import { saveCreation } from './lib/storage.js';
import { renderShareCard } from './face/composite.js';
import { prewarmDetector } from './face/detector.js';
import { ingest, IngestCancelled, IngestError } from './pipeline.js';
import { requestAnchors } from './ui/manualPicker.js';
import { toast, toastOk, toastBad } from './ui/toast.js';
import {
  state, subscribe, setBusy, addFace, setMode, hasFaces, hero,
} from './store.js';

import * as introView from './ui/intro.js';
import * as studioView from './ui/studio.js';
import * as huntView from './ui/hunt.js';
import * as scatterView from './ui/scatter.js';
import * as galleryView from './ui/gallery.js';

const VIEWS = {
  intro:   { root: '#view-intro',   module: introView },
  studio:  { root: '#view-studio',  module: studioView },
  hunt:    { root: '#view-hunt',    module: huntView },
  scatter: { root: '#view-scatter', module: scatterView },
  gallery: { root: '#view-gallery', module: galleryView },
};

/** Modes that need at least one face loaded. */
const NEEDS_FACE = new Set(['studio', 'hunt', 'scatter']);

let mounted = null;      // { mode, controller }
const fileInput = $('#file-input');

/* ------------------------------------------------------------- app object */

const app = {
  goto(mode) {
    if (NEEDS_FACE.has(mode) && !hasFaces()) {
      toast('Add a photo first — then every mode unlocks.', { icon: '📸' });
      mode = 'intro';
    }
    setMode(mode);
  },

  openFiles() {
    fileInput.value = '';
    fileInput.click();
  },

  async handleFiles(files) {
    const images = Array.from(files).filter(f => !f.type || f.type.startsWith('image/'));
    if (!images.length) { toastBad('That did not look like an image.'); return; }

    for (const file of images.slice(0, 8)) {
      await loadOne(file);
    }
  },

  /**
   * Adopt a face from the bundled library as the one being rebuilt. The record
   * is already cut into pieces by the time it gets here, so this is just a
   * matter of adding it and switching view.
   */
  useStockFace(face) {
    if (state.faces.some(f => f.id === face.id)) {
      app.goto('studio');
      return;
    }
    addFace(face, { makeHero: !hasFaces() });
    toastOk(`${face.label} is in pieces.`);
    app.goto('studio');
  },

  /** Add a library face as spare parts without making it the hero. */
  addSpareFace(face) {
    if (state.faces.some(f => f.id === face.id)) return;
    addFace(face, { makeHero: false });
    toastOk(`${face.label} joined the parts bin.`);
  },

  /**
   * Frame a composite, turn it into a PNG and file it on the fridge.
   * @returns {Promise<boolean>} whether it actually got stored
   */
  async saveCreation({ canvas, title, subtitle, meta }) {
    try {
      const card = renderShareCard(canvas, { title, subtitle });
      const blob = await canvasToBlob(card);
      if (!blob) throw new Error('Could not encode the image');
      const id = await saveCreation({ blob, title, meta: { ...meta, subtitle } });
      if (!id) {
        toastBad('This browser will not let me store anything — try Download instead.');
        return false;
      }
      return true;
    } catch (err) {
      console.error('[face-salad] save failed', err);
      toastBad('Could not save that one.');
      return false;
    }
  },
};

/* ------------------------------------------------------------- ingest flow */

async function loadOne(file) {
  try {
    const faces = await ingest({
      input: file,
      requestAnchors: (source, reason) => {
        setBusy(null);
        return requestAnchors(source, reason);
      },
      onProgress: (label, sub) => setBusy(label, sub),
    });

    setBusy(null);
    for (const face of faces) addFace(face, { makeHero: !hasFaces() });

    if (faces.length > 1) toastOk(`Found ${faces.length} faces — they are all in the bin now.`);
    else toastOk(`${faces[0].label} is in pieces.`);

    app.goto('studio');
  } catch (err) {
    setBusy(null);
    if (err instanceof IngestCancelled) return;
    if (err instanceof IngestError) toastBad(err.message);
    else {
      console.error('[face-salad] ingest failed', err);
      toastBad('Something went wrong reading that picture.');
    }
  }
}

/* ---------------------------------------------------------------- chrome */

function mountView(mode) {
  if (mounted?.mode === mode) { mounted.controller.update?.('remount'); return; }

  mounted?.controller?.destroy?.();
  for (const config of Object.values(VIEWS)) $(config.root).hidden = true;

  const config = VIEWS[mode] || VIEWS.intro;
  const root = $(config.root);
  root.hidden = false;
  clear(root);
  mounted = { mode, controller: config.module.mount(root, app) };

  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function paintModeButtons() {
  for (const button of $$('#mode-nav .mode-btn')) {
    const mode = button.dataset.mode;
    button.setAttribute('aria-pressed', String(state.mode === mode));
    button.disabled = NEEDS_FACE.has(mode) && !hasFaces();
    button.title = button.disabled ? 'Add a photo to unlock this' : '';
  }
}

function paintBusy() {
  const scrim = $('#busy');
  if (!state.busy) { scrim.hidden = true; return; }
  $('#busy-label').textContent = state.busy.label;
  $('#busy-sub').textContent = state.busy.sub || '';
  scrim.hidden = false;
}

function paintTitle() {
  const face = hero();
  document.title = face ? `${face.label} — Face Salad` : 'Face Salad — scramble the people you love';
}

/* ------------------------------------------------------------------ setup */

function wire() {
  for (const button of $$('#mode-nav .mode-btn')) {
    button.addEventListener('click', () => app.goto(button.dataset.mode));
  }

  $('#btn-add-face').addEventListener('click', () => app.openFiles());

  fileInput.addEventListener('change', event => {
    const files = Array.from(event.target.files || []);
    if (files.length) app.handleFiles(files);
  });

  // Drop anywhere, not just on the intro's target.
  window.addEventListener('dragover', event => {
    if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
  });
  window.addEventListener('drop', event => {
    const files = Array.from(event.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    app.handleFiles(files);
  });

  // Paste a photo straight in.
  window.addEventListener('paste', event => {
    const files = Array.from(event.clipboardData?.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length) app.handleFiles(files);
  });

  document.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.querySelector('.picker-scrim')) return;

    const shortcuts = { 1: 'studio', 2: 'hunt', 3: 'scatter', 4: 'gallery', 0: 'intro' };
    if (shortcuts[event.key]) { event.preventDefault(); app.goto(shortcuts[event.key]); }
  });

  subscribe((_, reason) => {
    paintModeButtons();
    paintBusy();
    paintTitle();
    // Mount off the state rather than the reason: several actions change the
    // mode as a side effect, and the view must follow whatever caused it.
    if (state.mode !== mounted?.mode) mountView(state.mode);
    // A first face should drop you straight onto the table.
    if (reason === 'faces' && state.mode === 'intro' && hasFaces()) setMode('studio');
  });
}

function boot() {
  wire();
  paintModeButtons();
  paintBusy();
  mountView(state.mode);
  prewarmDetector();

  // Keeps the console honest about what this page does and does not do.
  console.info(
    '%cFace Salad%c — every photo is processed locally; there is no server to send it to.',
    'font-weight:700;color:#e6502f', 'color:inherit',
  );
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
