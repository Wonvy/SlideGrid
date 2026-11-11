import { createStore } from './core/store.js';
import { schemaDefaults } from './core/utils.js';
import { layouts, getLayout } from './layouts/index.js';
import { styleSchema, backgroundTypeDefaults } from './style/schema.js';
import { exportSchema } from './export/schema.js';
import { DEFAULT_CAMERA, isValidAspect, normalizeAspect, shortSide } from './config.js';

// 项目（图片 + 版式/样式/视图设置）保存在 IndexedDB，见 project/controller.js；
// localStorage 只存跨项目的偏好（导出设置）。
const PREFS_KEY = 'slidegrid:prefs:v1';

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}

function layoutParams(layout, saved = {}) {
  const defaults = schemaDefaults(layout.params);
  if (layout.id !== 'grid') return { ...defaults, ...saved };
  const { centerLast, ...params } = saved;
  return { ...defaults, ...(centerLast === false ? { lastRowAlign: 'left' } : {}), ...params };
}

const defaultParams = (saved = {}) => {
  const params = {};
  for (const l of layouts) params[l.id] = layoutParams(l, saved[l.id] || {});
  return params;
};

/**
 * 画板设置：每个画板的图片顺序、版式、参数、样式、比例、构图视角、卡片调整和图层。
 * 读入时与默认值合并（新增参数时旧数据也能用）。
 *
 * 图集与继承：项目里有若干个图集（store.albums，每个是一组有名字的图片，左栏显示当前画板的图集）。
 * 每个画板关联一个图集（albumId），默认跟随它（slidesOwn = false，slides 就是这个图集的 slides）。
 * 在画布上单独改了某个画板的图片（替换、移除某张卡片），这个画板就复制一份自己的列表（slidesOwn = true），
 * 之后图集的变化不再影响它；「恢复跟随」可以回到图集。换图集 = 关联到另一个图集并跟随它。
 */
export function boardSettings(saved = {}) {
  return {
    // 这个画板用到的图片（按顺序，幻灯片对象）。跟随图集时与图集的 slides 是同一个数组
    slides: Array.isArray(saved.slides) ? saved.slides : [],
    slidesOwn: !!saved.slidesOwn,
    albumId: saved.albumId || null,
    layoutId: getLayout(saved.layoutId) ? saved.layoutId : 'grid',
    params: defaultParams(saved.params),
    style: { ...schemaDefaults(styleSchema), ...(saved.style || {}) },
    // 画板尺寸：像素 "宽x高"（旧数据的比例会换成像素，见 normalizeAspect）或长图 'long'
    aspect: normalizeAspect(isValidAspect(saved.aspect) ? saved.aspect : '1920x1080'),
    camera: { ...DEFAULT_CAMERA, ...(saved.camera || {}) },
    // 单张卡片的手动调整：{ [layoutId]: { [位置序号]: { dx, dy, rz, s, lift, cropX, cropY, cropZ, fit } } }
    //   s：等比缩放；cropX / cropY：图片在卡片里的平移（-1 ~ 1，占可移动范围的比例）；cropZ：图片放大；fit：'contain' 完整显示
    adjust: saved.adjust && typeof saved.adjust === 'object' ? saved.adjust : {},
    // 画板上的图层（文字、形状、钢笔路径），画在幻灯片上面，见 layers/model.js
    layers: Array.isArray(saved.layers) ? saved.layers : [],
  };
}

// 每个画板独立的设置字段（当前画板的这些字段展开在 store 顶层）
export const BOARD_KEYS = ['slides', 'slidesOwn', 'albumId', 'layoutId', 'params', 'style', 'aspect', 'camera', 'adjust', 'layers'];

export const newBoardId = () => `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const newAlbumId = () => `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// 图集：s.albums 里 id 对应的那个（找不到时用第一个）；当前画板的图集
export const albumOf = (s, id = s.albumId) => s.albums?.find(a => a.id === id) || s.albums?.[0] || null;
export const albumSlides = (s, id) => albumOf(s, id)?.slides || [];

/**
 * 项目设置 = 多个画板。当前画板的设置展开在 store 顶层（slides / layoutId / params / style …），
 * 其余画板的设置保存在 artboards[i].settings 里；切换画板时互换。
 *   artboards: [{ id, name, x, y, settings }]   x / y：画板在工作区中的位置（世界单位，左上角）
 *   activeBoard: id
 *   albums: [{ id, name, slides }]   图集（跟随某个图集的画板 slides === 这个图集的 slides）
 * 保存时图集记为 { id, name, slideIds }，单独设置过的画板记为 slideIds；all 为项目里的全部图片（读入时按 id 找回幻灯片对象）。
 * 旧数据没有 albums：只有一个图集「图集 1」（旧的共用列表 sharedIds，再旧的没有时为全部图片），
 * 和它顺序一致的画板改为跟随，其余的保留自己的列表。
 */
export function projectSettings(saved = {}, all = []) {
  const byId = new Map(all.map(x => [x.id, x]));
  const pick = ids => ids.map(id => byId.get(id)).filter(Boolean);
  const albums = Array.isArray(saved.albums) && saved.albums.length
    ? saved.albums.map((a, i) => ({ id: a.id || newAlbumId(), name: a.name || `图集 ${i + 1}`, slides: pick(a.slideIds || []) }))
    : [{ id: newAlbumId(), name: '图集 1', slides: Array.isArray(saved.sharedIds) ? pick(saved.sharedIds) : [...all] }];
  const slidesFor = st => {
    const album = albums.find(a => a.id === st?.albumId) || albums[0];
    const ids = Array.isArray(st?.slideIds) ? st.slideIds : null;
    const own = st?.slidesOwn ?? (!!ids && ids.join() !== album.slides.map(x => x.id).join());
    return own && ids ? { slides: pick(ids), slidesOwn: true, albumId: album.id } : { slides: album.slides, slidesOwn: false, albumId: album.id };
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
  return { albums, artboards: boards, activeBoard: active.id, selectedBoards: [active.id], ...active.settings };
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
  albums: (s.albums || []).map(a => ({ id: a.id, name: a.name, slideIds: a.slides.map(x => x.id) })),
});
// 新项目的默认设置（已序列化）
export const defaultSettings = () => settingsOf({ ...projectSettings() });

// 项目里全部的图片（各图集在前，再加上各画板单独用到的，按画板顺序）
export function libraryOf(s) {
  const seen = new Set(), out = [];
  for (const a of s.albums || []) for (const x of a.slides) if (!seen.has(x.id)) { seen.add(x.id); out.push(x); }
  for (const b of boardsOf(s)) {
    for (const x of b.settings.slides || []) if (!seen.has(x.id)) { seen.add(x.id); out.push(x); }
  }
  return out;
}

const prefs = loadPrefs();
// 旧的导出尺寸（长边像素 / 画板 / 画板 @2x）换成倍率：按 1920 宽的画板估算
function migrateExportOpts(o) {
  if (o.size == null || prefs.exportOpts?.scale != null) return o;
  const { size, customSize, scope, ...rest } = o;
  const px = size === 'custom' ? Number(customSize) : Number(size);
  const scale = size === 'board2x' ? 2 : size === 'board' || !px ? 1 : Math.max(1, Math.round(px / 1920));
  return { ...rest, scale };
}

export const store = createStore({
  project: null, // { id, name }
  assets: {},    // 素材（背景图）：{ [id]: { id, name, file, preview, thumb } }
  ...projectSettings(),
  exportOpts: migrateExportOpts({ ...schemaDefaults(exportSchema), ...(prefs.exportOpts || {}) }), // 导出偏好跨项目保留
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

// 当前画板和多选的画板改为跟随某个图集（返回 store 补丁）
function boardsToAlbum(s, album) {
  const sel = new Set(selectionOf(s));
  return {
    ...followAlbum(boardSettingsOf(s), album),
    artboards: s.artboards.map(b => (b.id !== s.activeBoard && sel.has(b.id) ? { ...b, settings: followAlbum(b.settings, album) } : b)),
  };
}

// 换掉某个图集的图片：跟随这个图集的画板（包括当前画板）一起换
function albumPatch(s, albumId, list) {
  const id = albumOf(s, albumId)?.id;
  const follows = st => !st.slidesOwn && (albumOf(s, st.albumId)?.id === id);
  return {
    albums: s.albums.map(a => (a.id === id ? { ...a, slides: list } : a)),
    artboards: s.artboards.map(b => (b.id !== s.activeBoard && follows(b.settings) ? { ...b, settings: { ...b.settings, slides: list } } : b)),
    ...(follows(s) ? { slides: list } : {}),
  };
}
// 画板改为跟随某个图集
const followAlbum = (st, album) => ({ ...st, albumId: album.id, slides: album.slides, slidesOwn: false });

/**
 * 修改当前画板用的图片列表。fn(list) → 新列表（返回 null 表示不修改）
 *   scope 'shared'（左侧列表的操作）：画板跟随图集时改图集，所有跟随这个图集的画板一起变；单独设置过的画板只改自己
 *   scope 'board'（画布上对某张卡片的操作）：只改当前画板——跟随图集的画板从此单独设置。
 *     图集里还没有真实图片时（第一次放图），仍然放进图集
 */
function editSlides(fn, scope = 'shared') {
  const s = store.get();
  if (s.slidesOwn) {
    const next = fn(s.slides);
    if (next) store.set({ slides: next });
    return;
  }
  const cur = albumSlides(s);
  const next = fn(cur);
  if (!next) return;
  if (scope === 'board' && hasReal(cur)) store.set({ slides: next, slidesOwn: true });
  else store.set(albumPatch(s, s.albumId, next));
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
  // 当前画板（及多选的画板）恢复跟随各自的图集
  followLibrary() {
    const s = store.get();
    const sel = new Set(selectionOf(s));
    store.set({
      slides: albumSlides(s),
      slidesOwn: false,
      artboards: s.artboards.map(b => (b.id !== s.activeBoard && sel.has(b.id) && b.settings.slidesOwn
        ? { ...b, settings: { ...b.settings, slides: albumSlides(s, b.settings.albumId), slidesOwn: false } } : b)),
    });
  },
  // 把当前画板的图片顺序设为它的图集（跟随这个图集的画板一起变），当前画板改为跟随
  shareBoardSlides() {
    const s = store.get();
    store.set({ ...albumPatch({ ...s, slidesOwn: false }, s.albumId, s.slides), slidesOwn: false });
  },

  /* ---------- 图集 ---------- */
  // 新建图集（可以带图片）；switchBoards：当前画板（及多选的画板）改为跟随它。返回新图集的 id
  addAlbum(name, slides = [], { switchBoards = true } = {}) {
    const s = store.get();
    const taken = new Set(s.albums.map(a => a.name));
    let albumName = name || `图集 ${s.albums.length + 1}`;
    for (let i = 2; taken.has(albumName); i++) albumName = `${name || '图集'} ${i}`;
    const album = { id: newAlbumId(), name: albumName, slides };
    const next = { ...s, albums: [...s.albums, album] };
    store.set(switchBoards ? { albums: next.albums, ...boardsToAlbum(next, album) } : { albums: next.albums });
    return album.id;
  },
  renameAlbum(id, name) {
    store.set(s => ({ albums: s.albums.map(a => (a.id === id ? { ...a, name } : a)) }));
  },
  // 删除图集（至少保留一个）：关联它的画板改为关联第一个其他图集（跟随的画板换成那个图集的图片）
  removeAlbum(id) {
    const s = store.get();
    if (s.albums.length <= 1) return false;
    const albums = s.albums.filter(a => a.id !== id);
    const fallback = albums[0];
    const fix = st => (st.albumId === id ? (st.slidesOwn ? { ...st, albumId: fallback.id } : followAlbum(st, fallback)) : st);
    const cur = fix(boardSettingsOf(s));
    store.set({
      albums,
      artboards: s.artboards.map(b => (b.id === s.activeBoard ? b : { ...b, settings: fix(b.settings) })),
      ...cur,
    });
    return true;
  },
  // 直接修改某个图集的图片（左栏查看别的图集时的排序、删除、导入）；fn(list) → 新列表（null 表示不改）
  editAlbum(id, fn) {
    const s = store.get();
    const album = s.albums.find(a => a.id === id);
    const next = album && fn(album.slides);
    if (next) store.set(albumPatch(s, id, next));
  },
  /**
   * 把一张图片移到（copy 时复制到）另一个图集，放在最后；from 为来源图集（null：只复制，比如来自画板单独的列表）
   */
  moveSlideToAlbum(slideId, from, to, copy = false) {
    const s = store.get();
    const target = s.albums.find(a => a.id === to);
    const slide = libraryOf(s).find(x => x.id === slideId);
    if (!target || !slide || from === to) return false;
    let next = target.slides.some(x => x.id === slideId) ? s : { ...s, ...albumPatch(s, to, [...target.slides.filter(x => !x.placeholder), slide]) };
    const src = from && next.albums.find(a => a.id === from);
    if (src && !copy) next = { ...next, ...albumPatch(next, from, src.slides.filter(x => x.id !== slideId)) };
    store.set({ albums: next.albums, artboards: next.artboards, slides: next.slides });
    return true;
  },
  // 某张卡片固定显示一张图片（可以是别的图集里的），只影响这张卡片
  pinCard(order, slideId) {
    actions.setItemAdjust(order, { slide: slideId });
  },
  // 当前画板（及多选的画板）换成某个图集，并跟随它
  setBoardAlbum(id) {
    const s = store.get();
    const album = s.albums.find(a => a.id === id);
    if (album) store.set(boardsToAlbum(s, album));
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
  // 新建画板：duplicate 时复制当前画板的全部设置（包括图集、是否跟随），否则沿用比例、跟随当前画板的图集；位置由调用方算好
  addArtboard({ x, y, duplicate = false, name, from = null }) {
    const s = store.get();
    const boards = boardsOf(s);
    const src = from ? boards.find(b => b.id === from) : boards.find(b => b.id === s.activeBoard);
    const { slides, slidesOwn, ...rest } = src.settings;
    const album = albumOf(s, src.settings.albumId);
    const settings = duplicate
      ? boardSettings({ ...JSON.parse(JSON.stringify(rest)), ...(slidesOwn ? { slides: [...slides], slidesOwn: true } : { slides: album.slides }), albumId: album.id })
      : boardSettings({ aspect: s.aspect, slides: album.slides, albumId: album.id });
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
  setAspect(rawId) {
    const s = store.get();
    const id = normalizeAspect(rawId, shortSide(s.aspect)); // 比例 → 像素（保持当前短边）
    // 切到长图时，版式不支持就换成规整网格
    const fix = st => (id === 'long' && !getLayout(st.layoutId).long ? { layoutId: 'grid', camera: { ...DEFAULT_CAMERA } } : {});
    store.set({ aspect: id, ...fix(s), artboards: syncSelected(s, st => ({ ...st, aspect: id, ...fix(st) })) });
  },
  setExport(key, value) {
    store.set(s => ({ exportOpts: { ...s.exportOpts, [key]: value } }));
  },
  // 调整某个位置的卡片（patch 中的数值为绝对值）
  // patch 里值为 undefined 的项 = 去掉这一项
  setItemAdjust(order, patch) {
    actions.setItemAdjusts([{ order, patch }]);
  },
  // 一次调整多张卡片（多选移动 / 对齐 / 分布），作为一步撤销
  setItemAdjusts(list) {
    store.set(s => {
      const cur = { ...(s.adjust[s.layoutId] || {}) };
      for (const { order, patch } of list) {
        const next = { ...cur[order], ...patch };
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        if (Object.keys(next).length) cur[order] = next; else delete cur[order];
      }
      return { adjust: { ...s.adjust, [s.layoutId]: cur } };
    });
  },
  // 去掉所有卡片手动调整里的某一项（例如 lift：恢复版式默认的前后），其他调整保留
  clearAdjustKey(key) {
    store.set(s => {
      const cur = {};
      for (const [order, a] of Object.entries(s.adjust[s.layoutId] || {})) {
        const { [key]: _drop, ...rest } = a;
        if (Object.keys(rest).length) cur[order] = rest;
      }
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
      let aspect = normalizeAspect(isValidAspect(p.aspect) ? p.aspect : s.aspect, shortSide(s.aspect));
      if (aspect === 'long' && !layout.long) aspect = '1920x1080';
      const style = p.style ? { ...s.style, ...p.style, bgImageId: s.style.bgImageId } : s.style;
      return {
        layoutId: layout.id,
        params: { ...s.params, [layout.id]: layoutParams(layout, p.params || {}) },
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
