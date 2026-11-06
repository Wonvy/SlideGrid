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

// 记住用户折叠过的和展开过的；都没操作过时用默认值（例如「偏好」默认收起）
const COLLAPSE_KEY = 'slidegrid:collapsed';
const EXPAND_KEY = 'slidegrid:expanded';
const load = k => { try { return new Set(JSON.parse(localStorage.getItem(k)) || []); } catch { return new Set(); } };
const collapsed = load(COLLAPSE_KEY);
const expanded = load(EXPAND_KEY);

export const isCollapsed = (key, byDefault = false) => (collapsed.has(key) ? true : expanded.has(key) ? false : byDefault);
export function setCollapsed(key, value) {
  if (value) { collapsed.add(key); expanded.delete(key); } else { collapsed.delete(key); expanded.add(key); }
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
    localStorage.setItem(EXPAND_KEY, JSON.stringify([...expanded]));
  } catch { /* 忽略 */ }
}

/** 可折叠的面板区块：点击标题折叠 / 展开，状态会记住 */
export function section(title, body, action, key = `section:${title}`, { collapsed: byDefault = false } = {}) {
  const toggle = el('button', { class: 'section-toggle', 'aria-expanded': 'true', title: '折叠 / 展开' }, el('h3', {}, title));
  const content = el('div', { class: 'section-body' }, body);
  // 标题在左，操作按钮和折叠箭头在右（展开时箭头朝上）
  const head = el('div', { class: 'section-head', title: '点击折叠 / 展开' }, toggle, action, el('span', { class: 'section-chevron' }, icon('chevron-down', 16)));
  const sec = el('section', { class: 'panel-section' }, head, content);
  const apply = c => {
    sec.classList.toggle('collapsed', c);
    toggle.setAttribute('aria-expanded', String(!c));
  };
  apply(isCollapsed(key, byDefault));
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
