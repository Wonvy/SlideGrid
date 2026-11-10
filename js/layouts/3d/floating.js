import { DEG } from '../../core/utils.js';
import { svg, countParam } from '../helpers.js';

// 悬浮错落：卡片同向侧转，高低交错地浮在画面中（类似 App 界面展示）；中间的离镜头更近。
// 可以排成多行：每行左右错开半格，行内仍然一高一低，画面更丰富。
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
    countParam(10),
    { key: 'rows', label: '行数', type: 'range', min: 1, max: 5, default: 2, format: v => `${Math.round(v)} 行` },
    { key: 'size', label: '大小', type: 'range', min: 0.15, max: 0.95, step: 0.01, default: 0.56 },
    { key: 'rowGap', label: '行距', type: 'range', min: -0.3, max: 1, step: 0.01, default: 0.12 },
    { key: 'rowShift', label: '隔行错开', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'spacing', label: '间隔', type: 'range', min: 0.3, max: 1.6, step: 0.01, default: 0.78 },
    { key: 'stagger', label: '高低错落', type: 'range', min: 0, max: 0.8, step: 0.01, default: 0.34 },
    { key: 'depth', label: '中间前凸', type: 'range', min: -300, max: 400, default: 120 },
    { key: 'rotate', label: '侧转', type: 'range', min: -60, max: 60, default: 28, unit: '°' },
    { key: 'tilt', label: '俯仰', type: 'range', min: -30, max: 30, default: 4, unit: '°' },
    { key: 'roll', label: '倾斜', type: 'range', min: -20, max: 20, default: 0, unit: '°' },
    { key: 'fov', label: '透视强度', type: 'range', min: 15, max: 90, default: 40, unit: '°' },
  ],
  compute({ n, aspect, W, H, p }) {
    const rows = Math.max(1, Math.min(n, Math.round(p.rows || 1)));
    const perRow = Math.ceil(n / rows);
    const dist = (H / 2) / Math.tan((p.fov * DEG) / 2); // 相机到 z=0 平面的距离（见 render/scene.js）
    const cos = Math.cos(p.rotate * DEG), sin = Math.sin(p.rotate * DEG);
    const place = k => {
      const h = H * p.size * k, w = h * aspect, step = w * p.spacing;
      const rowStep = h * (1 + p.stagger * 0.5 + p.rowGap);
      const items = [];
      for (let r = 0, i = 0; r < rows; r++) {
        const count = Math.min(perRow, n - r * perRow);
        if (count <= 0) break;
        const c = (perRow - 1) / 2;
        const shift = rows > 1 ? (r % 2 ? 0.5 : -0.5) * p.rowShift * step : 0; // 隔行左右错开
        const y0 = ((rows - 1) / 2 - r) * rowStep;
        const start = (perRow - count) / 2; // 最后一行不满时居中
        for (let j = 0; j < count; j++, i++) {
          const t = start + j - c;
          const up = perRow > 1 ? ((j + r + Math.round(c)) % 2 === 0 ? 1 : -1) : 0; // 一高一低，相邻两行交替
          const edge = Math.max(c, 0.5);
          items.push({
            i,
            x: t * step + shift,
            y: y0 + up * h * p.stagger * 0.5,
            z: p.depth * k * Math.max(0, 1 - Math.abs(t) / (edge + 0.5)),
            rx: -p.tilt, ry: p.rotate, rz: p.roll,
            w, h,
          });
        }
      }
      return items;
    };
    // 透视下靠近镜头的一侧会变大：按卡片四角投影后的范围缩放，整组放进画板（留一点边）
    const extent = items => {
      let ex = 0, ey = 0;
      for (const it of items) {
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
          const x = it.x + sx * (it.w / 2) * cos, z = it.z - sx * (it.w / 2) * sin, y = it.y + sy * it.h / 2;
          const f = dist / Math.max(dist - z, 1);
          ex = Math.max(ex, Math.abs(x * f));
          ey = Math.max(ey, Math.abs(y * f));
        }
      }
      return Math.max(ex / (W * 0.47), ey / (H * 0.46));
    };
    let k = 1, items = place(1);
    for (let iter = 0; iter < 4; iter++) {
      const over = extent(items);
      if (over <= 1.001) break;
      k /= over;
      items = place(k);
    }
    return { items, camera: { type: 'perspective', fov: p.fov } };
  },
};
