// 版式通用工具。所有坐标为世界单位，原点在画布中心，y 轴向上。
import { DEG } from '../core/utils.js';

/**
 * 在矩形区域内按列数排网格，整体等比缩放以完全放入区域并居中。
 * 返回 { items, bw, bh, cw, ch }，bw/bh 为网格整体宽高。
 */
export function gridInRect({ count, cols, aspect, gap, w, h, cx = 0, cy = 0, centerLast = true, start = 0 }) {
  const items = [];
  if (count <= 0) return { items, bw: 0, bh: 0, cw: 0, ch: 0 };
  cols = Math.max(1, Math.min(Math.round(cols), count));
  const rows = Math.ceil(count / cols);
  let cw = (w - gap * (cols - 1)) / cols;
  let ch = cw / aspect;
  if (ch * rows + gap * (rows - 1) > h) {
    ch = (h - gap * (rows - 1)) / rows;
    cw = ch * aspect;
  }
  cw = Math.max(cw, 1);
  ch = Math.max(ch, 1);
  const bw = cols * cw + (cols - 1) * gap;
  const bh = rows * ch + (rows - 1) * gap;
  const top = cy + bh / 2;
  for (let k = 0; k < count; k++) {
    const r = Math.floor(k / cols), c = k % cols;
    const inRow = r === rows - 1 ? count - r * cols : cols;
    const rowW = inRow * cw + (inRow - 1) * gap;
    const left = cx - (centerLast ? rowW : bw) / 2;
    items.push({ i: start + k, x: left + c * (cw + gap) + cw / 2, y: top - r * (ch + gap) - ch / 2, w: cw, h: ch });
  }
  return { items, bw, bh, cw, ch };
}

/**
 * 铺满型网格：生成足够多的格子覆盖 extent × extent 的区域，图片循环重复。
 * offset：奇数列的纵向错位（单元格高度的比例）。
 */
export function fillGrid({ n, aspect, W, gap, cols, offset = 0, extent }) {
  const cw = Math.max(4, (W + gap) / cols - gap);
  const ch = cw / aspect;
  const nc = Math.min(81, (Math.ceil(extent / (cw + gap)) + 2) | 1);
  const nr = Math.min(81, (Math.ceil(extent / (ch + gap)) + 2) | 1);
  // 让上下相邻的格子尽量不是同一张图
  const stride = n > 1 && nc % n === 0 ? nc + 1 : nc;
  const c0 = (nc - 1) / 2, r0 = (nr - 1) / 2;
  const items = [];
  for (let c = 0; c < nc; c++) {
    const shift = (Math.abs(c - c0) % 2 === 1 ? offset : 0) * (ch + gap);
    for (let r = 0; r < nr; r++) {
      items.push({ i: r * stride + c, x: (c - c0) * (cw + gap), y: (r0 - r) * (ch + gap) - shift, w: cw, h: ch });
    }
  }
  return items;
}

export const svg = body => `<svg viewBox="0 0 48 30" fill="currentColor" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

/**
 * 「数量」参数：最多显示几张卡片（0 = 全部图片）。图片比数量少时按图片数量显示。
 * 用在卡片数量跟着图片数量走的版式里（扇形、环形、层叠…），避免图片多了显得拥挤。
 * 长图模式下不限制（长图要把所有图片排下来）；铺满型版式（卡片铺满画板）没有这个参数，疏密用列数 / 缩放调。
 */
export const countParam = (defaultCount = 0) => ({
  key: 'count', label: '数量', type: 'range', min: 0, max: 40, default: defaultCount,
  format: v => (v > 0 ? `最多 ${Math.round(v)} 张` : '全部'),
});

/**
 * 把平放在地面（版式坐标的 xy 平面）上的卡片翻起来：以一条边为轴往镜头方向立起 angle 度，再整体抬高 height；
 * turn：卡片在自己平面里再转一点（显得随意）。edge：轴在哪条边（bottom / top / left / right）。
 */
export function raiseItem(it, { angle = 0, height = 0, edge = 'bottom', turn = 0 } = {}) {
  const a = angle * DEG, c = Math.cos(a), s = Math.sin(a);
  const out = { ...it, z: (it.z || 0) + height, rz: (it.rz || 0) + turn };
  if (edge === 'top') Object.assign(out, { y: it.y + it.h / 2 - (it.h / 2) * c, z: out.z + (it.h / 2) * s, rx: -angle });
  else if (edge === 'left') Object.assign(out, { x: it.x - it.w / 2 + (it.w / 2) * c, z: out.z + (it.w / 2) * s, ry: -angle });
  else if (edge === 'right') Object.assign(out, { x: it.x + it.w / 2 - (it.w / 2) * c, z: out.z + (it.w / 2) * s, ry: angle });
  else Object.assign(out, { y: it.y - it.h / 2 + (it.h / 2) * c, z: out.z + (it.h / 2) * s, rx: angle });
  // 叠放层级：抬起的卡片始终压在平放的上面（俯视时近处平放的卡片离镜头更近，不能只按远近排）；
  // 抬起的卡片之间同一层，按离镜头远近排（按抬起高度排会让后面抬得高的那张盖住前面的）
  // 防止穿插：带「倾斜」（在卡片平面里先转一下）再翻起时，有一个下角会转到桌面下面、插进旁边的卡片——
  // 算出四个角里最低的高度，整张抬到最低的角刚好贴着桌面（再加上浮起高度）
  const rz = (out.rz || 0) * DEG, rxa = (out.rx || 0) * DEG, rya = (out.ry || 0) * DEG;
  let low = Infinity;
  for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x0 = (cx * it.w) / 2, y0 = (cy * it.h) / 2;
    const x1 = x0 * Math.cos(rz) - y0 * Math.sin(rz), y1 = x0 * Math.sin(rz) + y0 * Math.cos(rz); // Rz
    const z2 = -x1 * Math.sin(rya); // Ry（z 原来是 0）
    const z3 = y1 * Math.sin(rxa) + z2 * Math.cos(rxa); // Rx
    low = Math.min(low, z3);
  }
  const floorZ = (it.z || 0) + height; // 最低的角应该在的高度
  if (out.z + low < floorZ - 1e-6) out.z = floorZ - low;
  out.stack = 1;
  // 竖直投到桌面上的形状（桌面投影用）：绕上下边翻起时高度方向变短，绕左右边时宽度方向变短
  const flat = Math.max(0.02, Math.abs(c));
  out.floor = edge === 'left' || edge === 'right' ? { sx: flat, sy: 1 } : { sx: 1, sy: flat };
  return out;
}

export const RAISE_EDGES = [
  { value: 'bottom', label: '下边' }, { value: 'top', label: '上边' }, { value: 'left', label: '左边' }, { value: 'right', label: '右边' },
];

/**
 * 单张卡片的「抬起」设置（选中卡片后在「设计」页调，存在卡片的手动调整里）：
 *   raise：auto 跟随版式（自动翻起中间几张）/ up 抬起 / flat 放平；抬起时的角度、高度、轴、转角，没设置时用版式参数
 */
export const raiseCardParams = [
  { key: 'raise', label: '抬起', type: 'select', default: 'auto', options: [{ value: 'auto', label: '跟随版式' }, { value: 'up', label: '抬起' }, { value: 'flat', label: '放平' }] },
  { key: 'raiseAngle', label: '翻起角度', type: 'range', min: 0, max: 90, default: 58, unit: '°', show: v => v.raise === 'up' },
  { key: 'raiseHeight', label: '浮起高度', type: 'range', min: 0, max: 400, default: 36, show: v => v.raise === 'up' },
  { key: 'raiseEdge', label: '翻起的轴', type: 'select', default: 'bottom', options: RAISE_EDGES, show: v => v.raise === 'up' },
  { key: 'raiseTurn', label: '倾斜', type: 'range', min: -45, max: 45, default: 0, unit: '°', show: v => v.raise === 'up' },
];

// 卡片的抬起设置（缺的用版式参数补上）：返回 null = 平放
export function cardRaise(card, p, auto) {
  const mode = card?.raise || 'auto';
  if (mode === 'flat' || (mode === 'auto' && !auto)) return null;
  if (mode === 'auto') return auto;
  return {
    angle: card.raiseAngle ?? p.angle,
    height: card.raiseHeight ?? p.height,
    edge: card.raiseEdge ?? p.edge ?? 'bottom',
    turn: card.raiseTurn ?? 0,
  };
}

/**
 * 桌面视角（等距展台 / 分组展台）：卡片平铺在桌面上，先平面旋转 turn，再俯视 tilt（group: rx = -tilt, rz = turn）。
 * persp > 0 时用透视相机（视场角 = persp，远处的卡片变小，俯视的压扁读起来像「倒下去」而不是「拉长」）；0 = 正交（等距）。
 */
export const PERSP_PARAM = { key: 'persp', label: '透视强度', type: 'range', min: 0, max: 60, default: 30, unit: '°', format: v => (v > 0 ? `${Math.round(v)}°` : '无（等距）') };
export const tableCamera = p => (p.persp > 0 ? { type: 'perspective', fov: p.persp } : { type: 'ortho' });
const camDist = (persp, H) => (H / 2) / Math.tan((persp * DEG) / 2); // 相机到 z=0 平面的距离（见 render/scene.js）

/** 桌面上的点（x, y，桌面坐标；s：整组缩放；gx / gy：整组平移）投影到画板上（中心为原点，y 向上）；在相机后面返回 null */
export function tableProjector({ tilt, turn, persp, H, s = 1, gx = 0, gy = 0 }) {
  const ct = Math.cos(turn * DEG), st = Math.sin(turn * DEG), cv = Math.cos(tilt * DEG), sv = Math.sin(tilt * DEG);
  const dist = persp > 0 ? camDist(persp, H) : Infinity;
  return (x, y) => {
    const rx = (x * ct - y * st) * s, ry = (x * st + y * ct) * s;
    const X = rx + gx, Y = ry * cv + gy, Z = -ry * sv; // 往远处（桌面上方）z 变小
    if (!isFinite(dist)) return [X, Y];
    if (dist - Z < dist * 0.05) return null;
    const f = dist / (dist - Z);
    return [X * f, Y * f];
  };
}

/** 画板四个角看到的桌面离中心最远多远（桌面坐标）；透视下看得到地平线时返回 cap */
export function tableReach({ tilt, persp, W, H, s = 1, cap = Infinity }) {
  const cv = Math.cos(tilt * DEG), sv = Math.sin(tilt * DEG);
  if (!(persp > 0)) return Math.hypot(W, H) / 2 / s / Math.max(cv, 0.05);
  const dist = camDist(persp, H);
  let far = 0;
  for (const [sx, sy] of [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]]) {
    const den = cv * dist - sv * sy;
    if (den <= cv * dist * 0.02) return cap;
    const l = (cv * dist) / den; // 视线 (0, 0, dist) + l·(sx, sy, -dist) 与桌面的交点
    far = Math.max(far, Math.hypot(l * sx, l * sy, dist * (1 - l)));
  }
  return Math.min(cap, far / s);
}

/**
 * 桌面类版式（等距展台、分组展台、满铺堆叠）的远近效果参数：
 *   farFade 远处渐隐（远处的卡片淡出到背景，也让铺满型网格的远端不会突然断掉）、dof 景深模糊、focusMode / focus 对焦（抬起的卡片 / 手动：0 = 最远，1 = 最近）、
 *   floorShadow 抬起的卡片投在桌面上的影子（抬得越高越淡、越散）
 * 参数面板里是「空间效果」一组，标题上有开关（fxOff）。
 */
export const tableFxParams = ({ farFade = 0, dof = 0, focus = 0.5, floorShadow = 0.5, focusLabel = '抬起的卡片' } = {}) => [
  // 这几项单独一组，标题上的开关一键关掉 / 打开（fxOff：关掉时效果都不画，各项的数值保留）
  { group: '空间效果', switch: { key: 'fxOff', invert: true } },
  { key: 'fxOff', label: '关闭空间效果', type: 'toggle', default: false, show: () => false },
  { key: 'farFade', label: '远处渐隐', type: 'range', min: 0, max: 1, step: 0.01, default: farFade },
  { key: 'dof', label: '景深模糊', type: 'range', min: 0, max: 1, step: 0.01, default: dof },
  {
    key: 'focusMode', label: '对焦', type: 'select', default: 'auto', show: v => v.dof > 0,
    options: [{ value: 'auto', label: focusLabel }, { value: 'manual', label: '手动' }],
  },
  {
    key: 'focus', label: '对焦位置', type: 'range', min: 0, max: 1, step: 0.01, default: focus, show: v => v.dof > 0 && v.focusMode === 'manual',
    format: v => (v <= 0.02 ? '最远处' : v >= 0.98 ? '最近处' : `${Math.round(v * 100)}%（远 → 近）`),
  },
  ...(floorShadow == null ? [] : [{ key: 'floorShadow', label: '桌面投影', type: 'range', min: 0, max: 1, step: 0.01, default: floorShadow }]),
];
// focus：'auto' = 对焦在抬起的卡片上（没有抬起的卡片时在中间）
export const tableFx = p => (p.fxOff ? { depthFx: { fade: 0, dof: 0, focus: 'auto' }, floorShadow: 0 } : {
  depthFx: { fade: p.farFade || 0, dof: p.dof || 0, focus: p.focusMode === 'manual' ? p.focus ?? 0.5 : 'auto' },
  floorShadow: p.floorShadow ?? 0,
});

/**
 * 给其他 3D 版式加上远近效果（远处渐隐、景深模糊）：在参数最后加上这几项，compute 的结果里带上 depthFx。
 * 没有抬起的卡片时，「自动」对焦在第一张（有主次顺序的版式：纵深层叠、环形展台）或离画板中心最近的那张卡片上。
 */
export function withDepthFx(layout, defaults = {}) {
  return {
    ...layout,
    params: [...layout.params, ...tableFxParams({ ...defaults, floorShadow: null, focusLabel: layout.ordered ? '最前面的卡片' : '画面中间的卡片' })],
    compute(args) {
      const r = layout.compute(args);
      return r && { ...r, depthFx: tableFx(args.p).depthFx };
    },
  };
}
