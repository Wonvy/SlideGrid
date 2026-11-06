// 全局样式参数。数值单位为"世界单位"：画布高度为 1000（长图以宽度 1600 为基准），导出时按分辨率等比放大。

const isGradient = s => s.bgType === 'linear' || s.bgType === 'radial';
const isPicture = s => s.bgType === 'image' || s.bgType === 'slide';

export const styleSchema = [
  { group: '背景' },
  {
    key: 'bgType', label: '类型', type: 'select', default: 'radial',
    options: [
      { value: 'transparent', label: '透明' },
      { value: 'solid', label: '纯色' },
      { value: 'linear', label: '线性渐变' },
      { value: 'radial', label: '径向渐变' },
      { value: 'image', label: '背景图' },
      { value: 'slide', label: '幻灯片模糊' },
    ],
  },
  {
    key: 'bg1', type: 'color', default: '#2b3040',
    label: s => (isGradient(s) ? '起始色' : isPicture(s) ? '底色' : '颜色'),
    show: s => s.bgType !== 'transparent' && !(s.bgType === 'slide') && !(s.bgType === 'image' && s.bgFit === 'cover'),
  },
  { key: 'bg2', label: '结束色', type: 'color', default: '#0d0f14', show: isGradient },
  { key: 'bgAngle', label: '渐变角度', type: 'range', min: 0, max: 360, default: 160, unit: '°', show: s => s.bgType === 'linear' },

  { key: 'bgImageId', label: '背景图', type: 'image', default: null, show: s => s.bgType === 'image' },
  {
    key: 'bgFit', label: '填充方式', type: 'select', default: 'cover', show: s => s.bgType === 'image',
    options: [
      { value: 'cover', label: '铺满（裁切）' },
      { value: 'contain', label: '完整显示' },
      { value: 'tile', label: '平铺' },
    ],
  },
  { key: 'bgScale', label: '平铺大小', type: 'range', min: 0.1, max: 3, step: 0.01, default: 0.6, show: s => s.bgType === 'image' && s.bgFit === 'tile' },
  { key: 'bgSlide', label: '使用第几张', type: 'range', min: 1, max: 60, default: 1, show: s => s.bgType === 'slide' },
  { key: 'bgBlur', label: '模糊', type: 'range', min: 0, max: 120, default: 0, show: isPicture },
  { key: 'bgDim', label: '遮罩', type: 'range', min: 0, max: 1, step: 0.01, default: 0, show: isPicture },
  { key: 'bgDimColor', label: '遮罩颜色', type: 'color', default: '#000000', show: s => isPicture(s) && s.bgDim > 0 },
  { key: 'vignette', label: '暗角', type: 'range', min: 0, max: 1, step: 0.01, default: 0, show: s => s.bgType !== 'transparent' },

  { group: '幻灯片' },
  { key: 'radius', label: '圆角', type: 'range', min: 0, max: 60, default: 10 },
  { key: 'borderWidth', label: '描边', type: 'range', min: 0, max: 30, default: 0 },
  { key: 'borderColor', label: '描边颜色', type: 'color', default: '#ffffff', show: s => s.borderWidth > 0 },

  { group: '投影' },
  { key: 'shadowOpacity', label: '不透明度', type: 'range', min: 0, max: 1, step: 0.01, default: 0.45 },
  { key: 'shadowBlur', label: '模糊', type: 'range', min: 0, max: 120, default: 36 },
  { key: 'shadowY', label: '偏移', type: 'range', min: -60, max: 120, default: 16 },
  { key: 'shadowColor', label: '颜色', type: 'color', default: '#000000' },
];

// 切换背景类型时顺手给出合适的默认值
export function backgroundTypeDefaults(style, type) {
  if (type === 'slide' && !style.bgBlur) return { bgBlur: 48, bgDim: Math.max(style.bgDim, 0.3) };
  return {};
}
