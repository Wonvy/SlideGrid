import { fillGrid, svg } from '../helpers.js';

// 铺满画布的网格（可以错位、旋转）；图片不够时循环重复。
function makeFillLayout({ id, name, icon, defaults, legacy }) {
  return {
    id,
    name,
    legacy,
    category: 'flat',
    icon,
    params: [
      { key: 'cols', label: '列数', type: 'range', min: 2, max: 10, default: defaults.cols },
      { key: 'gap', label: '间距', type: 'range', min: 0, max: 80, default: defaults.gap },
      { key: 'offset', label: '错位', type: 'range', min: 0, max: 1, step: 0.01, default: defaults.offset },
      { key: 'rotate', label: '旋转', type: 'range', min: -45, max: 45, default: defaults.rotate, unit: '°' },
      { key: 'zoom', label: '缩放', type: 'range', min: 0.5, max: 2.5, step: 0.01, default: defaults.zoom },
    ],
    compute({ n, aspect, W, H, p }) {
      const extent = Math.hypot(W, H) * 1.15 / p.zoom;
      const items = fillGrid({ n, aspect, W, gap: p.gap, cols: p.cols, offset: p.offset, extent });
      return { items, group: { rz: p.rotate, s: p.zoom }, camera: { type: 'ortho' } };
    },
  };
}

export const staggered = makeFillLayout({
  id: 'staggered',
  name: '铺满网格',
  icon: svg(`
    <rect x="3" y="-3" width="9" height="9" rx="1.2"/><rect x="3" y="9" width="9" height="9" rx="1.2"/><rect x="3" y="21" width="9" height="9" rx="1.2"/>
    <rect x="14" y="3" width="9" height="9" rx="1.2"/><rect x="14" y="15" width="9" height="9" rx="1.2"/>
    <rect x="25" y="-3" width="9" height="9" rx="1.2"/><rect x="25" y="9" width="9" height="9" rx="1.2"/><rect x="25" y="21" width="9" height="9" rx="1.2"/>
    <rect x="36" y="3" width="9" height="9" rx="1.2"/><rect x="36" y="15" width="9" height="9" rx="1.2"/>`),
  defaults: { cols: 4, gap: 24, offset: 0.5, rotate: 0, zoom: 1 },
});

export const tilted = makeFillLayout({
  id: 'tilted',
  name: '倾斜铺满',
  legacy: 'staggered', // 和「铺满网格」是同一种版式（只是默认带旋转）：不再出现在版式列表里，用过它的画板照常显示
  icon: svg(`<g transform="rotate(-20 24 15)">
    <rect x="-2" y="2" width="12" height="7" rx="1"/><rect x="12" y="-2" width="12" height="7" rx="1"/><rect x="26" y="2" width="12" height="7" rx="1"/><rect x="40" y="-2" width="12" height="7" rx="1"/>
    <rect x="-2" y="11" width="12" height="7" rx="1"/><rect x="12" y="7" width="12" height="7" rx="1"/><rect x="26" y="11" width="12" height="7" rx="1"/><rect x="40" y="7" width="12" height="7" rx="1"/>
    <rect x="-2" y="20" width="12" height="7" rx="1"/><rect x="12" y="16" width="12" height="7" rx="1"/><rect x="26" y="20" width="12" height="7" rx="1"/><rect x="40" y="16" width="12" height="7" rx="1"/>
    <rect x="12" y="25" width="12" height="7" rx="1"/><rect x="40" y="25" width="12" height="7" rx="1"/></g>`),
  defaults: { cols: 4, gap: 22, offset: 0.35, rotate: -18, zoom: 1.1 },
});
