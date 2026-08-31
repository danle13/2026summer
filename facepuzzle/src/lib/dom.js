/**
 * dom.js — the small amount of DOM sugar this app actually uses. No framework;
 * views build their own trees and hand back an element.
 */

/**
 * Create an element.
 * @param {string} tag  e.g. "button.btn.btn-primary" or "div#stage.card"
 * @param {object} [props]  attributes; `class`, `text`, `html`, `dataset`,
 *                          `style` (object) and `on` (event map) are special.
 * @param {...(Node|string|null|undefined|Array)} children
 */
export function el(tag, props, ...children) {
  const [, name = 'div', rest = ''] = /^([a-z0-9-]*)(.*)$/i.exec(tag) || [];
  const node = document.createElement(name || 'div');

  // `props` is optional: el('h1', 'hello') and el('p', {}, 'hello') both work,
  // so anything that isn't a plain options object is really the first child.
  if (!isPlainProps(props)) {
    if (props !== undefined) children.unshift(props);
    props = {};
  }

  // #id and .class shorthands baked into the tag string.
  for (const token of rest.match(/[#.][^#.]+/g) || []) {
    if (token[0] === '#') node.id = token.slice(1);
    else node.classList.add(token.slice(1));
  }

  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.classList.add(...String(value).split(/\s+/).filter(Boolean));
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'on') for (const [ev, fn] of Object.entries(value)) node.addEventListener(ev, fn);
    else if (key in node && typeof node[key] !== 'function' && key !== 'list') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }

  append(node, children);
  return node;
}

function isPlainProps(value) {
  return value != null
    && typeof value === 'object'
    && !Array.isArray(value)
    && !(value instanceof Node);
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function on(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  return () => target.removeEventListener(type, handler, opts);
}

/** True when the visitor has asked the OS to tone motion down. */
export const reducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
