import { el } from './dom.js';
import { icon } from './icons.js';
import { createMenu } from './menu.js';
import { attachWheel } from './wheel.js';
import { SCALES, resolveScale, exportSize } from '../export/schema.js';

/**
 * 导出面板的倍率：按钮显示「1× 1920 × 1080」（当前画板输出的像素），点击展开倍率菜单。
 * 倍率 = 画板的像素尺寸 × 几倍（1× 就是画板原始像素）；也可以输入任意倍率。滚轮切换。
 * canvasOf(s) → 当前画板的 { W, H, long, px }
 */
const fmtScale = v => `${Number(v.toFixed(2))}×`;

export function createSizePicker(root, { store, actions, canvasOf, onClose }) {
  const name = el('span', { class: 'sp-name' });
  const dims = el('span', { class: 'sp-dims' });
  const btn = el('button', { type: 'button', class: 'sp-btn', 'aria-haspopup': 'menu' }, name, dims, icon('chevron-down', 12));
  root.replaceChildren(btn);

  const px = (s, scale) => {
    const { width, height } = exportSize(canvasOf(s), { scale });
    return `${width} × ${height}`;
  };

  let custom = null;
  const menu = createMenu(btn, {
    className: 'size-menu',
    align: 'right',
    onClose,
    render(pop, close) {
      const s = store.get();
      const cur = resolveScale(s.exportOpts);
      pop.innerHTML = '';
      pop.append(el('div', { class: 'menu-title' }, canvasOf(s).long ? '导出倍率（长图：1× 宽 1920）' : '导出倍率（画板像素 × 倍率）'));
      for (const v of SCALES) {
        const active = cur === v;
        const item = el('button', { class: `size-item${active ? ' active' : ''}`, role: 'menuitemradio', 'aria-checked': String(active) },
          el('span', { class: 'size-check' }, active ? icon('check', 14) : null),
          el('span', { class: 'size-name' }, v === 1 ? '1× 原始像素' : fmtScale(v)),
          el('span', { class: 'size-px' }, px(s, v)));
        item.addEventListener('click', () => { close(); actions.setExport('scale', v); });
        pop.append(item);
      }
      // 任意倍率
      const isCustom = !SCALES.includes(cur);
      custom = el('input', { type: 'number', class: 'num-input size-input', min: 0.1, max: 8, step: 0.1, value: isCustom ? cur : 1.5 });
      const apply = () => {
        const v = Math.max(0.1, Math.min(8, Number(custom.value) || 1));
        actions.setExport('scale', Number(v.toFixed(2)));
      };
      custom.addEventListener('change', apply);
      custom.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { apply(); close(); } });
      pop.append(
        el('div', { class: 'menu-sep' }),
        el('div', { class: `size-item custom${isCustom ? ' active' : ''}` },
          el('span', { class: 'size-check' }, isCustom ? icon('check', 14) : null),
          el('span', { class: 'size-name' }, '自定义'),
          el('span', { class: 'size-custom' }, custom, el('span', { class: 'size-unit' }, '×'))),
        el('div', { class: 'size-hint' }, '画板的像素尺寸在顶栏中间的尺寸按钮里设置'),
      );
    },
  });

  // 滚轮：在预设倍率之间切换（悬停即可）
  attachWheel(btn, steps => {
    const cur = resolveScale(store.get().exportOpts);
    const i = SCALES.indexOf(cur);
    const next = SCALES[Math.max(0, Math.min(SCALES.length - 1, (i < 0 ? 1 : i) + (steps > 0 ? 1 : -1)))];
    actions.setExport('scale', next);
  }, { immediate: true });

  function update(s) {
    const scale = resolveScale(s.exportOpts);
    name.textContent = fmtScale(scale);
    dims.textContent = px(s, scale);
    btn.title = `导出 / 复制：${dims.textContent} px（画板像素 × ${fmtScale(scale)}，点击选择，滚轮切换）`;
    if (menu.isOpen() && document.activeElement !== custom) menu.refresh();
  }
  update(store.get());
  return { update, isOpen: menu.isOpen };
}
