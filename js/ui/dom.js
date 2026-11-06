import { icon } from './icons.js';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter(c => c != null && c !== false));
  return node;
}

/* ---------- 折叠状态（保存在 localStorage） ---------- */

const COLLAPSE_KEY = 'slidegrid:collapsed';
let collapsed;
try { collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || []); } catch { collapsed = new Set(); }

export const isCollapsed = key => collapsed.has(key);
export function setCollapsed(key, value) {
  if (value) collapsed.add(key); else collapsed.delete(key);
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed])); } catch { /* 忽略 */ }
}

/** 可折叠的面板区块：点击标题折叠 / 展开，状态会记住 */
export function section(title, body, action, key = `section:${title}`) {
  const toggle = el('button', { class: 'section-toggle', 'aria-expanded': 'true', title: '折叠 / 展开' },
    icon('chevron-down', 14), el('h3', {}, title));
  const content = el('div', { class: 'section-body' }, body);
  const head = el('div', { class: 'section-head', title: '点击折叠 / 展开' }, toggle, action);
  const sec = el('section', { class: 'panel-section' }, head, content);
  const apply = c => {
    sec.classList.toggle('collapsed', c);
    toggle.setAttribute('aria-expanded', String(!c));
  };
  apply(isCollapsed(key));
  // 整行可点击；标题行里的其他按钮（如「恢复默认」）保持各自的功能
  head.addEventListener('click', e => {
    const other = e.target.closest('button, input, select, a, label');
    if (other && other !== toggle && !toggle.contains(other)) return;
    const c = !sec.classList.contains('collapsed');
    setCollapsed(key, c);
    apply(c);
  });
  return sec;
}
