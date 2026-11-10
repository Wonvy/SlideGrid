import { gridInRect, svg, countParam } from '../helpers.js';

export default {
  id: 'grid',
  name: '规整网格',
  category: 'flat',
  long: true, // 支持长图模式
  icon: svg(`
    <rect x="4" y="4" width="12" height="9.5" rx="1.5"/><rect x="18" y="4" width="12" height="9.5" rx="1.5"/><rect x="32" y="4" width="12" height="9.5" rx="1.5"/>
    <rect x="4" y="16.5" width="12" height="9.5" rx="1.5"/><rect x="18" y="16.5" width="12" height="9.5" rx="1.5"/><rect x="32" y="16.5" width="12" height="9.5" rx="1.5"/>`),
  params: [
    countParam(0),
    { key: 'cols', label: '列数', type: 'range', min: 1, max: 12, default: 3 },
    { key: 'gap', label: '间距', type: 'range', min: 0, max: 120, default: 28 },
    { key: 'margin', label: '边距', type: 'range', min: 0, max: 300, default: 90 },
    { key: 'centerLast', label: '末行居中', type: 'toggle', default: true },
  ],
  compute({ n, aspect, W, H, p }) {
    const { items } = gridInRect({
      count: n, cols: p.cols, aspect, gap: p.gap,
      w: W - 2 * p.margin, h: H - 2 * p.margin, centerLast: p.centerLast,
    });
    return { items, camera: { type: 'ortho' } };
  },
};
