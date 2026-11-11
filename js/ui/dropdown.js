import { el } from './dom.js';
import { icon } from './icons.js';
import { createMenu } from './menu.js';

/**
 * 下拉框（代替浏览器自带的 <select>，样式和其他控件、菜单统一）。
 *   options：[{ value, label }]；onChange(value)
 *   返回 { node, set(value), value() }
 * 点击打开一列菜单（当前项打勾）；获得焦点时 ↑ / ↓ 直接换上一个 / 下一个，Enter / 空格打开。
 */
export function dropdown({ options, onChange, title = null, className = '' }) {
  let current = options[0]?.value;
  const label = el('span', { class: 'select-label' });
  const node = el('button', { type: 'button', class: `select select-btn ${className}`.trim(), title, 'aria-haspopup': 'listbox' }, label, icon('chevron-down', 13));
  const labelOf = v => options.find(o => o.value === v)?.label ?? '';
  const menu = createMenu(node, {
    className: 'select-menu',
    render(pop, close) {
      pop.style.minWidth = `${Math.round(node.getBoundingClientRect().width)}px`;
      pop.replaceChildren(...options.map(o => {
        const item = el('button', { class: `menu-item${o.value === current ? ' active' : ''}`, role: 'option', 'aria-selected': o.value === current ? 'true' : 'false' },
          el('span', { class: 'menu-check' }, o.value === current ? icon('check', 14) : null),
          el('span', { class: 'menu-label' }, o.label));
        item.addEventListener('click', () => { close(); if (o.value !== current) onChange(o.value); });
        return item;
      }));
      // 选项多时把当前项滚到看得见的地方
      requestAnimationFrame(() => pop.querySelector('.menu-item.active')?.scrollIntoView({ block: 'nearest' }));
    },
  });
  node.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation();
    const i = Math.max(0, options.findIndex(o => o.value === current));
    const next = options[Math.min(options.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next && next.value !== current) { menu.close(); onChange(next.value); }
  });
  const set = v => {
    current = v;
    label.textContent = labelOf(v);
    menu.refresh();
  };
  set(current);
  return { node, set, value: () => current };
}
