/**
 * 吸附与对齐的几何计算（屏幕坐标，CSS 像素）。
 * 矩形：{ l, t, r, b }
 */
export const SNAP_PX = 6;

export const rectOfPoints = pts => ({
  l: Math.min(...pts.map(p => p[0])), t: Math.min(...pts.map(p => p[1])),
  r: Math.max(...pts.map(p => p[0])), b: Math.max(...pts.map(p => p[1])),
});
export const unionRects = rs => ({
  l: Math.min(...rs.map(r => r.l)), t: Math.min(...rs.map(r => r.t)),
  r: Math.max(...rs.map(r => r.r)), b: Math.max(...rs.map(r => r.b)),
});
export const moveRect = (r, dx, dy) => ({ l: r.l + dx, t: r.t + dy, r: r.r + dx, b: r.b + dy });
export const intersects = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

const xLines = r => [r.l, (r.l + r.r) / 2, r.r];
const yLines = r => [r.t, (r.t + r.b) / 2, r.b];

/**
 * 把正在移动的矩形吸附到目标矩形的边缘 / 中线。
 * 返回 { dx, dy }（需要额外补的位移）和 guides（参考线，屏幕坐标）。
 */
export function snapRect(moving, targets, threshold = SNAP_PX) {
  let bx = null, by = null;
  for (const t of targets) {
    for (const tx of xLines(t)) for (const mx of xLines(moving)) {
      const d = tx - mx;
      if (Math.abs(d) <= threshold && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, x: tx };
    }
    for (const ty of yLines(t)) for (const my of yLines(moving)) {
      const d = ty - my;
      if (Math.abs(d) <= threshold && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, y: ty };
    }
  }
  const dx = bx ? bx.d : 0, dy = by ? by.d : 0;
  const m = moveRect(moving, dx, dy);
  const guides = [];
  // 参考线覆盖吸附后的矩形以及所有落在同一条线上的目标
  if (bx) {
    const hit = targets.filter(t => xLines(t).some(x => Math.abs(x - bx.x) < 0.5));
    const all = [m, ...hit];
    guides.push({ x: bx.x, y1: Math.min(...all.map(r => r.t)), y2: Math.max(...all.map(r => r.b)) });
  }
  if (by) {
    const hit = targets.filter(t => yLines(t).some(y => Math.abs(y - by.y) < 0.5));
    const all = [m, ...hit];
    guides.push({ y: by.y, x1: Math.min(...all.map(r => r.l)), x2: Math.max(...all.map(r => r.r)) });
  }
  return { dx, dy, guides };
}

/**
 * 对齐：返回每个矩形需要的位移 [dx, dy]。
 * ref：参照矩形（多选时是选中卡片的整体范围，单选时是画板）
 */
export function alignOffsets(rects, ref, mode) {
  return rects.map(r => {
    switch (mode) {
      case 'left': return [ref.l - r.l, 0];
      case 'hcenter': return [(ref.l + ref.r) / 2 - (r.l + r.r) / 2, 0];
      case 'right': return [ref.r - r.r, 0];
      case 'top': return [0, ref.t - r.t];
      case 'vcenter': return [0, (ref.t + ref.b) / 2 - (r.t + r.b) / 2];
      case 'bottom': return [0, ref.b - r.b];
      default: return [0, 0];
    }
  });
}

/** 等距分布（间距相等）：axis 'x' | 'y'；返回与 rects 同序的位移 */
export function distributeOffsets(rects, axis) {
  const lo = axis === 'x' ? 'l' : 't', hi = axis === 'x' ? 'r' : 'b';
  const order = rects.map((r, i) => i).sort((a, b) => rects[a][lo] - rects[b][lo]);
  const first = rects[order[0]], last = rects[order[order.length - 1]];
  const span = last[hi] - first[lo];
  const total = rects.reduce((n, r) => n + (r[hi] - r[lo]), 0);
  const gap = (span - total) / (rects.length - 1);
  const out = rects.map(() => [0, 0]);
  let pos = first[lo];
  for (const i of order) {
    const d = pos - rects[i][lo];
    out[i] = axis === 'x' ? [d, 0] : [0, d];
    pos += rects[i][hi] - rects[i][lo] + gap;
  }
  return out;
}
