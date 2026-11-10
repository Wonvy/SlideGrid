import { mulberry32 } from '../../core/utils.js';
import { svg, countParam } from '../helpers.js';

// 空中飘落：卡片在空中随机翻转、前后错开，像抛起来的一叠名片；可以整体偏到一侧，另一侧留白放文字。
// 位置用打散的网格（每格一张再随机挪一点），不会全挤在一起；超出画板的部分被裁掉，显得画面更满。
export default {
  id: 'tumble',
  name: '空中飘落',
  category: '3d',
  icon: svg(`
    <polygon points="20,1 31,3 29,11 18,9" opacity=".7"/>
    <polygon points="34,8 46,12 42,20 31,16"/>
    <polygon points="14,12 24,10 27,22 17,25" opacity=".85"/>
    <polygon points="29,20 37,22 35,30 27,28" opacity=".6"/>
    <polygon points="38,22 47,20 48,28 39,30" opacity=".75"/>`),
  params: [
    countParam(7),
    { key: 'size', label: '大小', type: 'range', min: 0.15, max: 0.8, step: 0.01, default: 0.27 },
    { key: 'vary', label: '大小差异', type: 'range', min: 0, max: 0.6, step: 0.01, default: 0.18 },
    { key: 'area', label: '分布宽度', type: 'range', min: 0.3, max: 1.4, step: 0.01, default: 0.75 },
    { key: 'spreadY', label: '分布高度', type: 'range', min: 0.3, max: 1.6, step: 0.01, default: 1.2 },
    { key: 'offset', label: '左右偏移', type: 'range', min: -0.6, max: 0.6, step: 0.01, default: 0.3 },
    { key: 'jitter', label: '随机位移', type: 'range', min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: 'rotate', label: '平面旋转', type: 'range', min: 0, max: 90, default: 38, unit: '°' },
    { key: 'tilt', label: '空间翻转', type: 'range', min: 0, max: 70, default: 48, unit: '°' },
    { key: 'depth', label: '前后错开', type: 'range', min: 0, max: 800, default: 360 },
    { key: 'seed', label: '随机种子', type: 'seed', default: 3 },
    { key: 'fov', label: '透视强度', type: 'range', min: 15, max: 75, default: 32, unit: '°' },
  ],
  compute({ n, aspect, W, H, p }) {
    const rnd = mulberry32(p.seed);
    const rw = W * p.area, rh = H * p.spreadY;
    const cx = (p.offset * W) / 2;
    const cols = Math.max(1, Math.min(n, Math.round(Math.sqrt((n * rw) / rh))));
    const rows = Math.ceil(n / cols);
    const cw = rw / cols, ch = rh / rows;
    const base = H * p.size;
    const items = [];
    for (let k = 0; k < n; k++) {
      const r = Math.floor(k / cols), c = k % cols;
      const inRow = r === rows - 1 ? n - r * cols : cols;
      const shift = ((cols - inRow) * cw) / 2 + (r % 2 ? cw * 0.25 : -cw * 0.25) * (cols > 1 ? 1 : 0); // 隔行错开
      const s = 1 + (rnd() * 2 - 1) * p.vary;
      const h = base * s, w = h * aspect;
      items.push({
        i: k,
        x: cx - rw / 2 + shift + (c + 0.5) * cw + (rnd() - 0.5) * cw * p.jitter,
        y: rh / 2 - (r + 0.5) * ch + (rnd() - 0.5) * ch * p.jitter,
        z: (rnd() * 2 - 1) * p.depth * 0.5,
        rx: (rnd() * 2 - 1) * p.tilt,
        ry: (rnd() * 2 - 1) * p.tilt,
        rz: (rnd() * 2 - 1) * p.rotate,
        w, h,
      });
    }
    return { items, camera: { type: 'perspective', fov: p.fov } };
  },
};
