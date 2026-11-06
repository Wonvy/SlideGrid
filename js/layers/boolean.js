import polygonClipping from '../vendor/polygonClipping.js';
import { createLayer, contoursOf, segments, segmentPoint, center, rotatePoint } from './model.js';

/**
 * 形状的布尔运算（类似 Illustrator 的路径查找器 / Figma 的布尔组）：
 *   union      合并：所有形状合成一个
 *   subtract   减去顶层：最下面的形状减去上面所有形状
 *   intersect  相交：只保留所有形状都覆盖的部分
 *   exclude    排除重叠：去掉重叠的部分（奇数次覆盖的区域）
 * 支持矩形、椭圆、路径（含复合路径 / 镂空）；曲线先细分成折线再运算，结果是一个路径图层（复合路径）。
 * 结果的样式：减去顶层用最下面形状的样式，其他用最上面形状的样式（与 Illustrator 一致）。
 */
export const BOOLEAN_OPS = [
  { id: 'union', label: '合并', icon: 'squares-unite' },
  { id: 'subtract', label: '减去顶层', icon: 'squares-subtract' },
  { id: 'intersect', label: '相交', icon: 'squares-intersect' },
  { id: 'exclude', label: '排除重叠', icon: 'squares-exclude' },
];
export const canBoolean = l => ['rect', 'ellipse', 'path'].includes(l.type) && !l.hidden;

const STEP = 3; // 曲线细分的大约长度（画板单位，画板高 1000）

// 圆角矩形 / 椭圆：先在本地坐标生成点，再按图层旋转
function shapeRing(l) {
  const pts = [];
  if (l.type === 'ellipse') {
    const rx = l.w / 2, ry = l.h / 2, c = center(l);
    const n = Math.max(24, Math.min(256, Math.ceil((Math.PI * (rx + ry)) / STEP)));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      pts.push({ x: c.x + rx * Math.cos(a), y: c.y + ry * Math.sin(a) });
    }
  } else {
    const r = Math.min(l.radius || 0, l.w / 2, l.h / 2);
    const corner = (cx, cy, a0) => {
      if (!r) { pts.push({ x: cx, y: cy }); return; }
      const n = Math.max(4, Math.ceil((Math.PI * r) / 2 / STEP));
      const ox = cx + (a0 === 0 || a0 === 270 ? -r : r), oy = cy + (a0 === 0 || a0 === 90 ? -r : r);
      for (let k = 0; k <= n; k++) {
        const a = ((a0 + (k / n) * 90) * Math.PI) / 180;
        pts.push({ x: ox + r * Math.cos(a), y: oy + r * Math.sin(a) });
      }
    };
    // 右上 → 右下 → 左下 → 左上（每段圆弧 90°）
    corner(l.x + l.w, l.y, 270);
    corner(l.x + l.w, l.y + l.h, 0);
    corner(l.x, l.y + l.h, 90);
    corner(l.x, l.y, 180);
  }
  const c = center(l);
  return pts.map(p => rotatePoint(p, c, l.rotation || 0));
}

// 路径：每个子路径细分成一个环（开放路径按闭合处理）
function pathRings(l) {
  const segs = segments(l);
  return contoursOf(l).map((k, c) => {
    const pts = [];
    for (const s of segs.filter(x => x[0] === c)) {
      const [, i, j] = s;
      const A = k.anchors[i], B = k.anchors[j];
      const curved = A.ho || B.hi;
      const len = Math.hypot(B.x - A.x, B.y - A.y);
      const n = curved ? Math.max(4, Math.min(128, Math.ceil(len / STEP))) : 1;
      for (let t = 0; t < n; t++) pts.push(t === 0 ? { x: A.x, y: A.y } : segmentPoint(l, s, t / n));
    }
    if (!k.closed) { const last = k.anchors[k.anchors.length - 1]; pts.push({ x: last.x, y: last.y }); }
    return pts;
  }).filter(r => r.length >= 3);
}

const area = ring => ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2;
const toPC = ring => { const r = ring.map(p => [p.x, p.y]); r.push(r[0]); return [r]; };

// 图层 → polygon-clipping 的多边形（考虑填充规则）
function geomOf(l) {
  const rings = l.type === 'path' ? pathRings(l) : [shapeRing(l)];
  if (!rings.length) return null;
  if (rings.length === 1) return toPC(rings[0]);
  if (l.fillRule === 'evenodd') return polygonClipping.xor(...rings.map(toPC));
  // nonzero：与最大的环方向相同的是实心，方向相反的是镂空（常见图标的画法）
  const big = rings.reduce((a, b) => (Math.abs(area(b)) > Math.abs(area(a)) ? b : a));
  const sign = Math.sign(area(big));
  const solid = rings.filter(r => Math.sign(area(r)) === sign).map(toPC);
  const holes = rings.filter(r => Math.sign(area(r)) !== sign).map(toPC);
  const fill = polygonClipping.union(...solid);
  return holes.length ? polygonClipping.difference(fill, ...holes) : fill;
}

// 去掉几乎共线的点，减少锚点
function simplify(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = out[out.length - 1] || ring[ring.length - 1], b = ring[i], c = ring[(i + 1) % ring.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
    if (Math.abs(cross) / len > 0.02) out.push(b);
  }
  return out.length >= 3 ? out : ring;
}

/**
 * 对图层做布尔运算。layers 按从下到上的顺序。
 * 返回新的路径图层；结果为空（例如没有重叠）时返回 null。
 */
export function booleanLayers(op, layers, existing = []) {
  const shapes = layers.filter(canBoolean);
  if (shapes.length < 2) return null;
  const geoms = shapes.map(geomOf).filter(Boolean);
  if (geoms.length < 2) return null;
  let res;
  if (op === 'union') res = polygonClipping.union(...geoms);
  else if (op === 'intersect') res = polygonClipping.intersection(...geoms);
  else if (op === 'exclude') res = polygonClipping.xor(...geoms);
  else res = polygonClipping.difference(geoms[0], ...geoms.slice(1));
  if (!res.length) return null;

  // 多个多边形（各自带镂空）→ 一个复合路径，用 evenodd 填充
  const contours = [];
  for (const poly of res) {
    for (const ring of poly) {
      const pts = simplify(ring.slice(0, -1));
      contours.push({ closed: true, anchors: pts.map(([x, y]) => ({ x, y, hi: null, ho: null })) });
    }
  }
  const styleFrom = op === 'subtract' ? shapes[0] : shapes[shapes.length - 1];
  const pick = k => styleFrom[k];
  const style = Object.fromEntries(['fillType', 'fill', 'fillAlpha', 'fill2', 'fill2Alpha', 'fillAngle', 'stroke', 'strokeWidth', 'opacity']
    .filter(k => pick(k) !== undefined).map(k => [k, pick(k)]));
  if (style.fillType === 'none') { style.fillType = 'solid'; style.fillAlpha = style.fillAlpha || 1; }
  const name = BOOLEAN_OPS.find(o => o.id === op).label;
  return createLayer('path', { ...style, contours, fillRule: 'evenodd', name: `${name} ${existing.filter(l => l.name?.startsWith(name)).length + 1}` }, existing);
}
