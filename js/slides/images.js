// 图片解码与缩放。统一产出预乘 alpha 的 ImageBitmap，供 WebGL 直接上传。

const DECODE_OPTS = { premultiplyAlpha: 'premultiply', imageOrientation: 'from-image' };

export async function decodeImage(blob) {
  try {
    return await createImageBitmap(blob, DECODE_OPTS);
  } catch {
    // 兜底：部分格式（如 SVG）createImageBitmap 无法直接解码
    return decodeViaElement(blob);
  }
}

async function decodeViaElement(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let w = img.naturalWidth || 1600, h = img.naturalHeight || 900;
    const isSvg = blob.type === 'image/svg+xml' || /\.svg$/i.test(blob.name || '');
    if (isSvg && Math.max(w, h) < 2400) {
      const s = 2400 / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return await createImageBitmap(c, { premultiplyAlpha: 'premultiply' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 等比缩小到最长边 maxSide；不需要缩小时原样返回 src
export async function resizeBitmap(src, maxSide) {
  const s = maxSide / Math.max(src.width, src.height);
  if (s >= 1) return src;
  const w = Math.max(1, Math.round(src.width * s));
  const h = Math.max(1, Math.round(src.height * s));
  try {
    return await createImageBitmap(src, {
      resizeWidth: w, resizeHeight: h, resizeQuality: 'high', premultiplyAlpha: 'premultiply',
    });
  } catch {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    return createImageBitmap(c, { premultiplyAlpha: 'premultiply' });
  }
}

export function makeThumb(src, width = 168) {
  const aspect = src.width / src.height;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.max(1, Math.round(width / aspect));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
