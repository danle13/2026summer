/**
 * studio.js — the mix-and-match table.
 *
 * Pick a slot from the rail, pick an option from the grid, watch the face
 * change. The "truth meter" quietly tracks how much of the real person is left,
 * which turns idle swapping into a game all on its own.
 */

import { el, clear } from '../lib/dom.js';
import { SLOTS, SLOT_BY_ID } from '../face/slots.js';
import { SAMPLE_PRESETS } from '../face/samples.js';
import { KIND_LABELS, DIFFICULTIES, DIFFICULTY_IDS } from '../face/decoys.js';
import { renderComposite, renderPieceThumb } from '../face/composite.js';
import { downloadCanvas } from '../lib/canvas.js';
import {
  state, hero, subscribe, selectPiece, randomizeSelection, resetSelection,
  rebuildBin, setPref, setHero, notify, truthCount,
} from '../store.js';
import { toast, toastOk } from './toast.js';
import { confetti } from './effects.js';

/** Thumbnails are pure functions of (piece, style) — cache them per piece. */
const thumbCache = new WeakMap();
function thumbFor(piece, style) {
  let byStyle = thumbCache.get(piece);
  if (!byStyle) { byStyle = new Map(); thumbCache.set(piece, byStyle); }
  if (!byStyle.has(style)) byStyle.set(style, renderPieceThumb(piece, { style, size: 132 }));
  return byStyle.get(style);
}

export function mount(root, app) {
  clear(root);

  let activeSlot = SLOTS.find(s => s.id === 'nose')?.id ?? SLOTS[0].id;
  let revealed = false;

  /* ---------------------------------------------------------- the stage */

  const stageCanvas = el('canvas', { width: 720, height: 720, 'aria-label': 'The face you have built' });
  const badges = el('div.stage-badges');
  const truthFill = el('i.truth-fill');
  const truthLabel = el('span.truth-label');

  const revealBtn = toggleButton('👁️ Reveal the real ones', () => {
    revealed = !revealed;
    revealBtn.setAttribute('aria-pressed', String(revealed));
    paintOptions();
    paintRail();
  });

  const stage = el('div.stage',
    el('div.stage-canvas-wrap', stageCanvas, badges),
    el('div.truth-meter',
      el('span', { 'aria-hidden': 'true', text: '🧬' }),
      el('div.truth-bar', truthFill),
      truthLabel,
    ),
    el('div.stage-tools',
      el('button.btn.btn-primary.btn-sm', {
        type: 'button', on: { click: () => { randomizeSelection({ avoidReal: false }); } },
      }, '🎲 Scramble'),
      el('button.btn.btn-sm', {
        type: 'button', title: 'Every single piece from someone or something else',
        on: { click: () => { randomizeSelection({ avoidReal: true }); toast('Not one genuine piece left.', { icon: '👻' }); } },
      }, '👻 Total stranger'),
      el('button.btn.btn-sm', {
        type: 'button', on: { click: () => { resetSelection(); toastOk('Back to their actual face.'); } },
      }, '↩︎ Undo the damage'),
      el('span.spacer'),
      revealBtn,
    ),
    el('div.stage-tools',
      el('button.btn.btn-sm', { type: 'button', on: { click: saveToFridge } }, '🧲 Stick on the fridge'),
      el('button.btn.btn-sm', { type: 'button', on: { click: download } }, '⬇︎ Download'),
      el('span.spacer'),
      el('button.btn.btn-sm.btn-grape', {
        type: 'button', on: { click: () => app.goto('hunt') },
      }, '🕵️ Play Impostor Hunt'),
    ),
  );

  /* ---------------------------------------------------------- the panel */

  const faceTabs = el('div.face-tabs');
  const slotRail = el('div.slot-rail', { role: 'group', 'aria-label': 'Face parts' });
  const optionGrid = el('div.option-grid', { role: 'listbox', 'aria-label': 'Options for this part' });
  const optionHint = el('span.hint');

  const blendOut = el('output');
  const blendInput = el('input', {
    type: 'range', min: '0', max: '100', step: '5',
    value: String(Math.round(state.prefs.blend * 100)),
    'aria-label': 'Colour matching strength',
    on: { input: e => setPref('blend', Number(e.target.value) / 100) },
  });

  const perSlotOut = el('output');
  const perSlotInput = el('input', {
    type: 'range', min: '3', max: '10', step: '1',
    value: String(state.prefs.perSlot),
    'aria-label': 'Options offered per part',
    on: { input: e => setPref('perSlot', Number(e.target.value)) },
  });

  const styleBtn = toggleButton('🧩 Jigsaw edges', () => {
    setPref('style', state.prefs.style === 'jigsaw' ? 'soft' : 'jigsaw');
  });
  const seamsBtn = toggleButton('✂︎ Show the cuts', () => setPref('seams', !state.prefs.seams));
  const chaosBtn = toggleButton('🤪 Let it get silly', () => setPref('chaos', !state.prefs.chaos));

  const difficultyRow = el('div.switch-row');
  const borrowRow = el('div.row', { style: { gap: '.35rem' } });

  const panel = el('div',
    el('div.panel',
      el('div.panel-head', el('h3', 'Whose face are we wrecking?'), el('span.hint', 'others become spare parts')),
      faceTabs,
      el('div.row',
        el('button.btn.btn-sm', { type: 'button', on: { click: () => app.openFiles() } }, '＋ Add another person'),
        borrowRow,
      ),
    ),
    el('div.panel',
      el('div.panel-head', el('h3', 'Parts bin'), optionHint),
      slotRail,
      optionGrid,
      el('div.row', { style: { marginTop: '.7rem' } },
        el('button.btn.btn-sm', {
          type: 'button', title: 'Generate a fresh set of impostors',
          on: { click: () => { rebuildBin({ reseed: true, keepSelection: false }); notify('bin'); toast('New impostors dealt.', { icon: '🔄' }); } },
        }, '🔄 Deal again'),
      ),
    ),
    el('div.panel',
      el('div.panel-head', el('h3', 'Dials')),
      el('div.control-row', el('label', { for: 'blend-input', text: 'Skin blend' }), blendInput, blendOut),
      el('div.control-row', el('label', { for: 'perslot-input', text: 'Options each' }), perSlotInput, perSlotOut),
      el('p.tiny.muted', { style: { margin: '.5rem 0 .2rem' }, text: 'How hard the fake pieces try:' }),
      difficultyRow,
      el('div.switch-row', styleBtn, seamsBtn, chaosBtn),
    ),
  );

  blendInput.id = 'blend-input';
  perSlotInput.id = 'perslot-input';

  root.appendChild(el('div.wrap', el('div.studio', stage, panel)));

  /* ------------------------------------------------------------ painting */

  function paintComposite() {
    const face = hero();
    if (!face) return;
    renderComposite({
      hero: face,
      bin: state.bin,
      selection: state.selection,
      style: state.prefs.style,
      blend: state.prefs.blend,
      seams: state.prefs.seams,
      size: 720,
      into: stageCanvas,
    });

    const { real, total } = truthCount();
    const pct = total ? Math.round((real / total) * 100) : 0;
    truthFill.style.width = `${pct}%`;
    truthLabel.textContent = `${real}/${total} genuinely them`;

    clear(badges);
    badges.appendChild(el('span.pill', { text: face.label }));
    if (pct === 100) badges.appendChild(el('span.pill.pill-ok', 'untouched'));
    else if (pct === 0) badges.appendChild(el('span.pill.pill-bad', 'a complete stranger'));
    else badges.appendChild(el('span.pill.pill-warn', `${pct}% them`));
    if (face.geometry.quality === 'estimated') {
      badges.appendChild(el('span.pill', { title: 'Placed by hand rather than detected', text: 'hand-placed' }));
    }
  }

  function paintFaceTabs() {
    clear(faceTabs);
    for (const face of state.faces) {
      const isHero = face.id === state.heroId;
      const tab = el('button.face-tab', {
        type: 'button',
        'aria-pressed': String(isHero),
        title: isHero ? 'This is the face being rebuilt' : `Rebuild ${face.label} instead`,
        on: { click: () => setHero(face.id) },
      }, el('span.dot'), el('span', { text: face.label }));
      faceTabs.appendChild(tab);
    }
    if (state.faces.length === 1) {
      faceTabs.appendChild(el('span.tiny.muted', {
        style: { alignSelf: 'center' },
        text: 'Add a second person and their real features join the lineup.',
      }));
    }

    // Borrowing a painted sample is the quickest way to see what a *real*
    // second person does to the parts bin, so keep it one click from here.
    clear(borrowRow);
    const spare = SAMPLE_PRESETS.filter(p => !state.faces.some(f => f.label.startsWith(p.label)));
    for (const preset of spare) {
      borrowRow.appendChild(el('button.switch', {
        type: 'button',
        title: `Add the sample face ${preset.label} as spare parts`,
        on: { click: () => app.addSample(preset.id) },
      }, `＋ ${preset.label}`));
    }
  }

  function paintRail() {
    clear(slotRail);
    for (const slot of SLOTS) {
      const options = state.bin[slot.id] || [];
      const chosen = options.find(p => p.id === state.selection[slot.id]);
      const chip = el('button.slot-chip', {
        type: 'button',
        'aria-selected': String(slot.id === activeSlot),
        title: `${slot.label} — ${slot.hint}`,
        on: { click: () => { activeSlot = slot.id; paintRail(); paintOptions(); } },
      },
        el('span.slot-chip-thumb', chosen ? thumbFor(chosen, state.prefs.style) : null),
        el('span.slot-chip-name', { text: slot.short }),
      );
      if (revealed && chosen) {
        chip.appendChild(el('span.slot-chip-badge', {
          text: chosen.real ? '✓' : '✗',
          style: chosen.real ? null : { background: 'var(--tomato)' },
        }));
      }
      slotRail.appendChild(chip);
    }
  }

  function paintOptions() {
    const slot = SLOT_BY_ID[activeSlot];
    const options = state.bin[activeSlot] || [];
    optionHint.textContent = slot ? slot.hint : '';
    clear(optionGrid);

    options.forEach((piece, index) => {
      const selected = piece.id === state.selection[activeSlot];
      const button = el('button.option.pop-in', {
        type: 'button',
        role: 'option',
        'aria-selected': String(selected),
        style: { animationDelay: `${Math.min(index * 24, 240)}ms` },
        title: revealed ? piece.note || describe(piece) : `Option ${index + 1}`,
        on: { click: () => selectPiece(activeSlot, piece.id) },
      }, thumbFor(piece, state.prefs.style));

      if (revealed) {
        const meta = KIND_LABELS[piece.kind] || KIND_LABELS.twin;
        button.appendChild(el('span.option-tag', { text: meta.text }));
        if (piece.real) button.appendChild(el('span.option-real-flag', { text: '✓', title: 'This is really them' }));
      }
      optionGrid.appendChild(button);
    });

    if (!options.length) {
      optionGrid.appendChild(el('p.muted.tiny', 'No pieces yet — add a photo first.'));
    }
  }

  function paintDials() {
    blendOut.value = `${Math.round(state.prefs.blend * 100)}%`;
    perSlotOut.value = String(state.prefs.perSlot);
    blendInput.value = String(Math.round(state.prefs.blend * 100));
    perSlotInput.value = String(state.prefs.perSlot);
    styleBtn.setAttribute('aria-pressed', String(state.prefs.style === 'jigsaw'));
    seamsBtn.setAttribute('aria-pressed', String(state.prefs.seams));
    chaosBtn.setAttribute('aria-pressed', String(state.prefs.chaos));

    clear(difficultyRow);
    for (const id of DIFFICULTY_IDS) {
      const meta = DIFFICULTIES[id];
      difficultyRow.appendChild(el('button.switch', {
        type: 'button',
        'aria-pressed': String(state.prefs.difficulty === id),
        title: meta.blurb,
        on: { click: () => setPref('difficulty', id) },
      }, meta.label));
    }
  }

  /* ------------------------------------------------------------- actions */

  function currentComposite(size = 900) {
    const face = hero();
    if (!face) return null;
    return renderComposite({
      hero: face, bin: state.bin, selection: state.selection,
      style: state.prefs.style, blend: state.prefs.blend, size,
    });
  }

  async function download() {
    const canvas = currentComposite();
    if (!canvas) return;
    const { real, total } = truthCount();
    await downloadCanvas(canvas, `face-salad-${hero().label.toLowerCase().replace(/\W+/g, '-')}-${real}of${total}.png`);
    toastOk('Saved to your downloads.');
  }

  async function saveToFridge() {
    const canvas = currentComposite();
    if (!canvas) return;
    const { real, total } = truthCount();
    const saved = await app.saveCreation({
      canvas,
      title: hero().label,
      subtitle: `${real} of ${total} pieces are genuinely them`,
      meta: { real, total, mode: 'studio' },
    });
    if (saved) {
      confetti({ count: 50, spread: 0.7 });
      toastOk('Stuck on the fridge.');
    }
  }

  /* ------------------------------------------------------------- wiring */

  function update(reason) {
    if (!hero()) return;
    if (reason === 'faces' || reason === 'hero' || reason === 'bin' || reason?.startsWith('pref:')) {
      // A new bin means the active slot's options changed underneath us.
      paintFaceTabs();
      paintRail();
      paintOptions();
      paintDials();
    } else if (reason === 'selection') {
      paintRail();
      paintOptions();
    }
    paintComposite();
  }

  paintFaceTabs();
  paintRail();
  paintOptions();
  paintDials();
  paintComposite();

  const unsubscribe = subscribe((_, reason) => update(reason));

  return {
    update,
    destroy() { unsubscribe(); },
  };
}

function toggleButton(label, onClick) {
  return el('button.switch', { type: 'button', 'aria-pressed': 'false', on: { click: onClick } }, label);
}

function describe(piece) {
  if (piece.real) return 'The genuine article';
  return piece.note || 'An impostor';
}
