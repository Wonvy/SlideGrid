import { el } from './dom.js';
import { icon } from './icons.js';

/**
 * 右键菜单。items：
 *   { label, icon?, shortcut?, action, disabled?, danger? }
 *   { title: '分组标题' }
 *   { sep: true }
 * 假值项会被忽略，方便按条件拼接。
 */
let current = null;

export function closeContextMenu() {
  current?.remove();
  current = null;
}

export function showContextMenu(x, y, items) {
  closeContextMenu();
  const pop = el('div', { class: 'menu ctx-menu show', role: 'menu' });
  let lastSep = true; // 避免开头 / 连续的分隔线
  for (const it of items) {
    if (!it) continue;
    if (it.sep) {
      if (!lastSep) pop.append(el('div', { class: 'menu-sep' }));
      lastSep = true;
      continue;
    }
    if (it.title) {
      pop.append(el('div', { class: 'menu-title' }, it.title));
      lastSep = false;
      continue;
    }
    const b = el('button', {
      class: `menu-item${it.danger ? ' danger' : ''}`, role: 'menuitem', disabled: it.disabled ? true : null,
    },
      el('span', { class: 'menu-check' }, it.icon ? icon(it.icon, 14) : null),
      el('span', { class: 'menu-label' }, it.label),
      it.shortcut ? el('span', { class: 'menu-meta' }, it.shortcut) : null);
    b.addEventListener('click', () => { closeContextMenu(); it.action?.(); });
    pop.append(b);
    lastSep = false;
  }
  if (pop.lastChild?.classList.contains('menu-sep')) pop.lastChild.remove();
  document.body.append(pop);
  // 保持在窗口内
  const r = pop.getBoundingClientRect();
  pop.style.left = `${Math.min(x, window.innerWidth - r.width - 6)}px`;
  pop.style.top = `${Math.min(y, window.innerHeight - r.height - 6)}px`;
  current = pop;
}

document.addEventListener('pointerdown', e => { if (current && !current.contains(e.target)) closeContextMenu(); }, true);
window.addEventListener('keydown', e => { if (e.key === 'Escape') closeContextMenu(); });
window.addEventListener('blur', closeContextMenu);
window.addEventListener('resize', closeContextMenu);
document.addEventListener('wheel', e => { if (current && !current.contains(e.target)) closeContextMenu(); }, { passive: true });
