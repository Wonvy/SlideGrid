import { clamp } from '../core/utils.js';

// 尺寸放在顶栏（复制按钮左侧），其余参数在「导出图片」的悬停面板里
export const sizeSchema = [
  {
    key: 'size', label: '尺寸', title: '导出尺寸：普通画布为长边，长图为宽度', type: 'select', default: 3840,
    options: [
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
];
// 透明与否由背景类型决定（样式 → 背景 → 透明）

export const exportSchema = [...sizeSchema, ...formatSchema];

export const resolveLongSide = o =>
  o.size === 'custom' ? clamp(Math.round(Number(o.customSize) || 0), 256, 12000) : Number(o.size) || 3840;

/**
 * 输出像素尺寸。canvas 为 resolveCanvas() 的结果 { W, H, long }。
 * 普通画布：size 为长边；长图：size 为宽度。
 */
export function exportSize(canvas, size) {
  const aspect = canvas.W / canvas.H;
  if (canvas.long || aspect >= 1) return { width: size, height: Math.max(1, Math.round(size / aspect)) };
  return { width: Math.max(1, Math.round(size * aspect)), height: size };
}
