// 全局样式参数。数值单位为"世界单位"：画布高度为 1000（长图以宽度 1600 为基准），导出时按分辨率等比放大。

const isGradient = s => s.bgType === 'linear' || s.bgType === 'radial';
const isPicture = s => s.bgType === 'image' || s.bgType === 'slide';
const hasFade = s => s.fadeType && s.fadeType !== 'none';
const hasGradientFade = s => hasFade(s) && s.fadeType !== 'solid'; // 单色遮罩只有一个不透明度

/**
 * 渐隐遮罩：让幻灯片层（含投影）按渐变逐渐透明，融进背景；背景本身不受影响。
 *   线性：沿「方向」从开始位置到结束位置渐变（方向同 CSS：180° = 从上到下）
 *   两端：从中线向两侧渐变（90° = 左右两侧渐隐）
 *   径向：从中心向四周渐变（1 = 画板边缘）
 */
export const FADE_PRESETS = [
  { id: 'none', label: '无', patch: { fadeType: 'none' } },
  { id: 'solid', label: '单色', patch: { fadeType: 'solid', fadeFrom: 0.5 } },
  { id: 'bottom', label: '底部渐隐', patch: { fadeType: 'linear', fadeAngle: 180, fadeStart: 0.5, fadeEnd: 1, fadeFrom: 1, fadeTo: 0 } },
  { id: 'top', label: '顶部渐隐', patch: { fadeType: 'linear', fadeAngle: 0, fadeStart: 0.5, fadeEnd: 1, fadeFrom: 1, fadeTo: 0 } },
  { id: 'right', label: '右侧渐隐', patch: { fadeType: 'linear', fadeAngle: 90, fadeStart: 0.55, fadeEnd: 1, fadeFrom: 1, fadeTo: 0 } },
  { id: 'left', label: '左侧渐隐', patch: { fadeType: 'linear', fadeAngle: 270, fadeStart: 0.55, fadeEnd: 1, fadeFrom: 1, fadeTo: 0 } },
  { id: 'sides', label: '左右渐隐', patch: { fadeType: 'mirror', fadeAngle: 90, fadeStart: 0.5, fadeEnd: 1, fadeFrom: 1, fadeTo: 0 } },
  { id: 'vertical', label: '上下渐隐', patch: { fadeType: 'mirror', fadeAngle: 0, fadeStart: 0.45, fadeEnd: 1, fadeFrom: 1, fadeTo: 0 } },
  { id: 'radial', label: '四周渐隐', patch: { fadeType: 'radial', fadeStart: 0.45, fadeEnd: 1.05, fadeFrom: 1, fadeTo: 0 } },
  { id: 'corner', label: '对角渐隐', patch: { fadeType: 'linear', fadeAngle: 135, fadeStart: 0.45, fadeEnd: 1, fadeFrom: 1, fadeTo: 0 } },
];

// 预览用的 CSS 遮罩（工具条菜单里的小图）
export function fadeCss(st) {
  const a = st.fadeFrom ?? 1, b = st.fadeTo ?? 0;
  const s = Math.round((st.fadeStart ?? 0.5) * 100), e = Math.round((st.fadeEnd ?? 1) * 100);
  const c = v => `rgba(255,255,255,${v})`;
  if (st.fadeType === 'linear') return `linear-gradient(${st.fadeAngle}deg, ${c(a)} ${s}%, ${c(b)} ${e}%)`;
  if (st.fadeType === 'mirror') {
    const h = v => 50 - v / 2, k = v => 50 + v / 2;
    return `linear-gradient(${st.fadeAngle}deg, ${c(b)} ${h(e)}%, ${c(a)} ${h(s)}%, ${c(a)} ${k(s)}%, ${c(b)} ${k(e)}%)`;
  }
  if (st.fadeType === 'radial') return `radial-gradient(closest-side, ${c(a)} ${s}%, ${c(b)} ${e}%)`;
  if (st.fadeType === 'solid') return `linear-gradient(${c(a)}, ${c(a)})`;
  return c(1);
}

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
    key: 'bg1', type: 'color', default: '#2b3040', half: true,
    label: s => (isGradient(s) ? '起始色' : isPicture(s) ? '底色' : '颜色'),
    show: s => s.bgType !== 'transparent' && !(s.bgType === 'slide') && !(s.bgType === 'image' && s.bgFit === 'cover'),
  },
  { key: 'bg2', label: '结束色', type: 'color', default: '#0d0f14', half: true, show: isGradient },
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
  { key: 'bgDim', label: '压暗', type: 'range', min: 0, max: 1, step: 0.01, default: 0, show: isPicture },
  { key: 'bgDimColor', label: '压暗颜色', type: 'color', default: '#000000', show: s => isPicture(s) && s.bgDim > 0 },
  { key: 'vignette', label: '暗角', type: 'range', min: 0, max: 1, step: 0.01, default: 0, show: s => s.bgType !== 'transparent' },

  { group: '卡片' },
  { key: 'radius', label: '圆角', type: 'range', min: 0, max: 60, default: 10 },
  { key: 'borderWidth', label: '描边', type: 'range', min: 0, max: 30, default: 0 },
  { key: 'borderColor', label: '描边颜色', type: 'color', default: '#ffffff', show: s => s.borderWidth > 0 },

  { group: '渐隐遮罩' },
  {
    key: 'fadeType', label: '类型', type: 'select', default: 'none',
    options: [
      { value: 'none', label: '无' },
      { value: 'solid', label: '单色' },
      { value: 'linear', label: '线性' },
      { value: 'mirror', label: '两端' },
      { value: 'radial', label: '径向' },
    ],
  },
  { key: 'fadeAngle', label: '方向', type: 'range', min: 0, max: 360, default: 180, unit: '°', show: s => s.fadeType === 'linear' || s.fadeType === 'mirror' },
  { key: 'fadeStart', label: '开始位置', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5, show: hasGradientFade },
  { key: 'fadeEnd', label: '结束位置', type: 'range', min: 0, max: 1, step: 0.01, default: 1, show: hasGradientFade },
  { key: 'fadeFrom', label: s => (s.fadeType === 'solid' ? '不透明度' : '起点不透明度'), type: 'range', min: 0, max: 1, step: 0.01, default: 1, show: hasFade },
  { key: 'fadeTo', label: '终点不透明度', type: 'range', min: 0, max: 1, step: 0.01, default: 0, show: hasGradientFade },

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
