/**
 * 设备样机：笔记本、显示器、平板、投影幕（矢量绘制），以及用户上传的 PNG 样机（device: 'custom'）。
 * 屏幕里显示画板的某一张幻灯片，或样机自己的图片（imageId）。
 *
 * 内置设备在自己的坐标系里定义（宽 1000），w / h 为整体尺寸，screen 为屏幕区域 [x, y, w, h]。
 * 绘制时按图层的框等比缩放、居中（图层框的比例与设备一致，见 deviceSize）。
 * 自定义样机：frameAssetId 为 PNG 素材，frameW / frameH 为原图尺寸；
 *   quad：屏幕的四个角（占图片的比例，左上、右上、右下、左下），上传时由用户对准，图片按透视填充进去（layers/warp.js）
 *   screen：旧数据的矩形屏幕区域 [x, y, w, h]（没有 quad 时使用）
 *   screenOnTop：PNG 的屏幕区域不透明时，图片画在外框上面；否则先画图片，再把 PNG 盖在上面
 */
import { drawWarped } from './warp.js';
export const DEVICES = {
  laptop: { label: '笔记本', icon: 'laptop', w: 1000, h: 562, screen: [106, 26, 788, 474], radius: 4 },
  monitor: { label: '显示器', icon: 'monitor', w: 1000, h: 764, screen: [18, 18, 964, 542], radius: 3 },
  tablet: { label: '平板', icon: 'tablet', w: 1000, h: 716, screen: [42, 42, 916, 632], radius: 18 },
  projector: { label: '投影幕', icon: 'presentation', w: 1000, h: 766, screen: [54, 60, 892, 502], radius: 0 },
  phone: { label: '手机', icon: 'smartphone', w: 480, h: 980, screen: [24, 24, 432, 932], radius: 58 },
  phoneLand: { label: '手机（横）', icon: 'smartphone-land', w: 980, h: 480, screen: [24, 24, 932, 432], radius: 58 },
  watch: { label: '手表', icon: 'watch', w: 440, h: 760, screen: [74, 214, 292, 332], radius: 64 },
};

// 外观配色：body 机身 / 边框，rim 金属边，bezel 屏幕黑边，metal 底座渐变
export const FRAMES = {
  dark: { label: '深空灰', body: '#2e3035', rim: '#55585f', bezel: '#09090a', metal: ['#56595f', '#26282c'], pole: '#6b6f77', band: '#1c1d21', keys: '#141518', side: '#3b3e44' },
  silver: { label: '银色', body: '#c9ccd2', rim: '#e4e6e9', bezel: '#09090a', metal: ['#e6e8eb', '#a5a9b0'], pole: '#9a9ea6', band: '#c9ced6', keys: '#2a2c31', side: '#b9bdc4' },
  light: { label: '白色', body: '#eef0f3', rim: '#ffffff', bezel: '#f6f7f8', metal: ['#f4f5f7', '#c9ccd1'], pole: '#b7bbc2', band: '#ece6dc', keys: '#e3e5e9', side: '#dadde2' },
};

export const deviceOf = id => DEVICES[id] || DEVICES.laptop;

// 样机页的预设：正面 + 带角度（yaw 左右，正值 = 从右侧看；pitch 俯视）
export const DEVICE_PRESETS = [
  { device: 'laptop', label: '笔记本' },
  { device: 'laptop', yaw: -32, pitch: 16, label: '笔记本 · 左侧' },
  { device: 'laptop', yaw: 32, pitch: 16, label: '笔记本 · 右侧' },
  { device: 'laptop', pitch: 30, label: '笔记本 · 俯视' },
  { device: 'monitor', label: '显示器' },
  { device: 'monitor', yaw: -28, pitch: 6, label: '显示器 · 左侧' },
  { device: 'monitor', yaw: 28, pitch: 6, label: '显示器 · 右侧' },
  { device: 'tablet', label: '平板' },
  { device: 'tablet', yaw: -30, pitch: 12, label: '平板 · 左侧' },
  { device: 'tablet', yaw: 30, pitch: 12, label: '平板 · 右侧' },
  { device: 'phone', label: '手机' },
  { device: 'phone', yaw: 30, pitch: 8, label: '手机 · 右侧' },
  { device: 'phoneLand', label: '手机（横）' },
  { device: 'phoneLand', yaw: -28, pitch: 10, label: '手机（横）· 左侧' },
  { device: 'watch', label: '手表' },
  { device: 'watch', yaw: -26, pitch: 8, label: '手表 · 左侧' },
  { device: 'projector', label: '投影幕' },
  { device: 'projector', yaw: 26, pitch: 4, label: '投影幕 · 右侧' },
];
// 设备的高宽比；自定义样机用 PNG 的尺寸（layer 为图层本身或带 frameW / frameH 的对象）
export const deviceAspect = (id, layer = null) => (id === 'custom' && layer?.frameW ? layer.frameH / layer.frameW
  : layer && hasAngle({ ...layer, device: id }) ? angledAspect(id, layer.yaw || 0, layer.pitch || 0)
    : deviceOf(id).h / deviceOf(id).w);
// 按宽度算出设备图层的尺寸
export const deviceSize = (id, w, layer = null) => ({ w, h: w * deviceAspect(id, layer) });

// 当前变换下，设备坐标 1 个单位对应多少像素（阴影的模糊半径不受变换影响，要自己换算）
const unitPx = (ctx, s) => {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b) * s;
};

function shadowed(ctx, on, px, fn) {
  if (on) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.38)';
    ctx.shadowBlur = 46 * px;
    ctx.shadowOffsetY = 22 * px;
    fn();
    ctx.restore();
  } else {
    fn();
  }
}

const vGrad = (ctx, y0, y1, [a, b]) => {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
};

const rr = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
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

// 屏幕：黑底 + 幻灯片（按 view 显示）+ 很淡的反光。view 也可以只传 fit 字符串
function drawScreen(ctx, d, img, view, gloss) {
  const v = typeof view === 'string' ? { fit: view, zoom: 1, x: 0, y: 0 } : view;
  const [x, y, w, h] = d.screen;
  ctx.save();
  rr(ctx, x, y, w, h, d.radius || 0);
  ctx.clip();
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, w, h);
  if (img?.width) {
    const k = (v.fit === 'contain' ? Math.min(w / img.width, h / img.height) : Math.max(w / img.width, h / img.height)) * v.zoom;
    const dw = img.width * k, dh = img.height * k;
    // 比屏幕大时可以平移：x / y = -1 看左 / 上边，1 看右 / 下边
    const ox = (w - dw) / 2 - (v.x * Math.max(0, dw - w)) / 2, oy = (h - dh) / 2 - (v.y * Math.max(0, dh - h)) / 2;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x + ox, y + oy, dw, dh);
  } else {
    ctx.fillStyle = '#1b1d22';
    ctx.fillRect(x, y, w, h);
  }
  if (gloss) {
    const g = ctx.createLinearGradient(x, y, x + w * 0.6, y + h);
    g.addColorStop(0, 'rgba(255,255,255,0.09)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

// 屏幕上面的装饰（手机的灵动岛）
const OVERLAY = {
  phone(ctx) { rr(ctx, 190, 46, 100, 30, 15); ctx.fillStyle = '#000'; ctx.fill(); },
  phoneLand(ctx) { rr(ctx, 46, 190, 30, 100, 15); ctx.fillStyle = '#000'; ctx.fill(); },
};

const BODY = {
  laptop(ctx, d, f, shadow, px) {
    // 屏幕盖：金属边 + 黑色边框
    shadowed(ctx, shadow, px, () => {
      rr(ctx, 80, 0, 840, 540, [26, 26, 8, 8]);
      ctx.fillStyle = f.rim;
      ctx.fill();
      // 底座
      rr(ctx, 0, 538, 1000, 24, [3, 3, 30, 30]);
      ctx.fillStyle = vGrad(ctx, 538, 562, f.metal);
      ctx.fill();
    });
    rr(ctx, 84, 4, 832, 532, [22, 22, 5, 5]);
    ctx.fillStyle = '#09090a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(500, 14, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#23262b';
    ctx.fill();
    // 开盖凹槽
    rr(ctx, 428, 538, 144, 9, [0, 0, 8, 8]);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fill();
  },
  monitor(ctx, d, f, shadow, px) {
    shadowed(ctx, shadow, px, () => {
      // 支架和底座
      ctx.beginPath();
      ctx.moveTo(452, 570);
      ctx.lineTo(548, 570);
      ctx.lineTo(570, 744);
      ctx.lineTo(430, 744);
      ctx.closePath();
      ctx.fillStyle = vGrad(ctx, 570, 744, f.metal);
      ctx.fill();
      rr(ctx, 320, 740, 360, 24, [6, 6, 14, 14]);
      ctx.fillStyle = vGrad(ctx, 740, 764, f.metal);
      ctx.fill();
      // 面板
      rr(ctx, 0, 0, 1000, 578, 18);
      ctx.fillStyle = f.rim;
      ctx.fill();
    });
    rr(ctx, 3, 3, 994, 572, 16);
    ctx.fillStyle = f.bezel;
    ctx.fill();
  },
  tablet(ctx, d, f, shadow, px) {
    shadowed(ctx, shadow, px, () => {
      rr(ctx, 0, 0, 1000, 716, 60);
      ctx.fillStyle = f.rim;
      ctx.fill();
    });
    rr(ctx, 6, 6, 988, 704, 54);
    ctx.fillStyle = f.bezel;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(500, 22, 4, 0, Math.PI * 2);
    ctx.fillStyle = f.bezel === '#09090a' ? '#24272c' : '#c8ccd2';
    ctx.fill();
  },
  phone(ctx, d, f, shadow, px) {
    shadowed(ctx, shadow, px, () => {
      rr(ctx, 0, 0, d.w, d.h, 80);
      ctx.fillStyle = f.rim;
      ctx.fill();
    });
    rr(ctx, 6, 6, d.w - 12, d.h - 12, 74);
    ctx.fillStyle = '#060607';
    ctx.fill();
  },
  watch(ctx, d, f, shadow, px) {
    shadowed(ctx, shadow, px, () => {
      // 表带（上下）+ 表壳
      rr(ctx, 104, 0, 232, 210, [36, 36, 0, 0]);
      ctx.fillStyle = f.band;
      ctx.fill();
      rr(ctx, 104, 550, 232, 210, [0, 0, 36, 36]);
      ctx.fill();
      rr(ctx, 40, 180, 360, 400, 100);
      ctx.fillStyle = f.rim;
      ctx.fill();
    });
    // 表冠、侧键
    rr(ctx, 396, 300, 26, 76, 10);
    ctx.fillStyle = vGrad(ctx, 300, 376, f.metal);
    ctx.fill();
    rr(ctx, 398, 412, 14, 64, 6);
    ctx.fill();
    rr(ctx, 50, 190, 340, 380, 90);
    ctx.fillStyle = '#060607';
    ctx.fill();
  },
  projector(ctx, d, f, shadow, px) {
    // 三脚架
    ctx.save();
    ctx.strokeStyle = f.pole;
    ctx.lineCap = 'round';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(500, 596); ctx.lineTo(500, 760);
    ctx.moveTo(500, 700); ctx.lineTo(392, 760);
    ctx.moveTo(500, 700); ctx.lineTo(608, 760);
    ctx.stroke();
    ctx.restore();
    shadowed(ctx, shadow, px, () => {
      // 幕布（白边）
      ctx.fillStyle = '#f6f6f3';
      ctx.fillRect(30, 30, 940, 556);
      // 顶部卷轴盒、底部配重杆
      rr(ctx, 0, 0, 1000, 42, 21);
      ctx.fillStyle = vGrad(ctx, 0, 42, f.metal);
      ctx.fill();
    });
    rr(ctx, 24, 582, 952, 14, 7);
    ctx.fillStyle = vGrad(ctx, 582, 596, f.metal);
    ctx.fill();
  },
};

/**
 * 画一个设备图层。img：屏幕里的幻灯片图片（ImageBitmap / canvas），没有时屏幕为深灰
 * 调用前 ctx 已设为画板坐标；旋转、不透明度由 drawLayers 处理。
 * 依次画：接触阴影（放在桌面上的设备、带角度的设备）→ 倒影（reflection）→ 设备本身
 */
export function drawDevice(ctx, l, img, frameImg = null) {
  const standing = ['laptop', 'monitor', 'projector'].includes(l.device) || hasAngle(l);
  if (l.shadow !== false && standing) drawContactShadow(ctx, l);
  if (l.reflection) drawReflection(ctx, l, img, frameImg);
  drawDeviceBody(ctx, l, img, frameImg);
}

// 接触阴影：设备底部一个压扁的柔和椭圆
function drawContactShadow(ctx, l) {
  const cx = l.x + l.w / 2, cy = l.y + l.h * 0.985, rx = l.w * 0.46, ry = Math.max(l.h * 0.035, l.w * 0.012);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, 'rgba(0,0,0,0.38)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.16)');
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
  if (l.device === 'custom') { drawCustom(ctx, l, img, frameImg); return; }
  if (hasAngle(l)) { drawAngled(ctx, l, img); return; }
  const d = deviceOf(l.device);
  const f = FRAMES[l.frame] || FRAMES.dark;
  const s = Math.min(l.w / d.w, l.h / d.h);
  ctx.save();
  ctx.translate(l.x + (l.w - d.w * s) / 2, l.y + (l.h - d.h * s) / 2);
  ctx.scale(s, s);
  const shadow = l.shadow !== false;
  drawFlat(ctx, l.device, d, f, img, screenView(l), shadow, unitPx(ctx, 1));
  ctx.restore();
}

// 正面（无角度）的设备：外形 → 屏幕 → 屏幕上的装饰
function drawFlat(ctx, id, d, f, img, fit, shadow, px) {
  const body = BODY[id] || (id === 'phoneLand' ? BODY.phone : BODY.laptop);
  body(ctx, d, f, shadow, px);
  drawScreen(ctx, d, img, fit, id !== 'projector');
  OVERLAY[id]?.(ctx);
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

/* ================= 带角度的设备（3D） =================
 * 每种内置设备用几个平面搭成 3D 模型（设备坐标：x 向右、y 向下、z 向里，与正面图的坐标一致），
 * 按 yaw（左右，正值 = 从右侧看）/ pitch（俯仰，正值 = 从上往下看）旋转、透视投影，
 * 每个平面先画成贴图，再透视填充进投影后的四边形（layers/warp.js）。从远到近绘制，背对镜头的面不画。
 *   face：{ pts: 四个 3D 角（左上、右上、右下、左下）, tw, th: 贴图尺寸, paint(g, f, img, fit): 画贴图 }
 *         或 { pts, color }（纯色面，如机身侧边）；shapes：投影（阴影）用的外形（圆角），默认就是四个角
 *   line：{ a, b, width, color }（投影幕的三脚架）
 */

// 圆角矩形的外形采样点（平面 z 上，顺时针）
function roundOutline(x, y, w, h, r, z, n = 6) {
  const pts = [];
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (Math.PI / 2) * (i / n);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]);
    }
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return pts;
}

// 机身侧边：正面外形和背面外形之间的一圈四边形
function sideBand(outline, depth, color) {
  return outline.map((a, i) => {
    const b = outline[(i + 1) % outline.length];
    return { pts: [a, b, [b[0], b[1], b[2] + depth], [a[0], a[1], a[2] + depth]], color };
  });
}

// 平面设备（手机、平板、手表）：正面贴图就是正面图本身 + 一圈侧边
function planar(id, outlineRect, depth, extraShapes = []) {
  const d = deviceOf(id);
  const [ox, oy, ow, oh, or] = outlineRect;
  const front = roundOutline(ox, oy, ow, oh, or, 0);
  return f => ({
    center: [d.w / 2, d.h / 2, depth / 2],
    faces: [
      ...sideBand(front, depth, f.side),
      {
        pts: [[0, 0, 0], [d.w, 0, 0], [d.w, d.h, 0], [0, d.h, 0]], tw: d.w, th: d.h,
        shapes: [front, ...extraShapes.map(([x, y, w, h, r]) => roundOutline(x, y, w, h, r, 0))],
        paint: (g, img, fit) => drawFlat(g, id, d, f, img, fit, false, 1),
      },
    ],
  });
}

// 笔记本键盘面的贴图（与屏幕盖同宽：DECK_W × DECK_D）
const DECK_W = 840, DECK_D = 560;
function paintDeck(g, f) {
  rr(g, 0, 0, DECK_W, DECK_D, [0, 0, 26, 26]);
  g.fillStyle = vGrad(g, 0, DECK_D, [f.metal[0], f.rim]);
  g.fill();
  // 键盘区：左右各留 52，6 行 14 列（第一行是矮的功能键）
  const x0 = 52, kbW = DECK_W - x0 * 2, cols = 14, gap = 5, kw = (kbW - gap * (cols - 1)) / cols, kh = 40, y0 = 34;
  rr(g, x0 - 8, y0 - 8, kbW + 16, 6 * (kh + gap) - 12, 12);
  g.fillStyle = 'rgba(0,0,0,0.07)';
  g.fill();
  g.fillStyle = f.keys;
  for (let r = 0; r < 6; r++) {
    const h = r === 0 ? kh - 16 : kh, y = y0 + (r === 0 ? 0 : r * (kh + gap) - 16);
    for (let c = 0; c < cols; c++) {
      rr(g, x0 + c * (kw + gap), y, kw, h, 6);
      g.fill();
    }
  }
  // 触控板
  const tw = 300, th = 180, ty = y0 + 6 * (kh + gap) - 16 + 26;
  rr(g, (DECK_W - tw) / 2, ty, tw, th, 16);
  g.fillStyle = 'rgba(0,0,0,0.06)';
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 2;
  g.stroke();
}

const deg = a => (a * Math.PI) / 180;
const LID_TILT = deg(14); // 屏幕盖向后倾斜（打开约 104°）

const MODELS = {
  laptop: f => {
    const d = DEVICES.laptop;
    const hy = 540, depth = DECK_D, x0 = 80, x1 = 80 + DECK_W; // 转轴高度、底座进深（向镜头方向）；底座和屏幕盖同宽
    const lid = (x, y) => [x, hy - (hy - y) * Math.cos(LID_TILT), (hy - y) * Math.sin(LID_TILT)];
    return {
      center: [500, 400, -depth / 2 + 60],
      faces: [
        // 屏幕盖（正面贴图：金属边 + 黑边 + 屏幕）
        {
          pts: [lid(80, 0), lid(920, 0), lid(920, hy), lid(80, hy)], tw: 840, th: 540,
          paint: (g, img, fit) => {
            g.translate(-80, 0);
            rr(g, 80, 0, 840, 540, [26, 26, 8, 8]);
            g.fillStyle = f.rim;
            g.fill();
            rr(g, 84, 4, 832, 532, [22, 22, 5, 5]);
            g.fillStyle = '#09090a';
            g.fill();
            drawScreen(g, d, img, fit, true);
          },
        },
        // 键盘面（水平，从转轴伸向镜头）
        { pts: [[x0, hy, 0], [x1, hy, 0], [x1, hy, -depth], [x0, hy, -depth]], tw: DECK_W, th: DECK_D, paint: g => paintDeck(g, f) },
        // 底座前沿、两侧（厚度 18）
        { pts: [[x0, hy, -depth], [x1, hy, -depth], [x1, hy + 18, -depth], [x0, hy + 18, -depth]], color: f.metal[1] },
        { pts: [[x0, hy, 0], [x0, hy, -depth], [x0, hy + 18, -depth], [x0, hy + 18, 0]], color: f.side, when: yaw => yaw < 0 },
        { pts: [[x1, hy, -depth], [x1, hy, 0], [x1, hy + 18, 0], [x1, hy + 18, -depth]], color: f.side, when: yaw => yaw > 0 },
      ],
    };
  },
  monitor: f => {
    const d = DEVICES.monitor;
    const panel = roundOutline(0, 0, 1000, 578, 18, 0);
    return {
      center: [500, 382, 60],
      faces: [
        // 底座（水平）、支架（竖直，在面板后面）
        { pts: [[320, 752, 260], [680, 752, 260], [680, 752, -40], [320, 752, -40]], color: f.metal[0] },
        { pts: [[320, 752, -40], [680, 752, -40], [680, 764, -40], [320, 764, -40]], color: f.metal[1] },
        { pts: [[452, 560, 70], [548, 560, 70], [570, 752, 110], [430, 752, 110]], color: f.metal[1] },
        ...sideBand(panel, 34, f.side),
        {
          pts: [[0, 0, 0], [1000, 0, 0], [1000, 578, 0], [0, 578, 0]], tw: 1000, th: 578, shapes: [panel],
          paint: (g, img, fit) => {
            rr(g, 0, 0, 1000, 578, 18);
            g.fillStyle = f.rim;
            g.fill();
            rr(g, 3, 3, 994, 572, 16);
            g.fillStyle = f.bezel;
            g.fill();
            drawScreen(g, d, img, fit, true);
          },
        },
      ],
    };
  },
  projector: f => {
    const d = DEVICES.projector;
    return {
      center: [500, 400, 0],
      lines: [
        { a: [500, 596, 0], b: [500, 700, 0], width: 9, color: f.pole },
        { a: [500, 700, 0], b: [392, 766, -70], width: 9, color: f.pole },
        { a: [500, 700, 0], b: [608, 766, -70], width: 9, color: f.pole },
        { a: [500, 700, 0], b: [500, 766, 120], width: 9, color: f.pole },
      ],
      faces: [
        {
          pts: [[0, 0, 0], [1000, 0, 0], [1000, 596, 0], [0, 596, 0]], tw: 1000, th: 596,
          paint: (g, img, fit) => {
            g.fillStyle = '#f6f6f3';
            g.fillRect(30, 30, 940, 556);
            rr(g, 0, 0, 1000, 42, 21);
            g.fillStyle = vGrad(g, 0, 42, f.metal);
            g.fill();
            rr(g, 24, 582, 952, 14, 7);
            g.fillStyle = vGrad(g, 582, 596, f.metal);
            g.fill();
            drawScreen(g, d, img, fit, false);
          },
        },
      ],
    };
  },
  tablet: planar('tablet', [0, 0, 1000, 716, 60], 28),
  phone: planar('phone', [0, 0, 480, 980, 80], 44),
  phoneLand: planar('phoneLand', [0, 0, 980, 480, 80], 44),
  watch: f => {
    // 侧边只算表壳；投影的外形 = 表壳 + 上下表带
    const base = planar('watch', [40, 180, 360, 400, 100], 64, [[104, 0, 232, 220, 36], [104, 540, 232, 220, 36]])(f);
    return { ...base, center: [220, 380, 32] };
  },
};

// 旋转 + 透视投影。返回 (p) → [x, y, z']
function projector3d(model, yaw, pitch, size) {
  const [cx, cy, cz] = model.center;
  const a = deg(yaw), b = deg(pitch);
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  const F = size * 3.4; // 镜头距离：越小透视越强（太小时近处会被放大得失真）
  return ([x, y, z]) => {
    let X = x - cx, Y = y - cy, Z = z - cz;
    [X, Z] = [X * ca + Z * sa, -X * sa + Z * ca];          // 左右
    [Y, Z] = [Y * cb - Z * sb, Y * sb + Z * cb];           // 俯仰
    const k = F / (F + Z);
    return [X * k, Y * k, Z];
  };
}

// 投影后的模型：所有面、线（投影坐标）和外接框
function projectModel(id, f, yaw, pitch) {
  const d = deviceOf(id);
  const model = MODELS[id](f);
  const P = projector3d(model, yaw, pitch, Math.max(d.w, d.h));
  const faces = model.faces.map((face, idx) => {
    const q = face.pts.map(P);
    const cross = (q[1][0] - q[0][0]) * (q[3][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[3][0] - q[0][0]);
    // 贴图面：背对镜头时不画；纯色面（侧边、底座）按远近顺序画，被前面的面盖住，个别面按角度决定是否可见
    const visible = face.paint ? cross > 1e-6 : face.when ? face.when(yaw, pitch) : true;
    return { ...face, idx, q, depth: q.reduce((sum, p) => sum + p[2], 0) / 4, visible, shapesQ: face.shapes?.map(sh => sh.map(P)) };
  });
  const lines = (model.lines || []).map(l => ({ ...l, pa: P(l.a), pb: P(l.b) }));
  const all = [...faces.flatMap(fc => fc.q), ...lines.flatMap(l => [l.pa, l.pb])];
  const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
  const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  return { faces, lines, box };
}

export const hasAngle = l => l.device !== 'custom' && (Math.abs(l.yaw || 0) > 0.01 || Math.abs(l.pitch || 0) > 0.01);

// 带角度时的高宽比（由投影后的外接框得出）
export function angledAspect(id, yaw, pitch) {
  const { box } = projectModel(id, FRAMES.dark, yaw, pitch);
  return box.h / Math.max(1e-6, box.w);
}

// 贴图缓存：同一张图片、同一设备 / 外观 / 显示方式 / 尺寸档位复用（工作区每帧重画，不能每次都重做贴图）
const texCache = new WeakMap();
const texOrder = [], TEX_LIMIT = 64;
const NO_IMAGE = {};
function faceTexture(key, img, face, f, fit, scale) {
  const owner = img || NO_IMAGE;
  let map = texCache.get(owner);
  if (!map) texCache.set(owner, (map = new Map()));
  const k = 2 ** (Math.ceil(Math.log2(Math.max(scale, 1 / 64)) * 2) / 2); // 每 √2 倍一档
  const id = `${key}|${viewKey(fit)}|${k}`;
  let c = map.get(id);
  if (!c) {
    const w = Math.max(2, Math.min(4096, Math.round(face.tw * k))), h = Math.max(2, Math.min(4096, Math.round(face.th * k)));
    c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d');
    g.scale(w / face.tw, h / face.th);
    face.paint(g, img, fit);
    map.set(id, c);
    // 全局最多保留 TEX_LIMIT 张贴图（最早做的先丢）
    texOrder.push([map, id]);
    while (texOrder.length > TEX_LIMIT) { const [m, k2] = texOrder.shift(); m.delete(k2); }
  }
  return c;
}

function polyPath(ctx, pts) {
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

// 带角度的设备
function drawAngled(ctx, l, img) {
  const f = FRAMES[l.frame] || FRAMES.dark;
  const { faces, lines, box } = projectModel(l.device, f, l.yaw || 0, l.pitch || 0);
  const s = Math.min(l.w / box.w, l.h / box.h);
  const ox = l.x + (l.w - box.w * s) / 2 - box.x * s, oy = l.y + (l.h - box.h * s) / 2 - box.y * s;
  const to = p => [ox + p[0] * s, oy + p[1] * s];
  const px = unitPx(ctx, s);
  const visible = faces.filter(fc => fc.visible).sort((a, b) => b.depth - a.depth);
  // 投影：所有可见面的外形合在一起，画到很远的地方，用投影偏移把影子挪回来（只留影子）
  if (l.shadow !== false) {
    const m = ctx.getTransform(), D = 50000;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.36)';
    ctx.shadowBlur = 46 * px;
    ctx.shadowOffsetX = m.a * D;
    ctx.shadowOffsetY = m.b * D + 22 * px;
    ctx.beginPath();
    for (const fc of visible) {
      for (const sh of fc.shapesQ || [fc.q]) polyPath(ctx, sh.map(p => { const [x, y] = to(p); return [x - D, y]; }));
    }
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.lineCap = 'round';
  for (const ln of lines) {
    const [ax, ay] = to(ln.pa), [bx, by] = to(ln.pb);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.strokeStyle = ln.color;
    ctx.lineWidth = ln.width * s;
    ctx.stroke();
  }
  ctx.restore();
  for (const fc of visible) {
    const q = fc.q.map(to);
    if (fc.color) {
      // 纯色面（侧边等）：描一圈同色的边盖住相邻面之间的缝
      ctx.beginPath();
      polyPath(ctx, q);
      ctx.fillStyle = fc.color;
      ctx.strokeStyle = fc.color;
      ctx.lineWidth = 1 / Math.max(1e-6, unitPx(ctx, 1));
      ctx.fill();
      ctx.stroke();
      continue;
    }
    const span = Math.max(Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]));
    const scale = (span * unitPx(ctx, 1) * 1.15) / Math.max(fc.tw, fc.th);
    const tex = faceTexture(`${l.device}|${l.frame}|${fc.idx}`, img, fc, f, screenView(l), scale);
    drawWarped(ctx, tex, q, { fit: 'fill' });
  }
}
