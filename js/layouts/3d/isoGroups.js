import { svg, raiseItem, raiseCardParams, cardRaise, RAISE_EDGES, PERSP_PARAM, tableCamera, tableProjector } from '../helpers.js';

// 分组展台：等距展台的有限网格版，每一列（也可以改成每一行）是一组、用一个图集的图片——
// 适合分组展示（例如第一列 App 界面、第二列海报、第三列名片）。组与组之间可以多留一点间距；
// 选中任意卡片可以单独抬起 / 倾斜（和等距展台一样，在「设计」页调）。
export default {
  id: 'isoGroups',
  name: '分组展台',
  category: '3d',
  icon: svg(`
    <polygon points="2,14 10,10 16,13 8,17"/><polygon points="12,9 20,5 26,8 18,12"/><polygon points="22,4 30,0 36,3 28,7"/>
    <polygon points="10,22 18,18 24,21 16,25" opacity=".55"/><polygon points="20,17 28,13 34,16 26,20" opacity=".55"/><polygon points="30,12 38,8 44,11 36,15" opacity=".55"/>
    <polygon points="20,29 28,25 34,28 26,32" opacity=".3"/><polygon points="38,15 46,11 48,18 40,22" opacity=".85"/>`),
  params: [
    // 默认每列一组（key 用 groupAxis：之前保存过的「每行一组」不再沿用）
    { key: 'groupAxis', label: '分组', type: 'select', default: 'col', options: [{ value: 'col', label: '每列一组' }, { value: 'row', label: '每行一组' }] },
    { key: 'rows', label: '行数', type: 'range', min: 1, max: 10, default: 4 },
    { key: 'cols', label: '列数', type: 'range', min: 1, max: 12, default: 3 },
    {
      key: 'groups', label: '每组用的图集', type: 'albumGroups', default: [],
      count: v => Math.max(1, Math.round(v.groupAxis !== 'row' ? v.cols : v.rows)),
      itemLabel: (v, i) => `第 ${i + 1} ${v.groupAxis !== 'row' ? '列' : '行'}`,
    },
    { key: 'gap', label: '间距', type: 'range', min: 0, max: 160, default: 30 },
    { key: 'groupGap', label: '组间距', type: 'range', min: 0, max: 400, default: 70 },
    { key: 'raise', label: '自动翻起', type: 'range', min: 0, max: 8, default: 0, format: v => (v > 0 ? `中间 ${Math.round(v)} 张` : '不自动') },
    { key: 'angle', label: '翻起角度', type: 'range', min: 0, max: 90, default: 58, unit: '°' },
    { key: 'height', label: '浮起高度', type: 'range', min: 0, max: 300, default: 36 },
    { key: 'edge', label: '翻起的轴', type: 'select', default: 'bottom', options: RAISE_EDGES },
    { key: 'tilt', label: '俯视角度', type: 'range', min: 0, max: 80, default: 40, unit: '°' },
    { key: 'turn', label: '平面旋转', type: 'range', min: -90, max: 90, default: -30, unit: '°' },
    { ...PERSP_PARAM, default: 35 },
    { key: 'zoom', label: '缩放', type: 'range', min: 0.3, max: 3, step: 0.01, default: 1 },
  ],
  cardParams: raiseCardParams,
  compute({ aspect, W, H, p, cards = {}, albums = [] }) {
    const rows = Math.max(1, Math.round(p.rows)), cols = Math.max(1, Math.round(p.cols));
    const byCol = p.groupAxis !== 'row';
    // 每组用哪个图集：指定了就用指定的，否则按图集顺序轮流
    const groups = Array.isArray(p.groups) ? p.groups : [];
    const albumOf = g => {
      const id = groups[g];
      if (id && albums.some(a => a.id === id)) return id;
      return albums.length ? albums[g % albums.length].id : null;
    };
    // 先按卡片宽 1 排好（单位尺寸），再整体缩放放进画板
    const w = 1, h = 1 / aspect;
    const gap = p.gap / 400, ggap = p.groupGap / 400; // 间距相对卡片宽（参数按一张卡片约 400 宽来定）
    const colX = c => c * (w + gap) + (byCol ? c * ggap : 0);
    const rowY = r => r * (h + gap) + (byCol ? 0 : r * ggap);
    const gw = colX(cols - 1) + w, gh = rowY(rows - 1) + h;
    const items = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const g = byCol ? c : r;
        items.push({
          i: items.length,
          album: albumOf(g),
          ai: byCol ? r : c, // 组内第几张
          x: colX(c) + w / 2 - gw / 2,
          y: gh / 2 - rowY(r) - h / 2,
          w, h,
        });
      }
    }
    // 投影后（平面旋转 + 俯视压扁 + 透视）整个网格放进画板的 88% × 「缩放」，并居中（透视下近处大、远处小，要往回挪）
    const corners = [[-gw / 2, -gh / 2], [gw / 2, -gh / 2], [gw / 2, gh / 2], [-gw / 2, gh / 2]];
    let k = Math.min(W, H) / Math.max(gw, gh), gx = 0, gy = 0;
    for (let iter = 0; iter < 12; iter++) {
      const proj = tableProjector({ tilt: p.tilt, turn: p.turn, persp: p.persp, H, s: k, gx, gy });
      const pts = corners.map(([x, y]) => proj(x, y));
      if (pts.some(q => !q)) { k *= 0.6; continue; } // 有角跑到相机后面：先缩小
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      const over = Math.max((Math.max(...xs) - Math.min(...xs)) / (W * 0.88), (Math.max(...ys) - Math.min(...ys)) / Math.max(H * 0.88, 1e-6)) / p.zoom;
      gx -= cx; gy -= cy;
      if (Math.abs(over - 1) < 0.002 && Math.abs(cx) + Math.abs(cy) < 0.5) break;
      k /= p.persp > 0 ? Math.sqrt(over) : over; // 透视下放大不是线性的：慢一点逼近
    }
    const scaled = items.map(it => ({ ...it, x: it.x * k, y: it.y * k, w: it.w * k, h: it.h * k }));
    // 自动翻起：离中心最近的几张
    const raise = Math.max(0, Math.round(p.raise));
    const near = new Set(scaled.map((it, i) => ({ i, d: Math.hypot(it.x, it.y) })).sort((a, b) => a.d - b.d).slice(0, raise).map(x => x.i));
    const auto = { angle: p.angle, height: p.height, edge: p.edge || 'bottom', turn: 0 };
    for (let i = 0; i < scaled.length; i++) {
      const r = cardRaise(cards[i], p, near.has(i) ? auto : null);
      if (r) scaled[i] = raiseItem(scaled[i], r);
    }
    return {
      items: scaled,
      group: { x: gx, y: gy, rx: -p.tilt, rz: p.turn },
      camera: tableCamera(p),
    };
  },
};
