import { createStore } from './core/store.js';
import { schemaDefaults } from './core/utils.js';
import { layouts, getLayout } from './layouts/index.js';
import { styleSchema, backgroundTypeDefaults } from './style/schema.js';
import { exportSchema } from './export/schema.js';
import { DEFAULT_CAMERA, isValidAspect } from './config.js';

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

/**
 * 画板设置：每个画板独立的版式、参数、样式、比例、构图视角和卡片调整。
 * 读入时与默认值合并（新增参数时旧数据也能用）。
 */
export function boardSettings(saved = {}) {
  return {
    layoutId: getLayout(saved.layoutId) ? saved.layoutId : 'grid',
    params: defaultParams(saved.params),
    style: { ...schemaDefaults(styleSchema), ...(saved.style || {}) },
    aspect: isValidAspect(saved.aspect) ? saved.aspect : '16:9',
    camera: { ...DEFAULT_CAMERA, ...(saved.camera || {}) },
    // 单张卡片的手动调整：{ [layoutId]: { [位置序号]: { dx, dy, rz, s, lift } } }（s 为等比缩放）
    adjust: saved.adjust && typeof saved.adjust === 'object' ? saved.adjust : {},
  };
}

export const newBoardId = () => `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * 项目设置 = 多个画板。当前画板的设置展开在 store 顶层（layoutId / params / style …），
 * 其余画板的设置保存在 artboards[i].settings 里；切换画板时互换。
 *   artboards: [{ id, name, x, y, settings }]   x / y：画板在工作区中的位置（世界单位，左上角）
 *   activeBoard: id
 */
export function projectSettings(saved = {}) {
  let boards = Array.isArray(saved.artboards) && saved.artboards.length
    ? saved.artboards
    : [{ name: '画板 1', x: 0, y: 0, settings: saved.layoutId ? saved : {} }];
  boards = boards.map((b, i) => ({
    id: b.id || newBoardId(),
    name: b.name || `画板 ${i + 1}`,
    x: Number(b.x) || 0,
    y: Number(b.y) || 0,
    settings: boardSettings(b.settings),
  }));
  const active = boards.find(b => b.id === saved.activeBoard) || boards[0];
  return { artboards: boards, activeBoard: active.id, selectedBoards: [active.id], ...active.settings };
}

// 当前画板（store 顶层）的设置
export const boardSettingsOf = s => ({ layoutId: s.layoutId, params: s.params, style: s.style, aspect: s.aspect, camera: s.camera, adjust: s.adjust });
// 所有画板，当前画板的 settings 换成最新值
export const boardsOf = s => s.artboards.map(b => (b.id === s.activeBoard ? { ...b, settings: boardSettingsOf(s) } : b));
// 保存到项目的设置
export const settingsOf = s => ({ artboards: boardsOf(s), activeBoard: s.activeBoard });

const prefs = loadPrefs();

export const store = createStore({
  project: null, // { id, name }
  slides: [],
  assets: {},    // 素材（背景图）：{ [id]: { id, name, file, preview, thumb } }
  ...projectSettings(),
  exportOpts: { ...schemaDefaults(exportSchema), ...(prefs.exportOpts || {}) }, // 导出偏好跨项目保留
  wheelMode: ['hover', 'alt', 'off'].includes(prefs.wheelMode) ? prefs.wheelMode : 'hover',
  wheelNav: prefs.wheelNav === 'scroll' ? 'scroll' : 'zoom', // 工作区滚轮：缩放视图（默认）/ 滚动视图
});

let prefsTimer;
store.subscribe(s => {
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ exportOpts: s.exportOpts, wheelMode: s.wheelMode, wheelNav: s.wheelNav })); } catch { /* 忽略 */ }
  }, 300);
});

const closeSlide = slide => slide?.preview?.close?.();

// 当前选中的画板（至少包含当前画板）
export const selectionOf = s => {
  const sel = (s.selectedBoards || []).filter(id => s.artboards.some(b => b.id === id));
  return sel.includes(s.activeBoard) ? sel : [...sel, s.activeBoard];
};

/**
 * 多选画板时，把同一修改同步到其他选中的画板（当前画板的设置在 store 顶层，由调用方修改）。
 * fn(settings) → 新的 settings。只选了一个画板时原样返回 artboards。
 */
function syncSelected(s, fn) {
  const sel = new Set(selectionOf(s));
  if (sel.size <= 1) return s.artboards;
  return s.artboards.map(b => (b.id !== s.activeBoard && sel.has(b.id) ? { ...b, settings: boardSettings(fn(b.settings)) } : b));
}

// 只保留仍被某个画板引用的素材
function pruneAssets(s, assets) {
  const used = new Set(boardsOf(s).map(b => b.settings.style?.bgImageId).filter(Boolean));
  const out = {};
  for (const [id, a] of Object.entries(assets)) {
    if (used.has(id)) out[id] = a;
    else a.preview?.close?.();
  }
  return out;
}

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
  // 设置背景图（多选画板时一起设置；其他画板仍在用的背景图会保留）
  setBackgroundImage(asset) {
    const s = store.get();
    const style = { ...s.style, bgType: 'image', bgImageId: asset.id };
    const artboards = syncSelected(s, st => ({ ...st, style: { ...st.style, bgType: 'image', bgImageId: asset.id } }));
    const next = { ...s, style, artboards };
    store.set({ style, artboards, assets: pruneAssets(next, { ...s.assets, [asset.id]: asset }) });
  },
  setProjectName(name) {
    store.set(s => ({ project: s.project ? { ...s.project, name } : s.project }));
  },

  /* ---------- 画板 ---------- */
  // 切换当前画板。keepSelection：保留现有的多选（id 已在选中集合里时）
  setActiveBoard(id, { keepSelection = false } = {}) {
    const s = store.get();
    const keep = keepSelection && selectionOf(s).includes(id);
    const selectedBoards = keep ? selectionOf(s) : [id];
    if (id === s.activeBoard) { store.set({ selectedBoards }); return; }
    const boards = boardsOf(s);
    const b = boards.find(x => x.id === id);
    if (!b) return;
    store.set({ artboards: boards, activeBoard: id, selectedBoards, ...b.settings });
  },
  // 多选：设置选中集合；active 为当前画板（默认集合里最后一个）
  selectBoards(ids, active = ids[ids.length - 1]) {
    const s = store.get();
    const valid = ids.filter(id => s.artboards.some(b => b.id === id));
    if (!valid.length) return;
    const act = valid.includes(active) ? active : valid[valid.length - 1];
    actions.setActiveBoard(act);
    store.set({ selectedBoards: valid });
  },
  // 加选 / 减选（Shift / ⌘ + 单击）
  toggleBoardSelection(id) {
    const s = store.get();
    const sel = selectionOf(s);
    if (sel.includes(id)) {
      if (sel.length === 1) return;
      const rest = sel.filter(x => x !== id);
      actions.selectBoards(rest, id === s.activeBoard ? rest[rest.length - 1] : s.activeBoard);
    } else {
      actions.selectBoards([...sel, id], id);
    }
  },
  selectAllBoards() {
    const s = store.get();
    actions.selectBoards(s.artboards.map(b => b.id), s.activeBoard);
  },
  // 新建画板：duplicate 时复制当前画板的全部设置；位置由调用方算好
  addArtboard({ x, y, duplicate = false, name, from = null }) {
    const s = store.get();
    const boards = boardsOf(s);
    const src = from ? boards.find(b => b.id === from) : boards.find(b => b.id === s.activeBoard);
    const settings = duplicate ? boardSettings(JSON.parse(JSON.stringify(src.settings))) : boardSettings({ aspect: s.aspect });
    const nums = boards.map(b => Number(/^画板 (\d+)$/.exec(b.name)?.[1]) || 0);
    // 名称不重复：「xx 副本」已存在时依次用「xx 副本 2」「xx 副本 3」…
    const taken = new Set(boards.map(b => b.name));
    let boardName = name || (duplicate ? `${src.name} 副本` : `画板 ${Math.max(boards.length, ...nums) + 1}`);
    if (taken.has(boardName)) {
      let i = 2;
      while (taken.has(`${boardName} ${i}`)) i++;
      boardName = `${boardName} ${i}`;
    }
    const board = { id: newBoardId(), name: boardName, x, y, settings };
    store.set({ artboards: [...boards, board], activeBoard: board.id, selectedBoards: [board.id], ...settings });
    return board;
  },
  // 删除画板（可多个），至少保留一个
  removeArtboards(ids) {
    const s = store.get();
    const del = new Set(ids);
    const boards = boardsOf(s).filter(b => !del.has(b.id));
    if (!boards.length || boards.length === s.artboards.length) return 0;
    let patch;
    if (!del.has(s.activeBoard)) {
      patch = { artboards: boards, selectedBoards: [s.activeBoard] };
    } else {
      const idx = s.artboards.findIndex(b => b.id === s.activeBoard);
      const next = boards[Math.min(Math.max(0, idx - 1), boards.length - 1)];
      patch = { artboards: boards, activeBoard: next.id, selectedBoards: [next.id], ...next.settings };
    }
    store.set({ ...patch, assets: pruneAssets({ ...s, ...patch }, s.assets) }); // 删掉的画板独用的背景图一并释放
    return s.artboards.length - boards.length;
  },
  removeArtboard(id) {
    return actions.removeArtboards([id]) > 0;
  },
  renameArtboard(id, name) {
    store.set(s => ({ artboards: s.artboards.map(b => (b.id === id ? { ...b, name } : b)) }));
  },
  moveArtboard(id, x, y) {
    actions.moveArtboards([{ id, x, y }]);
  },
  moveArtboards(moves) {
    const m = new Map(moves.map(v => [v.id, v]));
    store.set(s => ({ artboards: s.artboards.map(b => (m.has(b.id) ? { ...b, x: m.get(b.id).x, y: m.get(b.id).y } : b)) }));
  },

  /* ---------- 编辑（多选画板时同步到所有选中的画板；构图和卡片调整不同步） ---------- */
  setLayout(id) {
    const layout = getLayout(id);
    if (!layout) return false;
    const s = store.get();
    if (s.aspect === 'long' && !layout.long) return false; // 长图模式只支持部分版式
    const artboards = syncSelected(s, st => (st.aspect === 'long' && !layout.long ? st : { ...st, layoutId: id, camera: { ...DEFAULT_CAMERA } }));
    store.set({ layoutId: id, camera: { ...DEFAULT_CAMERA }, artboards });
    return true;
  },
  setParam(key, value) {
    store.set(s => ({
      params: { ...s.params, [s.layoutId]: { ...s.params[s.layoutId], [key]: value } },
      // 参数只同步给使用同一版式的画板
      artboards: syncSelected(s, st => (st.layoutId !== s.layoutId ? st
        : { ...st, params: { ...st.params, [s.layoutId]: { ...st.params[s.layoutId], [key]: value } } })),
    }));
  },
  resetParams() {
    store.set(s => {
      const defaults = schemaDefaults(getLayout(s.layoutId).params);
      return {
        params: { ...s.params, [s.layoutId]: defaults },
        artboards: syncSelected(s, st => (st.layoutId !== s.layoutId ? st : { ...st, params: { ...st.params, [s.layoutId]: { ...defaults } } })),
      };
    });
  },
  setStyle(key, value) {
    store.set(s => {
      const patch = { [key]: value, ...(key === 'bgType' ? backgroundTypeDefaults(s.style, value) : {}) };
      const style = { ...s.style, ...patch };
      const artboards = syncSelected(s, st => ({ ...st, style: { ...st.style, ...patch } }));
      // 移除背景图时，没有画板再用的素材一并释放
      if (key === 'bgImageId' && !value) return { style, artboards, assets: pruneAssets({ ...s, style, artboards }, s.assets) };
      return { style, artboards };
    });
  },
  // 一次改多个样式字段（工具条背景面板用）
  patchStyle(patch) {
    store.set(s => {
      const extra = patch.bgType && patch.bgType !== s.style.bgType ? backgroundTypeDefaults(s.style, patch.bgType) : {};
      return {
        style: { ...s.style, ...extra, ...patch },
        artboards: syncSelected(s, st => ({ ...st, style: { ...st.style, ...extra, ...patch } })),
      };
    });
  },
  setAspect(id) {
    const s = store.get();
    // 切到长图时，版式不支持就换成规整网格
    const fix = st => (id === 'long' && !getLayout(st.layoutId).long ? { layoutId: 'grid', camera: { ...DEFAULT_CAMERA } } : {});
    store.set({ aspect: id, ...fix(s), artboards: syncSelected(s, st => ({ ...st, aspect: id, ...fix(st) })) });
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
      let aspect = isValidAspect(p.aspect) ? p.aspect : s.aspect;
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
