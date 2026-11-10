import { svg, countParam } from '../helpers.js';

// 卡片沿纵深依次排开（层叠/阶梯）。
export default {
  id: 'cascade',
  name: '纵深层叠',
  category: '3d',
  ordered: true, // 图片按版式顺序分配（不受「图片顺序」设置影响）
  icon: svg(`
    <polygon points="30,6 40,4 40,18 30,17" opacity=".45"/>
    <polygon points="22,7 34,5 34,20 22,19" opacity=".65"/>
    <polygon points="12,8 27,6 27,23 12,22" opacity=".85"/>
    <polygon points="2,9 20,7 20,27 2,25"/>`),
  params: [
    countParam(6),
    { key: 'size', label: '大小', type: 'range', min: 0.2, max: 0.9, step: 0.01, default: 0.55 },
    { key: 'dx', label: '横向间隔', type: 'range', min: -400, max: 400, default: 170 },
    { key: 'dy', label: '纵向间隔', type: 'range', min: -200, max: 200, default: 0 },
    { key: 'dz', label: '纵深间隔', type: 'range', min: 0, max: 800, default: 240 },
    { key: 'rotate', label: '朝向', type: 'range', min: -80, max: 80, default: -32, unit: '°' },
    { key: 'order', label: '顺序', type: 'select', default: 'front', options: [{ value: 'front', label: '第一张在最前' }, { value: 'back', label: '第一张在最后' }] },
    { key: 'fov', label: '透视强度', type: 'range', min: 15, max: 90, default: 42, unit: '°' },
  ],
  compute({ n, aspect, W, H, p }) {
    const h = H * p.size, w = h * aspect;
    // 透视下远处的卡片会变小，所以不按中点居中，而是把第一张锚定在画面一侧
    const cx = n > 1 && p.dx !== 0 ? Math.sign(p.dx) * Math.max(0, W / 2 - w * 0.62) : 0;
    const cy = ((n - 1) * p.dy) / 2;
    const items = [];
    for (let k = 0; k < n; k++) {
      items.push({
        i: p.order === 'back' ? n - 1 - k : k,
        x: k * p.dx - cx,
        y: k * p.dy - cy,
        z: -k * p.dz,
        ry: p.rotate,
        w, h,
      });
    }
    return { items, camera: { type: 'perspective', fov: p.fov } };
  },
};
