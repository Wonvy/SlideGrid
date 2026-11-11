import { DEG, mulberry32 } from '../../core/utils.js';
import { svg, tableFxParams, tableFx } from '../helpers.js';

// 满铺堆叠：大量卡片随机转角、层层叠叠铺满桌面（略带俯视透视），中间一张主卡片抬起来压在最上面——
// 像一堆撒开的名片 / 印刷品。卡片铺满画板，图片不够时循环；疏密用「密度」调。
export default {
  id: 'pile',
  name: '满铺堆叠',
  category: '3d',
  surface: 'table', // 内容平面是桌面：立方体视图里朝镜头的那面是「上」（俯视 = 正对卡片）
  icon: svg(`
    <rect x="1" y="2" width="14" height="9" rx="1" transform="rotate(-18 8 6.5)" opacity=".45"/>
    <rect x="32" y="1" width="14" height="9" rx="1" transform="rotate(22 39 5.5)" opacity=".45"/>
    <rect x="2" y="18" width="14" height="9" rx="1" transform="rotate(25 9 22.5)" opacity=".45"/>
    <rect x="33" y="19" width="14" height="9" rx="1" transform="rotate(-15 40 23.5)" opacity=".45"/>
    <rect x="13" y="8" width="14" height="9" rx="1" transform="rotate(40 20 12.5)" opacity=".65"/>
    <rect x="15" y="9" width="19" height="12" rx="1.4" transform="rotate(-6 24.5 15)"/>`),
  params: [
    { key: 'size', label: '卡片大小', type: 'range', min: 0.12, max: 0.6, step: 0.01, default: 0.26 },
    { key: 'density', label: '密度', type: 'range', min: 0.4, max: 3, step: 0.05, default: 1.4 },
    { key: 'rotate', label: '随机旋转', type: 'range', min: 0, max: 180, default: 90, unit: '°' },
    { key: 'hero', label: '主卡片', type: 'select', default: 'on', options: [{ value: 'on', label: '中间抬起一张' }, { value: 'off', label: '不要' }] },
    { key: 'heroSize', label: '主卡片大小', type: 'range', min: 1, max: 3, step: 0.01, default: 1.7, show: p => p.hero !== 'off' },
    { key: 'heroTurn', label: '主卡片角度', type: 'range', min: -45, max: 45, default: -4, unit: '°', show: p => p.hero !== 'off' },
    { key: 'heroLift', label: '主卡片抬高', type: 'range', min: 0, max: 400, default: 90, show: p => p.hero !== 'off' },
    { key: 'tilt', label: '俯视角度', type: 'range', min: 0, max: 60, default: 24, unit: '°' },
    { key: 'turn', label: '平面旋转', type: 'range', min: -90, max: 90, default: 0, unit: '°' },
    { key: 'zoom', label: '缩放', type: 'range', min: 0.5, max: 2.5, step: 0.01, default: 1 },
    { key: 'seed', label: '随机种子', type: 'seed', default: 5 },
    { key: 'fov', label: '透视强度', type: 'range', min: 10, max: 70, default: 30, unit: '°' },
    ...tableFxParams(),
  ],
  compute({ aspect, W, H, p }) {
    const rnd = mulberry32(p.seed);
    const h = H * p.size, w = h * aspect;
    // 要铺满的范围（俯视时远处要多铺一些）
    const extent = (Math.hypot(W, H) * 1.25) / p.zoom / Math.max(Math.cos(p.tilt * DEG), 0.45);
    // 打散的网格：每格放一张、位置在格子里随机，密度越大格子越小（卡片叠得越多）
    const cell = Math.sqrt((w * h) / p.density) * 0.95;
    const nc = Math.min(40, Math.ceil(extent / cell) + 1), nr = nc;
    const items = [];
    const cards = [];
    for (let r = 0; r < nr; r++) {
      for (let c = 0; c < nc; c++) {
        cards.push({
          x: (c - (nc - 1) / 2 + (rnd() - 0.5) * 1.1) * cell,
          y: ((nr - 1) / 2 - r + (rnd() - 0.5) * 1.1) * cell,
          rz: (rnd() * 2 - 1) * p.rotate,
          z: rnd() * 12, // 叠放的先后（很小的高度差，只决定谁压在谁上面）
        });
      }
    }
    // 离中心近的先分到图片（配合「中心开始」的图片顺序，画面中间不重复）
    cards.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
    const heroOn = p.hero !== 'off';
    let k = 0;
    if (heroOn) {
      const s = p.heroSize;
      // 抬高是沿桌面的法线方向，俯视时画面上会往上移：在桌面上往下挪一点抵消，主卡片保持在画面中间
      const lift = 20 + p.heroLift;
      items.push({ i: k++, x: 0, y: -lift * Math.tan(p.tilt * DEG), z: lift, rz: p.heroTurn, w: w * s, h: h * s, stack: 1e6, floor: { sx: 1, sy: 1 } });
    }
    // 桌面上的卡片按高度叠放（俯视时近处的卡片离镜头更近，不能按远近排）
    for (const card of cards) items.push({ i: k++, ...card, w, h, stack: card.z });
    return {
      items,
      group: { rx: -p.tilt, rz: p.turn, s: p.zoom },
      camera: { type: 'perspective', fov: p.fov },
      ...tableFx(p),
    };
  },
};
