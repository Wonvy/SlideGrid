/**
 * 设备样机：笔记本、显示器、平板、手机、手表、投影幕（矢量绘制的 3D 模型），以及用户上传的 PNG 样机（device: 'custom'）。
 * 屏幕里显示画板的某一张幻灯片，或样机自己的图片（imageId）。
 *
 * 内置设备的外形在 deviceModels.js 里（设备坐标：宽 1000 左右，w / h 为正面图的整体尺寸，screen 为屏幕区域 [x, y, w, h]）。
 * 角度：yaw（左右，正值 = 从右侧看，±180 是背面）、pitch（俯仰，正值 = 从上往下看）；都是 0 时画正面图。
 * 绘制时按图层的框等比缩放、居中（图层框的比例与设备当前角度的外接框一致，见 deviceSize / withAngle）。
 * 自定义样机：frameAssetId 为 PNG 素材，frameW / frameH 为原图尺寸；
 *   quad：屏幕的四个角（占图片的比例，左上、右上、右下、左下），上传时由用户对准，图片按透视填充进去（layers/warp.js）
 *   screen：旧数据的矩形屏幕区域 [x, y, w, h]（没有 quad 时使用）
 *   screenOnTop：PNG 的屏幕区域不透明时，图片画在外框上面；否则先画图片，再把 PNG 盖在上面
 */
import { drawWarped } from './warp.js';
import { DEVICES, FRAMES, MODELS, deviceOf, tone } from './deviceModels.js';

export { DEVICES, FRAMES, deviceOf };

// 样机页的预设：正面 + 带角度（yaw 左右，正值 = 从右侧看；pitch 俯视）
export const DEVICE_PRESETS = [
  { device: 'laptop', label: '笔记本' },
  { device: 'laptop', yaw: -30, pitch: 14, label: '笔记本 · 左侧' },
  { device: 'laptop', yaw: 30, pitch: 14, label: '笔记本 · 右侧' },
  { device: 'laptop', pitch: 28, label: '笔记本 · 俯视' },
  { device: 'laptop', yaw: -150, pitch: 12, label: '笔记本 · 背面' },
  { device: 'monitor', label: '显示器' },
  { device: 'monitor', yaw: -28, pitch: 6, label: '显示器 · 左侧' },
  { device: 'monitor', yaw: 28, pitch: 6, label: '显示器 · 右侧' },
  { device: 'monitor', yaw: 150, pitch: 8, label: '显示器 · 背面' },
  { device: 'tablet', label: '平板' },
  { device: 'tablet', yaw: -30, pitch: 12, label: '平板 · 左侧' },
  { device: 'tablet', yaw: 30, pitch: 12, label: '平板 · 右侧' },
  { device: 'tablet', yaw: -18, pitch: 58, label: '平板 · 平放' },
  { device: 'phone', label: '手机' },
  { device: 'phone', yaw: -30, pitch: 8, label: '手机 · 左侧' },
  { device: 'phone', yaw: 30, pitch: 8, label: '手机 · 右侧' },
  { device: 'phone', yaw: 152, pitch: 8, label: '手机 · 背面' },
  { device: 'phoneLand', label: '手机（横）' },
  { device: 'phoneLand', yaw: -28, pitch: 10, label: '手机（横）· 左侧' },
  { device: 'phoneLand', yaw: 28, pitch: 10, label: '手机（横）· 右侧' },
  { device: 'watch', label: '手表' },
  { device: 'watch', yaw: -26, pitch: 8, label: '手表 · 左侧' },
  { device: 'watch', yaw: 28, pitch: 8, label: '手表 · 右侧' },
  { device: 'projector', label: '投影幕' },
  { device: 'projector', yaw: -26, pitch: 4, label: '投影幕 · 左侧' },
  { device: 'projector', yaw: 26, pitch: 4, label: '投影幕 · 右侧' },
];

export const hasAngle = l => l.device !== 'custom' && (Math.abs(l.yaw || 0) > 0.01 || Math.abs(l.pitch || 0) > 0.01);

// 角度的范围：左右转一整圈（-180 ~ 180），俯仰 ±85
export const PITCH_LIMIT = 85;
export function normalAngles(yaw, pitch) {
  let y = ((((Number(yaw) || 0) + 180) % 360) + 360) % 360 - 180;
  if (y === -180) y = 180;
  return { yaw: Math.round(y * 10) / 10, pitch: Math.round(Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Number(pitch) || 0)) * 10) / 10 };
}

// 设备的高宽比；自定义样机用 PNG 的尺寸（layer 为图层本身或带 frameW / frameH、yaw / pitch 的对象）
export const deviceAspect = (id, layer = null) => {
  if (id === 'custom') return layer?.frameW ? layer.frameH / layer.frameW : deviceOf(id).h / deviceOf(id).w;
  const box = boxOf(id, layer?.yaw || 0, layer?.pitch || 0);
  return box.h / Math.max(1e-6, box.w);
};
// 按宽度算出设备图层的尺寸
export const deviceSize = (id, w, layer = null) => ({ w, h: w * deviceAspect(id, layer) });
// 带角度时的高宽比（由投影后的外接框得出）
export const angledAspect = (id, yaw, pitch) => deviceAspect(id, { yaw, pitch });

/**
 * 改变样机的角度：设备在画板上的大小不变，旋转中心的位置不变（图层的框跟着新的外形变化）。
 * 图层自己有旋转（rotation）时也成立。
 */
export function withAngle(l, yaw, pitch) {
  const a = normalAngles(yaw, pitch);
  if (l.device === 'custom') return l;
  const b1 = boxOf(l.device, l.yaw || 0, l.pitch || 0), b2 = boxOf(l.device, a.yaw, a.pitch);
  const s = Math.min(l.w / b1.w, l.h / b1.h);
  const r = ((l.rotation || 0) * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const turn = ([x, y]) => [x * cos - y * sin, x * sin + y * cos];
  // 旋转中心相对图层中心的位置（图层自己的坐标）
  const d1 = turn([-(b1.x + b1.w / 2) * s, -(b1.y + b1.h / 2) * s]), d2 = turn([-(b2.x + b2.w / 2) * s, -(b2.y + b2.h / 2) * s]);
  const w = b2.w * s, h = b2.h * s;
  const cx = l.x + l.w / 2 + d1[0] - d2[0], cy = l.y + l.h / 2 + d1[1] - d2[1];
  return { ...l, yaw: a.yaw, pitch: a.pitch, w, h, x: cx - w / 2, y: cy - h / 2 };
}

// 当前变换下，设备坐标 1 个单位对应多少像素（阴影的模糊半径不受变换影响，要自己换算）
const unitPx = (ctx, s) => {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b) * s;
};

// 屏幕内容的显示方式：fit（cover 填满裁切 / contain 完整显示）、zoom（再放大）、x / y（-1 ~ 1，放大后看哪一部分）
export const screenView = l => ({ fit: l.fit || 'cover', zoom: l.screenZoom || 1, x: l.screenX || 0, y: l.screenY || 0 });
const viewKey = v => `${v.fit}|${v.zoom}|${v.x}|${v.y}`;

// 竖屏手机、手表这类屏幕比例和横版幻灯片差很多的设备，默认完整显示（否则只剩中间一条）
export function autoFit(device, img) {
  const screen = DEVICES[device]?.screen;
  if (!screen || !img?.width) return 'cover';
  const sr = screen[2] / screen[3], ir = img.width / img.height;
  return Math.max(sr / ir, ir / sr) > 1.6 ? 'contain' : 'cover';
}

/**
 * 画一个设备图层。img：屏幕里的幻灯片图片（ImageBitmap / canvas），没有时屏幕为深灰
 * 调用前 ctx 已设为画板坐标；旋转、不透明度由 drawLayers 处理。
 * 依次画：接触阴影（放在桌面上的设备、带角度的设备）→ 倒影（reflection）→ 设备本身
 */
export function drawDevice(ctx, l, img, frameImg = null) {
  if (l.shadow !== false) {
    const k = contactStrength(l);
    if (k > 0.01) drawContactShadow(ctx, l, k);
  }
  if (l.reflection) drawReflection(ctx, l, img, frameImg);
  drawDeviceBody(ctx, l, img, frameImg);
}

// 接触阴影（设备底部的椭圆）的强弱：
//   立在桌面上的设备（笔记本、显示器、投影幕）：正面图才用椭圆；带角度时按「脚印」画桌面上的影子（drawModel）
//   其他设备：带角度、又大致立着时才有（俯仰角大了像是平放 / 悬空，就淡出）
function contactStrength(l) {
  if (l.device === 'custom') return 0;
  if (deviceOf(l.device).foot) return hasAngle(l) ? 0 : 1;
  return hasAngle(l) ? Math.max(0, Math.min(1, 1 - (Math.abs(l.pitch || 0) - 25) / 25)) : 0;
}

// 接触阴影：设备底部一个压扁的柔和椭圆（宽度按设备底座的范围）
function drawContactShadow(ctx, l, k = 1) {
  const [f0, f1] = (!hasAngle(l) && deviceOf(l.device).foot) || [0.04, 0.96];
  const cx = l.x + (l.w * (f0 + f1)) / 2, cy = l.y + l.h * 0.985, rx = (l.w * (f1 - f0)) / 2, ry = Math.max(l.h * 0.035, l.w * 0.012);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(0,0,0,${0.38 * k})`);
  g.addColorStop(0.55, `rgba(0,0,0,${0.16 * k})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// 倒影：把设备画到离屏画布（按当前显示尺寸，图层对象不变时复用），上下翻转、由近到远渐隐，贴在设备下方
const reflectCache = new WeakMap();
function drawReflection(ctx, l, img, frameImg) {
  const m = ctx.getTransform();
  const px = Math.min(Math.hypot(m.a, m.b), 2048 / Math.max(l.w, l.h));
  const bucket = 2 ** (Math.round(Math.log2(Math.max(px, 1 / 64)) * 2) / 2);
  let hit = reflectCache.get(l);
  if (!hit || hit.bucket !== bucket || hit.img !== img || hit.frameImg !== frameImg) {
    const W = Math.max(2, Math.round(l.w * bucket)), H = Math.max(2, Math.round(l.h * bucket));
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d');
    g.scale(W / l.w, H / l.h);
    g.translate(-l.x, -l.y);
    drawDeviceBody(g, { ...l, shadow: false }, img, frameImg);
    // 底部（贴近地面）最清楚，往上渐隐
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-in';
    const fade = g.createLinearGradient(0, H, 0, H * 0.45);
    fade.addColorStop(0, 'rgba(0,0,0,0.32)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, W, H);
    hit = { bucket, img, frameImg, canvas: c };
    reflectCache.set(l, hit);
  }
  const bottom = l.y + l.h;
  ctx.save();
  ctx.translate(0, bottom * 2 + l.h * 0.01);
  ctx.scale(1, -1);
  ctx.drawImage(hit.canvas, l.x, l.y, l.w, l.h);
  ctx.restore();
}

function drawDeviceBody(ctx, l, img, frameImg = null) {
  if (l.device === 'custom') drawCustom(ctx, l, img, frameImg);
  else drawModel(ctx, l, img);
}

// 屏幕的四个角（画板坐标）
export const quadOf = l => (l.quad || (([x, y, w, h]) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]])(l.screen || [0.1, 0.1, 0.8, 0.8]))
  .map(([qx, qy]) => [l.x + qx * l.w, l.y + qy * l.h]);

// 屏幕内容：黑底 + 透视填充的图片
function drawQuadScreen(ctx, l, img) {
  const q = quadOf(l);
  ctx.beginPath();
  q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = img?.width ? '#000' : '#1b1d22';
  ctx.fill();
  if (img?.width) drawWarped(ctx, img, q, screenView(l));
}

// 自定义 PNG 样机：投影 → 屏幕内容 → PNG 外框（屏幕不透明的 PNG：外框 → 屏幕内容）
function drawCustom(ctx, l, img, frameImg) {
  if (frameImg && l.shadow !== false) {
    // 只要投影、不要第二遍图像：把图像画到很远的地方，用投影偏移把影子挪回来（任意旋转下都成立）
    const m = ctx.getTransform(), D = 50000, px = Math.hypot(m.a, m.b) * (l.w / 1000);
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
    ctx.shadowBlur = 46 * px;
    ctx.shadowOffsetX = m.a * D;
    ctx.shadowOffsetY = m.b * D + 22 * px;
    ctx.drawImage(frameImg, l.x - D, l.y, l.w, l.h);
    ctx.restore();
  }
  if (!l.screenOnTop) drawQuadScreen(ctx, l, img);
  if (frameImg) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(frameImg, l.x, l.y, l.w, l.h);
    if (l.screenOnTop) drawQuadScreen(ctx, l, img);
  } else {
    ctx.strokeStyle = 'rgba(124, 140, 255, .6)';
    ctx.lineWidth = Math.max(1, l.w / 300);
    ctx.strokeRect(l.x, l.y, l.w, l.h);
  }
}

/**
 * 找出 PNG 样机的屏幕区域：被不透明外框包围的透明区域（不与图片边缘相连），取面积最大的一块的外接矩形。
 * 返回占图片的比例 [x, y, w, h]；找不到时返回 null。img：ImageBitmap / canvas
 */
export function findScreen(img) {
  const k = Math.min(1, 480 / Math.max(img.width, img.height));
  const W = Math.max(1, Math.round(img.width * k)), H = Math.max(1, Math.round(img.height * k));
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, W, H);
  const data = g.getImageData(0, 0, W, H).data;
  const clear = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) clear[i] = data[i * 4 + 3] < 40 ? 1 : 0;
  const mark = new Int32Array(W * H); // 0 未访问，-1 与边缘相连的透明区域，>0 内部透明区域编号
  const stack = [];
  const fill = (start, id) => {
    let n = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    stack.push(start);
    mark[start] = id;
    while (stack.length) {
      const i = stack.pop();
      const x = i % W, y = (i / W) | 0;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && clear[j] && !mark[j]) { mark[j] = id; stack.push(j); }
      }
    }
    return { n, x0, y0, x1, y1 };
  };
  for (let x = 0; x < W; x++) for (const y of [0, H - 1]) { const i = y * W + x; if (clear[i] && !mark[i]) fill(i, -1); }
  for (let y = 0; y < H; y++) for (const x of [0, W - 1]) { const i = y * W + x; if (clear[i] && !mark[i]) fill(i, -1); }
  let best = null, id = 0;
  for (let i = 0; i < W * H; i++) {
    if (!clear[i] || mark[i]) continue;
    const r = fill(i, ++id);
    if (!best || r.n > best.n) best = r;
  }
  if (!best || best.n < W * H * 0.01) return null;
  // 向外多留 1 像素，盖住外框边缘的半透明过渡
  const x0 = Math.max(0, best.x0 - 1), y0 = Math.max(0, best.y0 - 1);
  const x1 = Math.min(W, best.x1 + 2), y1 = Math.min(H, best.y1 + 2);
  return [x0 / W, y0 / H, (x1 - x0) / W, (y1 - y0) / H];
}

/* ================= 内置设备（3D 模型） =================
 * 模型由几块「板」组成（deviceModels.js），按 yaw（左右）/ pitch（俯仰）旋转、透视投影到平面上：
 *   侧边：正面外形和背面外形之间的一圈四边形，按朝向和光照着色
 *   正面 / 背面：贴图（先画成位图，再透视填充进投影后的四边形，layers/warp.js）或纯色
 * 每块板是凸的，只画朝向镜头的面；板之间的先后由模型给的分隔平面决定（镜头在哪一侧）。
 * 没有角度时用正投影（就是正面图），朝前的面直接画矢量，不经过贴图。
 */
const rad = a => (a * Math.PI) / 180;
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// 光从左上前方来（视图坐标：x 右、y 下、z 向里）
const LIGHT = (v => v.map(x => x / Math.hypot(...v)))([-0.4, -0.75, -0.55]);
const FACING = -LIGHT[2]; // 正对镜头的面的受光量（贴图按这个亮度画，其他朝向在这个基础上变亮 / 变暗）

// 圆角矩形的外形采样点（顺时针，从左上角开始）。r：数字或 [左上, 右上, 右下, 左下]
function outline2d(w, h, r) {
  const rs = (Array.isArray(r) ? r : [r, r, r, r]).map(v => Math.max(0, Math.min(v || 0, w / 2, h / 2)));
  const pts = [];
  const corner = (cx, cy, cr, a0) => {
    if (cr < 0.01) { pts.push([cx, cy]); return; }
    const n = cr > 60 ? 10 : cr > 14 ? 7 : 4;
    for (let i = 0; i <= n; i++) {
      const a = a0 + (Math.PI / 2) * (i / n);
      pts.push([cx + Math.cos(a) * cr, cy + Math.sin(a) * cr]);
    }
  };
  corner(rs[0], rs[0], rs[0], Math.PI);
  corner(w - rs[1], rs[1], rs[1], -Math.PI / 2);
  corner(w - rs[2], h - rs[2], rs[2], 0);
  corner(rs[3], h - rs[3], rs[3], Math.PI / 2);
  return pts;
}
const mirrorR = r => (Array.isArray(r) ? [r[1], r[0], r[3], r[2]] : r);
// 四边形（左上、右上、右下、左下）朝向镜头时为正
const winding = q => (q[1][0] - q[0][0]) * (q[3][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[3][0] - q[0][0]);

// 按分隔平面排出先后（先画的在前）
function ordered(node, cam, out) {
  if (Array.isArray(node)) node.forEach(n => ordered(n, cam, out));
  else if (node.plane) {
    const [p, n] = node.plane;
    const front = dot3(add(cam, p, -1), n) > 0;
    ordered(front ? node.back : node.front, cam, out);
    ordered(front ? node.front : node.back, cam, out);
  } else out.push(node);
  return out;
}

// 投影后的模型：按先后顺序排好的面（poly 纯色四边形 / face 贴图或纯色的面 / line 线）和外接框
function buildScene(id, frameId, yaw, pitch) {
  const d = deviceOf(id), f = FRAMES[frameId] || FRAMES.dark;
  const flat = Math.abs(yaw) <= 0.01 && Math.abs(pitch) <= 0.01;
  const model = (MODELS[id] || MODELS.laptop)(f, flat);
  const [cx, cy, cz] = model.center;
  const ca = Math.cos(rad(yaw)), sa = Math.sin(rad(yaw)), cb = Math.cos(rad(pitch)), sb = Math.sin(rad(pitch));
  const F = flat ? 1e9 : Math.max(d.w, d.h) * 3.4; // 镜头距离：越小透视越强；正面图用正投影
  const turn = ([x, y, z]) => {
    const X = x * ca + z * sa, Z = -x * sa + z * ca; // 左右
    return [X, y * cb - Z * sb, y * sb + Z * cb];   // 俯仰
  };
  const P = p => {
    const [X, Y, Z] = turn([p[0] - cx, p[1] - cy, p[2] - cz]);
    const k = flat ? 1 : F / (F + Z);
    return [X * k, Y * k];
  };
  const cam = [cx + F * cb * sa, cy - F * sb, cz - F * cb * ca]; // 镜头在设备坐标里的位置
  const items = [], all = [];
  for (const s of ordered(model.tree, cam, [])) {
    if (s.line) {
      const a = P(s.a), b = P(s.b);
      all.push(a, b);
      items.push({ line: [a, b], width: s.width, color: s.color });
      continue;
    }
    const N = cross3(s.V, s.U); // 正面的朝向 = -(U × V)
    const o2 = outline2d(s.w, s.h, s.r);
    const front3 = o2.map(([x, y]) => add(add(s.O, s.U, x), s.V, y));
    const fq = front3.map(P), bq = front3.map(p => P(add(p, N, -s.t)));
    all.push(...fq, ...bq);
    const side = s.side || f.body;
    for (let i = 0; i < o2.length; i++) {
      const j = (i + 1) % o2.length;
      const quad = [fq[j], fq[i], bq[i], bq[j]];
      if (winding(quad) <= 1e-9) continue;
      const dx = o2[j][0] - o2[i][0], dy = o2[j][1] - o2[i][1], len = Math.hypot(dx, dy) || 1;
      const light = dot3(turn(add([s.U[0] * dy / len, s.U[1] * dy / len, s.U[2] * dy / len], s.V, -dx / len)), LIGHT);
      items.push({ poly: quad, color: tone(side, 0.72 + 0.38 * Math.max(-0.6, light)) });
    }
    const c3 = [s.O, add(s.O, s.U, s.w), add(add(s.O, s.U, s.w), s.V, s.h), add(s.O, s.V, s.h)];
    const face = (def, key, q, shape, normal, r) => ({
      face: def || { color: side }, key: `${s.key}:${key}`, q, shape, w: s.w, h: s.h, r, edge: !!s.edge && !flat, light: dot3(turn(normal), LIGHT),
    });
    const frontQ = c3.map(P);
    if (winding(frontQ) > 1e-9) items.push(face(s.front, 'f', frontQ, fq, N, s.r));
    else {
      // 背面：从背后看，左右和正面相反
      const backQ = [c3[1], c3[0], c3[3], c3[2]].map(p => P(add(p, N, -s.t)));
      if (winding(backQ) > 1e-9) items.push(face(s.back, 'b', backQ, [...bq].reverse(), N.map(v => -v), mirrorR(s.r)));
    }
  }
  // 正面图的外接框固定为设备的整体尺寸（旧图层的比例不变）；带角度时取投影的外接框
  let box = { x: -cx, y: -cy, w: d.w, h: d.h };
  if (!flat) {
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  return { items, box, flat, frame: f, ground: !flat && model.ground ? model.ground.map(P) : null, standing: !!model.ground };
}

// 最近用到的投影结果（工作区每帧重画，同一角度不用重算）
const sceneCache = new Map();
function sceneOf(id, frameId, yaw, pitch) {
  const key = `${id}|${frameId}|${yaw}|${pitch}`;
  let sc = sceneCache.get(key);
  if (!sc) {
    sc = buildScene(id, frameId, yaw, pitch);
    sceneCache.set(key, sc);
    if (sceneCache.size > 48) sceneCache.delete(sceneCache.keys().next().value);
  }
  return sc;
}
// 设备在当前角度下的外接框（设备坐标，原点在旋转中心）
const boxOf = (id, yaw, pitch) => sceneOf(DEVICES[id] ? id : 'laptop', 'dark', yaw, pitch).box;

// 贴图缓存：同一张图片、同一设备 / 外观 / 显示方式 / 尺寸档位复用（工作区每帧重画，不能每次都重做贴图）
const texCache = new WeakMap();
const texOrder = [], TEX_LIMIT = 96;
const NO_IMAGE = {};
function faceTexture(key, img, it, o, scale) {
  const owner = (it.face.screen && img) || NO_IMAGE; // 没有屏幕的面和图片无关，所有图片共用
  let map = texCache.get(owner);
  if (!map) texCache.set(owner, (map = new Map()));
  const k = 2 ** (Math.ceil(Math.log2(Math.max(scale, 1 / 64)) * 2) / 2); // 每 √2 倍一档
  const id = `${key}|${it.face.screen ? viewKey(o.view) : ''}|${k}`;
  let c = map.get(id);
  if (!c) {
    const w = Math.max(2, Math.min(4096, Math.round(it.w * k))), h = Math.max(2, Math.min(4096, Math.round(it.h * k)));
    c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d');
    g.scale(w / it.w, h / it.h);
    it.face.paint(g, o);
    map.set(id, c);
    // 全局最多保留 TEX_LIMIT 张贴图（最早做的先丢）
    texOrder.push([map, id]);
    while (texOrder.length > TEX_LIMIT) { const [m, k2] = texOrder.shift(); m.delete(k2); }
  }
  return c;
}

// 多边形的面积（屏幕上顺时针为正）
const polyArea = pts => pts.reduce((sum, p, i) => { const q = pts[(i + 1) % pts.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

function polyPath(ctx, pts) {
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function drawModel(ctx, l, img) {
  const { items, box, flat, frame: f, ground, standing } = sceneOf(DEVICES[l.device] ? l.device : 'laptop', l.frame in FRAMES ? l.frame : 'dark', l.yaw || 0, l.pitch || 0);
  const s = Math.min(l.w / box.w, l.h / box.h);
  const ox = l.x + (l.w - box.w * s) / 2 - box.x * s, oy = l.y + (l.h - box.h * s) / 2 - box.y * s;
  const to = p => [ox + p[0] * s, oy + p[1] * s];
  const px = unitPx(ctx, s), hair = 1 / Math.max(1e-6, unitPx(ctx, 1));
  // 投影：所有面的外形合在一起，画到很远的地方，用投影偏移把影子挪回来（只留影子）
  if (l.shadow !== false) {
    const m = ctx.getTransform(), D = 50000;
    // 立在桌面上的设备：先按脚印画一块贴着桌面的影子（从下往上看时脚印是反的，不画）
    if (ground && polyArea(ground) > 0) {
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = 20 * px;
      ctx.shadowOffsetX = m.a * D;
      ctx.shadowOffsetY = m.b * D + 4 * px;
      ctx.beginPath();
      polyPath(ctx, ground.map(p => { const [x, y] = to(p); return [x - D, y]; }));
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();
    }
    ctx.save();
    ctx.shadowColor = `rgba(0, 0, 0, ${standing && !flat ? 0.22 : 0.36})`;
    ctx.shadowBlur = 46 * px;
    ctx.shadowOffsetX = m.a * D;
    ctx.shadowOffsetY = m.b * D + 22 * px;
    ctx.beginPath();
    for (const it of items) {
      if (it.line) continue;
      polyPath(ctx, (it.poly || it.shape).map(p => { const [x, y] = to(p); return [x - D, y]; }));
    }
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
  }
  const view = screenView(l);
  for (const it of items) {
    if (it.line) {
      const [a, b] = it.line.map(to);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.strokeStyle = it.color;
      ctx.lineWidth = it.width * s;
      ctx.stroke();
      ctx.restore();
      continue;
    }
    if (it.poly) {
      // 侧边：描一圈同色的细边盖住相邻面之间的缝
      ctx.beginPath();
      polyPath(ctx, it.poly.map(to));
      ctx.fillStyle = it.color;
      ctx.strokeStyle = it.color;
      ctx.lineWidth = hair;
      ctx.fill();
      ctx.stroke();
      continue;
    }
    const shape = it.shape.map(to);
    const glow = (it.light - FACING) * 0.32; // 比正对镜头的面亮多少
    if (!it.face.paint) {
      ctx.beginPath();
      polyPath(ctx, shape);
      ctx.fillStyle = tone(it.face.color, 1 + glow);
      ctx.fill();
      continue;
    }
    const q = it.q.map(to);
    const o = { f, img, view, id: l.device, w: it.w, h: it.h, r: it.r };
    const upright = flat && Math.abs(q[0][1] - q[1][1]) < 1e-6 && Math.abs(q[0][0] - q[3][0]) < 1e-6 && q[1][0] > q[0][0] && q[3][1] > q[0][1];
    if (upright) {
      // 正面图里朝前的面：直接画矢量
      ctx.save();
      ctx.translate(q[0][0], q[0][1]);
      ctx.scale((q[1][0] - q[0][0]) / it.w, (q[3][1] - q[0][1]) / it.h);
      it.face.paint(ctx, o);
      ctx.restore();
      continue;
    }
    const span = Math.max(Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]), Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1]), Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1]));
    const scale = (span * unitPx(ctx, 1) * 1.15) / Math.max(it.w, it.h);
    drawWarped(ctx, faceTexture(`${l.device}|${l.frame}|${it.key}`, img, it, o, scale), q, { fit: 'fill' });
    if (it.face.lit && Math.abs(glow) > 0.01) {
      ctx.beginPath();
      polyPath(ctx, shape);
      ctx.fillStyle = glow > 0 ? `rgba(255,255,255,${Math.min(0.5, glow)})` : `rgba(0,0,0,${Math.min(0.6, -glow * 1.3)})`;
      ctx.fill();
    }
    if (it.edge) {
      ctx.beginPath();
      polyPath(ctx, shape);
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = Math.max(hair, 1.4 * s);
      ctx.stroke();
    }
  }
}
