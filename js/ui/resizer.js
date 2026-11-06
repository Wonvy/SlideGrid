import { clamp } from '../core/utils.js';
import { el } from './dom.js';

// 左右两栏可拖动调整宽度，双击分隔条恢复默认，宽度保存到 localStorage
const KEY = 'slidegrid:panels:v1';
const DEFAULTS = { left: 248, right: 300 };
const LIMITS = { left: [180, 560], right: [240, 600] };
const MIN_STAGE = 360;

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return { ...DEFAULTS }; }
}

export function initResizers(app) {
  const sizes = load();
  const apply = () => {
    app.style.setProperty('--left-w', `${sizes.left}px`);
    app.style.setProperty('--right-w', `${sizes.right}px`);
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(sizes)); } catch { /* 忽略 */ } };
  apply();

  for (const side of ['left', 'right']) {
    const gutter = el('div', { class: `gutter gutter-${side}`, title: '拖动调整宽度，双击恢复默认' });
    app.append(gutter);

    gutter.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      gutter.setPointerCapture(e.pointerId);
      const startX = e.clientX, start = sizes[side];
      gutter.classList.add('active');
      document.body.classList.add('resizing');

      const move = ev => {
        const dx = ev.clientX - startX;
        const other = side === 'left' ? sizes.right : sizes.left;
        const max = Math.min(LIMITS[side][1], app.clientWidth - other - MIN_STAGE);
        sizes[side] = Math.round(clamp(side === 'left' ? start + dx : start - dx, LIMITS[side][0], max));
        apply();
      };
      const up = () => {
        gutter.removeEventListener('pointermove', move);
        gutter.removeEventListener('pointerup', up);
        gutter.removeEventListener('pointercancel', up);
        gutter.classList.remove('active');
        document.body.classList.remove('resizing');
        save();
      };
      gutter.addEventListener('pointermove', move);
      gutter.addEventListener('pointerup', up);
      gutter.addEventListener('pointercancel', up);
    });

    gutter.addEventListener('dblclick', () => {
      sizes[side] = DEFAULTS[side];
      apply();
      save();
    });
  }
}
