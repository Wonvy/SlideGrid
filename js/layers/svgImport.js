import { createLayer, measureText, mapPoints, bounds } from './model.js';

/**
 * SVG 代码 → 可编辑的图层（从 Illustrator / Figma 复制的矢量、.svg 文件）。
 *   path / rect / circle / ellipse / line / polyline / polygon → 路径图层（复合路径保留镂空）
 *   text → 文字图层
 * 支持全部路径命令（含圆弧）、嵌套的 transform、填充 / 描边 / 不透明度 / 填充规则，渐变取两端颜色转成线性渐变。
 * 解析前去掉脚本、外部图片、foreignObject 和事件属性，只读取几何和样式。
 *
 * svgToLayers(text, existing) → { layers, bounds } | null（不是 SVG 或没有可转换的图形）
 * 返回的图层在 SVG 自己的坐标里，由调用方再缩放、摆放到画板上（placeLayers）。
 */
const SHAPES = 'path, rect, circle, ellipse, line, polyline, polygon, text';
const HIDDEN_PARENTS = 'defs, clipPath, mask, symbol, marker, pattern';

export function extractSvg(text) {
  if (!text) return null;
  const i = text.indexOf('<svg');
  const j = text.lastIndexOf('</svg>');
  return i >= 0 && j > i ? text.slice(i, j + 6) : null;
}

function sanitize(svg) {
  svg.querySelectorAll('script, foreignObject, iframe, image, use[href^="http"], use[*|href^="http"]').forEach(n => n.remove());
  for (const n of [svg, ...svg.querySelectorAll('*')]) {
    for (const a of [...n.attributes]) {
      if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
    }
  }
}

/* ---------------- 颜色 ---------------- */

function parseColor(c) {
  if (!c || c === 'none' || c === 'transparent') return null;
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  const hex = `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  return { hex, a };
}

// 渐变：取两端颜色，方向按 x1 y1 → x2 y2
function gradientFill(svg, url) {
  const id = url.match(/#([^")]+)/)?.[1];
  const g = id && svg.querySelector(`#${CSS.escape(id)}`);
  if (!g) return null;
  let stops = [...g.querySelectorAll('stop')];
  // xlink:href 引用的渐变
  if (!stops.length) {
    const ref = (g.getAttribute('href') || g.getAttribute('xlink:href') || '').slice(1);
    const r = ref && svg.querySelector(`#${CSS.escape(ref)}`);
    stops = r ? [...r.querySelectorAll('stop')] : [];
  }
  if (!stops.length) return null;
  const color = s => {
    const cs = getComputedStyle(s);
    const c = parseColor(cs.stopColor) || { hex: '#000000', a: 1 };
    return { hex: c.hex, a: c.a * (parseFloat(cs.stopOpacity) || (cs.stopOpacity === '0' ? 0 : 1)) };
  };
  const a = color(stops[0]), b = color(stops[stops.length - 1]);
  let angle = 90;
  if (g.tagName === 'linearGradient') {
    const num = (k, d) => { const v = g.getAttribute(k); return v == null ? d : parseFloat(v) / (v.endsWith('%') ? 100 : 1); };
    const dx = num('x2', 1) - num('x1', 0), dy = num('y2', 0) - num('y1', 0);
    angle = Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360);
  }
  return { fillType: 'linear', fill: a.hex, fillAlpha: a.a, fill2: b.hex, fill2Alpha: b.a, fillAngle: angle };
}

/* ---------------- 路径解析 ---------------- */

// d → 子路径列表（锚点带控制柄，SVG 坐标）
export function parsePathData(d) {
  const tokens = (d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || []);
  let i = 0;
  const num = () => parseFloat(tokens[i++]);
  const contours = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0, lastC = null, lastQ = null, cmd = '';

  const start = (nx, ny) => { cur = { anchors: [{ x: nx, y: ny, hi: null, ho: null }], closed: false }; contours.push(cur); sx = nx; sy = ny; };
  const last = () => cur.anchors[cur.anchors.length - 1];
  const line = (nx, ny) => { if (!cur) start(x, y); cur.anchors.push({ x: nx, y: ny, hi: null, ho: null }); };
  const cubic = (c1, c2, p) => {
    if (!cur) start(x, y);
    last().ho = c1;
    cur.anchors.push({ x: p.x, y: p.y, hi: c2, ho: null });
  };

  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z' ? 1 : 0;
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (C) {
      case 'M': {
        x = num() + ox; y = num() + oy;
        start(x, y);
        cmd = rel ? 'l' : 'L'; // 之后的坐标按 L 处理
        lastC = lastQ = null;
        continue;
      }
      case 'L': x = num() + ox; y = num() + oy; line(x, y); lastC = lastQ = null; break;
      case 'H': x = num() + ox; line(x, y); lastC = lastQ = null; break;
      case 'V': y = num() + oy; line(x, y); lastC = lastQ = null; break;
      case 'C': {
        const c1 = { x: num() + ox, y: num() + oy }, c2 = { x: num() + ox, y: num() + oy };
        x = num() + ox; y = num() + oy;
        cubic(c1, c2, { x, y }); lastC = c2; lastQ = null; break;
      }
      case 'S': {
        const c1 = lastC ? { x: 2 * x - lastC.x, y: 2 * y - lastC.y } : { x, y };
        const c2 = { x: num() + ox, y: num() + oy };
        x = num() + ox; y = num() + oy;
        cubic(c1, c2, { x, y }); lastC = c2; lastQ = null; break;
      }
      case 'Q': {
        const q = { x: num() + ox, y: num() + oy };
        const nx = num() + ox, ny = num() + oy;
        cubic({ x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) }, { x: nx + (2 / 3) * (q.x - nx), y: ny + (2 / 3) * (q.y - ny) }, { x: nx, y: ny });
        x = nx; y = ny; lastQ = q; lastC = null; break;
      }
      case 'T': {
        const q = lastQ ? { x: 2 * x - lastQ.x, y: 2 * y - lastQ.y } : { x, y };
        const nx = num() + ox, ny = num() + oy;
        cubic({ x: x + (2 / 3) * (q.x - x), y: y + (2 / 3) * (q.y - y) }, { x: nx + (2 / 3) * (q.x - nx), y: ny + (2 / 3) * (q.y - ny) }, { x: nx, y: ny });
        x = nx; y = ny; lastQ = q; lastC = null; break;
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num(), large = num(), sweep = num();
        const nx = num() + ox, ny = num() + oy;
        for (const [c1, c2, p] of arcToCubics(x, y, rx, ry, rot, large, sweep, nx, ny)) cubic(c1, c2, p);
        x = nx; y = ny; lastC = lastQ = null; break;
      }
      case 'Z': {
        if (cur) {
          // 终点与起点重合时合并成一个锚点
          const a = cur.anchors;
          const end = a[a.length - 1];
          if (a.length > 1 && Math.hypot(end.x - a[0].x, end.y - a[0].y) < 1e-6) {
            a[0].hi = end.hi;
            a.pop();
          }
          cur.closed = true;
        }
        x = sx; y = sy; cur = null; lastC = lastQ = null;
        cmd = ''; // Z 后面不能直接跟数字
        continue;
      }
      default: i++; continue;
    }
    // 同一命令后面可以连续跟多组参数：下一轮遇到数字时沿用当前命令
  }
  return contours.filter(k => k.anchors.length >= 2);
}

// 椭圆弧 → 若干段三次贝塞尔（SVG 规范 F.6 的端点参数转换）
function arcToCubics(x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
  if (!rx || !ry) return [[{ x: x1, y: y1 }, { x: x2, y: y2 }, { x: x2, y: y2 }]];
  const phi = (phiDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  else if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dt) / (Math.PI / 2));
  const step = dt / n, k = (4 / 3) * Math.tan(step / 4);
  const pt = (t, ex = 0, ey = 0) => {
    const px = rx * (Math.cos(t) + ex), py = ry * (Math.sin(t) + ey);
    return { x: cx + cos * px - sin * py, y: cy + sin * px + cos * py };
  };
  const out = [];
  for (let s = 0; s < n; s++) {
    const a = t1 + s * step, b = a + step;
    const c1 = pt(a, -k * Math.sin(a), k * Math.cos(a));
    const c2 = pt(b, k * Math.sin(b), -k * Math.cos(b));
    out.push([c1, c2, pt(b)]);
  }
  return out;
}

// 基本图形 → d
function shapeToD(el) {
  const n = k => parseFloat(el.getAttribute(k)) || 0;
  switch (el.tagName) {
    case 'path': return el.getAttribute('d') || '';
    case 'rect': {
      const x = n('x'), y = n('y'), w = n('width'), h = n('height');
      let rx = Math.min(n('rx') || n('ry'), w / 2), ry = Math.min(n('ry') || n('rx'), h / 2);
      if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle':
    case 'ellipse': {
      const cx = n('cx'), cy = n('cy');
      const rx = el.tagName === 'circle' ? n('r') : n('rx'), ry = el.tagName === 'circle' ? n('r') : n('ry');
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
    }
    case 'line': return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`;
    case 'polyline':
    case 'polygon': {
      const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4) return '';
      let d = `M${pts[0]} ${pts[1]}`;
      for (let k = 2; k + 1 < pts.length; k += 2) d += `L${pts[k]} ${pts[k + 1]}`;
      return el.tagName === 'polygon' ? `${d}Z` : d;
    }
    default: return '';
  }
}

/* ---------------- 转换 ---------------- */

export function svgToLayers(text, existing = []) {
  const src = extractSvg(text);
  if (!src) return null;
  const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.tagName !== 'svg' || doc.querySelector('parsererror')) return null;
  sanitize(root);

  // 挂到页面上（不可见）才能拿到计算后的样式和变换矩阵
  const host = document.createElement('div');
  // 不能用 visibility:hidden（会继承给图形，被当成不可见跳过），放到屏幕外并设为透明
  host.style.cssText = 'position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none;contain:strict;width:1px;height:1px;overflow:hidden';
  const svg = document.importNode(root, true);
  if (!svg.getAttribute('width') && !svg.getAttribute('viewBox')) svg.setAttribute('width', '1000');
  host.append(svg);
  document.body.append(host);

  const layers = [];
  try {
    const list = [...existing];
    const els = [...svg.querySelectorAll(SHAPES)].filter(el => !el.closest(HIDDEN_PARENTS)).slice(0, 2000);
    for (const el of els) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const m = el.getCTM();
      if (!m) continue;
      const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
      let opacity = 1;
      for (let n = el; n && n !== svg; n = n.parentElement) opacity *= parseFloat(getComputedStyle(n).opacity) || (getComputedStyle(n).opacity === '0' ? 0 : 1);
      const name = el.id || null;

      if (el.tagName === 'text') {
        const content = el.textContent.trim();
        if (!content) continue;
        const bb = el.getBBox();
        const p = new DOMPoint(bb.x, bb.y).matrixTransform(m);
        const color = parseColor(cs.fill) || { hex: '#000000', a: 1 };
        const family = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
        const l = measureText(createLayer('text', {
          text: content, x: p.x, y: p.y, fontSize: (parseFloat(cs.fontSize) || 16) * scale,
          fontWeight: parseInt(cs.fontWeight, 10) || 400, fontFamily: family || 'sans', color: color.hex,
          lineHeight: 1.2, opacity: opacity * color.a, ...(name ? { name } : {}),
        }, list));
        layers.push(l); list.push(l);
        continue;
      }

      const contours = parsePathData(shapeToD(el));
      if (!contours.length) continue;
      const fillUrl = cs.fill.startsWith('url(');
      const fill = fillUrl ? null : parseColor(cs.fill);
      const grad = fillUrl ? gradientFill(svg, cs.fill) : null;
      const stroke = parseColor(cs.stroke);
      const fillOpacity = parseFloat(cs.fillOpacity);
      const strokeOpacity = parseFloat(cs.strokeOpacity);
      const props = {
        contours,
        fillRule: cs.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
        opacity,
        strokeWidth: stroke ? (parseFloat(cs.strokeWidth) || 1) * scale : 0,
        stroke: stroke?.hex || '#000000',
        ...(grad || (fill ? { fillType: 'solid', fill: fill.hex, fillAlpha: fill.a * (Number.isFinite(fillOpacity) ? fillOpacity : 1) } : { fillType: 'none' })),
        ...(name ? { name } : {}),
      };
      if (stroke && Number.isFinite(strokeOpacity) && strokeOpacity < 1) props.opacity *= strokeOpacity; // 近似
      let l = createLayer('path', props, list);
      l = mapPoints(l, p => { const q = new DOMPoint(p.x, p.y).matrixTransform(m); return { x: q.x, y: q.y }; });
      if (!l.w && !l.h) continue;
      layers.push(l); list.push(l);
    }
  } finally {
    host.remove();
  }
  if (!layers.length) return null;
  return { layers, bounds: unionOf(layers) };
}

const unionOf = layers => {
  const bs = layers.map(bounds);
  const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
  return { x: x0, y: y0, w: Math.max(...bs.map(b => b.x + b.w)) - x0, h: Math.max(...bs.map(b => b.y + b.h)) - y0 };
};
