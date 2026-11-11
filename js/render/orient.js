import * as m4 from './math.js';
import { DEG } from '../core/utils.js';

/**
 * 视图的旋转（立方体视图用）。四元数 [x, y, z, w]；矩阵都是 math.js 的 4×4 列主序。
 * 用户相机的旋转 = Rx(pitch) · Ry(yaw) · Q（q：立方体视图设置的旋转，没有时为单位旋转）。
 */

export function quatToMat4([x, y, z, w]) {
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return new Float32Array([
    1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
    2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
    2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
    0, 0, 0, 1,
  ]);
}

// 4×4 矩阵的旋转部分（每列先归一化，去掉整组缩放）→ 四元数
export function mat4ToQuat(m) {
  const col = c => { const v = [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]]; const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
  const [c0, c1, c2] = [col(0), col(1), col(2)];
  const r = (i, j) => [c0, c1, c2][j][i]; // 第 i 行第 j 列
  const tr = r(0, 0) + r(1, 1) + r(2, 2);
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(r(2, 1) - r(1, 2)) / s, (r(0, 2) - r(2, 0)) / s, (r(1, 0) - r(0, 1)) / s, 0.25 * s];
  } else if (r(0, 0) > r(1, 1) && r(0, 0) > r(2, 2)) {
    const s = Math.sqrt(1 + r(0, 0) - r(1, 1) - r(2, 2)) * 2;
    q = [0.25 * s, (r(0, 1) + r(1, 0)) / s, (r(0, 2) + r(2, 0)) / s, (r(2, 1) - r(1, 2)) / s];
  } else if (r(1, 1) > r(2, 2)) {
    const s = Math.sqrt(1 + r(1, 1) - r(0, 0) - r(2, 2)) * 2;
    q = [(r(0, 1) + r(1, 0)) / s, 0.25 * s, (r(1, 2) + r(2, 1)) / s, (r(0, 2) - r(2, 0)) / s];
  } else {
    const s = Math.sqrt(1 + r(2, 2) - r(0, 0) - r(1, 1)) * 2;
    q = [(r(0, 2) + r(2, 0)) / s, (r(1, 2) + r(2, 1)) / s, 0.25 * s, (r(1, 0) - r(0, 1)) / s];
  }
  const l = Math.hypot(...q) || 1;
  return q.map(x => x / l);
}

export function slerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map(x => -x); d = -d; } // 走短的那条路
  if (d > 0.9995) { const q = a.map((x, i) => x + (b[i] - x) * t); const l = Math.hypot(...q); return q.map(x => x / l); }
  const th = Math.acos(d), s = Math.sin(th);
  const ka = Math.sin((1 - t) * th) / s, kb = Math.sin(t * th) / s;
  return a.map((x, i) => x * ka + b[i] * kb);
}

/** 用户相机的旋转矩阵（见文件开头） */
export function cameraRot(user = {}) {
  let rot = m4.multiply(m4.rotationX((user.pitch || 0) * DEG), m4.rotationY((user.yaw || 0) * DEG));
  if (Array.isArray(user.q) && user.q.length === 4) rot = m4.multiply(rot, quatToMat4(user.q));
  return rot;
}

/**
 * 从方向 d（内容坐标）看过去的旋转：把 d 转到朝向镜头（+z），屏幕上方尽量是内容的「上」（up）；
 * 正上 / 正下看时屏幕上方是内容的「后面」/「前面」（front：内容「前面」的方向）。
 */
export function lookFrom(d, up0 = [0, 1, 0], front = [0, 0, 1]) {
  const l = Math.hypot(...d) || 1;
  const z = d.map(v => v / l);
  const du = z[0] * up0[0] + z[1] * up0[1] + z[2] * up0[2];
  const up = Math.abs(du) > 0.999 ? front.map(v => (du > 0 ? -v : v)) : up0;
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let x = cross(up, z);
  const lx = Math.hypot(...x) || 1;
  x = x.map(v => v / lx);
  const y = cross(z, x);
  // 行 = x、y、z（列主序存放）
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, 0, 0, 0, 1]);
}

// 只取旋转部分（去掉平移、缩放）
export function rotationOf(m) {
  const out = m4.identity();
  for (let c = 0; c < 3; c++) {
    const l = Math.hypot(m[c * 4], m[c * 4 + 1], m[c * 4 + 2]) || 1;
    for (let r = 0; r < 3; r++) out[c * 4 + r] = m[c * 4 + r] / l;
  }
  return out;
}

// 旋转矩阵的转置 = 逆
export function transpose3(m) {
  const out = m4.identity();
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out[c * 4 + r] = m[r * 4 + c];
  return out;
}
