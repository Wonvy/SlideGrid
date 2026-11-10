import { DEG } from '../../core/utils.js';
import { fillGrid, svg } from '../helpers.js';

// 等距展台：卡片平铺在地面上（正交、等距视角），中间几张翻起或浮起，像桌面上摊开的名片 / 网页样机。
// 翻起：以卡片下边为轴立起来；浮起：整张抬高。翻起的角度依次变化（全角度 → 平放浮起 → 六成角度…）显得错落。
export default {
  id: 'isoStage',
  name: '等距展台',
  category: '3d',
  icon: svg(`
    <polygon points="2,18 12,13 20,17 10,22" opacity=".45"/><polygon points="14,24 24,19 32,23 22,28" opacity=".45"/>
    <polygon points="28,11 38,6 46,10 36,15" opacity=".45"/><polygon points="30,25 40,20 48,24 38,29" opacity=".45"/>
    <polygon points="14,12 22,8 24,0 16,4"/><polygon points="24,17 32,13 40,17 32,21" opacity=".85"/>`),
  params: [
    { key: 'cols', label: '列数', type: 'range', min: 3, max: 10, default: 5 },
    { key: 'gap', label: '间距', type: 'range', min: 0, max: 120, default: 34 },
    { key: 'offset', label: '错位', type: 'range', min: 0, max: 1, step: 0.01, default: 0 },
    { key: 'raise', label: '翻起数量', type: 'range', min: 0, max: 8, default: 3, format: v => (v > 0 ? `${Math.round(v)} 张` : '不翻起') },
    { key: 'angle', label: '翻起角度', type: 'range', min: 0, max: 90, default: 58, unit: '°' },
    { key: 'height', label: '浮起高度', type: 'range', min: 0, max: 300, default: 36 },
    { key: 'tilt', label: '俯视角度', type: 'range', min: 20, max: 80, default: 55, unit: '°' },
    { key: 'turn', label: '平面旋转', type: 'range', min: -90, max: 90, default: -30, unit: '°' },
    { key: 'zoom', label: '缩放', type: 'range', min: 0.5, max: 3, step: 0.01, default: 1.35 },
  ],
  compute({ n, aspect, W, H, p }) {
    const extent = (Math.hypot(W, H) * 1.5) / p.zoom / Math.max(Math.cos(p.tilt * DEG), 0.3);
    const items = fillGrid({ n, aspect, W, gap: p.gap, cols: p.cols, offset: p.offset, extent });
    // 离中心最近的几张翻起 / 浮起
    const raise = Math.max(0, Math.round(p.raise));
    const near = items.map((it, k) => ({ k, d: Math.hypot(it.x, it.y * 1.2) })).sort((a, b) => a.d - b.d).slice(0, raise);
    const PATTERN = [1, 0, 0.6, 0.85, 0.3];
    near.forEach(({ k }, j) => {
      const it = items[k];
      const a = p.angle * PATTERN[j % PATTERN.length] * DEG;
      const lift = p.height * (1 + (j % 3) * 0.6);
      // 以下边为轴往上翻：下边留在原处（再抬高 lift），上边翻向镜头
      items[k] = {
        ...it,
        y: it.y - it.h / 2 + (it.h / 2) * Math.cos(a),
        z: lift + (it.h / 2) * Math.sin(a),
        rx: a / DEG,
      };
    });
    return {
      items,
      group: { rx: -p.tilt, rz: p.turn, s: p.zoom },
      camera: { type: 'ortho' },
    };
  },
};
