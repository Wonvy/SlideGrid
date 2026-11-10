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
  // 叠放层级：抬起的卡片始终压在平放的上面（俯视时近处平放的卡片离镜头更近，不能只按远近排）
  out.stack = 1 + out.z;
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
