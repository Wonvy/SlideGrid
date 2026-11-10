// 版式通用工具。所有坐标为世界单位，原点在画布中心，y 轴向上。

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
