import { mulberry32 } from '../../core/utils.js';
import { svg, countParam } from '../helpers.js';

export default {
  id: 'scatter',
  name: '散落',
  category: 'flat',
  long: true, // 支持长图模式
  icon: svg(`
    <rect x="5" y="5" width="14" height="9" rx="1" transform="rotate(-10 12 9.5)"/>
    <rect x="25" y="3" width="14" height="9" rx="1" transform="rotate(8 32 7.5)"/>
    <rect x="9" y="17" width="14" height="9" rx="1" transform="rotate(6 16 21.5)"/>
    <rect x="28" y="16" width="14" height="9" rx="1" transform="rotate(-7 35 20.5)"/>`),
  params: [
    countParam(12),
    { key: 'size', label: '大小', type: 'range', min: 0.5, max: 1.8, step: 0.01, default: 1.05 },
    { key: 'rotate', label: '随机旋转', type: 'range', min: 0, max: 45, default: 10, unit: '°' },
    { key: 'jitter', label: '随机位移', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
    { key: 'margin', label: '边距', type: 'range', min: 0, max: 300, default: 110 },
    { key: 'seed', label: '随机种子', type: 'seed', default: 7 },
  ],
  compute({ n, aspect, W, H, p, long }) {
    const rnd = mulberry32(p.seed);
    const aw = W - 2 * p.margin;
    let ah = H - 2 * p.margin;
    let cols, rows, cellW, cellH;
    if (long) {
      // 长图：按宽度定列数，高度随行数增长
      cols = Math.max(1, Math.min(n, Math.round(Math.sqrt(n / 2))));
      rows = Math.ceil(n / cols);
      cellW = aw / cols;
      cellH = (cellW / aspect) * 1.2;
      ah = rows * cellH;
    } else {
      cols = Math.max(1, Math.round(Math.sqrt(n * (aw / ah) / aspect)));
      rows = Math.ceil(n / cols);
      cellW = aw / cols;
      cellH = ah / rows;
    }
    const w = Math.min(cellW, cellH * aspect) * 0.9 * p.size;
    const h = w / aspect;
    const items = [];
    for (let k = 0; k < n; k++) {
      const r = Math.floor(k / cols), c = k % cols;
      const inRow = r === rows - 1 ? n - r * cols : cols;
      const rowShift = ((cols - inRow) * cellW) / 2;
      items.push({
        i: k,
        x: -aw / 2 + rowShift + (c + 0.5) * cellW + (rnd() - 0.5) * cellW * p.jitter,
        y: ah / 2 - (r + 0.5) * cellH + (rnd() - 0.5) * cellH * p.jitter,
        z: rnd() * 10,
        rz: (rnd() * 2 - 1) * p.rotate,
        w, h,
      });
    }
    return { items, camera: { type: 'ortho' } };
  },
};
