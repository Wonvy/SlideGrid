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
 * 画板设置：每个画板的图片顺序、版式、参数、样式、比例、构图视角、卡片调整和图层。
 * 读入时与默认值合并（新增参数时旧数据也能用）。
 *
 * 图片的继承：项目有一份共用的图片列表（store.library，即左侧列表），画板默认跟随它（slidesOwn = false，
 * slides 就是 library）。在画布上单独改了某个画板的图片（交换、替换、移除某张卡片），这个画板就复制一份
 * 自己的列表（slidesOwn = true），之后共用列表的变化不再影响它；「恢复跟随」可以回到共用列表。
 */
export function boardSettings(saved = {}) {
  return {
    // 这个画板用到的图片（按顺序，幻灯片对象）。跟随共用列表时与 library 是同一个数组
    slides: Array.isArray(saved.slides) ? saved.slides : [],
    slidesOwn: !!saved.slidesOwn,
    layoutId: getLayout(saved.layoutId) ? saved.layoutId : 'grid',
    params: defaultParams(saved.params),
    style: { ...schemaDefaults(styleSchema), ...(saved.style || {}) },
    aspect: isValidAspect(saved.aspect) ? saved.aspect : '16:9',
    camera: { ...DEFAULT_CAMERA, ...(saved.camera || {}) },
    // 单张卡片的手动调整：{ [layoutId]: { [位置序号]: { dx, dy, rz, s, lift, cropX, cropY, cropZ, fit } } }
    //   s：等比缩放；cropX / cropY：图片在卡片里的平移（-1 ~ 1，占可移动范围的比例）；cropZ：图片放大；fit：'contain' 完整显示
    adjust: saved.adjust && typeof saved.adjust === 'object' ? saved.adjust : {},
    // 画板上的图层（文字、形状、钢笔路径），画在幻灯片上面，见 layers/model.js
    layers: Array.isArray(saved.layers) ? saved.layers : [],
  };
}

// 每个画板独立的设置字段（当前画板的这些字段展开在 store 顶层）
export const BOARD_KEYS = ['slides', 'slidesOwn', 'layoutId', 'params', 'style', 'aspect', 'camera', 'adjust', 'layers'];

export const newBoardId = () => `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * 项目设置 = 多个画板。当前画板的设置展开在 store 顶层（slides / layoutId / params / style …），
 * 其余画板的设置保存在 artboards[i].settings 里；切换画板时互换。
 *   artboards: [{ id, name, x, y, settings }]   x / y：画板在工作区中的位置（世界单位，左上角）
 *   activeBoard: id
 *   library: 共用的图片列表（跟随它的画板 slides === library）
 * 保存时共用列表记为 sharedIds，单独设置过的画板记为 slideIds；all 为项目里的全部图片（读入时按 id 找回幻灯片对象）。
 * 旧数据没有 sharedIds：共用列表为全部图片，和它顺序一致的画板改为跟随，其余的保留自己的列表。
 */
export function projectSettings(saved = {}, all = []) {
  const byId = new Map(all.map(x => [x.id, x]));
  const pick = ids => ids.map(id => byId.get(id)).filter(Boolean);
  const library = Array.isArray(saved.sharedIds) ? pick(saved.sharedIds) : [...all];
  const sharedKey = library.map(x => x.id).join();
  const slidesFor = st => {
    const ids = Array.isArray(st?.slideIds) ? st.slideIds : null;
    const own = st?.slidesOwn ?? (!!ids && ids.join() !== sharedKey);
    return own && ids ? { slides: pick(ids), slidesOwn: true } : { slides: library, slidesOwn: false };
  };
  let boards = Array.isArray(saved.artboards) && saved.artboards.length
    ? saved.artboards
    : [{ name: '画板 1', x: 0, y: 0, settings: saved.layoutId ? saved : {} }];
  boards = boards.map((b, i) => ({
    id: b.id || newBoardId(),
    name: b.name || `画板 ${i + 1}`,
    x: Number(b.x) || 0,
    y: Number(b.y) || 0,
    settings: boardSettings({ ...b.settings, ...slidesFor(b.settings) }),
  }));
  const active = boards.find(b => b.id === saved.activeBoard) || boards[0];
  return { library, artboards: boards, activeBoard: active.id, selectedBoards: [active.id], ...active.settings };
}

// 当前画板（store 顶层）的设置
export const boardSettingsOf = s => Object.fromEntries(BOARD_KEYS.map(k => [k, s[k]]));
// 所有画板，当前画板的 settings 换成最新值
export const boardsOf = s => s.artboards.map(b => (b.id === s.activeBoard ? { ...b, settings: boardSettingsOf(s) } : b));
// 保存到项目的设置
// 保存到项目的设置：幻灯片对象换成 id
const serializeBoard = b => {
  const { slides, slidesOwn, ...rest } = b.settings;
  return { ...b, settings: slidesOwn ? { ...rest, slidesOwn: true, slideIds: (slides || []).map(x => x.id) } : { ...rest, slidesOwn: false } };
};
export const settingsOf = s => ({
  artboards: boardsOf(s).map(serializeBoard),
  activeBoard: s.activeBoard,
  sharedIds: (s.library || []).map(x => x.id),
});
// 新项目的默认设置（已序列化）
export const defaultSettings = () => settingsOf({ ...projectSettings() });

// 项目里全部的图片（共用列表在前，再加上各画板单独用到的，按画板顺序）
export function libraryOf(s) {
  const seen = new Set(), out = [];
  for (const x of s.library || []) if (!seen.has(x.id)) { seen.add(x.id); out.push(x); }
  for (const b of boardsOf(s)) {
    for (const x of b.settings.slides || []) if (!seen.has(x.id)) { seen.add(x.id); out.push(x); }
  }
  return out;
}

const prefs = loadPrefs();

export const store = createStore({
  project: null, // { id, name }
  assets: {},    // 素材（背景图）：{ [id]: { id, name, file, preview, thumb } }
  ...projectSettings(),
  exportOpts: { ...schemaDefaults(exportSchema), ...(prefs.exportOpts || {}) }, // 导出偏好跨项目保留
  wheelMode: ['hover', 'alt', 'off'].includes(prefs.wheelMode) ? prefs.wheelMode : 'hover',
  wheelNav: prefs.wheelNav === 'scroll' ? 'scroll' : 'zoom', // 工作区滚轮：缩放视图（默认）/ 滚动视图
  snap: prefs.snap !== false, // 拖动时吸附对齐
});

let prefsTimer;
store.subscribe(s => {
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ exportOpts: s.exportOpts, wheelMode: s.wheelMode, wheelNav: s.wheelNav, snap: s.snap })); } catch { /* 忽略 */ }
  }, 300);
});

// 只在切换项目时主动释放图片内存；项目内删除的图片可能被「撤销」找回，交给浏览器回收
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

// 被使用的素材：画板背景图 + 图片图层
export function usedAssetIds(s) {
  const used = new Set();
  for (const b of boardsOf(s)) {
    if (b.settings.style?.bgImageId) used.add(b.settings.style.bgImageId);
    for (const l of b.settings.layers || []) {
      if (l.type === 'image' && l.assetId) used.add(l.assetId);
      if (l.type === 'device') { if (l.imageId) used.add(l.imageId); if (l.frameAssetId) used.add(l.frameAssetId); }
    }
  }
  return used;
}

// 只保留仍被某个画板引用的素材
function pruneAssets(s, assets) {
  const used = usedAssetIds(s);
  const out = {};
  for (const [id, a] of Object.entries(assets)) {
    if (used.has(id)) out[id] = a; // 不再使用的素材交给浏览器回收（撤销时可能还会用到）
  }
  return out;
}

const hasReal = list => (list || []).some(x => !x.placeholder);

// 换掉共用列表：跟随它的画板（包括当前画板）一起换
function libraryPatch(s, library) {
  return {
    library,
    artboards: s.artboards.map(b => (b.id !== s.activeBoard && !b.settings.slidesOwn ? { ...b, settings: { ...b.settings, slides: library } } : b)),
    ...(s.slidesOwn ? {} : { slides: library }),
  };
}

/**
 * 修改当前画板用的图片列表。fn(list) → 新列表（返回 null 表示不修改）
 *   scope 'shared'（左侧列表的操作）：画板跟随共用列表时改共用列表，所有跟随的画板一起变；单独设置过的画板只改自己
 *   scope 'board'（画布上对某张卡片的操作）：只改当前画板——跟随共用列表的画板从此单独设置。
 *     共用列表里还没有真实图片时（第一次放图），仍然放进共用列表
 */
function editSlides(fn, scope = 'shared') {
  const s = store.get();
  if (s.slidesOwn) {
    const next = fn(s.slides);
    if (next) store.set({ slides: next });
    return;
  }
  const next = fn(s.library);
  if (!next) return;
  if (scope === 'board' && hasReal(s.library)) store.set({ slides: next, slidesOwn: true });
  else store.set(libraryPatch(s, next));
}

export const actions = {
  addSlides(newSlides) {
    if (newSlides.length) editSlides(list => [...list, ...newSlides]);
  },
  // scope 见 editSlides：左侧列表里移除是 'shared'，画布上「从此画板移除」是 'board'
  removeSlide(id, scope = 'shared') {
    editSlides(list => list.filter(x => x.id !== id), scope);
  },
  clearSlides() {
    editSlides(() => []);
  },
  moveSlide(from, to) {
    editSlides(list => {
      if (from === to || from < 0 || from >= list.length) return null;
      const slides = [...list];
      const [item] = slides.splice(from, 1);
      slides.splice(Math.max(0, Math.min(to, slides.length)), 0, item);
      return slides;
    });
  },
  // 画布上交换两张卡片的图片：只改当前画板
  swapSlides(a, b) {
    editSlides(list => {
      if (a === b || !list[a] || !list[b]) return null;
      const slides = [...list];
      [slides[a], slides[b]] = [slides[b], slides[a]];
      return slides;
    }, 'board');
  },
  /**
   * 用新图片替换第 index 张；多张时其余的插在它后面（画布上的操作：只改当前画板）。
   * base：当前还没有真实图片时，传入示例卡片，把它们变成可单独替换的空位。
   */
  replaceSlide(index, newSlides, base = null) {
    editSlides(list => {
      const slides = [...(list.length ? list : base || [])];
      if (!newSlides.length || !slides[index]) return null;
      slides.splice(index, 1, ...newSlides);
      return slides;
    }, 'board');
  },
  // 追加图片：先依次填进示例空位，剩下的追加到末尾
  fillSlots(newSlides) {
    editSlides(list => {
      const slides = [...list];
      const rest = [...newSlides];
      for (let i = 0; i < slides.length && rest.length; i++) {
        if (slides[i].placeholder) slides[i] = rest.shift();
      }
      return [...slides, ...rest];
    });
  },
  // 当前画板（及多选的画板）恢复跟随共用列表
  followLibrary() {
    const s = store.get();
    const sel = new Set(selectionOf(s));
    store.set({
      slides: s.library,
      slidesOwn: false,
      artboards: s.artboards.map(b => (b.id !== s.activeBoard && sel.has(b.id) && b.settings.slidesOwn ? { ...b, settings: { ...b.settings, slides: s.library, slidesOwn: false } } : b)),
    });
  },
  // 把当前画板的图片顺序设为共用列表（所有跟随的画板一起变），当前画板改为跟随
  shareBoardSlides() {
    const s = store.get();
    store.set({ ...libraryPatch({ ...s, slidesOwn: false }, s.slides), slidesOwn: false });
  },
  // 切换到另一个项目（由项目控制器调用）。slides 为项目里的全部图片
  loadProject({ project, settings, slides, assets = {} }) {
    const s = store.get();
    libraryOf(s).forEach(x => { if (!slides.includes(x)) closeSlide(x); });
    Object.values(s.assets).forEach(a => { if (assets[a.id] !== a) a.preview?.close?.(); });
    store.set({ project, assets, ...projectSettings(settings, slides) });
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
  // 新建画板：duplicate 时复制当前画板的全部设置（包括是否跟随共用图片），否则沿用比例、跟随共用图片；位置由调用方算好
  addArtboard({ x, y, duplicate = false, name, from = null }) {
    const s = store.get();
    const boards = boardsOf(s);
    const src = from ? boards.find(b => b.id === from) : boards.find(b => b.id === s.activeBoard);
    const { slides, slidesOwn, ...rest } = src.settings;
    const settings = duplicate
      ? boardSettings({ ...JSON.parse(JSON.stringify(rest)), ...(slidesOwn ? { slides: [...slides], slidesOwn: true } : { slides: s.library }) })
      : boardSettings({ aspect: s.aspect, slides: s.library });
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
  // 一次调整多张卡片（多选移动 / 对齐 / 分布），作为一步撤销
  setItemAdjusts(list) {
    store.set(s => {
      const cur = { ...(s.adjust[s.layoutId] || {}) };
      for (const { order, patch } of list) cur[order] = { ...cur[order], ...patch };
      return { adjust: { ...s.adjust, [s.layoutId]: cur } };
    });
  },
  // 复位卡片的位置 / 旋转 / 缩放 / 裁切；交换过的图片（slide）保留
  resetItemAdjust(order) {
    store.set(s => {
      const cur = { ...(s.adjust[s.layoutId] || {}) };
      if (cur[order]?.slide != null) cur[order] = { slide: cur[order].slide }; else delete cur[order];
      return { adjust: { ...s.adjust, [s.layoutId]: cur } };
    });
  },
  // 交换两张卡片的图片：只改这两个位置（记在卡片的手动调整里），其他卡片、幻灯片列表、其他画板都不变
  swapCards(orderA, slideA, orderB, slideB) {
    if (orderA === orderB || !slideA || !slideB) return;
    store.set(s => {
      const cur = { ...(s.adjust[s.layoutId] || {}) };
      cur[orderA] = { ...cur[orderA], slide: slideB };
      cur[orderB] = { ...cur[orderB], slide: slideA };
      return { adjust: { ...s.adjust, [s.layoutId]: cur } };
    });
  },
  /* ---------- 图层（当前画板） ---------- */
  setLayers(layers) {
    store.set({ layers });
  },
  updateLayers(ids, patch) {
    const set = new Set(ids);
    store.set(s => ({ layers: s.layers.map(l => (set.has(l.id) ? (typeof patch === 'function' ? patch(l) : { ...l, ...patch }) : l)) }));
  },
  // 加入图片图层（素材和图层一起，作为一步撤销）
  // 样机屏幕换成自己的图片（asset 为 null：改回显示幻灯片，slide 可同时指定第几张）
  setDeviceImage(id, asset, slide = null) {
    store.set(s => ({
      assets: asset ? { ...s.assets, [asset.id]: asset } : s.assets,
      layers: s.layers.map(l => (l.id === id ? { ...l, imageId: asset ? asset.id : null, ...(slide ? { slide } : {}) } : l)),
    }));
  },
  addAssetLayers(assets, layers) {
    store.set(s => ({
      assets: { ...s.assets, ...Object.fromEntries(assets.map(a => [a.id, a])) },
      layers: [...s.layers, ...layers],
    }));
  },
  // 图层和卡片一起修改（一起移动时作为一步撤销）。adjusts：[{ order, patch }]
  applyEdits({ layers = null, adjusts = null }) {
    store.set(s => {
      const out = {};
      if (layers) out.layers = layers;
      if (adjusts?.length) {
        const cur = { ...(s.adjust[s.layoutId] || {}) };
        for (const { order, patch } of adjusts) cur[order] = { ...cur[order], ...patch };
        out.adjust = { ...s.adjust, [s.layoutId]: cur };
      }
      return out;
    });
  },
  // 复位裁切（保留位置、旋转、缩放）
  resetCrop(order) {
    actions.setItemAdjust(order, { cropX: 0, cropY: 0, cropZ: 1, fit: 'cover' });
  },
  // 清除所有卡片的位置 / 旋转 / 缩放 / 裁切；交换过的图片保留
  resetAdjust() {
    store.set(s => {
      const kept = Object.fromEntries(Object.entries(s.adjust[s.layoutId] || {}).filter(([, a]) => a.slide != null).map(([k, a]) => [k, { slide: a.slide }]));
      return { adjust: { ...s.adjust, [s.layoutId]: kept } };
    });
  },
  // 这张卡片不再固定显示交换来的图片
  unpinCard(order) {
    store.set(s => {
      const cur = { ...(s.adjust[s.layoutId] || {}) };
      if (!cur[order]) return {};
      const { slide, ...rest } = cur[order];
      if (Object.keys(rest).length) cur[order] = rest; else delete cur[order];
      return { adjust: { ...s.adjust, [s.layoutId]: cur } };
    });
  },
  // 恢复所有卡片的图片顺序（取消交换）
  resetSwaps() {
    store.set(s => {
      const out = {};
      for (const [k, a] of Object.entries(s.adjust[s.layoutId] || {})) {
        const { slide, ...rest } = a;
        if (Object.keys(rest).length) out[k] = rest;
      }
      return { adjust: { ...s.adjust, [s.layoutId]: out } };
    });
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
