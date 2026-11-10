// 画布比例
export const ASPECTS = [
  { id: '16:9', value: 16 / 9 },
  { id: '4:3', value: 4 / 3 },
  { id: '3:2', value: 3 / 2 },
  { id: '1:1', value: 1 },
  { id: '4:5', value: 4 / 5 },
  { id: '9:16', value: 9 / 16 },
  { id: '21:9', value: 21 / 9 },
  { id: 'long', label: '长图', value: null }, // 宽度固定，高度随内容
];

export const isLongAspect = id => id === 'long';

// 自定义比例写作 "宽:高"（如 "5:4"、"2.35:1"）
const RATIO_RE = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;
export function parseRatio(id) {
  const m = RATIO_RE.exec(String(id || ''));
  if (!m) return null;
  const v = Number(m[1]) / Number(m[2]);
  return v >= 0.1 && v <= 10 ? v : null;
}
// 精确像素尺寸写作 "宽x高"（如 "1920x1080"）：画板按这个比例，导出「画板尺寸」时正好是这么多像素
const PX_RE = /^(\d{2,5})x(\d{2,5})$/;
export function parsePixels(id) {
  const m = PX_RE.exec(String(id || ''));
  if (!m) return null;
  const w = Number(m[1]), h = Number(m[2]);
  return w >= 16 && h >= 16 && w <= 16000 && h <= 16000 && w / h >= 0.1 && w / h <= 10 ? { w, h } : null;
}
// 常用的像素尺寸（画布比例菜单里的预设）
export const PIXEL_PRESETS = [
  { id: '1920x1080', note: 'FHD 16:9' },
  { id: '2560x1440', note: '2K 16:9' },
  { id: '3840x2160', note: '4K 16:9' },
  { id: '1080x1080', note: '方形' },
  { id: '1080x1350', note: '竖版 4:5' },
  { id: '1242x1660', note: '小红书 3:4' },
  { id: '1080x1920', note: '竖屏 9:16' },
  { id: '900x383', note: '公众号封面' },
];
export const isValidAspect = id => id === 'long' || ASPECTS.some(a => a.id === id) || parseRatio(id) != null || parsePixels(id) != null;
export const aspectValue = id => ASPECTS.find(a => a.id === id && a.value)?.value ?? parseRatio(id)
  ?? (p => (p ? p.w / p.h : null))(parsePixels(id)) ?? ASPECTS[0].value;
export const aspectLabel = id => ASPECTS.find(a => a.id === id)?.label || (p => (p ? `${p.w} × ${p.h}` : id))(parsePixels(id));

// 预览纹理的最长边（导出时会重新读取原图）
export const PREVIEW_MAX_SIDE = 1600;

// yaw/pitch：旋转（度）；zoom：缩放；panX/panY：平移（世界单位）
export const DEFAULT_CAMERA = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0 };
