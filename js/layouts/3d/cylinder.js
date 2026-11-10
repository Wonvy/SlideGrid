import { DEG } from '../../core/utils.js';
import { svg, countParam } from '../helpers.js';

// 幻灯片排在圆柱面上：内凹（环抱观众）或外凸。
export default {
  id: 'cylinder',
  name: '弧形墙',
  category: '3d',
  icon: svg(`
    <polygon points="2,4 9,6 9,14 2,14"/><polygon points="11,6.3 19,7.4 19,14 11,14"/><polygon points="21,7.6 27,7.6 27,14 21,14"/><polygon points="29,7.4 37,6.3 37,14 29,14"/><polygon points="39,6 46,4 46,14 39,14"/>
    <polygon points="2,16 9,16 9,24 2,26"/><polygon points="11,16 19,16 19,22.6 11,23.7"/><polygon points="21,16 27,16 27,22.4 21,22.4"/><polygon points="29,16 37,16 37,23.7 29,22.6"/><polygon points="39,16 46,16 46,26 39,24"/>`),
  params: [
    countParam(0),
    {
      key: 'mode', label: '方向', type: 'select', default: 'concave',
      options: [{ value: 'concave', label: '内凹（环抱）' }, { value: 'convex', label: '外凸' }],
    },
    { key: 'rows', label: '行数', type: 'range', min: 1, max: 5, default: 2 },
    { key: 'gap', label: '间距', type: 'range', min: 0, max: 100, default: 22 },
    { key: 'arc', label: '弧度', type: 'range', min: 20, max: 320, default: 110, unit: '°' },
    { key: 'size', label: '高度', type: 'range', min: 0.2, max: 1.2, step: 0.01, default: 0.42 },
    { key: 'fov', label: '透视强度', type: 'range', min: 15, max: 90, default: 50, unit: '°' },
  ],
  compute({ n, aspect, H, p }) {
    const rows = Math.max(1, Math.min(p.rows, n));
    const cols = Math.ceil(n / rows);
    const ch = (H * p.size - p.gap * (rows - 1)) / rows;
    const cw = ch * aspect;
    const step = cw + p.gap;
    const R = (cols * step) / (p.arc * DEG);
    const bh = rows * ch + (rows - 1) * p.gap;
    const concave = p.mode === 'concave';
    // 内凹时把最外侧的列放在 z=0 附近，避免两侧贴脸
    const edge = Math.min(((cols - 1) / 2) * step / R, 80 * DEG);
    const zShift = concave ? R * (1 - Math.cos(edge)) : 0;
    const items = [];
    for (let k = 0; k < n; k++) {
      const r = Math.floor(k / cols), c = k % cols;
      const theta = ((c - (cols - 1) / 2) * step) / R;
      items.push({
        i: k,
        x: R * Math.sin(theta),
        y: bh / 2 - r * (ch + p.gap) - ch / 2,
        z: concave ? R * (1 - Math.cos(theta)) - zShift : R * (Math.cos(theta) - 1),
        ry: (concave ? -theta : theta) / DEG,
        w: cw, h: ch,
      });
    }
    return { items, camera: { type: 'perspective', fov: p.fov } };
  },
};
