import { ASPECTS } from '../config.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { attachWheel } from './wheel.js';

export function createAspectBar(root, { onSelect }) {
  const buttons = new Map();
  let current = null;
  const bar = el('div', { class: 'segmented', title: '画布比例（悬停滚轮切换）' });
  for (const a of ASPECTS) {
    const b = el('button', { onclick: () => onSelect(a.id), class: a.value ? '' : 'long-btn' }, a.value ? null : icon('scroll-text', 13), a.label || a.id);
    buttons.set(a.id, b);
    bar.append(b);
  }

  // 滚轮切换：向上 = 往左，向下 = 往右（与按钮排列方向一致）
  attachWheel(bar, steps => {
    const idx = ASPECTS.findIndex(x => x.id === current);
    const next = ASPECTS[Math.min(ASPECTS.length - 1, Math.max(0, idx - steps))];
    if (next.id !== current) onSelect(next.id);
  });

  root.append(bar);
  return {
    update(id) {
      current = id;
      buttons.forEach((b, key) => b.classList.toggle('active', key === id));
    },
  };
}
