import { buildScene, textureNeeds } from '../render/scene.js';
import { Renderer } from '../render/renderer.js';
import { paintBackground } from '../render/background.js';
import { decodeImage, resizeBitmap } from '../slides/images.js';
import { exportSize } from './schema.js';
import { nextFrame } from '../core/utils.js';

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

// 只放大 NDC 中 [l,r]×[b,t] 这一块，用于分块渲染
function tileMatrix(x0, y0, tw, th, W, H) {
  const l = (x0 / W) * 2 - 1, r = ((x0 + tw) / W) * 2 - 1;
  const t = 1 - (y0 / H) * 2, b = 1 - ((y0 + th) / H) * 2;
  const sx = 2 / (r - l), sy = 2 / (t - b);
  return new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, (-sx * (l + r)) / 2, (-sy * (t + b)) / 2, 0, 1]);
}

/**
 * 离屏渲染出高清图片。
 * @param input  与 buildScene 相同的参数
 * @returns { blob, width, height }
 */
export async function renderToBlob(input, { longSide, format = 'png', quality = 0.92, onProgress } = {}) {
  const scene = buildScene(input);
  const { width: pxW, height: pxH } = exportSize(scene, longSide);

  const out = document.createElement('canvas');
  out.width = pxW;
  out.height = pxH;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('无法创建画布，请降低导出尺寸');
  if (scene.style.bgType === 'transparent') {
    if (format === 'jpg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, pxW, pxH); } // JPG 不支持透明
  } else {
    const bgImage = await loadBackground(input.background, Math.max(pxW, pxH));
    paintBackground(ctx, pxW, pxH, scene.style, { image: bgImage, unit: pxH / scene.H });
    if (bgImage && bgImage !== input.background?.source && typeof bgImage.close === 'function') bgImage.close();
  }

  const glCanvas = document.createElement('canvas');
  const renderer = new Renderer(glCanvas, { preserveDrawingBuffer: true });
  try {
    const needs = textureNeeds(scene, pxW, pxH);
    const slides = [...new Map(scene.items.map(it => [it.slide.id, it.slide])).values()]
      .filter(s => needs.has(s.id));
    let done = 0;
    for (const slide of slides) {
      const target = Math.max(256, Math.min(renderer.maxTextureSize, Math.ceil(needs.get(slide.id))));
      const src = await loadExportSource(slide, target);
      renderer.setTexture(slide.id, src);
      if (src !== slide.source && typeof src.close === 'function') src.close();
      onProgress?.((0.7 * ++done) / slides.length);
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
        await nextFrame();
      }
    }
  } finally {
    renderer.dispose();
  }

  const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise(resolve => out.toBlob(resolve, mime, quality));
  if (!blob) throw new Error('编码失败，尺寸可能超出浏览器限制，请降低导出尺寸');
  onProgress?.(1);
  return { blob, width: pxW, height: pxH };
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
