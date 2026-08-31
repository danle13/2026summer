/**
 * gallery.js — the fridge door. Everything saved from the Studio or Scatter
 * lands here. It is backed by IndexedDB on this device only; there is nowhere
 * for it to sync to.
 */

import { el, clear } from '../lib/dom.js';
import { listCreations, deleteCreation, clearCreations } from '../lib/storage.js';
import { toast, toastOk } from './toast.js';

export function mount(root, app) {
  const view = el('div.wrap');
  root.appendChild(view);

  /** Object URLs handed out for the current render, revoked before the next. */
  let urls = [];

  function releaseUrls() {
    for (const url of urls) URL.revokeObjectURL(url);
    urls = [];
  }

  async function render() {
    releaseUrls();
    clear(view);

    const rows = await listCreations();

    view.appendChild(el('div.view-head',
      el('h2', 'The fridge'),
      el('p', rows.length
        ? 'Everything you have kept. Stored in this browser on this device — clearing your site data clears the fridge.'
        : 'Nothing on it yet.'),
    ));

    if (!rows.length) {
      view.appendChild(el('div.empty-state',
        el('div.es-emoji', { 'aria-hidden': 'true', text: '🧲' }),
        el('h3', 'A bare fridge'),
        el('p', 'Build something horrible in the Studio and press "Stick on the fridge".'),
        el('p', { style: { marginTop: '1rem' } },
          el('button.btn.btn-primary', { type: 'button', on: { click: () => app.goto('studio') } }, 'Open the studio')),
      ));
      return;
    }

    const grid = el('div.fridge-grid');
    for (const row of rows) {
      const url = URL.createObjectURL(row.blob);
      urls.push(url);

      grid.appendChild(el('div.magnet-card.pop-in',
        el('img', { src: url, alt: row.title || 'A saved face', loading: 'lazy' }),
        el('div.magnet-meta',
          el('span.mm-title', { text: row.title || 'Untitled', title: row.meta?.subtitle || '' }),
          el('div.magnet-actions',
            el('a.icon-btn', {
              href: url,
              download: `${(row.title || 'face-salad').replace(/\W+/g, '-').toLowerCase()}.png`,
              title: 'Download',
              'aria-label': `Download ${row.title || 'this face'}`,
            }, '⬇'),
            el('button.icon-btn.danger', {
              type: 'button',
              title: 'Take it off the fridge',
              'aria-label': `Delete ${row.title || 'this face'}`,
              on: { click: async () => { await deleteCreation(row.id); toast('Taken down.'); render(); } },
            }, '🗑'),
          ),
        ),
        row.meta?.subtitle ? el('p.tiny.muted', { style: { padding: '0 .8rem .7rem' }, text: row.meta.subtitle }) : null,
      ));
    }

    view.appendChild(grid);
    view.appendChild(el('div.row', { style: { marginTop: '1.4rem' } },
      el('button.btn.btn-sm', {
        type: 'button',
        on: {
          click: async () => {
            if (!confirm('Clear the whole fridge? This cannot be undone.')) return;
            await clearCreations();
            toastOk('Fridge cleared.');
            render();
          },
        },
      }, 'Clear the fridge'),
    ));
  }

  render();

  return {
    update() { render(); },
    destroy() { releaseUrls(); },
  };
}
