/**
 * 透视填充：把图片画进任意四边形（Canvas 2D 没有透视变换）。
 * 做法：由四个角算出单应矩阵（单位正方形 → 四边形），把正方形切成网格，每个格子拆成两个三角形，
 * 每个三角形用仿射变换画对应的那块图片。网格点上透视完全准确，格子越密越接近真实透视。
 * 相邻三角形各向外扩一点（约 0.6 像素）盖住接缝。
 */

// 单位正方形 → 四边形（顺序：左上、右上、右下、左下）。返回 (u, v) → [x, y]
export function homography(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) > 1e-12 && (Math.abs(dx3) > 1e-12 || Math.abs(dy3) > 1e-12)) {
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
  };
}

const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

// 四边形的大致宽高比（对边长度取平均）
export const quadAspect = q => (dist(q[0], q[1]) + dist(q[3], q[2])) / Math.max(1e-6, dist(q[0], q[3]) + dist(q[1], q[2]));

// 一个三角形：源图里的三点 s → 目标三点 d（目标三角形向外扩 grow 盖住接缝）
function triangle(ctx, img, s, d, grow) {
  const [[u0, v0], [u1, v1], [u2, v2]] = s;
  const [[x0, y0], [x1, y1], [x2, y2]] = d;
  const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
  if (Math.abs(det) < 1e-9) return;
  const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3;
  ctx.save();
  ctx.beginPath();
  d.forEach(([x, y], i) => {
    const len = Math.hypot(x - cx, y - cy) || 1;
    const ex = x + ((x - cx) / len) * grow, ey = y + ((y - cy) / len) * grow;
    if (i) ctx.lineTo(ex, ey); else ctx.moveTo(ex, ey);
  });
  ctx.closePath();
  ctx.clip();
  const a = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det;
  const b = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det;
  const c = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / det;
  const dd = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / det;
  ctx.transform(a, b, c, dd, x0 - a * u0 - c * v0, y0 - b * u0 - dd * v0);
  // 只取这个三角形附近的一块源图，减少绘制量
  const bx = Math.max(0, Math.floor(Math.min(u0, u1, u2)) - 2), by = Math.max(0, Math.floor(Math.min(v0, v1, v2)) - 2);
  const bw = Math.min(img.width, Math.ceil(Math.max(u0, u1, u2)) + 2) - bx, bh = Math.min(img.height, Math.ceil(Math.max(v0, v1, v2)) + 2) - by;
  if (bw > 0 && bh > 0) ctx.drawImage(img, bx, by, bw, bh, bx, by, bw, bh);
  ctx.restore();
}

/**
 * 把 img 透视填充进四边形 q（当前坐标系下的四个点：左上、右上、右下、左下）。
 * fit：'cover' 裁切填满（按四边形的大致比例），'contain' 完整显示（其余部分留给调用方的底色）
 */
export function drawWarped(ctx, img, q, { fit = 'cover' } = {}) {
  if (!img?.width) return;
  const m = ctx.getTransform();
  const px = Math.hypot(m.a, m.b) || 1; // 1 个单位 = 多少像素
  const H = homography(q);
  const ar = quadAspect(q), ir = img.width / img.height;
  // 源图取哪一块（cover），图片放在正方形的哪一块（contain）
  let sx = 0, sy = 0, sw = img.width, sh = img.height, u0 = 0, v0 = 0, u1 = 1, v1 = 1;
  if (fit === 'contain') {
    if (ir > ar) { const k = ar / ir; v0 = (1 - k) / 2; v1 = v0 + k; } else { const k = ir / ar; u0 = (1 - k) / 2; u1 = u0 + k; }
  } else if (ir > ar) { sw = img.height * ar; sx = (img.width - sw) / 2; } else { sh = img.width / ar; sy = (img.height - sh) / 2; }
  // 网格密度随屏幕上的大小变化：小的时候少切几块
  const span = Math.max(dist(q[0], q[2]), dist(q[1], q[3])) * px;
  const n = Math.max(4, Math.min(16, Math.round(span / 70)));
  const grid = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const u = u0 + ((u1 - u0) * i) / n, v = v0 + ((v1 - v0) * j) / n;
      grid.push({ d: H(u, v), s: [sx + (sw * i) / n, sy + (sh * j) / n] });
    }
  }
  const grow = 0.6 / px;
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p00 = grid[j * (n + 1) + i], p10 = grid[j * (n + 1) + i + 1];
      const p01 = grid[(j + 1) * (n + 1) + i], p11 = grid[(j + 1) * (n + 1) + i + 1];
      triangle(ctx, img, [p00.s, p10.s, p11.s], [p00.d, p10.d, p11.d], grow);
      triangle(ctx, img, [p00.s, p11.s, p01.s], [p00.d, p11.d, p01.d], grow);
    }
  }
  ctx.restore();
}
