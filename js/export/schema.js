import { clamp } from '../core/utils.js';

/**
 * 导出倍率：画板的像素尺寸 × 倍率（1 = 画板原始像素）。倍率放在顶栏（复制按钮左侧），其余参数在「导出」的悬停面板里。
 * 长图：宽度 1920 × 倍率，高度随内容。
 */
export const SCALES = [0.5, 1, 2, 3, 4];
export const scaleSchema = [
  {
    key: 'scale', label: '倍率', type: 'select', default: 1,
    options: SCALES.map(v => ({ value: v, label: v === 1 ? '1×（原始像素）' : `${v}×` })),
  },
];
const LONG_W = 1920;     // 长图 1 倍时的宽度
const MAX_SIDE = 16384;  // 浏览器画布的最大边长

export const formatSchema = [
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

export const exportSchema = [...scaleSchema, ...formatSchema, ...copySchema];

// 当前的导出倍率（0.1 ~ 8）
export const resolveScale = o => clamp(Number(o.scale) || 1, 0.1, 8);

/**
 * 输出像素尺寸。canvas 为 resolveCanvas() 的结果 { W, H, long, px }。
 *   { scale }：画板像素 × 倍率（导出、复制）；{ longSide }：长边固定为这么多像素（预览、缩略图）
 *   也接受直接传一个数字（= longSide）
 */
export function exportSize(canvas, opt) {
  const { scale = null, longSide = null } = typeof opt === 'number' ? { longSide: opt } : opt || {};
  const aspect = canvas.W / canvas.H;
  let width, height;
  if (scale != null) {
    if (canvas.long) { width = LONG_W * scale; height = width / aspect; }
    else if (canvas.px) { width = canvas.px.w * scale; height = canvas.px.h * scale; }
    else { const short = 1080 * scale; [width, height] = aspect >= 1 ? [short * aspect, short] : [short, short / aspect]; }
  } else {
    const size = longSide || 1920;
    [width, height] = canvas.long || aspect >= 1 ? [size, size / aspect] : [size * aspect, size];
  }
  // 超过浏览器画布上限时等比缩小
  const k = Math.min(1, MAX_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}
