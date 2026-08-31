/**
 * toast.js — transient messages. Deliberately blunt: one line, one tone, gone
 * in a few seconds.
 */

import { el } from '../lib/dom.js';

const host = () => document.getElementById('toasts');

/**
 * @param {string} message
 * @param {{tone?: 'neutral'|'ok'|'bad', ms?: number, icon?: string}} [opts]
 */
export function toast(message, { tone = 'neutral', ms = 3600, icon } = {}) {
  const parent = host();
  if (!parent) return () => {};

  const node = el('div.toast', { dataset: { tone } },
    icon ? el('span', { 'aria-hidden': 'true', text: icon }) : null,
    el('span', { text: message }),
  );
  parent.appendChild(node);

  // Never let more than three stack up.
  while (parent.children.length > 3) parent.firstElementChild.remove();

  const dismiss = () => {
    if (!node.isConnected) return;
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 240);
  };
  const timer = setTimeout(dismiss, ms);
  node.addEventListener('click', () => { clearTimeout(timer); dismiss(); });

  return dismiss;
}

export const toastOk  = (m, o) => toast(m, { tone: 'ok', icon: '✓', ...o });
export const toastBad = (m, o) => toast(m, { tone: 'bad', icon: '!', ...o, ms: 5200 });
