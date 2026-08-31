/**
 * manualPicker.js — the fallback that makes the whole app dependable.
 *
 * When the detector is blocked, slow, or simply wrong, this asks for four
 * points: both pupils, the tip of the nose, the middle of the mouth. That's
 * enough for regions.js to lay out every other feature from average
 * proportions, and it works on drawings, dogs and statues too.
 */

import { el, clear } from '../lib/dom.js';

const STEPS = [
  { key: 'eyeL',    label: 'Left eye',  hint: 'Click the pupil of the eye on the LEFT of the picture.' },
  { key: 'eyeR',    label: 'Right eye', hint: 'Now the pupil of the eye on the RIGHT.' },
  { key: 'noseTip', label: 'Nose tip',  hint: 'The very tip of the nose.' },
  { key: 'mouth',   label: 'Mouth',     hint: 'The middle of the mouth, where the lips meet.' },
];

/**
 * @param {HTMLCanvasElement} source the (already downscaled) photo
 * @param {string} [reason] why we are asking
 * @returns {Promise<object|null>} anchors in source pixels, or null if cancelled
 */
export function requestAnchors(source, reason = '') {
  return new Promise(resolve => {
    let step = 0;
    const points = {};

    const stage = el('div.picker-stage');
    const preview = el('canvas');
    preview.width = source.width;
    preview.height = source.height;
    preview.getContext('2d').drawImage(source, 0, 0);
    stage.appendChild(preview);

    const stepRow = el('div.picker-steps');
    const hint = el('p.muted', { text: STEPS[0].hint });
    const backBtn = el('button.btn.btn-sm', { type: 'button', text: 'Undo point', disabled: true });
    const skipBtn = el('button.btn.btn-sm', { type: 'button', text: 'Cancel' });
    const doneBtn = el('button.btn.btn-sm.btn-primary', { type: 'button', text: 'Use these points', disabled: true });

    const card = el('div.picker-card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Point out the face' },
      el('h2', { text: 'Show me the face' }),
      reason ? el('p.muted', { text: reason }) : null,
      stepRow,
      stage,
      hint,
      el('div.picker-foot', backBtn, skipBtn, doneBtn),
    );
    const scrim = el('div.picker-scrim', card);

    function renderSteps() {
      clear(stepRow);
      STEPS.forEach((s, i) => {
        const cls = i < step ? 'picker-step done' : i === step ? 'picker-step active' : 'picker-step';
        stepRow.appendChild(el('span', { class: cls, text: `${i + 1}. ${s.label}` }));
      });
      hint.textContent = step < STEPS.length
        ? STEPS[step].hint
        : 'Looks good? Drop a point again to redo one, or carry on.';
      backBtn.disabled = step === 0;
      doneBtn.disabled = step < STEPS.length;
      if (step >= STEPS.length) doneBtn.focus();
    }

    function renderDots() {
      stage.querySelectorAll('.picker-dot').forEach(n => n.remove());
      STEPS.forEach((s, i) => {
        const p = points[s.key];
        if (!p) return;
        stage.appendChild(el('span.picker-dot', {
          text: String(i + 1),
          style: { left: `${(p.x / source.width) * 100}%`, top: `${(p.y / source.height) * 100}%` },
        }));
      });
    }

    function place(event) {
      if (step >= STEPS.length) return;
      const rect = preview.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * source.width;
      const y = ((event.clientY - rect.top) / rect.height) * source.height;
      points[STEPS[step].key] = { x, y };
      step++;
      renderSteps();
      renderDots();
    }

    stage.addEventListener('pointerdown', event => { event.preventDefault(); place(event); });

    backBtn.addEventListener('click', () => {
      if (step === 0) return;
      step--;
      delete points[STEPS[step].key];
      renderSteps();
      renderDots();
    });

    const close = value => {
      document.removeEventListener('keydown', onKey);
      scrim.remove();
      resolve(value);
    };

    skipBtn.addEventListener('click', () => close(null));
    doneBtn.addEventListener('click', () => close(step >= STEPS.length ? { ...points } : null));

    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); close(null); }
    }
    document.addEventListener('keydown', onKey);

    document.body.appendChild(scrim);
    renderSteps();
    skipBtn.focus();
  });
}
