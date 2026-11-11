import { DEG } from '../../core/utils.js';
import { fillGrid, svg } from '../helpers.js';

// 经典的"倾斜平铺墙"作品集效果：整面网格绕 Z 旋转后再向后倾倒。
export default {
  id: 'isoWall',
  name: '倾斜墙面',
  legacy: 'isoStage', // 等于「等距展台」不翻起卡片（翻起数量 0）：不再出现在版式列表里，用过它的画板照常显示
  category: '3d',
  icon: svg(`
    <polygon points="4,17 14,11 22,15 12,21"/><polygon points="15,10.5 25,4.5 33,8.5 23,14.5"/>
    <polygon points="13,22 23,16 31,20 21,26"/><polygon points="24,15.5 34,9.5 42,13.5 32,19.5"/>
    <polygon points="34,9 44,3 48,5 38,11" opacity=".6"/><polygon points="32,27 42,21 48,24 38,30" opacity=".6"/>`),
  params: [
    { key: 'cols', label: '列数', type: 'range', min: 3, max: 12, default: 5 },
    { key: 'gap', label: '间距', type: 'range', min: 0, max: 80, default: 22 },
    { key: 'offset', label: '错位', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'tilt', label: '倾倒角度', type: 'range', min: 0, max: 80, default: 50, unit: '°' },
    { key: 'turn', label: '平面旋转', type: 'range', min: -90, max: 90, default: -32, unit: '°' },
    { key: 'zoom', label: '缩放', type: 'range', min: 0.4, max: 3, step: 0.01, default: 1.2 },
    { key: 'fov', label: '透视强度', type: 'range', min: 5, max: 75, default: 26, unit: '°' },
  ],
  compute({ n, aspect, W, H, p }) {
    const extent = (Math.hypot(W, H) * 1.6) / p.zoom / Math.max(Math.cos(p.tilt * DEG), 0.35);
    const items = fillGrid({ n, aspect, W, gap: p.gap, cols: p.cols, offset: p.offset, extent });
    return {
      items,
      group: { rx: -p.tilt, rz: p.turn, s: p.zoom },
      camera: { type: 'perspective', fov: p.fov },
    };
  },
};
