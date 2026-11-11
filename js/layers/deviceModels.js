/**
 * 内置设备样机的外形：每种设备由几块「板」搭成（圆角矩形拉伸出厚度），正面 / 背面是贴图，侧边按光照着色。
 * 设备坐标：x 向右、y 向下、z 向里（背面方向），宽度 1000 左右；正面图（没有角度）就是这个模型的正视图。
 *
 *   板：{ key, O, U, V, w, h, r, t, side, front, back, edge }
 *     O：正面左上角；U / V：正面的「右」「下」方向（单位向量），正面朝向 N = -(U × V)；w / h：正面尺寸
 *     r：圆角（数字或 [左上, 右上, 右下, 左下]）；t：厚度（沿 -N）；side：侧边颜色（默认机身色）
 *     front / back：{ paint(g, o), screen, lit } 贴图（g 的坐标 = 这一面自己的坐标，背面是从背后看的坐标）
 *                   或 { color } 纯色；screen：贴图里有屏幕内容（随图片变化）；lit：贴图跟着光照变亮 / 变暗
 *     edge：正面外沿加一圈很淡的高光
 *   线：{ line: true, a, b, width, color }（投影幕的三脚架）
 *   ground：落在桌面上的设备的「脚印」（桌面上的一圈点），用来画桌面上的影子
 *   风格（o.real）：false = 简洁（平涂、干净）；true = 写实（拉丝金属、倒角高光、玻璃反光、镜头和键帽的细节）
 *   先后顺序（tree）：板的数组（按顺序画），或 { plane: [点, 法线], front, back }——
 *     镜头在平面的正面一侧时先画 back 再画 front，反之相反（两组分别在平面两侧，谁离镜头近谁后画）
 */
export const DEVICES = {
  laptop: { label: '笔记本', icon: 'laptop', w: 1000, h: 562, screen: [106, 26, 788, 474], radius: 6, foot: [0.02, 0.98] },
  monitor: { label: '显示器', icon: 'monitor', w: 1000, h: 764, screen: [18, 18, 964, 542], radius: 4, foot: [0.27, 0.73] },
  tablet: { label: '平板', icon: 'tablet', w: 1000, h: 716, screen: [34, 34, 932, 648], radius: 24 },
  projector: { label: '投影幕', icon: 'presentation', w: 1000, h: 766, screen: [54, 60, 892, 502], radius: 0, foot: [0.33, 0.67] },
  phone: { label: '手机', icon: 'smartphone', w: 480, h: 980, screen: [18, 18, 444, 944], radius: 62 },
  phoneLand: { label: '手机（横）', icon: 'smartphone-land', w: 980, h: 480, screen: [18, 18, 944, 444], radius: 62 },
  watch: { label: '手表', icon: 'watch', w: 440, h: 760, screen: [74, 214, 292, 332], radius: 64 },
};

// 外观配色：body 机身，hi / lo 机身的亮部 / 暗部，bezel 屏幕边框，well / keys 键盘凹槽 / 键帽，band 表带，pole 支架
export const FRAMES = {
  dark: { label: '深空灰', body: '#3b3d42', hi: '#63666d', lo: '#222327', bezel: '#050506', well: '#25262b', keys: '#0e0f11', band: '#1e1f23', pole: '#666a72' },
  silver: { label: '银色', body: '#d3d5d9', hi: '#f3f4f6', lo: '#9da0a7', bezel: '#050506', well: '#1e1f22', keys: '#101113', band: '#dfe3ea', pole: '#9a9ea6' },
  light: { label: '白色', body: '#f1f2f4', hi: '#ffffff', lo: '#c5c8ce', bezel: '#f8f9fa', well: '#dcdfe4', keys: '#ffffff', band: '#f2ede5', pole: '#b7bbc2' },
};

export const deviceOf = id => DEVICES[id] || DEVICES.laptop;

const BLACK = '#050506';

/* ---------------- 画图的小工具 ---------------- */

const rr = (g, x, y, w, h, r) => {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
};
const dot = (g, x, y, r, color) => {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
};
// 线性渐变：stops 为颜色数组（均匀分布）或 [位置, 颜色] 数组
const grad = (g, x0, y0, x1, y1, stops) => {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((s, i) => (Array.isArray(s) ? gr.addColorStop(s[0], s[1]) : gr.addColorStop(i / (stops.length - 1), s)));
  return gr;
};
const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// 调亮 / 调暗：k < 1 变暗，k > 1 向白色靠近
export function tone(hex, k) {
  const c = rgb(hex).map(v => Math.round(Math.max(0, k <= 1 ? v * k : v + (255 - v) * Math.min(1, k - 1))));
  return `rgb(${c.join(',')})`;
}

// 屏幕：黑底 + 图片（按 view 显示）+ 很淡的反光。rect：[x, y, w, h]；view：{ fit, zoom, x, y }
export function drawScreen(g, rect, radius, img, view, gloss) {
  const v = typeof view === 'string' ? { fit: view, zoom: 1, x: 0, y: 0 } : view;
  const [x, y, w, h] = rect;
  g.save();
  rr(g, x, y, w, h, radius || 0);
  g.clip();
  g.fillStyle = '#000';
  g.fillRect(x, y, w, h);
  if (img?.width) {
    const k = (v.fit === 'contain' ? Math.min(w / img.width, h / img.height) : Math.max(w / img.width, h / img.height)) * v.zoom;
    const dw = img.width * k, dh = img.height * k;
    // 比屏幕大时可以平移：x / y = -1 看左 / 上边，1 看右 / 下边
    const ox = (w - dw) / 2 - (v.x * Math.max(0, dw - w)) / 2, oy = (h - dh) / 2 - (v.y * Math.max(0, dh - h)) / 2;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, x + ox, y + oy, dw, dh);
  } else {
    g.fillStyle = '#1b1d22';
    g.fillRect(x, y, w, h);
  }
  if (gloss === 'real') {
    // 写实：玻璃上一道斜着的反光（边缘清楚），屏幕四周一圈很窄的暗边（屏幕陷在玻璃下面）
    g.beginPath();
    g.moveTo(x, y); g.lineTo(x + w * 0.58, y); g.lineTo(x + w * 0.22, y + h); g.lineTo(x, y + h);
    g.closePath();
    g.fillStyle = grad(g, x, y, x + w * 0.45, y + h * 0.7, [[0, 'rgba(255,255,255,0.17)'], [0.6, 'rgba(255,255,255,0.05)'], [1, 'rgba(255,255,255,0.02)']]);
    g.fill();
    rr(g, x, y, w, h, radius || 0);
    g.lineWidth = Math.max(3, Math.min(w, h) * 0.008);
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.stroke();
  } else if (gloss) {
    g.fillStyle = grad(g, x, y, x + w * 0.6, y + h, [[0, 'rgba(255,255,255,0.08)'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect(x, y, w, h);
  }
  g.restore();
}
const glossOf = o => (o.real ? 'real' : true);

/* ---------------- 写实风格的材质 ---------------- */

// 拉丝纹：一条条很淡的横线（固定的伪随机，每次画出来都一样）
let brushed = null;
function brushPattern(g) {
  if (!brushed) {
    brushed = new OffscreenCanvas(64, 256);
    const x = brushed.getContext('2d');
    let seed = 20240611;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let y = 0; y < 256; y++) {
      const v = rnd() - 0.5;
      x.fillStyle = `rgba(${v > 0 ? '255,255,255' : '0,0,0'},${(Math.abs(v) * 0.1).toFixed(3)})`;
      x.fillRect(0, y, 64, 1);
    }
  }
  return g.createPattern(brushed, 'repeat');
}
// 金属面：斜向的明暗过渡 + 拉丝纹 + 一圈倒角高光（左上亮、右下暗）
function metalReal(g, w, h, r, color, k = 1) {
  rr(g, 0, 0, w, h, r);
  g.fillStyle = grad(g, 0, 0, w, h, [[0, tone(color, k * 1.14)], [0.3, tone(color, k)], [0.68, tone(color, k * 0.9)], [1, tone(color, k * 1.03)]]);
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = brushPattern(g);
  g.fillRect(0, 0, w, h);
  g.restore();
  bevel(g, 0, 0, w, h, r);
}
// 倒角：外形内侧描一圈渐变的细线
function bevel(g, x, y, w, h, r, width = 2.4) {
  const inset = width / 2;
  const rs = (Array.isArray(r) ? r : [r, r, r, r]).map(v => Math.max(0, (v || 0) - inset));
  rr(g, x + inset, y + inset, w - width, h - width, rs);
  g.lineWidth = width;
  g.strokeStyle = grad(g, x, y, x + w, y + h, [[0, 'rgba(255,255,255,0.5)'], [0.5, 'rgba(255,255,255,0.08)'], [1, 'rgba(0,0,0,0.28)']]);
  g.stroke();
}
// 玻璃边框（黑 / 白）：很淡的上下过渡，贴着机身的一圈细亮线
function glassReal(g, x, y, w, h, r, color) {
  rr(g, x, y, w, h, r);
  const dark = color === BLACK;
  g.fillStyle = grad(g, x, y, x, y + h, dark ? ['#16171a', '#050506', '#0c0d0f'] : [tone(color, 1.02), tone(color, 0.97)]);
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = dark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.1)';
  g.stroke();
}

// 金属面上一层很淡的斜向光泽
function sheen(g, w, h, r) {
  rr(g, 0, 0, w, h, r);
  g.fillStyle = grad(g, 0, 0, w, h, [[0, 'rgba(255,255,255,0.10)'], [0.45, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,0.07)']]);
  g.fill();
}
// 纯色的金属面（背面、底座的上面等）
const metal = (k = 1) => (g, { f, w, h, r, real }) => {
  if (real) { metalReal(g, w, h, r, f.body, k); return; }
  rr(g, 0, 0, w, h, r);
  g.fillStyle = tone(f.body, k);
  g.fill();
  sheen(g, w, h, r);
};
// 圆管 / 圆杆：上亮下暗
const tube = (g, { f, w, h, r, real }) => {
  rr(g, 0, 0, w, h, r);
  // 写实：圆柱的高光带更窄更亮，下缘有一点反光
  g.fillStyle = real ? grad(g, 0, 0, 0, h, [[0, f.body], [0.18, tone(f.hi, 1.2)], [0.42, f.body], [0.82, f.lo], [1, tone(f.lo, 1.25)]])
    : grad(g, 0, 0, 0, h, [[0, f.hi], [0.35, f.body], [1, f.lo]]);
  g.fill();
};
// 摄像头镜头
function lens(g, x, y, r, f, real = false) {
  if (real) {
    // 写实：金属圈（上亮下暗）→ 黑色镜筒 → 几圈镀膜的反光 → 两个高光点
    g.beginPath(); g.arc(x, y, r + 6, 0, Math.PI * 2);
    g.fillStyle = grad(g, x, y - r - 6, x, y + r + 6, [tone(f.body, 1.25), tone(f.body, 0.62)]);
    g.fill();
    dot(g, x, y, r + 1.5, '#050506');
    const glass = g.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.05, x, y, r);
    glass.addColorStop(0, '#3b4a78'); glass.addColorStop(0.35, '#131a30'); glass.addColorStop(0.7, '#07080c'); glass.addColorStop(1, '#1a1c22');
    dot(g, x, y, r, glass);
    g.lineWidth = 1.2;
    for (const [k, c] of [[0.78, 'rgba(120,150,255,0.28)'], [0.56, 'rgba(180,120,255,0.22)'], [0.34, 'rgba(90,200,255,0.25)']]) {
      g.beginPath(); g.arc(x, y, r * k, 0, Math.PI * 2); g.strokeStyle = c; g.stroke();
    }
    dot(g, x - r * 0.3, y - r * 0.32, r * 0.13, 'rgba(255,255,255,0.75)');
    dot(g, x + r * 0.26, y + r * 0.3, r * 0.06, 'rgba(255,255,255,0.35)');
    return;
  }
  dot(g, x, y, r + 5, tone(f.body, 0.8));
  dot(g, x, y, r, '#0b0c0f');
  dot(g, x, y, r * 0.55, '#171a20');
  dot(g, x - r * 0.24, y - r * 0.24, r * 0.16, 'rgba(130,160,230,0.6)');
}

/* ---------------- 各个面的贴图 ---------------- */

// 笔记本屏幕盖（840 × 540）
function paintLid(g, o) {
  const { f, img, view, real } = o;
  if (real) {
    metalReal(g, 840, 540, [22, 22, 8, 8], f.body);
    glassReal(g, 3, 3, 834, 534, [19.5, 19.5, 6, 6], BLACK);
  } else {
    rr(g, 0, 0, 840, 540, [22, 22, 8, 8]);
    g.fillStyle = f.body;
    g.fill();
    rr(g, 3, 3, 834, 534, [19.5, 19.5, 6, 6]);
    g.fillStyle = BLACK;
    g.fill();
  }
  drawScreen(g, [26, 26, 788, 474], DEVICES.laptop.radius, img, view, glossOf(o));
  dot(g, 420, 14, 3.4, '#16181c');
  dot(g, 420, 14, 1.3, '#2a3454');
  if (real) dot(g, 419.4, 13.4, 0.5, 'rgba(255,255,255,0.7)');
}

// 笔记本键盘面（840 × 560，上边是转轴一侧）
function paintDeck(g, { f, w: W, h: D, r, real }) {
  if (real) metalReal(g, W, D, r, f.body);
  else {
    rr(g, 0, 0, W, D, r);
    g.fillStyle = grad(g, 0, 0, 0, D, [tone(f.body, 0.95), tone(f.body, 1.05)]);
    g.fill();
  }
  // 转轴
  rr(g, 64, 0, W - 128, 12, [0, 0, 6, 6]);
  g.fillStyle = f.lo;
  g.fill();
  // 键盘凹槽：功能键一行（矮）+ 五行
  const x0 = 46, kbW = W - 92, y0 = 30, pad = 7, gap = 5, kh = 38, fh = 20;
  const kw = (kbW - pad * 2 - gap * 13) / 14;
  const wellH = pad * 2 + fh + 5 * (kh + gap);
  rr(g, x0, y0, kbW, wellH, 10);
  g.fillStyle = f.well;
  g.fill();
  if (real) {
    // 凹槽的边：上沿暗、下沿亮（陷下去）
    rr(g, x0, y0, kbW, wellH, 10);
    g.lineWidth = 2;
    g.strokeStyle = grad(g, 0, y0, 0, y0 + wellH, ['rgba(0,0,0,0.45)', 'rgba(255,255,255,0.18)']);
    g.stroke();
  }
  g.fillStyle = f.keys;
  const ones = n => Array(n).fill(1);
  const rows = [ones(14), [...ones(12), 2], [1.5, ...ones(11), 1.5], [1.75, ...ones(10), 2.25], [2.25, ...ones(10), 1.75], [1, 1, 1, 1.25, 5.5, 1.25, 1, 1, 1]];
  rows.forEach((units, i) => {
    const h = i ? kh : fh, y = y0 + pad + (i ? fh + gap + (i - 1) * (kh + gap) : 0);
    let x = x0 + pad;
    for (const u of units) {
      const kwid = u * kw + (u - 1) * gap;
      rr(g, x, y, kwid, h, 5);
      g.fill();
      if (real) {
        // 键帽：顶上一道亮边、底下一道暗边，中间一个小小的字符（远看像印了字）
        g.fillStyle = 'rgba(255,255,255,0.13)';
        g.fillRect(x + 3, y + 0.8, kwid - 6, 1.4);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x + 3, y + h - 1.6, kwid - 6, 1.2);
        if (i && u < 5) {
          g.fillStyle = f.keys === '#ffffff' ? 'rgba(0,0,0,0.42)' : 'rgba(255,255,255,0.5)';
          rr(g, x + kwid / 2 - 3.2, y + h / 2 - 4, 6.4, 8, 1.6);
          g.fill();
        }
        g.fillStyle = f.keys;
      }
      x += kwid + gap;
    }
  });
  // 扬声器孔
  g.fillStyle = 'rgba(0,0,0,0.26)';
  for (const sx of [13, W - 13 - 19.5]) {
    for (let c = 0; c < 4; c++) for (let rw = 0; rw < 36; rw++) { g.beginPath(); g.arc(sx + c * 6.5, y0 + 10 + rw * 6.5, 1.5, 0, Math.PI * 2); g.fill(); }
  }
  // 触控板
  const tw = 330, ty = y0 + wellH + 22, th = D - ty - 30;
  rr(g, (W - tw) / 2, ty, tw, th, 14);
  g.fillStyle = 'rgba(0,0,0,0.045)';
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.16)';
  g.lineWidth = 1.6;
  g.stroke();
  if (real) {
    // 触控板是玻璃的：一道很淡的斜反光
    g.save();
    g.clip();
    g.fillStyle = grad(g, (W - tw) / 2, ty, (W - tw) / 2 + tw * 0.7, ty + th, [[0, 'rgba(255,255,255,0.14)'], [0.5, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,0)']]);
    g.fillRect((W - tw) / 2, ty, tw, th);
    g.restore();
  }
  // 开盖凹槽
  rr(g, W / 2 - 70, D - 9, 140, 9, [8, 8, 0, 0]);
  g.fillStyle = 'rgba(0,0,0,0.16)';
  g.fill();
}

// 笔记本底面：四个脚垫
function paintLaptopBottom(g, o) {
  metal(0.9)(g, o);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  for (const [x, y] of [[70, 50], [o.w - 130, 50], [70, o.h - 68], [o.w - 130, o.h - 68]]) { rr(g, x, y, 60, 18, 9); g.fill(); }
}

// 笔记本正面图里的底座（1000 × 24）
function paintBaseBar(g, { f, w, h, r, real }) {
  rr(g, 0, 0, w, h, r);
  g.fillStyle = real ? grad(g, 0, 0, 0, h, [[0, tone(f.hi, 1.25)], [0.12, f.hi], [0.4, f.body], [0.85, f.lo], [1, tone(f.lo, 1.3)]])
    : grad(g, 0, 0, 0, h, [[0, f.hi], [0.3, f.body], [1, f.lo]]);
  g.fill();
  rr(g, w / 2 - 72, 0, 144, 9, [0, 0, 8, 8]);
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.fill();
}

// 显示器面板（1000 × 578）
function paintPanel(g, o) {
  const { f, img, view, real } = o;
  if (real) {
    metalReal(g, 1000, 578, 18, f.body);
    glassReal(g, 2.5, 2.5, 995, 573, 16, f.bezel);
  } else {
    rr(g, 0, 0, 1000, 578, 18);
    g.fillStyle = f.body;
    g.fill();
    rr(g, 2.5, 2.5, 995, 573, 16);
    g.fillStyle = f.bezel;
    g.fill();
  }
  drawScreen(g, DEVICES.monitor.screen, DEVICES.monitor.radius, img, view, glossOf(o));
}

// 显示器支架：面板下面有一段面板的影子
function paintNeck(g, o) {
  metal(1)(g, o);
  rr(g, 0, 0, o.w, o.h, o.r);
  g.fillStyle = grad(g, 0, 270, 0, 340, ['rgba(0,0,0,0.28)', 'rgba(0,0,0,0)']);
  g.fill();
}

// 平板（1000 × 716）
function paintTablet(g, o) {
  const { f, img, view, real } = o;
  if (real) {
    metalReal(g, 1000, 716, 56, f.body);
    glassReal(g, 4, 4, 992, 708, 52, f.bezel);
  } else {
    rr(g, 0, 0, 1000, 716, 56);
    g.fillStyle = f.body;
    g.fill();
    rr(g, 4, 4, 992, 708, 52);
    g.fillStyle = f.bezel;
    g.fill();
  }
  drawScreen(g, DEVICES.tablet.screen, DEVICES.tablet.radius, img, view, glossOf(o));
  dot(g, 500, 18, 3.6, f.bezel === BLACK ? '#1c1e23' : '#c8ccd2');
  if (real) dot(g, 499.2, 17.2, 0.7, 'rgba(255,255,255,0.6)');
}

// 平板 / 手机背面的摄像头模组
const camPlate = lenses => (g, { f, w, h, r, real }) => {
  rr(g, 0, 0, w, h, r);
  if (real) {
    // 写实：磨砂玻璃的模组，四周一圈倒角
    g.fillStyle = grad(g, 0, 0, w, h, [tone(f.body, 1.04), tone(f.body, 0.86)]);
    g.fill();
    bevel(g, 0, 0, w, h, r, 3);
  } else {
    g.fillStyle = tone(f.body, 0.93);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.14)';
    g.lineWidth = 2;
    g.stroke();
  }
  for (const [x, y, rad] of lenses) lens(g, x * w, y * h, rad, f, real);
  dot(g, w * 0.72, h * 0.22, w * 0.05, '#ebe6d2');
  if (real) {
    g.beginPath(); g.arc(w * 0.72, h * 0.22, w * 0.05, 0, Math.PI * 2);
    g.lineWidth = 1.5; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.stroke();
    dot(g, w * 0.72, h * 0.22, w * 0.022, '#fff7d6');
  }
};

// 手机（竖 / 横）：机身边框 + 玻璃 + 屏幕 + 灵动岛
function paintPhone(g, { f, img, view, id, w, h, real }) {
  const d = DEVICES[id];
  rr(g, 0, 0, w, h, 78);
  g.fillStyle = grad(g, 0, 0, w, h, [f.hi, f.body, f.lo, f.body]);
  g.fill();
  if (real) {
    // 写实：抛光的金属中框（几道明暗交替的反光）+ 黑色玻璃
    rr(g, 0, 0, w, h, 78);
    g.fillStyle = grad(g, 0, 0, w, h, [[0, tone(f.hi, 1.25)], [0.18, f.lo], [0.38, f.hi], [0.6, f.body], [0.8, tone(f.lo, 0.85)], [1, f.hi]]);
    g.fill();
    glassReal(g, 4.5, 4.5, w - 9, h - 9, 73.5, BLACK);
  } else {
    rr(g, 4.5, 4.5, w - 9, h - 9, 73.5);
    g.fillStyle = BLACK;
    g.fill();
  }
  drawScreen(g, d.screen, d.radius, img, view, real ? 'real' : true);
  const land = id === 'phoneLand';
  if (land) rr(g, 38, h / 2 - 60, 34, 120, 17); else rr(g, w / 2 - 60, 38, 120, 34, 17);
  g.fillStyle = '#000';
  g.fill();
  if (real) {
    // 灵动岛里的前置镜头
    const [lx, ly] = land ? [55, h / 2 + 38] : [w / 2 + 38, 55];
    dot(g, lx, ly, 7, '#0b0d14');
    dot(g, lx, ly, 3.4, '#1b2440');
    dot(g, lx - 1.6, ly - 1.6, 1.1, 'rgba(255,255,255,0.6)');
  }
}

// 手表表壳（360 × 400）
function paintWatch(g, { f, img, view, real }) {
  rr(g, 0, 0, 360, 400, 96);
  g.fillStyle = real ? grad(g, 0, 0, 360, 400, [[0, tone(f.hi, 1.25)], [0.2, f.body], [0.45, f.hi], [0.7, f.lo], [1, f.body]])
    : grad(g, 0, 0, 360, 400, [f.hi, f.body, f.lo]);
  g.fill();
  if (real) glassReal(g, 7, 7, 346, 386, 89, BLACK);
  else {
    rr(g, 7, 7, 346, 386, 89);
    g.fillStyle = BLACK;
    g.fill();
  }
  drawScreen(g, [34, 34, 292, 332], DEVICES.watch.radius, img, view, real ? 'real' : true);
  if (real) {
    // 弧面玻璃：左上角一片柔和的高光
    const glow = g.createRadialGradient(90, 70, 10, 90, 70, 230);
    glow.addColorStop(0, 'rgba(255,255,255,0.2)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
    rr(g, 7, 7, 346, 386, 89);
    g.fillStyle = glow;
    g.fill();
  }
}

// 手表背面：传感器
function paintWatchBack(g, o) {
  metal(0.96)(g, o);
  dot(g, 180, 200, 116, tone(o.f.body, 0.82));
  dot(g, 180, 200, 104, '#0d0e11');
  for (const [x, y] of [[150, 170], [210, 170], [150, 230], [210, 230]]) dot(g, x, y, 15, '#1d2128');
}

// 表带：两侧稍暗（弧面），靠近表壳的一端有表壳的影子（near：'top' | 'bottom'；'in' = 插在表壳里的一段，整段在影子里）
// k：这一段的明暗（表带往后弯，越靠外越暗一点）；near 为 'mid' 时没有表壳的影子
const band = (near, k = 1) => (g, { f, w, h, r, real }) => {
  rr(g, 0, 0, w, h, r);
  g.fillStyle = tone(f.band, k);
  g.fill();
  g.fillStyle = grad(g, 0, 0, w, 0, [[0, 'rgba(0,0,0,0.2)'], [0.16, 'rgba(0,0,0,0)'], [0.84, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.2)']]);
  g.fill();
  if (near !== 'mid') {
    g.fillStyle = near === 'in' ? 'rgba(0,0,0,0.3)' : near === 'bottom' ? grad(g, 0, h - 90, 0, h, ['rgba(0,0,0,0)', 'rgba(0,0,0,0.3)']) : grad(g, 0, 0, 0, 90, ['rgba(0,0,0,0.3)', 'rgba(0,0,0,0)']);
    g.fill();
  }
  if (real && near !== 'in') {
    // 写实：氟橡胶表带——中间一道柔和的高光，两边各一条细细的压线
    g.fillStyle = grad(g, 0, 0, w, 0, [[0.3, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0.12)'], [0.7, 'rgba(255,255,255,0)']]);
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.16)';
    g.lineWidth = 1.5;
    for (const x of [14, w - 14]) { g.beginPath(); g.moveTo(x, near === 'bottom' ? 30 : 0); g.lineTo(x, near === 'bottom' ? h : h - 30); g.stroke(); }
  }
};

// 投影幕的幕布（940 × 556）：白边 + 画面
function paintSheet(g, { img, view, w, h, real }) {
  g.fillStyle = '#f6f6f3';
  g.fillRect(0, 0, w, h);
  if (real) {
    // 写实：幕布有一点布纹，四周略暗
    g.fillStyle = brushPattern(g);
    g.fillRect(0, 0, w, h);
    const vig = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.62);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.1)');
    g.fillStyle = vig;
    g.fillRect(0, 0, w, h);
  }
  g.fillStyle = grad(g, 0, 0, 0, 46, ['rgba(0,0,0,0.14)', 'rgba(0,0,0,0)']);
  g.fillRect(0, 0, w, 46);
  drawScreen(g, [24, 30, 892, 502], 0, img, view, false);
}

// 投影幕顶部的卷轴盒：两端有端盖
function paintCase(g, o) {
  tube(g, o);
  g.fillStyle = 'rgba(0,0,0,0.22)';
  rr(g, 0, 0, 30, o.h, [o.h / 2, 0, 0, o.h / 2]);
  g.fill();
  rr(g, o.w - 30, 0, 30, o.h, [0, o.h / 2, o.h / 2, 0]);
  g.fill();
}

/* ---------------- 模型 ---------------- */

const X = [1, 0, 0], Y = [0, 1, 0], BACK = [0, 0, 1], FRONT = [0, 0, -1], LEFT = [-1, 0, 0], UP = [0, -1, 0];
// 朝前的板（x, y, z = 正面左上角）
const facing = (key, x, y, z, w, h, o) => ({ key, O: [x, y, z], U: X, V: Y, w, h, ...o });
// 朝上的板（水平）：x, y, z 为后左角，h 为向观众方向的进深
const lying = (key, x, y, z, w, h, o) => ({ key, O: [x, y, z], U: X, V: FRONT, w, h, ...o });
// 朝右 / 朝左 / 朝后的板（w 为前后方向 / 左右方向的宽度）
const rightward = (key, x, y, z, w, h, o) => ({ key, O: [x, y, z], U: BACK, V: Y, w, h, ...o });
const leftward = (key, x, y, z, w, h, o) => ({ key, O: [x, y, z], U: FRONT, V: Y, w, h, ...o });
const backward = (key, x, y, z, w, h, o) => ({ key, O: [x, y, z], U: LEFT, V: Y, w, h, ...o });

const LID_TILT = (17 * Math.PI) / 180; // 屏幕盖向后倾斜（打开约 107°）

function laptop(f, flat) {
  const lid = { w: 840, h: 540, r: [22, 22, 8, 8], t: 12, front: { paint: paintLid, screen: true }, back: { paint: metal(1), lit: true }, edge: true };
  // 正面图：屏幕盖立着，下面一条底座（比屏幕盖宽，像从正前方看到的样子）
  if (flat) {
    return {
      center: [500, 281, 0],
      tree: [
        { key: 'lid', O: [80, 0, 0], U: X, V: Y, ...lid },
        facing('bar', 0, 538, -20, 1000, 24, { r: [3, 3, 22, 22], t: 12, front: { paint: paintBaseBar } }),
      ],
    };
  }
  const c = Math.cos(LID_TILT), s = Math.sin(LID_TILT), hy = 540; // hy：转轴的高度
  return {
    center: [500, 330, -200],
    ground: [[80, 560, 0], [920, 560, 0], [920, 560, -560], [80, 560, -560]],
    tree: {
      plane: [[0, 0, 0], FRONT],
      front: [lying('base', 80, hy, 0, 840, 560, { r: [10, 10, 26, 26], t: 20, front: { paint: paintDeck, lit: true }, back: { paint: paintLaptopBottom, lit: true }, edge: true })],
      back: [{ key: 'lid', O: [80, hy - 540 * c, 540 * s], U: X, V: [0, c, -s], ...lid }],
    },
  };
}

function monitor() {
  return {
    center: [500, 382, 60],
    ground: [[330, 764, 220], [670, 764, 220], [670, 764, -60], [330, 764, -60]],
    tree: {
      plane: [[0, 752, 0], UP],
      front: {
        plane: [[0, 0, 30], FRONT],
        front: [facing('panel', 0, 0, 0, 1000, 578, { r: 18, t: 30, front: { paint: paintPanel, screen: true }, back: { paint: metal(1), lit: true }, edge: true })],
        back: {
          plane: [[0, 0, 70], FRONT],
          front: [facing('joint', 440, 330, 30, 120, 120, { r: 24, t: 40 })],
          back: [facing('neck', 410, 300, 70, 180, 452, { r: [14, 14, 0, 0], t: 16, front: { paint: paintNeck }, back: { paint: metal(1), lit: true } })],
        },
      },
      back: [lying('foot', 330, 752, 220, 340, 280, { r: 26, t: 12, front: { paint: metal(1.02), lit: true }, back: { paint: metal(0.85) } })],
    },
  };
}

function tablet() {
  return {
    center: [500, 358, 11],
    tree: {
      plane: [[0, 0, 22], BACK],
      front: [backward('cam', 966, 34, 28, 150, 150, { r: 40, t: 7, front: { paint: camPlate([[0.34, 0.34, 26], [0.68, 0.68, 22]]), lit: true } })],
      back: [facing('body', 0, 0, 0, 1000, 716, { r: 56, t: 22, front: { paint: paintTablet, screen: true }, back: { paint: metal(1), lit: true }, edge: true })],
    },
  };
}

// 竖放的手机转成横放：顶部（灵动岛）转到左边
const turn = {
  p: ([x, y, z]) => [y, 480 - x, z],
  v: ([x, y, z]) => [y, -x, z],
  slab: s => ({ ...s, O: turn.p(s.O), U: turn.v(s.U), V: turn.v(s.V) }),
  plane: ([p, n]) => [turn.p(p), turn.v(n)],
};
const same = { slab: s => s, plane: p => p };

function phone(id) {
  const d = DEVICES[id];
  const m = id === 'phoneLand' ? turn : same;
  const button = (make, key, x, y, z, h) => m.slab(make(key, x, y, z, 16, h, { r: 8, t: 8 }));
  return {
    center: [d.w / 2, d.h / 2, 20],
    tree: {
      plane: m.plane([[0, 0, 40], BACK]),
      front: [m.slab(backward('cam', 456, 24, 47, 200, 200, { r: 56, t: 8, front: { paint: camPlate([[0.3, 0.3, 34], [0.3, 0.7, 34], [0.7, 0.5, 34]]), lit: true } }))],
      back: {
        plane: m.plane([[480, 0, 0], X]),
        front: [button(rightward, 'power', 485, 250, 12, 120)],
        back: {
          plane: m.plane([[0, 0, 0], LEFT]),
          front: [button(leftward, 'action', -5, 170, 28, 36), button(leftward, 'volUp', -5, 240, 28, 70), button(leftward, 'volDown', -5, 326, 28, 70)],
          back: [facing('body', 0, 0, 0, d.w, d.h, { r: 78, t: 40, front: { paint: paintPhone, screen: true }, back: { paint: metal(1), lit: true }, edge: true })],
        },
      },
    },
  };
}

function watch(f) {
  // 表带：插进表壳里的一小段（总在表壳后面，只从圆角的缝里露出来）+ 露在外面、向后弯下去的三段。
  // 每段比上一段多弯一些；正面看过去三段的高度加起来还是 180（和正面图的尺寸一致）
  const inner = (key, y) => facing(key, 104, y, 44, 232, 70, { r: 0, t: 22, side: f.band, front: { paint: band('in') }, back: { paint: band('in') } });
  const BEND = [[70, 8, 1], [66, 24, 0.93], [70, 44, 0.84]]; // [长度, 向后弯的角度, 明暗]
  // dir：1 = 下面的表带（从表壳往下），-1 = 上面的。返回按先后顺序排好的结构（见文件开头的 tree）
  function strap(name, dir) {
    let p = [104, dir > 0 ? 580 : 180, 44];
    const segs = BEND.map(([len, deg, k], i) => {
      const a = (deg * Math.PI) / 180, d = [0, dir * Math.cos(a), Math.sin(a)]; // 这一段往外走的方向
      const start = p, end = [p[0], p[1] + d[1] * len, p[2] + d[2] * len];
      p = end;
      const last = i === BEND.length - 1;
      const paint = band(i === 0 ? (dir > 0 ? 'top' : 'bottom') : 'mid', k);
      return {
        joint: [start, d],
        slab: {
          key: `${name}${i}`, w: 232, h: len, t: 22, side: f.band, front: { paint }, back: { paint },
          // 正面的左上角：下面的表带是靠表壳的一端，上面的表带是外面的一端
          O: dir > 0 ? start : end, U: X, V: dir > 0 ? d : d.map(v => -v),
          r: last ? (dir > 0 ? [0, 0, 30, 30] : [30, 30, 0, 0]) : 0,
        },
      };
    });
    // 相邻两段以接缝处的平面分开：镜头在外面那一侧时先画里面的一段，反之先画外面的
    const chain = k => (k === segs.length - 1 ? [segs[k].slab] : { plane: segs[k + 1].joint, front: chain(k + 1), back: [segs[k].slab] });
    return chain(0);
  }
  return {
    center: [220, 380, 35],
    tree: {
      plane: [[400, 0, 0], X],
      front: [
        rightward('crown', 420, 292, 9, 52, 52, { r: 26, t: 24, front: { color: f.hi } }),
        rightward('button', 407, 372, 22, 26, 70, { r: 13, t: 11 }),
      ],
      back: {
        plane: [[0, 180, 0], UP],
        front: strap('strapTop', -1),
        back: {
          plane: [[0, 580, 0], Y],
          front: strap('strapBottom', 1),
          back: [
            inner('strapTopIn', 180),
            inner('strapBottomIn', 510),
            facing('case', 40, 180, 0, 360, 400, { r: 96, t: 70, front: { paint: paintWatch, screen: true }, back: { paint: paintWatchBack, lit: true }, edge: true }),
          ],
        },
      },
    },
  };
}

function projector(f) {
  const line = (a, b) => ({ line: true, a, b, width: 10, color: f.pole });
  const top = [500, 700, 34];
  return {
    center: [500, 383, 0],
    ground: [[500, 766, 170], [628, 766, -50], [372, 766, -50]],
    tree: {
      plane: [[0, 0, 20], FRONT],
      front: [
        facing('sheet', 30, 30, 4, 940, 556, { r: 0, t: 4, side: '#d9d9d5', front: { paint: paintSheet, screen: true }, back: { color: '#2b2c30' } }),
        facing('bar', 24, 582, -3, 952, 14, { r: 7, t: 14, front: { paint: tube }, back: { paint: tube } }),
        facing('case', 0, 0, -14, 1000, 42, { r: 21, t: 40, front: { paint: paintCase }, back: { paint: paintCase } }),
      ],
      back: [line([500, 36, 34], top), line(top, [392, 766, -36]), line(top, [608, 766, -36]), line(top, [500, 766, 150])],
    },
  };
}

// (外观配色, 是否正面图) → { center: 旋转中心, tree: 先后顺序, ground: 脚印 }
export const MODELS = {
  laptop,
  monitor,
  tablet,
  projector,
  phone: () => phone('phone'),
  phoneLand: () => phone('phoneLand'),
  watch,
};
