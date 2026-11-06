import { el } from './dom.js';
import { icon } from './icons.js';
import { createMenu } from './menu.js';
import { attachWheel } from './wheel.js';
import { sizeSchema, resolveLongSide, exportSize } from '../export/schema.js';

/**
 * 顶栏的导出尺寸：按钮显示「4K · 3840 × 2160」，点击展开尺寸菜单。
 * 每项显示名称和当前画板实际输出的像素；「自定义」可直接输入长边（长图为宽度）。滚轮切换尺寸。
 * canvasOf(s) → 当前画板的 { W, H, long }
 */
const PRESETS = sizeSchema[0].options.filter(o => o.value !== 'custom').map(o => ({
  value: o.value, name: o.label.split('·')[1]?.trim() || String(o.value),
}));
const nameOf = o => (o.size === 'custom' ? '自定义' : PRESETS.find(p => p.value === o.size)?.name || `${o.size}`);

export function createSizePicker(root, { store, actions, canvasOf }) {
  const name = el('span', { class: 'sp-name' });
  const dims = el('span', { class: 'sp-dims' });
  const btn = el('button', { class: 'sp-btn', 'aria-haspopup': 'menu' }, name, dims, icon('chevron-down', 12));
  root.replaceChildren(btn);

  const px = (s, size) => {
    const { width, height } = exportSize(canvasOf(s), size);
    return `${width} × ${height}`;
  };

  let custom = null;
  const menu = createMenu(btn, {
    className: 'size-menu',
    align: 'right',
    render(pop, close) {
      const s = store.get(), o = s.exportOpts;
      const long = canvasOf(s).long;
      pop.innerHTML = '';
      pop.append(el('div', { class: 'menu-title' }, long ? '导出尺寸（长图按宽度）' : '导出尺寸（按长边）'));
      for (const p of PRESETS) {
        const active = o.size === p.value;
        const item = el('button', { class: `size-item${active ? ' active' : ''}`, role: 'menuitemradio', 'aria-checked': String(active) },
          el('span', { class: 'size-check' }, active ? icon('check', 14) : null),
          el('span', { class: 'size-name' }, p.name),
          el('span', { class: 'size-px' }, px(s, p.value)));
        item.addEventListener('click', () => { actions.setExport('size', p.value); close(); });
        pop.append(item);
      }
      // 自定义：直接输入
      custom = el('input', { type: 'number', class: 'num-input size-input', min: 256, max: 12000, step: 100, value: o.customSize });
      const apply = () => {
        const v = Math.max(256, Math.min(12000, Math.round(Number(custom.value) || 0)));
        actions.setExport('customSize', v);
        actions.setExport('size', 'custom');
      };
      custom.addEventListener('change', apply);
      custom.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { apply(); close(); } });
      custom.addEventListener('focus', () => { if (o.size !== 'custom') apply(); });
      const isCustom = o.size === 'custom';
      pop.append(
        el('div', { class: 'menu-sep' }),
        el('div', { class: `size-item custom${isCustom ? ' active' : ''}` },
          el('span', { class: 'size-check' }, isCustom ? icon('check', 14) : null),
          el('span', { class: 'size-name' }, '自定义'),
          el('span', { class: 'size-custom' }, custom, el('span', { class: 'size-unit' }, 'px'))),
      );
    },
  });

  // 滚轮：在预设尺寸之间切换（工具栏不会滚动，悬停即可）
  attachWheel(btn, steps => {
    const o = store.get().exportOpts;
    const i = PRESETS.findIndex(p => p.value === o.size);
    const next = PRESETS[Math.max(0, Math.min(PRESETS.length - 1, (i < 0 ? PRESETS.length - 1 : i) + (steps > 0 ? 1 : -1)))];
    actions.setExport('size', next.value);
  }, { immediate: true });

  function update(s) {
    const o = s.exportOpts;
    name.textContent = nameOf(o);
    dims.textContent = px(s, resolveLongSide(o));
    btn.title = `导出 / 复制尺寸：${dims.textContent} px（点击选择，滚轮切换）`;
    if (menu.isOpen() && document.activeElement !== custom) menu.refresh();
  }
  update(store.get());
  return { update };
}
