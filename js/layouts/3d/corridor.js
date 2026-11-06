import { svg } from '../helpers.js';

// 一整排幻灯片向远处延伸，近端固定在画面一侧。
export default {
  id: 'corridor',
  name: '透视长廊',
  category: '3d',
  icon: svg(`
    <polygon points="3,5 15,7 15,14 3,15"/><polygon points="17,7.5 26,9 26,14 17,14"/><polygon points="28,9.3 34,10.3 34,14 28,14"/><polygon points="36,10.6 40,11.2 40,14 36,14"/>
    <polygon points="3,16.5 15,16 15,23 3,25"/><polygon points="17,16 26,16 26,21 17,22.5"/><polygon points="28,16 34,16 34,19.7 28,20.7"/><polygon points="36,16 40,16 40,18.8 36,19.4"/>`),
  params: [
    { key: 'rows', label: '行数', type: 'range', min: 1, max: 4, default: 2 },
    { key: 'gap', label: '间距', type: 'range', min: 0, max: 100, default: 26 },
    { key: 'angle', label: '转角', type: 'range', min: -80, max: 80, default: 42, unit: '°' },
    { key: 'size', label: '高度', type: 'range', min: 0.2, max: 1.2, step: 0.01, default: 0.62 },
    { key: 'inset', label: '近端位置', type: 'range', min: -0.5, max: 0.9, step: 0.01, default: 0.12 },
    { key: 'fov', label: '透视强度', type: 'range', min: 15, max: 90, default: 50, unit: '°' },
  ],
  compute({ n, aspect, W, H, p }) {
    const rows = Math.max(1, Math.min(p.rows, n));
    const cols = Math.ceil(n / rows);
    const ch = (H * p.size - p.gap * (rows - 1)) / rows;
    const cw = ch * aspect;
    const bh = rows * ch + (rows - 1) * p.gap;
    const dir = p.angle >= 0 ? 1 : -1; // 向右延伸 / 向左延伸
    const items = [];
    for (let k = 0; k < n; k++) {
      const r = Math.floor(k / cols), c = k % cols;
      items.push({
        i: k,
        x: dir * (c * (cw + p.gap) + cw / 2),
        y: bh / 2 - r * (ch + p.gap) - ch / 2,
        w: cw, h: ch,
      });
    }
    return {
      items,
      group: { x: -dir * (W / 2) * (1 - p.inset), ry: p.angle },
      camera: { type: 'perspective', fov: p.fov },
    };
  },
};
