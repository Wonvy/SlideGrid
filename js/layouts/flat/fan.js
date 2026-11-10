import { DEG } from '../../core/utils.js';
import { svg, countParam } from '../helpers.js';

export default {
  id: 'fan',
  name: '扇形展开',
  category: 'flat',
  ordered: true, // 图片按版式顺序分配（不受「图片顺序」设置影响）
  icon: svg(`
    <rect x="17" y="6" width="14" height="19" rx="1.5" transform="rotate(-30 24 40)" opacity=".55"/>
    <rect x="17" y="6" width="14" height="19" rx="1.5" transform="rotate(-10 24 40)" opacity=".75"/>
    <rect x="17" y="6" width="14" height="19" rx="1.5" transform="rotate(10 24 40)" opacity=".9"/>
    <rect x="17" y="6" width="14" height="19" rx="1.5" transform="rotate(30 24 40)"/>`),
  params: [
    countParam(7),
    { key: 'size', label: '大小', type: 'range', min: 0.2, max: 0.8, step: 0.01, default: 0.42 },
    { key: 'spread', label: '展开角度', type: 'range', min: 0, max: 200, default: 70, unit: '°' },
    { key: 'radius', label: '半径', type: 'range', min: 0.6, max: 6, step: 0.05, default: 2.2 },
    { key: 'lift', label: '上下位置', type: 'range', min: -400, max: 400, default: 0 },
  ],
  compute({ n, aspect, H, p }) {
    const h = H * p.size, w = h * aspect;
    const R = h * p.radius;
    const spread = n > 1 ? p.spread : 0;
    const pivotY = -R * (1 + Math.cos((spread / 2) * DEG)) / 2 + p.lift;
    const items = [];
    for (let k = 0; k < n; k++) {
      const a = n > 1 ? -spread / 2 + (k * spread) / (n - 1) : 0;
      items.push({
        i: k,
        x: R * Math.sin(a * DEG),
        y: pivotY + R * Math.cos(a * DEG),
        z: k,
        rz: -a,
        w, h,
      });
    }
    return { items, camera: { type: 'ortho' } };
  },
};
