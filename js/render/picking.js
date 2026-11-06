import * as m4 from './math.js';

// 点选：把每张幻灯片的四个角投影到屏幕（NDC），判断点是否落在四边形内。
// 结果按 scene 缓存，scene 重建后自动失效。

const cache = new WeakMap();

function projectedQuads(scene) {
  let quads = cache.get(scene);
  if (quads) return quads;
  quads = scene.items.map(it => {
    const mvp = m4.multiply(scene.viewProj, it.model);
    const hw = it.w / 2, hh = it.h / 2;
    const pts = [];
    for (const [x, y] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
      const v = m4.transformVec4(mvp, [x, y, 0, 1]);
      if (v[3] <= 1e-6) return null; // 在镜头后面
      pts.push([v[0] / v[3], v[1] / v[3]]);
    }
    return pts;
  });
  cache.set(scene, quads);
  return quads;
}

function inConvexQuad(q, x, y) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(cross) < 1e-12) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

// nx, ny 为 NDC 坐标（-1 ~ 1，y 向上）。返回最上层命中的 item，未命中返回 null。
export function pickItem(scene, nx, ny) {
  if (!scene) return null;
  const quads = projectedQuads(scene);
  for (let k = scene.items.length - 1; k >= 0; k--) {
    const q = quads[k];
    if (q && inConvexQuad(q, nx, ny)) return scene.items[k];
  }
  return null;
}

// item 中心点在 NDC 中的位置
export function itemCenterNdc(scene, item) {
  const v = m4.transformVec4(m4.multiply(scene.viewProj, item.model), [0, 0, 0, 1]);
  return [v[0] / v[3], v[1] / v[3]];
}

// 屏幕上的位移（NDC）→ 版式坐标（组空间）中的位移。仅用于正交相机（平面版式）。
export function ndcDeltaToLayout(scene, dx, dy) {
  const M = m4.multiply(scene.viewProj, scene.groupM);
  const a = M[0], b = M[4], c = M[1], d = M[5];
  const det = a * d - b * c || 1e-9;
  return [(d * dx - b * dy) / det, (-c * dx + a * dy) / det];
}

// item 四个角在 NDC 中的位置：左下、右下、右上、左上（卡片自身坐标，y 向上）
export function itemCornersNdc(scene, item) {
  const mvp = m4.multiply(scene.viewProj, item.model);
  const hw = item.w / 2, hh = item.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => {
    const v = m4.transformVec4(mvp, [x, y, 0, 1]);
    return [v[0] / v[3], v[1] / v[3]];
  });
}
