import { createStore } from './core/store.js';
import { schemaDefaults } from './core/utils.js';
import { layouts, getLayout } from './layouts/index.js';
import { styleSchema, backgroundTypeDefaults } from './style/schema.js';
import { exportSchema } from './export/schema.js';
import { ASPECTS, DEFAULT_CAMERA } from './config.js';

// 项目（图片 + 版式/样式/视图设置）保存在 IndexedDB，见 project/controller.js；
// localStorage 只存跨项目的偏好（导出设置）。
const PREFS_KEY = 'slidegrid:prefs:v1';

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}

const defaultParams = (saved = {}) => {
  const params = {};
  for (const l of layouts) params[l.id] = { ...schemaDefaults(l.params), ...(saved[l.id] || {}) };
  return params;
};

// 项目级设置：读入时与默认值合并（新增参数时旧项目也能用）
export function projectSettings(saved = {}) {
  return {
    layoutId: getLayout(saved.layoutId) ? saved.layoutId : 'grid',
    params: defaultParams(saved.params),
    style: { ...schemaDefaults(styleSchema), ...(saved.style || {}) },
    aspect: ASPECTS.some(a => a.id === saved.aspect) ? saved.aspect : '16:9',
    camera: { ...DEFAULT_CAMERA, ...(saved.camera || {}) },
    // 单张卡片的手动调整：{ [layoutId]: { [位置序号]: { dx, dy, rz, s, lift } } }（s 为等比缩放）
    adjust: saved.adjust && typeof saved.adjust === 'object' ? saved.adjust : {},
  };
}

export const settingsOf = s => ({ layoutId: s.layoutId, params: s.params, style: s.style, aspect: s.aspect, camera: s.camera, adjust: s.adjust });

const prefs = loadPrefs();

export const store = createStore({
  project: null, // { id, name }
  slides: [],
  assets: {},    // 素材（背景图）：{ [id]: { id, name, file, preview, thumb } }
  ...projectSettings(),
  exportOpts: { ...schemaDefaults(exportSchema), ...(prefs.exportOpts || {}) }, // 导出偏好跨项目保留
  wheelMode: ['hover', 'alt', 'off'].includes(prefs.wheelMode) ? prefs.wheelMode : 'hover',
});

let prefsTimer;
store.subscribe(s => {
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ exportOpts: s.exportOpts, wheelMode: s.wheelMode })); } catch { /* 忽略 */ }
  }, 300);
});

const closeSlide = slide => slide?.preview?.close?.();

export const actions = {
  addSlides(newSlides) {
    if (newSlides.length) store.set(s => ({ slides: [...s.slides, ...newSlides] }));
  },
  removeSlide(id) {
    const s = store.get();
    closeSlide(s.slides.find(x => x.id === id));
    store.set({ slides: s.slides.filter(x => x.id !== id) });
  },
  clearSlides() {
    store.get().slides.forEach(closeSlide);
    store.set({ slides: [] });
  },
  moveSlide(from, to) {
    const slides = [...store.get().slides];
    if (from === to || from < 0 || from >= slides.length) return;
    const [item] = slides.splice(from, 1);
    slides.splice(Math.max(0, Math.min(to, slides.length)), 0, item);
    store.set({ slides });
  },
  swapSlides(a, b) {
    const slides = [...store.get().slides];
    if (a === b || !slides[a] || !slides[b]) return;
    [slides[a], slides[b]] = [slides[b], slides[a]];
    store.set({ slides });
  },
  /**
   * 用新图片替换第 index 张；多张时其余的插在它后面。
   * base：当前还没有真实图片时，传入示例卡片，把它们变成可单独替换的空位。
   */
  replaceSlide(index, newSlides, base = null) {
    const slides = [...(store.get().slides.length ? store.get().slides : base || [])];
    if (!newSlides.length || !slides[index]) return;
    const [old] = slides.splice(index, 1, ...newSlides);
    closeSlide(old);
    store.set({ slides });
  },
  // 追加图片：先依次填进示例空位，剩下的追加到末尾
  fillSlots(newSlides) {
    const slides = [...store.get().slides];
    const rest = [...newSlides];
    for (let i = 0; i < slides.length && rest.length; i++) {
      if (slides[i].placeholder) slides[i] = rest.shift();
    }
    store.set({ slides: [...slides, ...rest] });
  },
  // 切换到另一个项目（由项目控制器调用）
  loadProject({ project, settings, slides, assets = {} }) {
    const s = store.get();
    s.slides.forEach(x => { if (!slides.includes(x)) closeSlide(x); });
    Object.values(s.assets).forEach(a => { if (assets[a.id] !== a) a.preview?.close?.(); });
    store.set({ project, slides, assets, ...projectSettings(settings) });
  },
  // 设置背景图（只保留当前这一张素材）
  setBackgroundImage(asset) {
    const s = store.get();
    Object.values(s.assets).forEach(a => { if (a !== asset) a.preview?.close?.(); });
    store.set({ assets: { [asset.id]: asset }, style: { ...s.style, bgType: 'image', bgImageId: asset.id } });
  },
  setProjectName(name) {
    store.set(s => ({ project: s.project ? { ...s.project, name } : s.project }));
  },
  setLayout(id) {
    const layout = getLayout(id);
    if (!layout) return false;
    if (store.get().aspect === 'long' && !layout.long) return false; // 长图模式只支持部分版式
    store.set({ layoutId: id, camera: { ...DEFAULT_CAMERA } });
    return true;
  },
  setParam(key, value) {
    store.set(s => ({ params: { ...s.params, [s.layoutId]: { ...s.params[s.layoutId], [key]: value } } }));
  },
  resetParams() {
    store.set(s => ({ params: { ...s.params, [s.layoutId]: schemaDefaults(getLayout(s.layoutId).params) } }));
  },
  setStyle(key, value) {
    store.set(s => {
      const extra = key === 'bgType' ? backgroundTypeDefaults(s.style, value) : {};
      // 移除背景图时一并释放素材
      if (key === 'bgImageId' && !value) {
        Object.values(s.assets).forEach(a => a.preview?.close?.());
        return { assets: {}, style: { ...s.style, bgImageId: null } };
      }
      return { style: { ...s.style, [key]: value, ...extra } };
    });
  },
  setAspect(id) {
    const s = store.get();
    // 切到长图时，当前版式不支持就换成规整网格
    const patch = id === 'long' && !getLayout(s.layoutId).long ? { layoutId: 'grid', camera: { ...DEFAULT_CAMERA } } : {};
    store.set({ aspect: id, ...patch });
  },
  setExport(key, value) {
    store.set(s => ({ exportOpts: { ...s.exportOpts, [key]: value } }));
  },
  // 调整某个位置的卡片（patch 中的数值为绝对值）
  setItemAdjust(order, patch) {
    store.set(s => {
      const cur = s.adjust[s.layoutId] || {};
      const next = { ...cur[order], ...patch };
      return { adjust: { ...s.adjust, [s.layoutId]: { ...cur, [order]: next } } };
    });
  },
  resetItemAdjust(order) {
    store.set(s => {
      const cur = { ...(s.adjust[s.layoutId] || {}) };
      delete cur[order];
      return { adjust: { ...s.adjust, [s.layoutId]: cur } };
    });
  },
  resetAdjust() {
    store.set(s => ({ adjust: { ...s.adjust, [s.layoutId]: {} } }));
  },
  /**
   * 套用「我的版式」。缺省字段用默认值，所以旧版本保存的版式也能套用。
   * 返回 { ok, reason }
   */
  applyPreset(p) {
    const layout = getLayout(p.layoutId);
    if (!layout) return { ok: false, reason: `版式「${p.layoutId}」在当前版本中不存在` };
    store.set(s => {
      let aspect = ASPECTS.some(a => a.id === p.aspect) ? p.aspect : s.aspect;
      if (aspect === 'long' && !layout.long) aspect = '16:9';
      const style = p.style ? { ...s.style, ...p.style, bgImageId: s.style.bgImageId } : s.style;
      return {
        layoutId: layout.id,
        params: { ...s.params, [layout.id]: { ...schemaDefaults(layout.params), ...(p.params || {}) } },
        adjust: { ...s.adjust, [layout.id]: { ...(p.adjust || {}) } },
        camera: { ...DEFAULT_CAMERA, ...(p.camera || {}) },
        aspect,
        style,
      };
    });
    return { ok: true };
  },
  setPref(key, value) {
    store.set({ [key]: value });
  },
  setCamera(patch) {
    store.set(s => ({ camera: { ...s.camera, ...patch } }));
  },
  resetCamera() {
    store.set({ camera: { ...DEFAULT_CAMERA } });
  },
};

/** 从当前状态生成「我的版式」的内容（不含 id / 名称 / 缩略图） */
export function presetFromState(s, { includeStyle = false, includeAspect = false } = {}) {
  let style = null;
  if (includeStyle) {
    const { bgImageId, ...rest } = s.style; // 背景图本身属于项目素材，不放进版式
    style = rest;
  }
  return {
    layoutId: s.layoutId,
    params: { ...s.params[s.layoutId] },
    adjust: { ...(s.adjust[s.layoutId] || {}) },
    camera: { ...s.camera },
    aspect: includeAspect ? s.aspect : null,
    style,
  };
}
