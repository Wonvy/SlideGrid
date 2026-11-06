import { buildScene, textureNeeds } from '../render/scene.js';
import { Renderer } from '../render/renderer.js';
import { paintBackground } from '../render/background.js';
import { decodeImage, resizeBitmap } from '../slides/images.js';
import { exportSize } from './schema.js';
import { nextFrame } from '../core/utils.js';
import { tileMatrix } from '../render/math.js';
import { drawLayers } from '../layers/draw.js';

const MAX_TILE = 2048;

// 导出时按实际需要的分辨率重新读取原图
async function loadExportSource(slide, target) {
  const src = slide.source;
  if (src instanceof Blob) {
    const full = await decodeImage(src);
    const out = await resizeBitmap(full, target);
    if (out !== full) full.close();
    return out;
  }
  return Math.max(src.width, src.height) <= target ? src : resizeBitmap(src, target);
}

// 背景图 / 幻灯片模糊背景：导出时按画布尺寸重新读取原图
async function loadBackground(bg, target) {
  if (!bg) return null;
  const src = bg.source;
  if (src instanceof Blob) {
    const full = await decodeImage(src);
    const out = await resizeBitmap(full, Math.min(8192, target));
    if (out !== full) full.close();
    return out;
  }
  return src || bg.preview || null;
}


/**
 * 图片图层用到的图片：预览时直接用内存里的预览图；正式导出按输出尺寸重新读取原图（Logo 放大导出也清晰）。
 * 返回 { [assetId]: { preview, temp } }，temp 表示用完要释放
 */
async function layerImages(input, k, preview) {
  const out = {};
  // 图片图层，以及样机的屏幕图片 / PNG 外框
  const uses = input.layers.filter(l => !l.hidden).flatMap(l => (l.type === 'image' ? [[l.assetId, l]]
    : l.type === 'device' ? [[l.imageId, l], [l.frameAssetId, l]] : []));
  for (const [id, l] of uses) {
    if (!id || out[id]) continue;
    const a = input.assets?.[id];
    if (!a) continue;
    const need = Math.ceil(Math.max(l.w, l.h) * k * 1.25);
    const pv = a.preview;
    if (preview || !a.file || (pv && Math.max(pv.width, pv.height) >= need)) { out[id] = { preview: pv, temp: false }; continue; }
    try {
      const full = await decodeImage(a.file);
      const img = await resizeBitmap(full, Math.min(8192, need));
      if (img !== full) full.close();
      out[id] = { preview: img, temp: true };
    } catch {
      out[id] = { preview: pv, temp: false };
    }
  }
  return out;
}

// 设备样机屏幕里的幻灯片：按输出尺寸读取原图（预览时直接用预览图）。返回 Map<第几张, { img, temp }>
async function deviceImages(input, k, preview) {
  const out = new Map();
  for (const l of input.layers) {
    if (l.type !== 'device' || l.hidden || l.imageId) continue;
    const n = l.slide || 1;
    const slide = input.slides?.[n - 1];
    if (!slide) continue;
    const need = Math.ceil(l.w * k * 1.1);
    if (out.has(n) && Math.max(out.get(n).img.width, out.get(n).img.height) >= need) continue;
    if (preview || !slide.source) { out.set(n, { img: slide.preview, temp: false }); continue; }
    try {
      const prev = out.get(n);
      if (prev?.temp) prev.img.close?.();
      const img = await loadExportSource(slide, Math.min(8192, Math.max(256, need)));
      out.set(n, { img, temp: img !== slide.source && img !== slide.preview });
    } catch {
      out.set(n, { img: slide.preview, temp: false });
    }
  }
  return out;
}

let sharedPreview = null;
function previewRenderer() {
  if (!sharedPreview || sharedPreview.gl.isContextLost()) {
    sharedPreview = new Renderer(document.createElement('canvas'), { preserveDrawingBuffer: true });
  }
  return sharedPreview;
}

/**
 * 离屏渲染到一张 canvas。
 * @param input  与 buildScene 相同的参数
 * @param opts   longSide：导出尺寸；fill：透明背景时的填充（'white' 或不填 = 保留透明）；
 *               preview：true 时直接用内存里的预览图（快，用于缩略图 / 导出面板预览），否则重新读取原图
 * @returns { canvas, width, height }
 */
export async function renderToCanvas(input, { longSide, fill = null, preview = false, onProgress, transparent = false } = {}) {
  const scene = buildScene(input);
  const { width: pxW, height: pxH } = exportSize(scene, longSide);

  const out = document.createElement('canvas');
  out.width = pxW;
  out.height = pxH;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('无法创建画布，请降低导出尺寸');
  // 透明：背景类型为透明，或这次输出选了「透明背景」（只去掉背景，幻灯片、投影、图层照常）
  if (transparent || scene.style.bgType === 'transparent') {
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, pxW, pxH); }
  } else {
    const bgImage = preview ? input.background?.preview || null : await loadBackground(input.background, Math.max(pxW, pxH));
    paintBackground(ctx, pxW, pxH, scene.style, { image: bgImage, unit: pxH / scene.H });
    if (!preview && bgImage && bgImage !== input.background?.source && typeof bgImage.close === 'function') bgImage.close();
  }

  // 预览共用一个渲染器（WebGL 上下文和预览纹理都留着复用）；正式导出每次新建，用完释放显存
  const renderer = preview ? previewRenderer() : new Renderer(document.createElement('canvas'), { preserveDrawingBuffer: true });
  const glCanvas = renderer.canvas;
  try {
    const slides = [...new Map(scene.items.map(it => [it.slide.id, it.slide])).values()];
    if (preview) {
      for (const slide of slides) renderer.setTexture(slide.id, slide.preview);
      renderer.prune(new Set(slides.map(sl => sl.id)));
    } else {
      const needs = textureNeeds(scene, pxW, pxH);
      const needed = slides.filter(sl => needs.has(sl.id));
      let done = 0;
      for (const slide of needed) {
        const target = Math.max(256, Math.min(renderer.maxTextureSize, Math.ceil(needs.get(slide.id))));
        const src = await loadExportSource(slide, target);
        renderer.setTexture(slide.id, src);
        if (src !== slide.source && typeof src.close === 'function') src.close();
        onProgress?.((0.7 * ++done) / needed.length);
      }
    }

    const T = Math.min(MAX_TILE, renderer.maxViewport);
    const cols = Math.ceil(pxW / T), rows = Math.ceil(pxH / T);
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const x0 = tx * T, y0 = ty * T;
        const tw = Math.min(T, pxW - x0), th = Math.min(T, pxH - y0);
        renderer.setSize(tw, th);
        renderer.render(scene, tileMatrix(x0, y0, tw, th, pxW, pxH));
        ctx.drawImage(glCanvas, x0, y0);
        onProgress?.(0.7 + (0.25 * (ty * cols + tx + 1)) / (rows * cols));
        if (!preview) await nextFrame();
      }
    }
  } finally {
    if (!preview) renderer.dispose();
  }
  // 图层（文字、形状、路径、图片）画在最上面，按画板坐标缩放到输出尺寸
  if (input.layers?.length) {
    const k = pxH / scene.H;
    const images = await layerImages(input, k, preview);
    const screens = await deviceImages(input, k, preview);
    try {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, pxW, pxH);
      ctx.clip();
      ctx.setTransform(pxW / scene.W, 0, 0, k, 0, 0);
      drawLayers(ctx, input.layers, { assets: images, slideImage: n => screens.get(n)?.img });
      ctx.restore();
    } finally {
      for (const { preview: img, temp } of Object.values(images)) if (temp) img.close?.();
      for (const { img, temp } of screens.values()) if (temp) img.close?.();
    }
  }
  return { canvas: out, width: pxW, height: pxH };
}

/** 离屏渲染出高清图片：{ blob, width, height } */
export async function renderToBlob(input, { longSide, format = 'png', quality = 0.92, onProgress, preview = false, transparent = false } = {}) {
  const { canvas, width, height } = await renderToCanvas(input, {
    longSide, preview, onProgress, transparent, fill: format === 'jpg' ? '#ffffff' : null, // JPG 不支持透明
  });
  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise(resolve => canvas.toBlob(resolve, mime, quality));
  if (!blob) throw new Error('编码失败，尺寸可能超出浏览器限制，请降低导出尺寸');
  onProgress?.(1);
  return { blob, width, height };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
