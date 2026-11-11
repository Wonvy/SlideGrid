import { DEG } from '../../core/utils.js';
import { fillGrid, svg, raiseItem, raiseCardParams, cardRaise, RAISE_EDGES, PERSP_PARAM, tableCamera, tableReach, tableFxParams, tableFx } from '../helpers.js';

// 等距展台：卡片平铺在地面上（等距视角，也可以加透视），中间几张翻起或浮起，像桌面上摊开的名片 / 网页样机。
// 翻起：以卡片下边为轴立起来；浮起：整张抬高。翻起的角度依次变化（全角度 → 平放浮起 → 六成角度…）显得错落。
// 也可以选中任意卡片，在「设计」页单独设置抬起 / 放平、角度、高度、翻起的轴和倾斜（cardParams）。
export default {
  id: 'isoStage',
  name: '等距展台',
  category: '3d',
  surface: 'table', // 内容平面是桌面：立方体视图里朝镜头的那面是「上」（俯视 = 正对卡片）
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
    { key: 'edge', label: '翻起的轴', type: 'select', default: 'bottom', options: RAISE_EDGES },
    { key: 'tilt', label: '俯视角度', type: 'range', min: 20, max: 80, default: 45, unit: '°' },
    { key: 'turn', label: '平面旋转', type: 'range', min: -90, max: 90, default: -30, unit: '°' },
    PERSP_PARAM,
    { key: 'zoom', label: '缩放', type: 'range', min: 0.5, max: 3, step: 0.01, default: 1.1 },
    ...tableFxParams({ farFade: 0.45, dof: 0.4 }),
  ],
  cardParams: raiseCardParams,
  compute({ n, aspect, W, H, p, cards = {} }) {
    // 网格要铺满画板能看到的桌面范围（透视下远处看得更远；看得到地平线时最多铺到正交时的 3 倍）
    const ortho = (Math.hypot(W, H) * 1.5) / p.zoom / Math.max(Math.cos(p.tilt * DEG), 0.3);
    const extent = p.persp > 0 ? 3 * tableReach({ tilt: p.tilt, persp: p.persp, W, H, s: p.zoom, cap: ortho }) : ortho;
    const items = fillGrid({ n, aspect, W, gap: p.gap, cols: p.cols, offset: p.offset, extent });
    // 离中心最近的几张自动翻起 / 浮起（角度依次变化）；单张卡片的设置优先
    const raise = Math.max(0, Math.round(p.raise));
    const near = items.map((it, k) => ({ k, d: Math.hypot(it.x, it.y * 1.2) })).sort((a, b) => a.d - b.d).slice(0, raise);
    const PATTERN = [1, 0, 0.6, 0.85, 0.3];
    const auto = new Map(near.map(({ k }, j) => [k, {
      angle: p.angle * PATTERN[j % PATTERN.length], height: p.height * (1 + (j % 3) * 0.6), edge: p.edge || 'bottom', turn: 0,
    }]));
    for (let k = 0; k < items.length; k++) {
      const r = cardRaise(cards[k], p, auto.get(k));
      if (r) items[k] = raiseItem(items[k], r);
    }
    return {
      items,
      group: { rx: -p.tilt, rz: p.turn, s: p.zoom },
      camera: tableCamera(p),
      ...tableFx(p),
    };
  },
};
