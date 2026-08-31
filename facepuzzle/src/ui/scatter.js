/**
 * scatter.js — the literal jigsaw.
 *
 * The face gets its features punched out and dumped in a tray, mixed with
 * impostors that belong to nobody. Drag pieces back into the holes. Any piece
 * fits any hole, which is the whole joke: nothing stops you putting the mouth
 * where an eye should be, and the game will happily tell you how that went.
 */

import { el, clear } from '../lib/dom.js';
import { SLOTS, SLOT_BY_ID } from '../face/slots.js';
import { renderPunched, renderLoosePiece, renderComposite, holeRect, HOLE_SCALE } from '../face/composite.js';
import { cloneCanvas } from '../lib/canvas.js';
import { makeRng, shuffle, sample } from '../lib/random.js';
import { state, hero, subscribe } from '../store.js';
import { confetti } from './effects.js';
import { toast, toastOk } from './toast.js';

/** Extra wrong pieces thrown into the tray to keep it from being a sorting task. */
const RED_HERRINGS = 4;

export function mount(root, app) {
  let pieces = [];                  // every piece in play, real + herrings
  let placements = {};              // slot id -> piece id | null
  let startedAt = 0;
  let finished = false;
  let clock = null;

  const view = el('div.wrap');
  root.appendChild(view);

  /* ----------------------------------------------------------------- deal */

  function deal() {
    const face = hero();
    if (!face) return;
    const rng = makeRng(Date.now() >>> 0);

    const real = SLOTS.map(slot => (state.bin[slot.id] || []).find(p => p.real)).filter(Boolean);
    const fakes = sample(
      rng,
      SLOTS.flatMap(slot => (state.bin[slot.id] || []).filter(p => !p.real)),
      RED_HERRINGS,
    );

    pieces = shuffle(rng, [...real, ...fakes]);
    placements = Object.fromEntries(SLOTS.map(s => [s.id, null]));
    finished = false;
    startedAt = performance.now();
    startClock();
    render();
  }

  function startClock() {
    stopClock();
    clock = setInterval(() => {
      const node = view.querySelector('[data-elapsed]');
      if (node) node.textContent = formatTime(performance.now() - startedAt);
    }, 250);
  }
  function stopClock() { if (clock) { clearInterval(clock); clock = null; } }

  /* -------------------------------------------------------------- dragging */

  let drag = null;

  function beginDrag(pieceId, fromSlot, event) {
    if (finished) return;
    const piece = pieces.find(p => p.id === pieceId);
    if (!piece) return;

    const ghost = el('div.piece.dragging', renderLoosePiece(piece, state.prefs.style, 200));
    document.body.appendChild(ghost);
    drag = { piece, fromSlot, ghost, armed: null };
    moveGhost(event);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    window.addEventListener('pointercancel', onUp, { once: true });
  }

  function moveGhost(event) {
    if (!drag) return;
    drag.ghost.style.left = `${event.clientX - 54}px`;
    drag.ghost.style.top = `${event.clientY - 48}px`;
  }

  function onMove(event) {
    if (!drag) return;
    event.preventDefault();
    moveGhost(event);

    // The ghost has pointer-events: none, so this reads what is underneath it.
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const slotNode = under?.closest?.('.drop-slot') || null;
    if (drag.armed !== slotNode) {
      drag.armed?.classList.remove('armed');
      slotNode?.classList.add('armed');
      drag.armed = slotNode;
    }
  }

  function onUp() {
    if (!drag) return;
    window.removeEventListener('pointermove', onMove);

    const targetSlot = drag.armed?.dataset.slot || null;
    drag.armed?.classList.remove('armed');
    drag.ghost.remove();

    const { piece, fromSlot } = drag;
    drag = null;

    if (targetSlot) {
      // Whatever was already in that hole goes back to the tray, unless we are
      // swapping two placed pieces — then they trade places.
      const displaced = placements[targetSlot];
      placements[targetSlot] = piece.id;
      if (fromSlot) placements[fromSlot] = displaced || null;
    } else if (fromSlot) {
      placements[fromSlot] = null;   // dragged out of the face, back to the tray
    }

    render();
    if (SLOTS.every(s => placements[s.id])) finish();
  }

  /* -------------------------------------------------------------- scoring */

  function score() {
    let correct = 0;
    for (const slot of SLOTS) {
      const placed = pieces.find(p => p.id === placements[slot.id]);
      if (placed?.real && placed.slot === slot.id) correct++;
    }
    return { correct, total: SLOTS.length };
  }

  function finish() {
    if (finished) return;
    finished = true;
    stopClock();
    const { correct, total } = score();
    render();
    if (correct === total) {
      confetti({ count: 150 });
      toastOk(`Perfect rebuild in ${formatTime(performance.now() - startedAt)}.`);
    } else {
      toast(`${correct} of ${total} in the right place. The rest is… someone.`, { icon: '🙃' });
    }
  }

  function solve() {
    for (const slot of SLOTS) {
      const real = pieces.find(p => p.real && p.slot === slot.id);
      placements[slot.id] = real?.id ?? null;
    }
    finish();
  }

  /* --------------------------------------------------------------- render */

  function render() {
    clear(view);
    const face = hero();
    if (!face) { view.appendChild(noFace(app)); return; }
    if (!pieces.length) { view.appendChild(readyScreen()); return; }

    const boardInner = el('div.board-inner');
    // While you are playing, the board is the face with its features punched
    // out. Once it is checked, put the whole face back underneath: a correct
    // piece then disappears into it, and a wrong one is obviously sitting on
    // top of somebody.
    const board = finished ? cloneCanvas(face.base) : renderPunched(face, 720, { dim: 0.3 });
    board.className = 'board-face';
    boardInner.appendChild(board);

    for (const slot of SLOTS) {
      // Drop targets sit exactly on the punched holes, so what you aim at is
      // what you hit.
      const box = holeRect(face.rel[slot.id], 100, HOLE_SCALE);
      const placedId = placements[slot.id];
      const placed = placedId ? pieces.find(p => p.id === placedId) : null;

      const hole = el('div.drop-slot', {
        dataset: { slot: slot.id },
        style: {
          left: `${box.x}%`,
          top: `${box.y}%`,
          width: `${box.w}%`,
          height: `${box.h}%`,
        },
      });

      if (placed) {
        hole.classList.add('filled');
        const art = renderLoosePiece(placed, state.prefs.style, 260);
        art.style.width = '100%';
        art.style.height = '100%';
        art.style.objectFit = 'fill';
        hole.appendChild(art);
        if (finished) {
          const right = placed.real && placed.slot === slot.id;
          hole.appendChild(el('span.verdict-mark', {
            text: right ? '✓' : '✕',
            style: {
              position: 'absolute', right: '-6px', bottom: '-6px',
              width: '24px', height: '24px', borderRadius: '50%',
              display: 'grid', placeItems: 'center', fontSize: '.7rem',
              color: '#fff', fontWeight: '900',
              background: right ? 'var(--mint)' : 'var(--tomato)',
            },
          }));
        } else {
          hole.style.cursor = 'grab';
          hole.addEventListener('pointerdown', event => {
            event.preventDefault();
            beginDrag(placed.id, slot.id, event);
          });
        }
      } else {
        hole.textContent = slot.short;
      }
      boardInner.appendChild(hole);
    }

    const trayGrid = el('div.tray-grid');
    const loose = pieces.filter(p => !Object.values(placements).includes(p.id));
    for (const piece of loose) {
      const node = el('div.piece', {
        title: finished ? (piece.real ? `${piece.faceLabel}'s real ${SLOT_BY_ID[piece.slot].noun}` : piece.note) : 'Drag me onto the face',
        tabindex: '0',
      }, renderLoosePiece(piece, state.prefs.style, 160));
      node.addEventListener('pointerdown', event => {
        event.preventDefault();
        beginDrag(piece.id, null, event);
      });
      trayGrid.appendChild(node);
    }
    if (!loose.length) trayGrid.appendChild(el('p.tiny.muted', 'Tray empty — every piece is on the face.'));

    const { correct, total } = score();

    view.appendChild(el('div.scatter',
      el('div.board',
        el('div.scatter-hud',
          el('span.pill', { text: face.label }),
          el('span.pill', el('span', { 'aria-hidden': 'true', text: '⏱' }), el('span', { dataset: { elapsed: '' }, text: formatTime(performance.now() - startedAt) })),
          finished ? el('span', { class: correct === total ? 'pill pill-ok' : 'pill pill-warn', text: `${correct}/${total} in the right place` }) : null,
        ),
        boardInner,
        el('div.stage-tools',
          el('button.btn.btn-sm', { type: 'button', on: { click: deal } }, '💥 Scatter again'),
          el('button.btn.btn-sm', { type: 'button', disabled: finished, on: { click: finish } }, '✅ Check my work'),
          el('button.btn.btn-sm', { type: 'button', disabled: finished, on: { click: solve } }, '🪄 Just fix it'),
          el('span.spacer'),
          finished ? el('button.btn.btn-sm.btn-primary', { type: 'button', on: { click: keep } }, '🧲 Keep it') : null,
        ),
      ),
      el('div.tray',
        el('div.panel-head',
          el('h3', 'Loose pieces'),
          el('span.hint', { text: `${loose.length} left` }),
        ),
        el('p.tiny.muted', { style: { marginBottom: '.7rem' } },
          `Four of these belong to nobody. Drag anything anywhere — the face will not stop you.`),
        trayGrid,
      ),
    ));
  }

  function readyScreen() {
    const face = hero();
    return el('div.hunt.scorecard',
      el('div.es-emoji', { 'aria-hidden': 'true', style: { fontSize: '3rem' }, text: '💥' }),
      el('h2', `Blow ${face.label} apart`),
      el('p.muted', { style: { margin: '.6rem auto 1.4rem', maxWidth: '44ch' } },
        'Eight features come out of the face and land in a tray, along with four pieces that ' +
        'belong to nobody. Put them back — or don\'t, and see what you get.'),
      el('div.hunt-foot',
        el('button.btn.btn-primary.btn-lg', { type: 'button', on: { click: deal } }, '💥 Scatter the face'),
        el('button.btn.btn-lg', { type: 'button', on: { click: () => app.goto('studio') } }, 'Back to the studio'),
      ),
    );
  }

  async function keep() {
    const face = hero();
    // Rebuild what the player actually made, slot by slot.
    const selection = {};
    for (const slot of SLOTS) {
      const placed = pieces.find(p => p.id === placements[slot.id]);
      if (placed) selection[slot.id] = placed.id;
    }
    // A piece can sit in a hole it does not belong to, so it may not be in that
    // slot's option list at all. Re-key each placement into the slot it landed
    // in, with a fresh id and surface cache — reusing the original's id would
    // collide in the compositor's blend cache and hand back the wrong cut.
    const bin = { ...state.bin };
    for (const slot of SLOTS) {
      const placed = pieces.find(p => p.id === placements[slot.id]);
      if (!placed) continue;
      const inSlot = {
        ...placed,
        id: `${placed.id}@${slot.id}`,
        slot: slot.id,
        _surfaces: new Map(),
      };
      bin[slot.id] = [...(bin[slot.id] || []), inSlot];
      selection[slot.id] = inSlot.id;
    }

    const { correct, total } = score();
    const canvas = renderComposite({
      hero: face, bin, selection, style: state.prefs.style, blend: state.prefs.blend, size: 900,
    });
    const saved = await app.saveCreation({
      canvas,
      title: `${face.label}, reassembled`,
      subtitle: `${correct} of ${total} pieces in the right place`,
      meta: { correct, total, mode: 'scatter' },
    });
    if (saved) toastOk('Stuck on the fridge.');
  }

  render();
  const unsubscribe = subscribe((_, reason) => {
    if (reason === 'faces' || reason === 'hero' || reason === 'bin') { pieces = []; stopClock(); render(); }
  });

  return {
    update() {},
    destroy() { stopClock(); drag?.ghost?.remove(); window.removeEventListener('pointermove', onMove); unsubscribe(); },
  };
}

function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function noFace(app) {
  return el('div.empty-state',
    el('div.es-emoji', { 'aria-hidden': 'true', text: '💥' }),
    el('h3', 'Nothing to scatter'),
    el('p', 'Add a face and it will fall to pieces.'),
    el('p', { style: { marginTop: '1rem' } },
      el('button.btn.btn-primary', { type: 'button', on: { click: () => app.openFiles() } }, 'Choose a photo')),
  );
}
