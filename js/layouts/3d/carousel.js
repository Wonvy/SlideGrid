import { DEG } from '../../core/utils.js';
import { svg } from '../helpers.js';

// 幻灯片围成一圈，俯视角度可调。
export default {
  id: 'carousel',
  name: '环形展台',
  category: '3d',
  icon: svg(`
    <polygon points="19,16 29,16 29,26 19,26"/>
    <polygon points="6,13 15,15 15,24 6,21" opacity=".75"/><polygon points="33,15 42,13 42,21 33,24" opacity=".75"/>
    <polygon points="10,5 16,6 16,12 10,11" opacity=".4"/><polygon points="32,6 38,5 38,11 32,12" opacity=".4"/><polygon points="21,4 27,4 27,9 21,9" opacity=".3"/>`),
  params: [
    { key: 'size', label: '大小', type: 'range', min: 0.12, max: 0.7, step: 0.01, default: 0.34 },
    { key: 'spacing', label: '间隔', type: 'range', min: 0, max: 1.5, step: 0.01, default: 0.2 },
    { key: 'tilt', label: '俯视角度', type: 'range', min: -30, max: 45, default: 10, unit: '°' },
    { key: 'spin', label: '旋转', type: 'range', min: -180, max: 180, default: 0, unit: '°' },
    {
      key: 'facing', label: '朝向', type: 'select', default: 'out',
      options: [{ value: 'out', label: '朝外' }, { value: 'in', label: '朝内' }],
    },
    { key: 'fov', label: '透视强度', type: 'range', min: 15, max: 90, default: 40, unit: '°' },
  ],
  compute({ n, aspect, H, p }) {
    const h = H * p.size, w = h * aspect;
    const R = Math.max((n * w * (1 + p.spacing)) / (2 * Math.PI), w * 0.6);
    const items = [];
    for (let k = 0; k < n; k++) {
      const theta = (360 * k) / n + p.spin;
      items.push({
        i: k,
        x: R * Math.sin(theta * DEG),
        y: 0,
        z: R * Math.cos(theta * DEG),
        ry: p.facing === 'in' ? theta + 180 : theta,
        w, h,
      });
    }
    return {
      items,
      group: { z: -R, rx: p.tilt },
      camera: { type: 'perspective', fov: p.fov },
    };
  },
};
