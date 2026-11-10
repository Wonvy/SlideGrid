import { clamp } from '../core/utils.js';

// 尺寸放在顶栏（复制按钮左侧），其余参数在「导出图片」的悬停面板里
export const sizeSchema = [
  {
    key: 'size', label: '尺寸', title: '导出尺寸：「画板」= 画板的像素尺寸（没设像素尺寸时按 4K 长边）；其余为长边，长图为宽度', type: 'select', default: 'board',
    options: [
      { value: 'board', label: '画板像素 · 画板' },
      { value: 'board2x', label: '画板像素 × 2 · 画板 @2x' },
      { value: 1920, label: '1920 px · FHD' },
      { value: 2560, label: '2560 px · 2K' },
      { value: 3840, label: '3840 px · 4K' },
      { value: 5120, label: '5120 px · 5K' },
      { value: 7680, label: '7680 px · 8K' },
      { value: 'custom', label: '自定义…' },
    ],
  },
  { key: 'customSize', label: '自定义', type: 'number', min: 256, max: 12000, default: 3000, wheelStep: 100, unit: 'px', show: v => v.size === 'custom' },
];

export const formatSchema = [
  {
    key: 'scope', label: '范围', type: 'select', default: 'current',
    options: [
      { value: 'current', label: '当前画板' },
      { value: 'selected', label: '所选画板（ZIP）' },
      { value: 'all', label: '全部画板（ZIP）' },
    ],
  },
  {
    key: 'format', label: '格式', type: 'select', default: 'png',
    options: [
      { value: 'png', label: 'PNG（无损）' },
      { value: 'jpg', label: 'JPG（体积小）' },
    ],
  },
  { key: 'quality', label: 'JPG 质量', type: 'range', min: 0.5, max: 1, step: 0.01, default: 0.92, show: v => v.format === 'jpg' },
  { key: 'transparent', label: '透明背景', type: 'toggle', default: false, show: v => v.format === 'png' },
];
// 透明：画板背景类型为透明，或导出时打开「透明背景」（只对 PNG）。
// 复制到剪贴板有自己独立的开关（copyTransparent，在复制按钮左边）。
export const copySchema = [{ key: 'copyTransparent', label: '复制透明背景', type: 'toggle', default: false }];

export const exportSchema = [...sizeSchema, ...formatSchema, ...copySchema];

// 导出尺寸：数字为长边（长图为宽度）；'board' / 'board2x' 表示按画板的像素尺寸（1 倍 / 2 倍）
export const resolveLongSide = o =>
  (o.size === 'board' || o.size === 'board2x' ? o.size
    : o.size === 'custom' ? clamp(Math.round(Number(o.customSize) || 0), 256, 12000) : Number(o.size) || 3840);
const BOARD_FALLBACK = 3840; // 画板没有设置像素尺寸时，「画板」按 4K 长边

/**
 * 输出像素尺寸。canvas 为 resolveCanvas() 的结果 { W, H, long }。
 * 普通画布：size 为长边；长图：size 为宽度；'board' / 'board2x'：画板的像素尺寸（1 / 2 倍），没设时按 4K 长边。
 */
export function exportSize(canvas, size) {
  if (size === 'board' || size === 'board2x') {
    const k = size === 'board2x' ? 2 : 1;
    if (canvas.px && !canvas.long) return { width: canvas.px.w * k, height: canvas.px.h * k };
    size = BOARD_FALLBACK * k;
  }
  const aspect = canvas.W / canvas.H;
  if (canvas.long || aspect >= 1) return { width: size, height: Math.max(1, Math.round(size / aspect)) };
  return { width: Math.max(1, Math.round(size * aspect)), height: size };
}
