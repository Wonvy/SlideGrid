// 4x4 矩阵，列主序（WebGL 约定）。角度单位为弧度。

export const identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

// a * b
export function multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3;
    }
  }
  return o;
}

export const multiplyAll = (...ms) => ms.reduce((acc, m) => multiply(acc, m));

export const translation = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

export const scaling = (x, y, z) => new Float32Array([x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1]);

export function rotationX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

export function rotationY(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

export function rotationZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

// T * Rx * Ry * Rz * S —— 先绕 Z 旋转，再绕 Y、X（与 CSS "rotateX() rotateY() rotateZ()" 一致）
export function compose(x, y, z, rx, ry, rz, s = 1) {
  return multiplyAll(translation(x, y, z), rotationX(rx), rotationY(ry), rotationZ(rz), scaling(s, s, s));
}

export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

export function ortho(l, r, b, t, n, f) {
  return new Float32Array([
    2 / (r - l), 0, 0, 0,
    0, 2 / (t - b), 0, 0,
    0, 0, -2 / (f - n), 0,
    -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1,
  ]);
}

/**
 * 分块 / 局部渲染：只取画面中 (x0, y0, tw, th) 这一块（像素，左上为原点，整幅为 W × H），
 * 返回乘在投影矩阵前面的裁切矩阵。
 */
export function tileMatrix(x0, y0, tw, th, W, H) {
  const l = (x0 / W) * 2 - 1, r = ((x0 + tw) / W) * 2 - 1;
  const t = 1 - (y0 / H) * 2, b = 1 - ((y0 + th) / H) * 2;
  const sx = 2 / (r - l), sy = 2 / (t - b);
  return new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, (-sx * (l + r)) / 2, (-sy * (t + b)) / 2, 0, 1]);
}

export function transformVec4(m, v) {
  const out = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    out[r] = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3];
  }
  return out;
}
