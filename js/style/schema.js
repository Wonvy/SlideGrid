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

/**
 * 卡片的宽高比。style.cardAspect：
 *   'auto'（默认）跟随图片——取图片里最常见的比例（一样多时取靠前的），竖版、4:3 的图片不用设置就是对的
 *   '宽:高'（如 '4:3'、'9:16'）固定比例；'custom' 用 cardAspectW : cardAspectH
 * 比例和卡片不一样的图片按「填满（裁切）」显示，可以在卡片上单独改成「完整显示」。
 */
export const CARD_ASPECTS = ['16:9', '16:10', '3:2', '4:3', '1:1', '4:5', '3:4', '2:3', '9:16'];
const autoCache = new WeakMap();
function commonAspect(slides) {
  if (!slides?.length) return 16 / 9;
  let hit = autoCache.get(slides);
  if (hit == null) {
    const count = new Map();
    let best = null, bestN = 0;
    for (const s of slides) {
      if (!(s.aspect > 0)) continue;
      const key = Math.round(s.aspect * 50) / 50; // 相差很小的算同一种比例
      const e = count.get(key) || { n: 0, aspect: s.aspect };
      e.n++;
      count.set(key, e);
      if (e.n > bestN) { best = e; bestN = e.n; }
    }
    hit = best ? best.aspect : 16 / 9;
    autoCache.set(slides, hit);
  }
  return hit;
}
export function cardAspect(style, slides) {
  const v = style?.cardAspect;
  let a = null;
  if (v === 'custom') a = (Number(style.cardAspectW) || 16) / (Number(style.cardAspectH) || 9);
  else if (typeof v === 'string' && v.includes(':')) { const [w, h] = v.split(':').map(Number); if (w > 0 && h > 0) a = w / h; }
  return a ? Math.max(0.1, Math.min(10, a)) : commonAspect(slides);
}

export const styleSchema = [
  { group: '背景' },
  {
    key: 'bgType', label: '类型', type: 'select', default: 'radial', previews: true,
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
  // 图片分配到卡片的顺序：按版式（从第一个位置开始循环）；或先填满画板里看得见的卡片（左上开始 / 中心开始），
  // 这样可见区域里尽量不出现重复的图片，画板外的卡片再接着用剩下的
  {
    key: 'slideOrder', label: '图片顺序', type: 'select', default: 'center', segmented: false, previews: 'order',
    options: [{ value: 'layout', label: '按版式' }, { value: 'visible', label: '左上开始' }, { value: 'center', label: '中心开始' }],
  },
  // 卡片比例：默认跟随图片；也可以固定成某个比例（竖版、4:3…）或自己填
  {
    key: 'cardAspect', label: '卡片比例', type: 'select', default: 'auto', previews: 'aspect',
    title: '卡片的宽高比。「跟随图片」取图片里最常见的比例；比例不一样的图片会被裁切（可以在卡片上改成完整显示）',
    options: [{ value: 'auto', label: '跟随图片' }, ...CARD_ASPECTS.map(v => ({ value: v, label: `${v}${Number(v.split(':')[0]) < Number(v.split(':')[1]) ? '（竖版）' : ''}` })), { value: 'custom', label: '自定义…' }],
  },
  { key: 'cardAspectW', label: '宽', type: 'number', min: 1, max: 100, step: 1, default: 16, half: true, show: s => s.cardAspect === 'custom' },
  { key: 'cardAspectH', label: '高', type: 'number', min: 1, max: 100, step: 1, default: 9, half: true, show: s => s.cardAspect === 'custom' },
  { key: 'radius', label: '圆角', type: 'range', min: 0, max: 60, default: 10 },
  // 厚度：卡片向背面延伸成一块板（转动视角、3D 版式里看得到侧边）。侧边的颜色取图片最靠边的颜色，或者自己指定
  { key: 'thickness', label: '厚度', type: 'range', min: 0, max: 80, default: 0, title: '卡片的厚度：3D 版式、或者用右上角的立方体转动视角后看得到侧边' },
  {
    key: 'sideMode', label: '侧边颜色', type: 'select', default: 'edge', half: true, previews: 'side', show: s => s.thickness > 0,
    options: [{ value: 'edge', label: '延伸图片边缘' }, { value: 'color', label: '指定颜色' }],
  },
  { key: 'borderWidth', label: '描边', type: 'range', min: 0, max: 30, default: 0, half: true },
  { key: 'sideColor', label: '侧边', type: 'color', default: '#d9dbe0', show: s => s.thickness > 0 && s.sideMode === 'color' },
  { key: 'borderColor', label: '描边颜色', type: 'color', default: '#ffffff', show: s => s.borderWidth > 0 },

  { group: '渐隐遮罩' },
  {
    key: 'fadeType', label: '类型', type: 'select', default: 'none', segmented: false, previews: 'fade',
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
  { key: 'shadowAngle', label: '角度', type: 'range', min: 0, max: 360, default: 180, unit: '°' },
  { key: 'shadowColor', label: '颜色', type: 'color', default: '#000000' },
];

// 切换背景类型时顺手给出合适的默认值
export function backgroundTypeDefaults(style, type) {
  if (type === 'slide' && !style.bgBlur) return { bgBlur: 48, bgDim: Math.max(style.bgDim, 0.3) };
  return {};
}
