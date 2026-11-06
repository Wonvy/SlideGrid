import { DEG } from '../core/utils.js';

/**
 * 背景绘制（Canvas2D）。预览和导出共用，按像素尺寸等比计算。
 *
 * @param ctx    2D 上下文
 * @param w, h   像素尺寸
 * @param st     样式（见 style/schema.js）
 * @param image  背景图 / 幻灯片模糊用的图片（ImageBitmap 或 canvas），没有就只画底色
 * @param unit   每个世界单位对应的像素数（用于模糊半径、平铺大小）
 */
export function paintBackground(ctx, w, h, st, { image = null, unit = h / 1000 } = {}) {
  ctx.clearRect(0, 0, w, h);
  const type = st.bgType;
  if (type === 'transparent') return;

  if (type === 'image' || type === 'slide') {
    ctx.fillStyle = st.bg1 || '#000';
    ctx.fillRect(0, 0, w, h);
    if (image) {
      const fit = type === 'slide' ? 'cover' : st.bgFit || 'cover';
      withBlur(ctx, w, h, (st.bgBlur || 0) * unit, (g, blurPx) => drawImageFit(g, w, h, image, fit, (st.bgScale || 0.6) * 1000 * unit, blurPx));
    }
    if (st.bgDim > 0) {
      ctx.globalAlpha = st.bgDim;
      ctx.fillStyle = st.bgDimColor || '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
  } else {
    ctx.fillStyle = gradientFill(ctx, w, h, st);
    ctx.fillRect(0, 0, w, h);
  }

  if (st.vignette > 0) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.hypot(w, h) * 0.55);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${Math.min(0.9, st.vignette * 0.85)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

function gradientFill(ctx, w, h, st) {
  if (st.bgType === 'linear') {
    // 与 CSS 一致：0° 指向上方，180° 指向下方
    const a = (st.bgAngle ?? 180) * DEG;
    const sx = Math.sin(a), sy = -Math.cos(a);
    const r = (Math.abs(w * sx) + Math.abs(h * sy)) / 2;
    const g = ctx.createLinearGradient(w / 2 - sx * r, h / 2 - sy * r, w / 2 + sx * r, h / 2 + sy * r);
    g.addColorStop(0, st.bg1);
    g.addColorStop(1, st.bg2);
    return g;
  }
  if (st.bgType === 'radial') {
    const cx = w / 2, cy = h * 0.42;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, st.bg1);
    g.addColorStop(1, st.bg2);
    return g;
  }
  return st.bg1;
}

// tileSize：平铺时单块图片的高度（像素）
function drawImageFit(g, w, h, img, fit, tileSize, blurPx) {
  const iw = img.width, ih = img.height;
  if (fit === 'tile') {
    const th = Math.max(8, tileSize), tw = th * (iw / ih);
    const pattern = g.createPattern(img, 'repeat');
    pattern.setTransform(new DOMMatrix([tw / iw, 0, 0, th / ih, (w - tw) / 2, (h - th) / 2]));
    g.fillStyle = pattern;
    g.fillRect(-blurPx * 2, -blurPx * 2, w + blurPx * 4, h + blurPx * 4);
    return;
  }
  // 模糊时把图放大一圈，避免边缘被模糊成透明
  const m = fit === 'cover' ? blurPx * 2 : 0;
  const bw = w + m * 2, bh = h + m * 2;
  const s = fit === 'cover' ? Math.max(bw / iw, bh / ih) : Math.min(w / iw, h / ih);
  const dw = iw * s, dh = ih * s;
  g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

const supportsFilter = (() => {
  try {
    const t = document.createElement('canvas').getContext('2d');
    t.filter = 'blur(2px)';
    return t.filter === 'blur(2px)';
  } catch { return false; }
})();

// 模糊：优先用 Canvas filter；不支持时（较老的 Safari）用「缩小再放大」近似
function withBlur(ctx, w, h, blurPx, draw) {
  if (blurPx < 0.5) { draw(ctx, 0); return; }
  if (supportsFilter) {
    ctx.save();
    ctx.filter = `blur(${blurPx}px)`;
    draw(ctx, blurPx);
    ctx.restore();
    return;
  }
  const k = Math.max(1, blurPx / 2.5);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w / k));
  c.height = Math.max(1, Math.ceil(h / k));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.scale(c.width / w, c.height / h);
  draw(g, blurPx);
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, w, h);
  ctx.restore();
}
