import { el } from './dom.js';
import { icon } from './icons.js';
import { createMenu } from './menu.js';

/**
 * 下拉框（代替浏览器自带的 <select>，样式和其他控件、菜单统一）。
 *   options：[{ value, label }]；onChange(value)
 *   返回 { node, set(value), value() }
 * 点击打开一列菜单（当前项打勾）；获得焦点时 ↑ / ↓ 直接换上一个 / 下一个，Enter / 空格打开。
 */
export function dropdown({ options, onChange, title = null, className = '', previews = false }) {
  let current = options[0]?.value;
  const label = el('span', { class: 'select-label' });
  const updatePreview = (preview, value) => {
    preview.dataset.preview = previews === true ? value : `${previews}-${value}`;
    if (previews === 'aspect') {
      const [w, h] = value.split(':').map(Number);
      preview.style.setProperty('--preview-aspect', w > 0 && h > 0 ? w / h : 4 / 3);
    }
  };
  const makePreview = (value, small = false) => {
    const grid = previews === 'order' ? el('span', { class: 'select-preview-order' },
      Array.from({ length: 9 }, () => el('span'))) : null;
    const preview = el('span', { class: small ? 'select-preview select-preview-current' : 'select-preview', 'aria-hidden': 'true' }, grid);
    updatePreview(preview, value);
    return preview;
  };
  const thumbnail = previews ? makePreview(current, true) : null;
  const node = el('button', { type: 'button', class: `select select-btn ${className}`.trim(), title, 'aria-haspopup': 'listbox' }, thumbnail, label, icon('chevron-down', 13));
  const labelOf = v => options.find(o => o.value === v)?.label ?? '';
  const menu = createMenu(node, {
    className: previews ? 'select-menu select-preview-grid' : 'select-menu',
    align: previews ? 'right' : 'left',
    flip: !!previews,
    render(pop, close) {
      if (!previews) pop.style.minWidth = `${Math.round(node.getBoundingClientRect().width)}px`;
      pop.replaceChildren(...options.map(o => {
        const item = el('button', { class: `menu-item${o.value === current ? ' active' : ''}`, role: 'option', 'aria-selected': o.value === current ? 'true' : 'false' },
          previews ? makePreview(o.value)
            : el('span', { class: 'menu-check' }, o.value === current ? icon('check', 14) : null),
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
    if (thumbnail) {
      updatePreview(thumbnail, v);
      if (!title) node.title = label.textContent;
    }
    menu.refresh();
  };
  set(current);
  return { node, set, value: () => current };
}
