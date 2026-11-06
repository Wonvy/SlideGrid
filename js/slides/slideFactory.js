import { decodeImage, resizeBitmap, makeThumb } from './images.js';
import { PREVIEW_MAX_SIDE } from '../config.js';

let counter = 0;

/**
 * Slide 数据结构：
 *   id, name, path
 *   source   原始 File（导出时重新解码，按需要的分辨率读取）
 *   preview  预览用 ImageBitmap（最长边 ≤ PREVIEW_MAX_SIDE）
 *   thumb    侧边栏缩略图 canvas
 *   aspect, width, height  原图尺寸
 */
const newId = () => `s${++counter}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// id 可选：从本地缓存恢复时沿用原来的 id
export async function createSlide({ file, path, id, name }) {
  const full = await decodeImage(file);
  const { width, height } = full;
  const preview = await resizeBitmap(full, PREVIEW_MAX_SIDE);
  if (preview !== full) full.close();
  return {
    id: id || newId(),
    name: name || file.name,
    path: path || file.name,
    source: file,
    preview,
    thumb: makeThumb(preview),
    aspect: width / height,
    width,
    height,
  };
}

// 并发解码（保持原有顺序），失败的文件跳过
export async function createSlides(list, onProgress) {
  const results = new Array(list.length).fill(null);
  let next = 0, done = 0;
  async function worker() {
    while (next < list.length) {
      const k = next++;
      try {
        results[k] = await createSlide(list[k]);
      } catch (err) {
        console.warn('无法读取图片：', list[k].path, err);
      }
      onProgress?.(++done, list.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker));
  return results.filter(Boolean);
}

/**
 * 背景图等素材：与幻灯片类似，但预览分辨率更高（背景铺满整个画布）。
 * { id, name, file, preview, thumb, width, height }
 */
const ASSET_PREVIEW_MAX = 2560;
export async function createAsset({ file, id, name }) {
  const full = await decodeImage(file);
  const { width, height } = full;
  const preview = await resizeBitmap(full, ASSET_PREVIEW_MAX);
  if (preview !== full) full.close();
  return {
    id: id || `a${++counter}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name || file.name,
    file,
    preview,
    thumb: makeThumb(preview, 120),
    width,
    height,
  };
}
