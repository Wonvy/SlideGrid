/**
 * 设备样机：笔记本、显示器、平板、投影幕（矢量绘制），以及用户上传的 PNG 样机（device: 'custom'）。
 * 屏幕里显示画板的某一张幻灯片，或样机自己的图片（imageId）。
 *
 * 内置设备在自己的坐标系里定义（宽 1000），w / h 为整体尺寸，screen 为屏幕区域 [x, y, w, h]。
 * 绘制时按图层的框等比缩放、居中（图层框的比例与设备一致，见 deviceSize）。
 * 自定义样机：frameAssetId 为 PNG 素材，frameW / frameH 为原图尺寸，screen 为屏幕区域占图片的比例 [x, y, w, h]
 * （上传时由 findScreen 找出图片里被包围的透明区域）。先画屏幕内容，再把 PNG 盖在上面。
 */
export const DEVICES = {
  laptop: { label: '笔记本', icon: 'laptop', w: 1000, h: 562, screen: [106, 26, 788, 474], radius: 4 },
  monitor: { label: '显示器', icon: 'monitor', w: 1000, h: 764, screen: [18, 18, 964, 542], radius: 3 },
  tablet: { label: '平板', icon: 'tablet', w: 1000, h: 716, screen: [42, 42, 916, 632], radius: 18 },
  projector: { label: '投影幕', icon: 'presentation', w: 1000, h: 766, screen: [54, 60, 892, 502], radius: 0 },
};

// 外观配色：body 机身 / 边框，rim 金属边，bezel 屏幕黑边，metal 底座渐变
export const FRAMES = {
  dark: { label: '深空灰', body: '#2e3035', rim: '#55585f', bezel: '#09090a', metal: ['#56595f', '#26282c'], pole: '#6b6f77' },
  silver: { label: '银色', body: '#c9ccd2', rim: '#e4e6e9', bezel: '#09090a', metal: ['#e6e8eb', '#a5a9b0'], pole: '#9a9ea6' },
  light: { label: '白色', body: '#eef0f3', rim: '#ffffff', bezel: '#f6f7f8', metal: ['#f4f5f7', '#c9ccd1'], pole: '#b7bbc2' },
};

export const deviceOf = id => DEVICES[id] || DEVICES.laptop;
// 设备的高宽比；自定义样机用 PNG 的尺寸（layer 为图层本身或带 frameW / frameH 的对象）
export const deviceAspect = (id, layer = null) => (id === 'custom' && layer?.frameW ? layer.frameH / layer.frameW : deviceOf(id).h / deviceOf(id).w);
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

// 屏幕：黑底 + 幻灯片（填满裁切 / 完整显示）+ 很淡的反光
function drawScreen(ctx, d, img, fit, gloss) {
  const [x, y, w, h] = d.screen;
  ctx.save();
  rr(ctx, x, y, w, h, d.radius || 0);
  ctx.clip();
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, w, h);
  if (img?.width) {
    const k = fit === 'contain' ? Math.min(w / img.width, h / img.height) : Math.max(w / img.width, h / img.height);
    const dw = img.width * k, dh = img.height * k;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
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
 */
export function drawDevice(ctx, l, img, frameImg = null) {
  if (l.device === 'custom') { drawCustom(ctx, l, img, frameImg); return; }
  const d = deviceOf(l.device);
  const f = FRAMES[l.frame] || FRAMES.dark;
  const s = Math.min(l.w / d.w, l.h / d.h);
  ctx.save();
  ctx.translate(l.x + (l.w - d.w * s) / 2, l.y + (l.h - d.h * s) / 2);
  ctx.scale(s, s);
  const shadow = l.shadow !== false;
  BODY[l.device in BODY ? l.device : 'laptop'](ctx, d, f, shadow, unitPx(ctx, 1));
  drawScreen(ctx, d, img, l.fit, l.device !== 'projector');
  ctx.restore();
}

// 自定义 PNG 样机：投影 → 屏幕内容 → PNG 外框
function drawCustom(ctx, l, img, frameImg) {
  const [fx, fy, fw, fh] = l.screen || [0.1, 0.1, 0.8, 0.8];
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
  drawScreen(ctx, { screen: [l.x + fx * l.w, l.y + fy * l.h, fw * l.w, fh * l.h], radius: 0 }, img, l.fit, false);
  if (frameImg) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(frameImg, l.x, l.y, l.w, l.h);
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
