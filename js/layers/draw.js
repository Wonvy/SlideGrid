import { fontOf, textLines, lineWidths, pathOf, center, anchorCount } from './model.js';
import { drawDevice } from './devices.js';

/**
 * 把图层画到 2D 画布上。调用前 ctx 的变换应已设为「画板坐标 → 像素」（工作区与导出共用，所见即所得）。
 * skip：正在编辑的文字图层（由编辑框显示）不画
 * assets：图片素材 { [id]: { preview } }（工作区用预览图，导出时传入按输出尺寸读取的原图）
 * slideImage(n)：画板第 n 张幻灯片（从 1 开始）的图片，设备样机的屏幕用
 */
export function drawLayers(ctx, layers, { skip = null, assets = {}, slideImage = () => null } = {}) {
  for (const l of layers || []) {
    if (l.hidden || l.id === skip) continue;
    ctx.save();
    ctx.globalAlpha *= l.opacity ?? 1;
    if (l.type !== 'path' && l.rotation) {
      const c = center(l);
      ctx.translate(c.x, c.y);
      ctx.rotate((l.rotation * Math.PI) / 180);
      ctx.translate(-c.x, -c.y);
    }
    if (l.type === 'text') drawText(ctx, l);
    else if (l.type === 'image') drawImage(ctx, l, assets[l.assetId]);
    else if (l.type === 'device') drawDevice(ctx, l, l.imageId ? assets[l.imageId]?.preview : slideImage(l.slide || 1), assets[l.frameAssetId]?.preview);
    else drawShape(ctx, l);
    ctx.restore();
  }
}

const rgba = (hex, a) => {
  const h = (hex || '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a ?? 1})`;
};

// 填充：纯色或线性渐变（两端各自的颜色和不透明度，可做透明渐变）。渐变按图层自身的框计算（随图层旋转）
function fillStyle(ctx, l) {
  if (l.fillType === 'none') return null;
  if (l.fillType !== 'linear') return rgba(l.fill, l.fillAlpha);
  const a = ((l.fillAngle ?? 180) * Math.PI) / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const half = (Math.abs(l.w * dx) + Math.abs(l.h * dy)) / 2; // 与 CSS 渐变线长度一致
  const c = center(l);
  const g = ctx.createLinearGradient(c.x - dx * half, c.y - dy * half, c.x + dx * half, c.y + dy * half);
  g.addColorStop(0, rgba(l.fill, l.fillAlpha));
  g.addColorStop(1, rgba(l.fill2, l.fill2Alpha));
  return g;
}

function drawShape(ctx, l) {
  let path;
  if (l.type === 'path') {
    if (!anchorCount(l)) return;
    path = pathOf(l);
  } else {
    path = new Path2D();
    if (l.type === 'ellipse') path.ellipse(l.x + l.w / 2, l.y + l.h / 2, Math.abs(l.w / 2), Math.abs(l.h / 2), 0, 0, Math.PI * 2);
    else if (l.radius > 0) path.roundRect(l.x, l.y, l.w, l.h, Math.min(l.radius, Math.abs(l.w) / 2, Math.abs(l.h) / 2));
    else path.rect(l.x, l.y, l.w, l.h);
  }
  const fill = fillStyle(ctx, l);
  if (fill) { ctx.fillStyle = fill; ctx.fill(path, l.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'); }
  if (l.strokeWidth > 0) {
    ctx.strokeStyle = l.stroke;
    ctx.lineWidth = l.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke(path);
  }
}

function drawImage(ctx, l, asset) {
  const img = asset?.preview;
  if (!img) {
    // 图片还没读取（或丢失）：画一个占位框
    ctx.fillStyle = 'rgba(124, 140, 255, .15)';
    ctx.fillRect(l.x, l.y, l.w, l.h);
    return;
  }
  if (l.radius > 0) {
    const p = new Path2D();
    p.roundRect(l.x, l.y, l.w, l.h, Math.min(l.radius, Math.abs(l.w) / 2, Math.abs(l.h) / 2));
    ctx.clip(p);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, l.x, l.y, l.w, l.h);
}

function drawText(ctx, l) {
  ctx.font = fontOf(l);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${l.letterSpacing || 0}px`;
  ctx.fillStyle = l.color;
  ctx.textBaseline = 'middle';
  const lh = l.fontSize * l.lineHeight;
  const widths = lineWidths(l);
  textLines(l).forEach((line, i) => {
    const off = l.align === 'center' ? (l.w - widths[i]) / 2 : l.align === 'right' ? l.w - widths[i] : 0;
    ctx.fillText(line, l.x + off, l.y + lh * (i + 0.5));
  });
}
