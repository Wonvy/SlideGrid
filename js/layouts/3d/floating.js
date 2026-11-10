import { DEG } from '../../core/utils.js';
import { svg, countParam } from '../helpers.js';

// 悬浮错落：一排卡片同向侧转，高低交错地浮在画面中（类似 App 界面展示）；中间的离镜头更近。
export default {
  id: 'floating',
  name: '悬浮错落',
  category: '3d',
  icon: svg(`
    <polygon points="2,9 10,7 10,23 2,22" opacity=".55"/>
    <polygon points="11,5 20,3 20,21 11,20" opacity=".8"/>
    <polygon points="20,10 30,8 30,28 20,27"/>
    <polygon points="30,3 39,1 39,19 30,18" opacity=".8"/>
    <polygon points="39,8 47,6 47,22 39,21" opacity=".55"/>`),
  params: [
    countParam(5),
    { key: 'size', label: '大小', type: 'range', min: 0.2, max: 0.95, step: 0.01, default: 0.56 },
    { key: 'spacing', label: '间隔', type: 'range', min: 0.3, max: 1.6, step: 0.01, default: 0.78 },
    { key: 'stagger', label: '高低错落', type: 'range', min: 0, max: 0.8, step: 0.01, default: 0.34 },
    { key: 'depth', label: '中间前凸', type: 'range', min: -300, max: 400, default: 120 },
    { key: 'rotate', label: '侧转', type: 'range', min: -60, max: 60, default: 28, unit: '°' },
    { key: 'tilt', label: '俯仰', type: 'range', min: -30, max: 30, default: 4, unit: '°' },
    { key: 'roll', label: '倾斜', type: 'range', min: -20, max: 20, default: 0, unit: '°' },
    { key: 'fov', label: '透视强度', type: 'range', min: 15, max: 90, default: 40, unit: '°' },
  ],
  compute({ n, aspect, W, H, p }) {
    const c = (n - 1) / 2;
    const dist = (H / 2) / Math.tan((p.fov * DEG) / 2); // 相机到 z=0 平面的距离（见 render/scene.js）
    const cos = Math.cos(p.rotate * DEG), sin = Math.sin(p.rotate * DEG);
    const place = k => {
      const h = H * p.size * k, w = h * aspect, step = w * p.spacing;
      return Array.from({ length: n }, (_, i) => {
        const t = i - c;
        const up = n > 1 ? ((i + Math.round(c)) % 2 === 0 ? 1 : -1) : 0; // 中间那张在上
        return {
          i,
          x: t * step,
          y: up * h * p.stagger * 0.5,
          z: (c > 0 ? p.depth * (1 - Math.abs(t) / c) : p.depth) * k,
          rx: -p.tilt, ry: p.rotate, rz: p.roll,
          w, h,
        };
      });
    };
    // 透视下靠近镜头的一侧会变大：按卡片左右边投影后的范围缩放，整排放进画板（留一点边）
    const halfSpan = items => Math.max(...items.flatMap(it => [-1, 1].map(sgn => {
      const x = it.x + sgn * (it.w / 2) * cos, z = it.z - sgn * (it.w / 2) * sin;
      return Math.abs(x * dist / Math.max(dist - z, 1)) + it.h * 0.06;
    })));
    let k = 1, items = place(1);
    for (let iter = 0; iter < 3; iter++) {
      const span = halfSpan(items);
      if (span <= W * 0.47) break;
      k *= (W * 0.47) / span;
      items = place(k);
    }
    return { items, camera: { type: 'perspective', fov: p.fov } };
  },
};
