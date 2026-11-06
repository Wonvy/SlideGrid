import * as m4 from './math.js';
import { DEG } from '../core/utils.js';
import { aspectValue, isLongAspect } from '../config.js';

// 世界坐标：画布高度固定为 1000，宽度 = 1000 × 画布比例，原点在画布中心，y 轴向上。
// 长图模式：宽度固定为 LONG_W，高度由版式内容决定。
export const WORLD_H = 1000;
export const LONG_W = 1600;

// 版式结果在画布上占据的上下范围（考虑 Z 轴旋转）
function verticalExtent(items) {
  let minY = Infinity, maxY = -Infinity;
  for (const it of items) {
    const a = (it.rz || 0) * DEG;
    const ey = Math.abs((it.w / 2) * Math.sin(a)) + Math.abs((it.h / 2) * Math.cos(a));
    minY = Math.min(minY, it.y - ey);
    maxY = Math.max(maxY, it.y + ey);
  }
  return Number.isFinite(minY) ? maxY - minY : 0;
}

/**
 * 计算画布的世界尺寸 { W, H, long }。
 * 长图模式下先用一个极高的画布试排，量出内容高度，再加上下边距。
 */
export function resolveCanvas({ slides, layout, params, aspect }) {
  if (!isLongAspect(aspect)) {
    const a = typeof aspect === 'number' ? aspect : aspectValue(aspect);
    return { W: WORLD_H * a, H: WORLD_H, long: false };
  }
  const W = LONG_W;
  const n = slides.length;
  if (!n || !layout.long) return { W, H: W * 16 / 9, long: true };
  const probe = layout.compute({ n, aspect: slides[0].aspect || 16 / 9, W, H: 1e5, p: params, long: true }) || {};
  const margin = params.margin ?? 80;
  const H = Math.max(W * 0.3, verticalExtent(probe.items || []) + 2 * margin);
  return { W, H, long: true };
}

function makeCamera(cam, user, W, H) {
  const rot = m4.multiply(m4.rotationX((user.pitch || 0) * DEG), m4.rotationY((user.yaw || 0) * DEG));
  const zoom = user.zoom || 1;
  const pan = m4.translation(user.panX || 0, user.panY || 0, 0);
  if (cam.type === 'perspective') {
    const fov = (cam.fov || 35) * DEG;
    // 让 z=0 平面恰好铺满画布高度：平面版式与 3D 版式使用同一套尺寸
    const dist = (H / 2) / Math.tan(fov / 2);
    return {
      proj: m4.perspective(fov, W / H, dist * 0.01, dist * 100),
      view: m4.multiplyAll(pan, m4.translation(0, 0, -dist / zoom), rot),
    };
  }
  return {
    proj: m4.ortho(-W / 2, W / 2, -H / 2, H / 2, -1e5, 1e5),
    view: m4.multiplyAll(pan, m4.scaling(zoom, zoom, zoom), rot),
  };
}

/**
 * 以屏幕上的某点为中心缩放：返回新的 { zoom, panX, panY }。
 * (cx, cy) 为该点相对画布中心的偏移（世界单位，y 向上）。
 */
export function zoomAround(camera, perspective, cx, cy, nextZoom) {
  const z = camera.zoom || 1, px = camera.panX || 0, py = camera.panY || 0;
  if (perspective) {
    // 屏幕位置 s = zoom × (pan + p)
    return { zoom: nextZoom, panX: px + cx / nextZoom - cx / z, panY: py + cy / nextZoom - cy / z };
  }
  // 屏幕位置 s = pan + zoom × p
  const k = nextZoom / z;
  return { zoom: nextZoom, panX: cx - k * (cx - px), panY: cy - k * (cy - py) };
}

// 屏幕上移动 1 个世界单位，对应 pan 需要变化多少
export const panFactor = (camera, perspective) => (perspective ? 1 / (camera.zoom || 1) : 1);

// 图片按 cover 方式填满单元格
function coverUV(imgAspect, cellAspect) {
  if (imgAspect > cellAspect) {
    const sx = cellAspect / imgAspect;
    return [sx, 1, (1 - sx) / 2, 0];
  }
  const sy = imgAspect / cellAspect;
  return [1, sy, 0, (1 - sy) / 2];
}

/**
 * 把「幻灯片 + 版式 + 参数」转换成渲染器可以直接绘制的场景。
 * 预览和导出共用这一函数。
 */
export function buildScene({ slides, layout, params, style, aspect, camera, adjust = null }) {
  const { W, H, long } = resolveCanvas({ slides, layout, params, aspect });
  const n = slides.length;
  const empty = { W, H, long, items: [], viewProj: m4.identity(), coplanar: true, style };
  if (!n) return empty;

  const slideAspect = slides[0].aspect || 16 / 9;
  const result = layout.compute({ n, aspect: slideAspect, W, H, p: params, long }) || {};
  // 手动调整（移动 / 旋转工具）按位置序号叠加在版式结果上
  const raw = (result.items || []).filter(it => it.w > 0 && it.h > 0).map((it, order) => {
    const a = adjust?.[order];
    if (!a) return it;
    const k = a.s > 0 ? a.s : 1; // 等比缩放
    return {
      ...it,
      x: (it.x || 0) + (a.dx || 0),
      y: (it.y || 0) + (a.dy || 0),
      w: it.w * k,
      h: it.h * k,
      rz: (it.rz || 0) + (a.rz || 0),
      z: (it.z || 0) + (a.lift || 0) * 20, // 调整过的卡片按操作顺序叠在上面
      adjusted: true,
    };
  });

  const g = result.group || {};
  const groupM = m4.compose(g.x || 0, g.y || 0, g.z || 0, (g.rx || 0) * DEG, (g.ry || 0) * DEG, (g.rz || 0) * DEG, g.s ?? 1);
  const { proj, view } = makeCamera(result.camera || { type: 'ortho' }, camera || {}, W, H);
  const viewProj = m4.multiply(proj, view);

  const items = raw.map((it, order) => {
    const slideIndex = ((it.i % n) + n) % n;
    const slide = slides[slideIndex];
    const model = m4.multiply(groupM, m4.compose(
      it.x || 0, it.y || 0, it.z || 0, (it.rx || 0) * DEG, (it.ry || 0) * DEG, (it.rz || 0) * DEG, 1,
    ));
    const depth = m4.multiply(view, model)[14]; // 视图空间中心点的 z
    // order：在版式结果中的序号（同一版式下稳定，用于悬停/拖放定位）
    // slideIndex：对应第几张幻灯片（铺满型版式中会重复出现）
    return {
      slide, slideIndex, model, w: it.w, h: it.h, order, depth, adjusted: !!it.adjusted,
      opacity: it.opacity ?? 1,
      uv: coverUV(slide.aspect || slideAspect, it.w / it.h),
    };
  });
  items.sort((a, b) => (a.depth - b.depth) || (a.order - b.order));

  const z0 = raw[0]?.z || 0;
  const coplanar = raw.every(it => (it.z || 0) === z0 && !it.rx && !it.ry);

  return { W, H, long, items, viewProj, coplanar, style, groupM, ortho: (result.camera || {}).type !== 'perspective' };
}

/**
 * 估算导出时每张图需要的纹理分辨率（长边像素），避免把所有原图都按原尺寸塞进显存。
 * 返回 Map<slideId, longSidePx>；画面外的图不计入。
 */
export function textureNeeds(scene, pxW, pxH) {
  const needs = new Map();
  for (const it of scene.items) {
    const id = it.slide.id;
    const mvp = m4.multiply(scene.viewProj, it.model);
    const hw = it.w / 2, hh = it.h / 2;
    const pts = [];
    let behind = false;
    for (const [x, y] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
      const v = m4.transformVec4(mvp, [x, y, 0, 1]);
      if (v[3] <= 1e-6) { behind = true; break; }
      pts.push([(v[0] / v[3] * 0.5 + 0.5) * pxW, (0.5 - v[1] / v[3] * 0.5) * pxH]);
    }
    if (behind) { needs.set(id, Infinity); continue; }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    if (Math.max(...xs) < 0 || Math.min(...xs) > pxW || Math.max(...ys) < 0 || Math.min(...ys) > pxH) continue;

    let ppu = 0; // 每世界单位对应的最大像素数
    for (let k = 0; k < 4; k++) {
      const a = pts[k], b = pts[(k + 1) % 4];
      ppu = Math.max(ppu, Math.hypot(b[0] - a[0], b[1] - a[1]) / (k % 2 === 0 ? it.w : it.h));
    }
    const imgW = (ppu * it.w) / it.uv[0];
    const imgH = (ppu * it.h) / it.uv[1];
    const a = it.slide.aspect || 1;
    const longSide = a >= 1 ? Math.max(imgW, imgH * a) : Math.max(imgH, imgW / a);
    needs.set(id, Math.max(needs.get(id) || 0, longSide * 1.25));
  }
  return needs;
}
