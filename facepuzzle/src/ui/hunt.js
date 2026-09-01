/**
 * hunt.js — Impostor Hunt.
 *
 * One slot per round. Every option is shown *on the face*, with all the other
 * features left genuine, so the question is always "which of these people is
 * actually them?" rather than "which of these floating eyebrows looks right".
 * That framing is what makes it hard, and what makes it funny when you're wrong.
 */

import { el, clear } from '../lib/dom.js';
import { SLOTS } from '../face/slots.js';
import { DIFFICULTIES, DIFFICULTY_IDS, KIND_LABELS } from '../face/decoys.js';
import { renderComposite, renderPieceThumb, renderShareCard } from '../face/composite.js';
import { downloadCanvas, createCanvas } from '../lib/canvas.js';
import { makeRng, shuffle } from '../lib/random.js';
import { state, hero, subscribe, rebuildBin, refreshStrangers, setPref, notify } from '../store.js';
import { confetti, shake } from './effects.js';
import { toastOk } from './toast.js';

/** Seconds a round is worth full marks for; answering later just scores less. */
const ROUND_SECONDS = 18;
const BASE_POINTS = 120;
const TIME_POINTS = 80;
const MAX_STREAK_BONUS = 2;

export function mount(root, app) {
  let phase = 'ready';        // ready | playing | done
  let rounds = [];
  let index = 0;
  let answers = [];
  let score = 0;
  let streak = 0;
  let bestStreak = 0;
  let deadline = 0;
  let ticker = null;
  let zoomed = false;

  const view = el('div.wrap');
  root.appendChild(view);

  /* --------------------------------------------------------------- setup */

  function buildRounds() {
    const rng = makeRng(Date.now() >>> 0);
    const playable = SLOTS.filter(slot => {
      const options = state.bin[slot.id] || [];
      return options.length >= 2 && options.some(p => p.real);
    });
    rounds = shuffle(rng, playable).map(slot => ({
      slot,
      options: shuffle(rng, state.bin[slot.id]),
    }));
  }

  function start() {
    buildRounds();
    if (!rounds.length) return;
    index = 0; answers = []; score = 0; streak = 0; bestStreak = 0;
    phase = 'playing';
    beginRound();
  }

  function beginRound() {
    deadline = performance.now() + ROUND_SECONDS * 1000;
    render();
    startTicker();
  }

  function startTicker() {
    stopTicker();
    ticker = setInterval(() => {
      const hud = view.querySelector('[data-clock]');
      if (hud) hud.textContent = String(Math.max(0, Math.ceil((deadline - performance.now()) / 1000)));
      const bar = view.querySelector('[data-clockbar]');
      if (bar) bar.style.width = `${Math.max(0, ((deadline - performance.now()) / (ROUND_SECONDS * 1000)) * 100)}%`;
    }, 120);
  }

  function stopTicker() {
    if (ticker) { clearInterval(ticker); ticker = null; }
  }

  /* ------------------------------------------------------------- answering */

  function answer(pieceId, cardNode) {
    const round = rounds[index];
    if (round.answered) return;

    const chosen = round.options.find(p => p.id === pieceId);
    const correct = !!chosen?.real;
    const secondsLeft = Math.max(0, (deadline - performance.now()) / 1000);

    let gained = 0;
    if (correct) {
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      const multiplier = Math.min(MAX_STREAK_BONUS, 1 + (streak - 1) * 0.15);
      gained = Math.round((BASE_POINTS + (secondsLeft / ROUND_SECONDS) * TIME_POINTS) * multiplier);
    } else {
      streak = 0;
      shake(cardNode);
    }

    score += gained;
    round.answered = { pieceId, correct, gained };
    answers.push({ slot: round.slot, chosen, correct, gained, truth: round.options.find(p => p.real) });

    stopTicker();
    render();

    if (correct) confetti({ count: 34, spread: 0.5, origin: centerOf(cardNode) });

    setTimeout(() => {
      if (index < rounds.length - 1) { index++; beginRound(); }
      else {
        phase = 'done';
        render();
        // Celebrate a decent run; a score of zero deserves silence.
        const hitRate = answers.filter(a => a.correct).length / Math.max(1, answers.length);
        if (hitRate >= 0.5) confetti({ count: hitRate === 1 ? 160 : 100 });
      }
    }, correct ? 1050 : 1750);
  }

  /* --------------------------------------------------------------- render */

  function render() {
    clear(view);
    if (!hero()) { view.appendChild(noFaces(app)); return; }
    if (phase === 'ready')  { view.appendChild(readyScreen()); return; }
    if (phase === 'done')   { view.appendChild(scoreScreen()); return; }
    view.appendChild(playScreen());
  }

  function readyScreen() {
    const face = hero();
    const preview = renderComposite({
      hero: face, bin: state.bin, selection: state.selection,
      style: 'soft', blend: state.prefs.blend, size: 360,
    });

    const difficultyRow = el('div.switch-row', { style: { justifyContent: 'center' } });
    for (const id of DIFFICULTY_IDS) {
      const meta = DIFFICULTIES[id];
      difficultyRow.appendChild(el('button.switch', {
        type: 'button',
        'aria-pressed': String(state.prefs.difficulty === id),
        title: meta.blurb,
        on: { click: () => { setPref('difficulty', id); render(); } },
      }, meta.label));
    }

    const slotCount = SLOTS.filter(s => (state.bin[s.id] || []).length >= 2).length;
    const perSlot = state.prefs.perSlot;

    return el('div.hunt.scorecard',
      el('div', { style: { display: 'grid', placeItems: 'center', marginBottom: '1rem' } },
        el('div', { style: { width: '180px', borderRadius: '22px', overflow: 'hidden', boxShadow: 'var(--shadow-2)' } }, preview),
      ),
      el('h2', `How well do you actually know ${face.label}?`),
      el('p.muted', { style: { margin: '.5rem auto 1.2rem', maxWidth: '46ch' } },
        `${slotCount} rounds. Each one shows ${perSlot} versions of ${face.label} that differ by exactly one feature. ` +
        'Only one of them is the real thing. Faster answers score more, and a streak multiplies everything.'),
      el('p.tiny.muted', { style: { marginBottom: '.4rem' }, text: 'How hard should the fakes be?' }),
      difficultyRow,
      el('p.tiny.muted', { style: { margin: '.8rem 0 1.2rem' }, text: DIFFICULTIES[state.prefs.difficulty].blurb }),
      el('div.hunt-foot',
        el('button.btn.btn-primary.btn-lg', { type: 'button', on: { click: start } }, '🕵️ Start the hunt'),
        el('button.btn.btn-lg', { type: 'button', on: { click: () => app.goto('studio') } }, 'Back to the studio'),
      ),
    );
  }

  function playScreen() {
    const round = rounds[index];
    const face = hero();
    const slot = round.slot;
    const answered = round.answered;

    const board = el('div.hunt-board');
    round.options.forEach((piece, i) => {
      const card = el('button.hunt-card.pop-in', {
        type: 'button',
        disabled: !!answered,
        style: { animationDelay: `${i * 45}ms` },
        'aria-label': `Option ${i + 1}`,
        on: { click: event => answer(piece.id, event.currentTarget) },
      });

      // The whole face, with only this slot swapped — everything else genuine.
      const selection = { ...realSelection(), [slot.id]: piece.id };
      const art = zoomed
        ? renderPieceThumb(piece, { style: 'soft', size: 320 })
        : zoomToFace(renderComposite({
            hero: face, bin: state.bin, selection, uniform: true,
            style: 'soft', blend: state.prefs.blend, size: 400,
          }));
      card.appendChild(art);
      card.appendChild(el('span.card-index', { text: String(i + 1) }));

      if (answered) {
        const verdict = piece.id === answered.pieceId
          ? (answered.correct ? 'right' : 'wrong')
          : (piece.real ? 'missed' : null);
        if (verdict) {
          card.dataset.verdict = verdict;
          card.appendChild(el('span.verdict-mark', { text: verdict === 'wrong' ? '✕' : '✓' }));
        }
        if (!piece.real) {
          card.appendChild(el('span.option-tag', { text: (KIND_LABELS[piece.kind] || {}).text || 'FAKE' }));
        }
      }
      board.appendChild(card);
    });

    const clockBar = el('i', { dataset: { clockbar: '' }, style: { width: '100%' } });

    return el('div.hunt',
      el('div.hunt-hud',
        stat(String(score), 'score'),
        stat(streak ? `×${(Math.min(MAX_STREAK_BONUS, 1 + (streak - 1) * 0.15)).toFixed(2)}` : '—', `streak ${streak}`),
        el('div.hud-progress', el('i', { style: { width: `${((index) / rounds.length) * 100}%` } })),
        el('span.pill', { text: `round ${index + 1} of ${rounds.length}` }),
        el('div.hud-stat',
          el('b', { dataset: { clock: '' }, text: String(ROUND_SECONDS) }),
          el('span', 'seconds'),
        ),
      ),
      el('div.hud-progress.clock', { style: { marginBottom: '1rem' }, title: 'Time left this round' }, clockBar),
      el('div.hunt-prompt',
        el('h2', 'Which one is ', el('span.target-word', { text: `${face.label}'s real ${slot.noun}` }), '?'),
        el('p', answered
          ? (answered.correct
              ? `Yes — that really is their ${slot.noun}. +${answered.gained}`
              : `Nope. ${answers[answers.length - 1]?.chosen?.note || 'That one was an impostor.'}`)
          : `Everything else on these faces is genuinely them. Only the ${slot.noun} changes.`),
      ),
      board,
      el('div.hunt-foot',
        el('button.switch', {
          type: 'button', 'aria-pressed': String(zoomed),
          on: { click: () => { zoomed = !zoomed; render(); } },
        }, zoomed ? '🔍 Showing the piece alone' : '🔍 Zoom to the piece'),
        el('button.btn.btn-sm', { type: 'button', on: { click: () => { stopTicker(); phase = 'ready'; render(); } } }, 'Give up'),
      ),
    );
  }

  function scoreScreen() {
    const face = hero();
    const right = answers.filter(a => a.correct).length;
    const total = answers.length;
    const verdict = verdictFor(right, total, face.label);

    const breakdown = el('div.score-breakdown');
    for (const entry of answers) {
      breakdown.appendChild(el('div.score-row',
        el('span.sr-thumb', renderPieceThumb(entry.truth, { style: 'soft', size: 96 })),
        el('span.sr-name', { text: entry.slot.label }),
        entry.correct
          ? el('span.pill.pill-ok', { text: `+${entry.gained}` })
          : el('span.sr-note', { text: entry.chosen?.note || 'picked an impostor' }),
      ));
    }

    return el('div.hunt.scorecard',
      el('p.tiny.muted', { text: `Impostor Hunt — ${DIFFICULTIES[state.prefs.difficulty].label}` }),
      el('div.big-score', { text: String(score) }),
      el('p.verdict-line', { text: verdict.line }),
      el('p.muted', { text: `${right} of ${total} features spotted · best streak ${bestStreak}` }),
      breakdown,
      el('div.hunt-foot',
        el('button.btn.btn-primary', {
          type: 'button',
          on: { click: () => { rebuildBin({ reseed: true }); refreshStrangers(); notify('bin'); start(); } },
        }, '🔁 New impostors, same face'),
        el('button.btn', { type: 'button', on: { click: shareScore } }, '⬇︎ Save the scorecard'),
        el('button.btn', { type: 'button', on: { click: () => app.goto('studio') } }, 'Back to the studio'),
      ),
    );
  }

  async function shareScore() {
    const face = hero();
    const right = answers.filter(a => a.correct).length;
    const canvas = renderComposite({
      hero: face, bin: state.bin, selection: realSelection(),
      style: 'soft', blend: state.prefs.blend, size: 900,
    });
    const card = renderShareCard(canvas, {
      title: `${score} points on ${face.label}`,
      subtitle: `${right}/${answers.length} real features spotted — ${DIFFICULTIES[state.prefs.difficulty].label} mode`,
    });
    await downloadCanvas(card, `face-salad-score-${score}.png`);
    toastOk('Scorecard saved.');
  }

  /* -------------------------------------------------------------- helpers */

  function realSelection() {
    const out = {};
    for (const slot of SLOTS) {
      const real = (state.bin[slot.id] || []).find(p => p.real);
      if (real) out[slot.id] = real.id;
    }
    return out;
  }

  render();
  const unsubscribe = subscribe((_, reason) => {
    // Only a change to the underlying faces should interrupt a game in flight.
    if (phase === 'playing' && reason !== 'faces' && reason !== 'hero') return;
    if (phase === 'playing') { stopTicker(); phase = 'ready'; }
    render();
  });

  return {
    update() {},
    destroy() { stopTicker(); unsubscribe(); },
  };
}

/**
 * The face crop leaves room for hair and shoulders, which is right for the
 * studio but wastes half of a small comparison card. Push in on the features.
 */
function zoomToFace(composite, factor = 1.28) {
  const size = composite.width;
  const { canvas, ctx } = createCanvas(size, size);
  const scaled = size * factor;
  const offset = (size - scaled) / 2;
  // Bias upward a touch: the interesting half of a face is above the middle.
  ctx.drawImage(composite, offset, offset - size * 0.04, scaled, scaled);
  return canvas;
}

function stat(value, label) {
  return el('div.hud-stat', el('b', { text: value }), el('span', { text: label }));
}

function centerOf(node) {
  const rect = node.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function verdictFor(right, total, name) {
  const ratio = total ? right / total : 0;
  if (ratio === 1)    return { line: `Flawless. You know ${name} better than they do.` };
  if (ratio >= 0.75)  return { line: 'Very close to their actual face.' };
  if (ratio >= 0.5)   return { line: 'Half a person. Recognisable at a distance.' };
  if (ratio > 0)      return { line: `You have built a stranger who owes ${name} money.` };
  return { line: 'Not one correct feature. Astonishing, honestly.' };
}

function noFaces(app) {
  return el('div.empty-state',
    el('div.es-emoji', { 'aria-hidden': 'true', text: '🕵️' }),
    el('h3', 'Nobody to hunt yet'),
    el('p', 'Add a photo first and the game will build itself.'),
    el('p', { style: { marginTop: '1rem' } },
      el('button.btn.btn-primary', { type: 'button', on: { click: () => app.openFiles() } }, 'Choose a photo')),
  );
}
