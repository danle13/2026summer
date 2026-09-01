/**
 * intro.js — the landing page: what this is, the drop zone, and three painted
 * sample faces so nobody has to hand over a real photo to find out whether the
 * thing is fun.
 */

import { el, clear } from '../lib/dom.js';
import { featuredIds, loadStockFaces } from '../face/stockFaces.js';
import { renderAvatar } from '../face/composite.js';
import { state, subscribe } from '../store.js';

export function renderIntro(root, app) {
  clear(root);

  const dropzone = buildDropzone(app);

  root.appendChild(el('div.wrap',
    el('div.hero',
      el('div',
        el('span.hero-eyebrow', el('span', { 'aria-hidden': 'true', text: '🥗' }), 'a party game for faces'),
        el('h1', 'Take your favourite person ', el('span.wobble', 'apart'), '.'),
        el('p.hero-lede',
          'Drop in a photo. Face Salad finds the face, lifts out the eyebrows, the nose, ' +
          'the mouth, the jaw — and hands them back mixed in with real features borrowed ' +
          'from two dozen other faces. Their real nose is in there. Probably. Can you ' +
          'still pick it out?'),
        el('div.hero-cta',
          el('button.btn.btn-primary.btn-lg', {
            type: 'button',
            on: { click: () => app.openFiles() },
          }, el('span', { 'aria-hidden': 'true', text: '📸' }), 'Choose a photo'),
          state.faces.length
            ? el('button.btn.btn-lg', { type: 'button', on: { click: () => app.goto('studio') } }, 'Back to the studio')
            : null,
        ),
        el('div.hero-notes',
          el('span.pill.pill-ok', '🔒 Nothing is uploaded'),
          el('span.pill', '📵 Works offline'),
          el('span.pill', '👨‍👩‍👧 Better with two or more people'),
        ),
      ),
      dropzone,
    ),

    el('div.steps',
      step(1, 'Feed it a face', 'Any photo where you can see both eyes. A group shot is even better — everyone in it joins the parts bin.'),
      step(2, 'Watch it come apart', 'Eight pieces: hair line, both brows, both eyes, nose, mouth, jaw. Each one gets a lineup of real features belonging to other people.'),
      step(3, 'Put them back wrong', 'Swap features in the Studio, or play Impostor Hunt and try to spot the genuine parts under pressure.'),
      step(4, 'Stick it on the fridge', 'Save the monsters you make. They live in your browser, not on anyone else\'s computer.'),
    ),

    el('div.panel', { style: { marginTop: '2rem' } },
      el('div.panel-head', el('h3', 'A quiet note about photos')),
      el('p.muted.tiny',
        'Face Salad has no server. The picture is decoded, measured and chopped up entirely inside this ' +
        'browser tab, and it disappears the moment you close it — apart from anything you deliberately save ' +
        'to the Fridge, which is stored locally on this device. Please only use photos of people who would ' +
        'find this funny.'),
      el('p.muted.tiny', { style: { marginTop: '.6rem' } },
        'The built-in strangers are not real people either: every one of them was produced by a ' +
        'text-to-image model, so no actual person\u2019s face was scraped or reused to make this. ' +
        'They come from the SFHQ-T2I dataset (MIT licensed).'),
    ),
  ));
}

function step(n, title, body) {
  return el('div.step',
    el('div.step-n', { text: String(n) }),
    el('h4', { text: title }),
    el('p', { text: body }),
  );
}

function buildDropzone(app) {
  const zone = el('div.dropzone', {
    role: 'button',
    tabindex: '0',
    'aria-label': 'Choose or drop a photo',
  },
    el('div.dropzone-emoji', { 'aria-hidden': 'true', text: '🖼️' }),
    el('h3', 'Drop a photo here'),
    el('p', 'JPEG, PNG, HEIC, whatever your phone makes. Front-on faces work best.'),
    el('p.dropzone-or', 'or borrow someone'),
    buildSampleRow(app),
  );

  const setOver = over => zone.classList.toggle('is-over', over);

  zone.addEventListener('click', event => {
    // The sample buttons live inside the zone; don't hijack their clicks.
    if (event.target.closest('.sample-btn')) return;
    app.openFiles();
  });
  zone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); app.openFiles(); }
  });

  zone.addEventListener('dragover', event => { event.preventDefault(); setOver(true); });
  zone.addEventListener('dragleave', () => setOver(false));
  zone.addEventListener('drop', event => {
    event.preventDefault();
    setOver(false);
    const files = Array.from(event.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
    if (files.length) app.handleFiles(files);
  });

  return zone;
}

/**
 * Three faces from the bundled library, offered as a way in for anyone who is
 * not ready to hand over a photo of a real person. They load lazily; if the
 * library is unreachable the row simply does not appear.
 */
function buildSampleRow(app) {
  const row = el('div.sample-row');

  featuredIds(3)
    .then(ids => (ids.length ? loadStockFaces(ids) : []))
    .then(faces => {
      if (!faces.length) {
        row.appendChild(el('p.tiny.muted', 'Sample faces could not be loaded — pick a photo instead.'));
        return;
      }
      for (const face of faces) {
        row.appendChild(el('button.sample-btn', {
          type: 'button',
          title: 'Take this face apart',
          'aria-label': 'Try one of the sample faces',
          on: { click: () => app.useStockFace(face) },
        }, renderAvatar(face, 128)));
      }
    })
    .catch(() => {});

  return row;
}

/**
 * Mount wrapper so main.js can treat every view identically. The intro is cheap
 * to rebuild, so it just re-renders when the roster of faces changes.
 */
export function mount(root, app) {
  renderIntro(root, app);
  const unsubscribe = subscribe((_, reason) => {
    if (reason === 'faces') renderIntro(root, app);
  });
  return {
    update() {},
    destroy() { unsubscribe(); },
  };
}
