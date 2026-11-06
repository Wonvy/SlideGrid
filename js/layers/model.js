/**
 * 图层：画在幻灯片上面的文字、矩形、椭圆和钢笔路径。每个画板有自己的图层列表（settings.layers，后面的在上层）。
 *
 * 坐标：画板坐标，原点在画板左上角，y 向下，单位与画板一致（画板高度 1000）。
 * 公共字段：{ id, type, name, x, y, w, h, rotation（度，绕中心）, opacity, hidden, locked }
 *   rect     radius、填充、描边
 *   ellipse  填充、描边
 *   text     text、fontSize、fontWeight、fontFamily、align、lineHeight、letterSpacing、color（w / h 由文字测量得出）
 *   path     anchors: [{ x, y, hi: {x,y}|null, ho: {x,y}|null }]（绝对坐标，hi / ho 为进入 / 离开的控制柄）、closed、填充、描边
 *            路径不使用 rotation：旋转、缩放直接作用在锚点上；x / y / w / h 为锚点的包围盒
 * 填充：fillType 'solid' | 'linear' | 'none'，fill / fillAlpha，渐变时 fill2 / fill2Alpha / fillAngle（可做透明度渐变）
 * 描边：stroke、strokeWidth（0 = 无描边）
 */
export const FONTS = {
  sans: '-apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
  serif: '"Songti SC", "Noto Serif SC", Georgia, serif',
  mono: '"SF Mono", Menlo, Consolas, monospace',
};

const TYPE_NAMES = { rect: '矩形', ellipse: '椭圆', text: '文字', path: '路径' };
export const typeName = t => TYPE_NAMES[t] || '图层';

export const newLayerId = () => `l_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const BASE = { rotation: 0, opacity: 1, hidden: false, locked: false };
const FILL = { fillType: 'solid', fill: '#7c8cff', fillAlpha: 1, fill2: '#7c8cff', fill2Alpha: 0, fillAngle: 180, stroke: '#ffffff', strokeWidth: 0 };

export function createLayer(type, props = {}, existing = []) {
  const n = existing.filter(l => l.type === type).length + 1;
  const base = { id: newLayerId(), type, name: `${typeName(type)} ${n}`, x: 0, y: 0, w: 200, h: 120, ...BASE };
  if (type === 'rect') return { ...base, ...FILL, radius: 0, ...props };
  if (type === 'ellipse') return { ...base, ...FILL, ...props };
  if (type === 'text') {
    return measureText({
      ...base, text: '输入文字', fontSize: 64, fontWeight: 700, fontFamily: 'sans', align: 'left',
      lineHeight: 1.25, letterSpacing: 0, color: '#ffffff', ...props,
    });
  }
  if (type === 'path') {
    return syncPathBox({ ...base, ...FILL, fillType: 'none', stroke: '#ffffff', strokeWidth: 6, anchors: [], closed: false, ...props });
  }
  throw new Error(`未知图层类型：${type}`);
}

/* ---------------- 文字测量 ---------------- */

let measureCtx = null;
const ctx2d = () => (measureCtx ||= document.createElement('canvas').getContext('2d'));
export const fontOf = l => `${l.fontWeight || 400} ${l.fontSize}px ${FONTS[l.fontFamily] || FONTS.sans}`;
export const textLines = l => String(l.text ?? '').split('\n');

// 每行的宽度（含字间距），给绘制和测量共用
export function lineWidths(l) {
  const g = ctx2d();
  g.font = fontOf(l);
  if ('letterSpacing' in g) g.letterSpacing = `${l.letterSpacing || 0}px`;
  return textLines(l).map(line => g.measureText(line).width);
}

// 根据文字内容更新 w / h（左上角不动）
export function measureText(l) {
  const widths = lineWidths(l);
  const w = Math.max(l.fontSize * 0.5, ...widths);
  const h = textLines(l).length * l.fontSize * l.lineHeight;
  return { ...l, w, h };
}

/* ---------------- 路径 ---------------- */

// 锚点 → Path2D（画板坐标）
export function pathOf(l) {
  const p = new Path2D();
  const a = l.anchors;
  if (!a.length) return p;
  p.moveTo(a[0].x, a[0].y);
  const seg = (from, to) => {
    const c1 = from.ho || from, c2 = to.hi || to;
    if (!from.ho && !to.hi) p.lineTo(to.x, to.y);
    else p.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
  };
  for (let i = 1; i < a.length; i++) seg(a[i - 1], a[i]);
  if (l.closed && a.length > 2) { seg(a[a.length - 1], a[0]); p.closePath(); }
  return p;
}

// 三次贝塞尔上的点
const bez = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
};
export function segments(l) {
  const a = l.anchors, out = [];
  for (let i = 1; i < a.length; i++) out.push([i - 1, i]);
  if (l.closed && a.length > 2) out.push([a.length - 1, 0]);
  return out;
}
export function segmentPoint(l, [i, j], t) {
  const A = l.anchors[i], B = l.anchors[j];
  const c1 = A.ho || A, c2 = B.hi || B;
  return { x: bez(A.x, c1.x, c2.x, B.x, t), y: bez(A.y, c1.y, c2.y, B.y, t) };
}

// 路径实际范围（按曲线采样，不含控制柄）
function pathBounds(l) {
  const a = l.anchors;
  if (!a.length) return { x: l.x || 0, y: l.y || 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = p => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); };
  a.forEach(add);
  for (const s of segments(l)) for (let k = 1; k < 16; k++) add(segmentPoint(l, s, k / 16));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export const syncPathBox = l => ({ ...l, ...pathBounds(l), rotation: 0 });

/**
 * 在线段 seg 的 t 处插入锚点（de Casteljau 分割，曲线形状不变）。返回新图层和新锚点序号。
 */
export function insertAnchor(l, seg, t) {
  const [i, j] = seg;
  const A = l.anchors[i], B = l.anchors[j];
  const P0 = A, P1 = A.ho || A, P2 = B.hi || B, P3 = B;
  const lerp = (p, q) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const a = lerp(P0, P1), b = lerp(P1, P2), c = lerp(P2, P3);
  const d = lerp(a, b), e = lerp(b, c), m = lerp(d, e);
  const curved = A.ho || B.hi;
  const anchors = l.anchors.map(p => ({ ...p }));
  if (curved) {
    anchors[i].ho = A.ho ? a : null;
    anchors[j].hi = B.hi ? c : null;
  }
  const mid = { x: m.x, y: m.y, hi: curved ? d : null, ho: curved ? e : null };
  const at = j === 0 ? anchors.length : j;
  anchors.splice(at, 0, mid);
  return { layer: syncPathBox({ ...l, anchors }), index: at };
}

// 离点 p 最近的线段位置：{ seg, t, d }
export function nearestOnPath(l, p) {
  let best = null;
  for (const s of segments(l)) {
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      const q = segmentPoint(l, s, t);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (!best || d < best.d) best = { seg: s, t, d };
    }
  }
  return best;
}

/* ---------------- 几何 ---------------- */

export const center = l => ({ x: l.x + l.w / 2, y: l.y + l.h / 2 });
const rot = (p, c, deg) => {
  const a = (deg * Math.PI) / 180, s = Math.sin(a), k = Math.cos(a);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * k - dy * s, y: c.y + dx * s + dy * k };
};

// 四个角（画板坐标，考虑旋转）：左上、右上、右下、左下
export function corners(l) {
  const c = center(l);
  return [[l.x, l.y], [l.x + l.w, l.y], [l.x + l.w, l.y + l.h], [l.x, l.y + l.h]].map(([x, y]) => rot({ x, y }, c, l.rotation || 0));
}

// 轴对齐包围盒
export function bounds(l) {
  const pts = corners(l);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

// 画板坐标 → 图层自身坐标（去掉旋转）
export const toLocal = (l, p) => rot(p, center(l), -(l.rotation || 0));

let hitCtx = null;
/**
 * 点 p（画板坐标）是否点中图层。tol：容差（画板单位，通常为几个屏幕像素）。
 * 有填充的形状点内部即可；没有填充时只认描边附近。
 */
export function hitLayer(l, p, tol) {
  if (l.hidden) return false;
  if (l.type === 'path') {
    const g = (hitCtx ||= document.createElement('canvas').getContext('2d'));
    const path = pathOf(l);
    if (l.fillType !== 'none' && g.isPointInPath(path, p.x, p.y)) return true;
    g.lineWidth = Math.max(l.strokeWidth || 0, 0) + tol * 2;
    return g.isPointInStroke(path, p.x, p.y);
  }
  const q = toLocal(l, p);
  const inBox = q.x >= l.x - tol && q.x <= l.x + l.w + tol && q.y >= l.y - tol && q.y <= l.y + l.h + tol;
  if (!inBox) return false;
  if (l.type === 'text') return true;
  const filled = l.fillType !== 'none' && (l.fillAlpha > 0 || (l.fillType === 'linear' && l.fill2Alpha > 0));
  if (l.type === 'ellipse') {
    const c = center(l), rx = l.w / 2, ry = l.h / 2;
    const r = Math.hypot((q.x - c.x) / Math.max(rx, 1e-6), (q.y - c.y) / Math.max(ry, 1e-6));
    if (filled) return r <= 1 + tol / Math.max(1, Math.min(rx, ry));
    return Math.abs(r - 1) * Math.min(rx, ry) <= tol + (l.strokeWidth || 0) / 2;
  }
  if (filled) return true;
  const edge = Math.min(q.x - l.x, l.x + l.w - q.x, q.y - l.y, l.y + l.h - q.y);
  return Math.abs(edge) <= tol + (l.strokeWidth || 0) / 2;
}

/* ---------------- 变换 ---------------- */

export function moveLayer(l, dx, dy) {
  if (l.type === 'path') {
    const mv = p => (p ? { x: p.x + dx, y: p.y + dy } : p);
    return { ...l, x: l.x + dx, y: l.y + dy, anchors: l.anchors.map(a => ({ x: a.x + dx, y: a.y + dy, hi: mv(a.hi), ho: mv(a.ho) })) };
  }
  return { ...l, x: l.x + dx, y: l.y + dy };
}

/**
 * 把图层从旧框架映射到新框架（缩放 / 旋转选框时用）。框架：{ cx, cy, w, h, rotation }
 * 图层相对框架的位置按比例变换；矩形 / 文字的尺寸按框架局部的缩放比例变化。
 */
export function mapToFrame(l, from, to) {
  const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1;
  const dr = (to.rotation || 0) - (from.rotation || 0);
  const map = p => {
    if (!p) return p;
    const q = rot(p, { x: from.cx, y: from.cy }, -(from.rotation || 0));
    const local = { x: to.cx + (q.x - from.cx) * sx, y: to.cy + (q.y - from.cy) * sy };
    return rot(local, { x: to.cx, y: to.cy }, to.rotation || 0);
  };
  if (l.type === 'path') {
    return syncPathBox({ ...l, anchors: l.anchors.map(a => ({ ...map(a), hi: map(a.hi), ho: map(a.ho) })) });
  }
  const c = map(center(l));
  // 图层自身的轴与框架的轴大致对齐时，按框架局部缩放；否则按面积等比缩放
  const rel = (((l.rotation || 0) - (from.rotation || 0)) % 180 + 180) % 180;
  const aligned = rel < 1 || rel > 179, swapped = Math.abs(rel - 90) < 1;
  const kx = aligned ? sx : swapped ? sy : Math.sqrt(Math.abs(sx * sy));
  const ky = aligned ? sy : swapped ? sx : Math.sqrt(Math.abs(sx * sy));
  let w = Math.abs(l.w * kx), h = Math.abs(l.h * ky);
  let next = { ...l, rotation: (l.rotation || 0) + dr };
  if (l.type === 'text') {
    // 文字：按高度方向的比例缩放字号，宽高由测量得出
    next = measureText({ ...next, fontSize: Math.max(4, l.fontSize * Math.abs(ky)) });
    w = next.w; h = next.h;
  }
  return { ...next, x: c.x - w / 2, y: c.y - h / 2, w, h };
}

/**
 * 修改图层的一个属性（属性面板、顶部工具条共用）：
 * 文字的字号 / 内容等变化后重新测量尺寸；路径的位置 / 尺寸作用在锚点上。
 */
const TEXT_METRICS = new Set(['text', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing']);
export function applyLayerProp(l, key, value) {
  if (!(key in l) && !['x', 'y', 'w', 'h'].includes(key)) return l; // 这种图层没有这个属性
  if (l.type === 'path' && (key === 'x' || key === 'y')) return moveLayer(l, key === 'x' ? value - l.x : 0, key === 'y' ? value - l.y : 0);
  if (l.type === 'path' && (key === 'w' || key === 'h')) {
    const f = { cx: l.x + l.w / 2, cy: l.y + l.h / 2, w: l.w, h: l.h, rotation: 0 };
    const w = key === 'w' ? value : l.w, h = key === 'h' ? value : l.h;
    return mapToFrame(l, f, { cx: l.x + w / 2, cy: l.y + h / 2, w, h, rotation: 0 });
  }
  const next = { ...l, [key]: value };
  return l.type === 'text' && TEXT_METRICS.has(key) ? measureText(next) : next;
}

// 多个图层的轴对齐包围盒（画板坐标）
export function unionBounds(list) {
  if (!list.length) return null;
  const bs = list.map(bounds);
  const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
  const x1 = Math.max(...bs.map(b => b.x + b.w)), y1 = Math.max(...bs.map(b => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// 选框：单个（非路径）图层用它自己的旋转框，多个时用轴对齐的整体包围盒
export function selectionFrame(list) {
  if (list.length === 1 && list[0].type !== 'path') {
    const l = list[0];
    return { cx: l.x + l.w / 2, cy: l.y + l.h / 2, w: l.w, h: l.h, rotation: l.rotation || 0 };
  }
  const b = unionBounds(list);
  return b && { cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, rotation: 0 };
}

// 框架的四个角和各边中点（画板坐标）：nw, n, ne, e, se, s, sw, w
export function frameHandles(f) {
  const pts = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };
  const out = {};
  for (const [k, [ux, uy]] of Object.entries(pts)) {
    out[k] = rot({ x: f.cx + (ux * f.w) / 2, y: f.cy + (uy * f.h) / 2 }, { x: f.cx, y: f.cy }, f.rotation);
  }
  return out;
}
export const rotatePoint = rot;
