import { store, actions, selectionOf, libraryOf, boardsOf, albumOf, BOARD_KEYS } from './state.js';
import { getLayout } from './layouts/index.js';
import { createAlbumBar } from './ui/albumBar.js';
import { createSizePicker } from './ui/sizePicker.js';
import { canvasOf } from './app/boards.js';
import { createProjectController } from './project/controller.js';
import { createHistory } from './project/history.js';
import { view } from './workspace/view.js';
import { createSlidesPanel } from './ui/slidesPanel.js';
import { createSettingsPanel } from './ui/settingsPanel.js';
import { createTopbarMenus } from './ui/topbarMenus.js';
import { createProjectDialog } from './ui/projectDialog.js';
import { attachViewportInteraction } from './ui/viewportInteraction.js';
import { createToolbar } from './ui/toolbar.js';
import { createBgPicker } from './ui/bgPicker.js';
import { createFadePicker } from './ui/fadePicker.js';
import { createResizeHandles } from './ui/resizeHandles.js';
import { createPresetsPanel } from './ui/presetsPanel.js';
import { initResizers } from './ui/resizer.js';
import { toast } from './ui/toast.js';
import { el } from './ui/dom.js';
import { setWheelMode } from './ui/wheel.js';
import { applyIcons, icon } from './ui/icons.js';
import './core/noPageZoom.js';
import { placeholders, slidesOf, hasRealSlides, is3D, isPerspective, getAdjust, nextLift } from './app/boards.js';
import { ui, setUi, setSelection, clearSelection, resetCardState, onUiChange } from './app/uiState.js';
import { activeCardScene, visibleCards, stackCards, canStack, canPlaceCards, placeCards, resetStack, stackChanged } from './app/cardOrder.js';
import { createWorkspace } from './app/workspace.js';
import { createImporting } from './app/importing.js';
import { createExporting } from './app/exporting.js';
import { createBoardOps } from './app/boardOps.js';
import { createAlignment } from './app/alignment.js';
import { createContextMenus } from './app/contextMenus.js';
import { createLayerTools, SLIDES_ID } from './app/layerTools.js';
import { createInspector } from './ui/inspector.js';
import { createContextBar } from './ui/contextBar.js';
import { setUsedFonts } from './ui/fontPicker.js';
import { applyLayerProp, typeName } from './layers/model.js';
import { createMockups } from './app/mockups.js';
import { createMemoryGuard } from './app/memory.js';
import { hasAdjust } from './render/scene.js';
import { createViewCube } from './ui/viewCube.js';

/**
 * 入口：创建各个模块并把它们连起来。
 *   app/workspace     工作区渲染、视图、坐标换算
 *   app/importing     导入图片（选择 / 拖入 / 粘贴）、背景图
 *   app/exporting     导出、复制、离屏预览
 *   app/boardOps      画板新建 / 复制 / 重命名 / 删除
 *   app/alignment     对齐、分布、吸附参考线
 *   app/contextMenus  右键菜单
 *   app/uiState       悬停 / 选中等交互状态（不进 store）
 */
applyIcons();

const $ = id => document.getElementById(id);
const stage = $('stage');
const viewport = $('viewport'); // 工作区：铺满中间区域，所有画板画在同一张画布上

let ws;
try {
  ws = createWorkspace({ viewport, bgCanvas: $('bg-canvas'), glCanvas: $('gl-canvas'), fgCanvas: $('fg-canvas') });
} catch (err) {
  stage.innerHTML = `<div class="stage-error">${err.message}<br>请使用最新版 Chrome / Edge / Safari / Firefox</div>`;
  throw err;
}
const boards = createBoardOps(ws);

/* ---------------- 导出 / 项目 ---------------- */

const exporting = createExporting({ copyBtn: $('copy-btn'), exportBtn: $('export-btn') });

const saveStatus = $('save-status');
const projectTitle = $('project-title');
let projectDialog = null;
const controller = createProjectController({
  store, actions, placeholders, snapshot: exporting.snapshot,
  onStatus: text => {
    saveStatus.textContent = text;
    saveStatus.dataset.state = text;
  },
  onChange: () => projectDialog?.refresh(),
});
projectDialog = createProjectDialog({ store, controller, download: exporting.download, toast });
$('project-btn').addEventListener('click', () => projectDialog.open());

window.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    controller.markDirty();
    controller.flush().then(() => toast('已保存'));
  }
});
window.addEventListener('pagehide', () => { controller.flush(); });
window.addEventListener('slidegrid:db', e => toast(e.detail, { error: true, sticky: true }));

async function importProject(file) {
  try {
    toast('正在导入项目…', { sticky: true });
    const { record, failed } = await controller.importFile(file);
    toast(failed ? `已导入「${record.name}」，${failed} 张图片无法读取` : `已导入项目「${record.name}」`, { error: failed > 0 });
  } catch (err) {
    console.error(err);
    toast(`导入失败：${err.message}`, { error: true, duration: 5000 });
  }
}

/* ---------------- 撤销 / 重做 ---------------- */

const isMac = navigator.platform.includes('Mac');
const undoBtn = $('undo-btn');
const redoBtn = $('redo-btn');
const history = createHistory(store, {
  onChange: () => {
    undoBtn.disabled = !history.canUndo();
    redoBtn.disabled = !history.canRedo();
    undoBtn.title = history.canUndo() ? `撤销：${history.undoLabel()}（${isMac ? '⌘Z' : 'Ctrl+Z'}）` : '没有可撤销的操作';
    redoBtn.title = history.canRedo() ? `重做：${history.redoLabel()}（${isMac ? '⇧⌘Z' : 'Ctrl+Y'}）` : '没有可重做的操作';
  },
});
// 大项目的内存保护（app/memory.js）
const memory = createMemoryGuard({ history });

function doUndo() {
  const label = history.undo();
  if (label) { clearSelection(); toast(`已撤销：${label}`); }
}
function doRedo() {
  const label = history.redo();
  if (label) { clearSelection(); toast(`已重做：${label}`); }
}
undoBtn.addEventListener('click', doUndo);
redoBtn.addEventListener('click', doRedo);
window.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const t = e.target;
  if (/^(INPUT|TEXTAREA)$/.test(t?.tagName) || t?.isContentEditable) return; // 输入框里保留自己的撤销
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); doRedo(); }
});

/* ---------------- 导入 ---------------- */

const importing = createImporting({
  ws,
  targetAlbum: () => browsedAlbum()?.id || null,       // 查看别的图集时，散的图片导入到那个图集
  onAlbumCreated: id => setUi('browseAlbum', id),        // 拖入文件夹新建的图集：左栏切过去查看（画板不变）
  listSlide: id => libraryOf(store.get()).find(x => x.id === id) || null,
  deviceAt: (x, y) => layerTools?.deviceAtClient(x, y) || null,
  onDeviceChanged: id => { setTool('select'); clearSelection(); layerTools.select([id]); },
  fileInput: $('file-input'),
  folderInput: $('folder-input'),
  overlay: $('drop-overlay'),
  dropLabel: $('drop-label'),
  onProjectFile: importProject,
  onLayoutFile: file => { settings.showTab('mine'); presetsPanel.importFile(file); },
  // 粘贴的图片 / SVG 成为图层后：选中它们，切回选择工具
  onLayersAdded: ids => { setTool('select'); clearSelection(); layerTools.select(ids); },
});
document.querySelectorAll('[data-action="pick-files"]').forEach(b => b.addEventListener('click', importing.pickFiles));
document.querySelectorAll('[data-action="pick-folder"]').forEach(b => b.addEventListener('click', importing.pickFolder));
$('clear-btn').addEventListener('click', () => {
  const browsing = browsedAlbum();
  if (browsing) {
    if (browsing.slides.length && confirm(`清空图集「${browsing.name}」的图片？（用这个图集的画板都会清空）`)) actions.editAlbum(browsing.id, () => []);
    return;
  }
  if (!hasRealSlides()) return;
  const msg = store.get().slidesOwn
    ? '移除当前画板的全部图片？（这个画板单独设置了图片，其他画板不受影响）'
    : `清空图集「${albumOf(store.get())?.name}」的图片？（用这个图集的画板都会清空；单独设置过图片的画板不受影响）`;
  if (confirm(msg)) actions.clearSlides();
});

// 左栏查看的图集：点图集只是查看（列表显示它的图片），不会改变画板；排序 / 删除 / 导入改的是这个图集。
// 把列表里的图片拖到画布卡片上 = 只替换这一张；拖到别的图集上 = 移到那个图集（按住 Alt 复制）
function browsedAlbum(s = store.get()) {
  const id = ui.browseAlbum;
  return id && id !== albumOf(s)?.id ? s.albums.find(a => a.id === id) || null : null;
}
const listSlides = (s = store.get()) => browsedAlbum(s)?.slides ?? s.slides;
// 列表图片的来源图集（拖到别的图集时从这里移走）；画板单独设置的列表没有来源图集
const listAlbumId = (s = store.get()) => browsedAlbum(s)?.id ?? (s.slidesOwn ? null : albumOf(s)?.id);
const setBrowse = id => setUi('browseAlbum', id && id !== albumOf(store.get())?.id ? id : null);

// 左栏顶部：图集（叠放）
const albumBar = createAlbumBar($('album-bar'), {
  store, actions, toast,
  browsingId: () => browsedAlbum()?.id || albumOf(store.get())?.id,
  onBrowse: setBrowse,
  onUseForBoard: id => { actions.setBoardAlbum(id); setBrowse(null); },
  onDropSlide: (slideId, to, copy) => {
    const name = libraryOf(store.get()).find(x => x.id === slideId)?.name || '图片';
    const from = listAlbumId();
    if (actions.moveSlideToAlbum(slideId, from, to, copy || !from)) {
      toast(`已${copy || !from ? '复制' : '移动'}「${name}」到图集「${store.get().albums.find(a => a.id === to)?.name}」`);
    }
  },
});

// 图集和图片列表之间的分隔条：上下拖动调整图集区域的高度（记住；双击恢复）
{
  const bar = $('album-bar'), split = $('album-splitter'), KEY = 'slidegrid:album-h';
  const setH = h => { if (h) bar.style.setProperty('--album-h', `${h}px`); else bar.style.removeProperty('--album-h'); };
  try { setH(Number(localStorage.getItem(KEY)) || 0); } catch { /* 忽略 */ }
  split.addEventListener('pointerdown', e => {
    e.preventDefault();
    split.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = bar.getBoundingClientRect().height;
    const max = () => $('slides-panel').getBoundingClientRect().height * 0.7;
    document.body.classList.add('resizing-v');
    const move = ev => setH(Math.round(Math.max(64, Math.min(max(), h0 + ev.clientY - y0))));
    const up = () => {
      split.removeEventListener('pointermove', move);
      document.body.classList.remove('resizing-v');
      try { localStorage.setItem(KEY, String(Math.round(bar.getBoundingClientRect().height))); } catch { /* 忽略 */ }
    };
    split.addEventListener('pointermove', move);
    split.addEventListener('pointerup', up, { once: true });
    split.addEventListener('pointercancel', up, { once: true });
  });
  split.addEventListener('dblclick', () => { setH(0); try { localStorage.removeItem(KEY); } catch { /* 忽略 */ } });
}

// 左栏顶部：当前画板的图片来源（跟随图集 / 单独设置）
const slidesMode = $('slides-mode');
function renderSlidesMode(s) {
  const boards = boardsOf(s);
  const album = albumOf(s);
  // 图片列表标题：正在显示哪个图集
  const shown = browsedAlbum(s) || (!s.slidesOwn ? album : null);
  $('slides-subtitle').textContent = shown ? shown.name : '此画板的图片';
  $('slides-subtitle').title = shown ? `图集「${shown.name}」里的图片` : '这个画板单独设置的图片列表';
  const following = boards.filter(b => !b.settings.slidesOwn && albumOf(s, b.settings.albumId)?.id === album?.id).length;
  const browsing = browsedAlbum(s);
  if (browsing) {
    // 查看别的图集：画板不变；拖图片到卡片上只替换那一张
    slidesMode.hidden = false;
    slidesMode.className = 'slides-mode browse';
    slidesMode.replaceChildren(
      el('span', { class: 'sm-text', title: '点图集只是查看：把图片拖到画布的卡片上，只替换那一张；拖到上面别的图集上，移动过去（按住 Alt 复制）' },
        icon('images', 14), `正在查看「${browsing.name}」· 拖图片到卡片上替换单张`),
      el('button', { class: 'btn ghost small', title: `当前画板（多选时所选画板）换成图集「${browsing.name}」`, onclick: () => { actions.setBoardAlbum(browsing.id); setBrowse(null); toast(`已换成图集「${browsing.name}」`); } }, '用于当前画板'),
      el('button', { class: 'btn ghost small', title: `回到当前画板的图集「${album?.name}」`, onclick: () => setBrowse(null) }, '返回'),
    );
    return;
  }
  if (s.slidesOwn) {
    slidesMode.hidden = false;
    slidesMode.className = 'slides-mode own';
    slidesMode.replaceChildren(
      el('span', { class: 'sm-text', title: '在画布上单独替换 / 移除过卡片，这个画板有自己的图片列表，图集的变化不影响它' },
        icon('frame', 14), '此画板单独设置了图片'),
      el('button', { class: 'btn ghost small', title: `改回跟随图集「${album?.name}」（这个画板单独的顺序和替换会丢失）`, onclick: () => { actions.followLibrary(); toast('已恢复跟随图集'); } }, '恢复跟随'),
      el('button', { class: 'btn ghost small', title: `把这个画板的图片列表存回图集「${album?.name}」，用这个图集的画板一起更新`, onclick: () => { actions.shareBoardSlides(); toast(`已更新图集「${album?.name}」`); } }, '存回图集'),
    );
  } else if (boards.length > 1) {
    slidesMode.hidden = false;
    slidesMode.className = 'slides-mode';
    slidesMode.replaceChildren(el('span', { class: 'sm-text', title: '这里的修改会同步到用这个图集的所有画板；在画布上单独替换 / 移除某张卡片时，只改那个画板' },
      icon('images', 14), `${following} 个画板在用这个图集`));
  } else {
    slidesMode.hidden = true;
  }
}

/* ---------------- 面板 ---------------- */

const panels = initResizers($('app'));
document.querySelector('.slides-head').append(panels.collapseButton('left'));

const slidesPanel = createSlidesPanel({
  listEl: $('slide-list'),
  countEl: $('slide-count'),
  emptyEl: $('empty-tip'),
  dropzone: $('dropzone'),
  footEl: $('slides-foot'),
  viewButtons: { grid: $('view-grid'), list: $('view-list') },
  // 查看别的图集时，删除 / 排序改的是那个图集
  onRemove: id => { const b = browsedAlbum(); if (b) actions.editAlbum(b.id, l => l.filter(x => x.id !== id)); else actions.removeSlide(id); },
  onMove: (from, to) => {
    const b = browsedAlbum();
    if (!b) { actions.moveSlide(from, to); return; }
    actions.editAlbum(b.id, l => { if (from === to || !l[from]) return null; const n = [...l]; const [x] = n.splice(from, 1); n.splice(Math.min(to, n.length), 0, x); return n; });
  },
  onHover: i => setUi('listHover', browsedAlbum() ? null : i), // 左侧悬停 → 当前画板里高亮这张图出现的所有位置
  onPick: importing.pickFiles,
});
const settings = createSettingsPanel($('settings-panel'), {
  store, actions,
  notify: msg => toast(msg, { error: true }),
  imageCtx: {
    imageThumb: id => store.get().assets[id]?.thumb || null,
    pickImage: importing.pickBackground,
    dropTarget: 'background',
  },
  // 从工具条「更多背景 / 遮罩设置」跳过来时，先取消选择，回到画板设置
  onBoardRequest: () => { clearSelection(); layerTools?.clear(); },
  layoutPreview: exporting.layoutPreview,
});
document.querySelector('#settings-panel .rp-tabs').append(panels.collapseButton('right'));
const presetsPanel = createPresetsPanel(settings.presetsContainer, {
  store, actions, snapshot: exporting.snapshot, toast, download: exporting.download, footer: settings.presetsFooter, saveFooter: settings.designFooter,
  onCount: n => settings.setPresetCount(n),
});
const topbarMenus = createTopbarMenus($('board-bar'), {
  store, actions,
  onActivate: id => boards.activateBoard(id),
  onAdd: boards.addBoard,
  onDuplicateSelected: boards.duplicateSelected,
  onRename: boards.renameBoard,
  onDelete: boards.deleteBoard,
  onDeleteSelected: () => boards.deleteBoards(),
  onFitAll: ws.fitAll,
});
// 顶栏：导出尺寸 + 复制时的透明背景开关（与导出的透明设置相互独立）
const sizePicker = createSizePicker($('size-picker'), { store, actions, canvasOf });
const copyTransparentBtn = Object.assign(document.createElement('button'), { className: 'eg-toggle', type: 'button' });
copyTransparentBtn.append(Object.assign(document.createElement('span'), { className: 'checker-swatch' }));
copyTransparentBtn.addEventListener('click', () => actions.setExport('copyTransparent', !store.get().exportOpts.copyTransparent));
$('copy-btn').before(copyTransparentBtn);
function refreshCopyTransparent(o) {
  copyTransparentBtn.classList.toggle('on', !!o.copyTransparent);
  copyTransparentBtn.setAttribute('aria-pressed', String(!!o.copyTransparent));
  copyTransparentBtn.title = o.copyTransparent
    ? '复制透明背景：开（复制的 PNG 去掉画板背景）· 与导出设置无关'
    : '复制透明背景：关（复制带背景）· 点击打开';
}
refreshCopyTransparent(store.get().exportOpts);

/* ---------------- 工具 ---------------- */

const CARD_TOOLS = ['select', 'rotate', 'scale'];
const SELECT_TOOLS = [...CARD_TOOLS, 'crop']; // 切换到这些工具时保留卡片选择
// 工具是否可用：单张卡片调整（选择 / 旋转 / 比例）只用于平面版式
function toolAvailability(id) {
  // 选择工具在 3D 版式下仍可用（选图层、移动画板），只是不能单独调整卡片
  if (CARD_TOOLS.includes(id) && id !== 'select' && is3D()) return { ok: false, reason: '3D 版式暂不支持单张卡片调整，可在平面版式中使用' };
  return { ok: true, reason: '' };
}
function setTool(id) {
  if (!toolAvailability(id).ok) {
    toast(toolAvailability(id).reason, { error: true });
    return;
  }
  ui.tool = id;
  if (!SELECT_TOOLS.includes(id)) clearSelection();
  layerTools?.onToolChange(id);
  refreshTools();
}
let interaction = null;
let layerTools = null; // 见下方「图层」
function refreshTools() {
  updateHint();
  interaction?.updateCursor();
  ws.scheduleRender();
}

const toolbar = createToolbar($('app'), {
  onTool: setTool,
  availability: toolAvailability,
  onZoomIn: () => ws.zoomViewBy(1.25),
  onZoomOut: () => ws.zoomViewBy(0.8),
  onFit: () => ws.fitBoard(),
  onFitAll: ws.fitAll,
  onActualSize: ws.actualSize,
  onResetAdjust: () => {
    actions.resetAdjust();
    clearSelection();
    toast('已重置当前画板的卡片调整');
  },
});
// 撤销 / 重做放在画布右下角的视图条最前面
toolbar.viewbar.prepend(document.querySelector('.history-btns'));

const alignment = createAlignment({ ws, viewport, alignSlot: toolbar.alignSlot, snapSlot: toolbar.viewSlot, layers: () => layerTools });

// 工具条上的「画板背景」：快速切换类型、预设色板、自定义颜色
const bgPicker = createBgPicker(toolbar.bgSlot, {
  store, actions,
  pickImage: importing.pickBackground,
  onMore: () => settings.revealBackground(),
});

// 图层（文字、形状、钢笔路径）的交互
// 和选中的卡片一起移动时：屏幕位移 → 各卡片的手动调整（只用于平面版式）
const cardPatches = orders => {
  if (is3D()) return null;
  const starts = orders.map(o => ({ o, adj: { dx: 0, dy: 0, ...getAdjust(o) } }));
  return (mx, my) => {
    const [lx, ly] = ws.toLayoutDelta(mx, my);
    return starts.map(({ o, adj }) => ({ order: o, patch: { dx: adj.dx + lx, dy: adj.dy + ly } }));
  };
};
layerTools = createLayerTools({
  ws, viewport,
  getTool: () => ui.tool,
  setTool,
  setGuides: alignment.setGuides,
  snapEnabled: () => store.get().snap,
  getCardSelection: () => ui.selection,
  setCardSelection: orders => setSelection(orders),
  cardPatches,
});
ws.hooks.drawOverlay = layerTools.drawOverlay;
ws.hooks.editingLayer = layerTools.editingId;

// 设备样机：样机页、拖到画板上、上传 PNG 样机（app/mockups.js）
const mockups = createMockups({
  ws, viewport, settingsSlot: settings.mockupSlot, importing, setTool, clearSelection,
  getLayerTools: () => layerTools,
});

// 画板里看得见的卡片（按场景缓存）：图层列表的「幻灯片」一组、左栏图片的「在画板里」标记
const cardListCache = new WeakMap();
const visibleOf = scene => {
  let v = cardListCache.get(scene);
  if (!v) { v = visibleCards(scene); cardListCache.set(scene, v); }
  return v;
};
let usedScene = null;
function refreshUsed(s = store.get()) {
  const scene = activeCardScene(s);
  if (scene === usedScene) return;
  usedScene = scene;
  slidesPanel.markUsed(new Set(visibleOf(scene).filter(it => !it.slide.placeholder).map(it => it.slide.id)));
}
// 检查器：「设计」页里选中对象的属性、「图层」页的图层列表
const inspector = createInspector({ selectionSlot: settings.selectionSlot, layersSlot: settings.layersSlot }, {
  store, actions, ui, is3D, setTool,
  cardParams: () => getLayout(store.get().layoutId).cardParams || null,
  onDeviceImage: l => mockups.pickImage(l),
  onDeviceQuad: l => mockups.adjustQuad(l),
  selectLayers: ids => { if (ids.length) setSelection([]); layerTools.select(ids); },
  getCards: () => ui.selection,
  placeLayers: (ids, target, place) => layerTools.placeAt(ids, target, place),
  slidesId: SLIDES_ID,
  menus: {
    layer: (x, y, layer, opts) => onContextMenu.layerMenu(x, y, layer, opts),
    card: (x, y, card) => onContextMenu.cardMenu(x, y, card),
  },
  clearAll: () => { clearSelection(); layerTools.clear(); },
  // 图层列表里的「幻灯片」一组：画板里看得见的卡片（按场景缓存）
  cards: {
    list: () => visibleOf(activeCardScene()),
    select: orders => { layerTools.clear(); setSelection(orders); },
    canStack,
    canDrag: canPlaceCards,
    place: placeCards,
    resetStack,
    stackChanged,
    hover: order => setUi('hover', order),
  },
  onFade: () => settings.revealStyleGroup('渐隐遮罩'),
  notify: msg => toast(msg),
});
// 顶部工具条的上下文属性
const contextBar = createContextBar(toolbar.ctxSlot, {
  store, ui, typeName,
  setLayerProp: (key, value) => actions.updateLayers(ui.layerSel, l => applyLayerProp(l, key, value)),
  setCards: (key, value) => actions.setItemAdjusts(ui.selection.map(order => ({ order, patch: { [key]: value } }))),
  getCards: () => ui.selection,
  resetCrop: order => actions.resetCrop(order),
  reorder: (dir, toEnd) => layerTools.reorder(dir, toEnd),
  removeLayers: () => layerTools.remove([...ui.layerSel]),
  booleanOp: op => layerTools.booleanOp(op),
  booleanCount: () => layerTools.booleanCount(),
});

// 设计页：有选中对象时显示它们的属性，否则显示画板设置；顶部工具条同样跟随选择
const syncInspector = (s = store.get()) => {
  inspector.update(s);
  settings.setSelectionMode(inspector.hasSelection());
  settings.setLayerCount((s.layers || []).length);
  const ctx = contextBar.update(s);
  toolbar.bgSlot.hidden = ctx !== 'board'; // 画板背景、遮罩只在没有选择时显示
};

// 工具条上的「渐隐遮罩」：一键预设
const fadePicker = createFadePicker(toolbar.bgSlot, {
  store, actions,
  onMore: () => settings.revealStyleGroup('渐隐遮罩'),
});

// 画板框选的矩形
const marquee = Object.assign(document.createElement('div'), { className: 'marquee', hidden: true });
viewport.append(marquee);
function setMarquee(r) {
  marquee.hidden = !r;
  if (r) Object.assign(marquee.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
}

// 选中卡片的缩放手柄：选择 / 旋转 / 比例工具下、平面版式中、只选中一张时显示
const resizeHandles = createResizeHandles(viewport, {
  getTarget: () => {
    if (ui.selected == null || ui.selection.length !== 1 || is3D() || ui.tempHand) return null;
    if (!CARD_TOOLS.includes(ui.tool)) return null;
    return ws.findItem(ui.selected);
  },
  cornersClient: ws.itemCornersClient,
  centerClient: ws.itemCenterClient,
  getAdjust,
  setItemAdjust: (order, patch) => actions.setItemAdjust(order, patch),
  toLayoutDelta: ws.toLayoutDelta,
  nextLift,
});

const onContextMenu = createContextMenus({ ws, boards, importing, exporting, panels, slidesPanel, bgPicker, setTool, layerTools, ui });

// 立方体视图（3D 版式时在画布右上角）：拖动旋转视角、点面切换正视 / 俯视…、透视 / 正交
createViewCube($('stage'), { store, actions });

interaction = attachViewportInteraction(viewport, {
  getTool: () => ui.tool,
  setTool,
  toolAvailable: id => toolAvailability(id).ok,
  is3D,
  isPerspective,
  cardSelectable: () => !!getLayout(store.get().layoutId).cardParams,
  canSwap: hasRealSlides,
  getSlide: i => store.get().slides[i],
  onTempHand: on => { ui.tempHand = on; refreshTools(); },
  // 画板与视图（⌘D 复制所选画板；Alt 拖动画板 = 原地复制后拖动副本）
  duplicateBoards: () => boards.duplicateSelected(),
  duplicateBoardsInPlace: ids => boards.duplicateInPlace(ids),
  boardAt: ws.boardAt,
  activeBoard: () => store.get().activeBoard,
  activateBoard: boards.activateBoard,
  boardRect: ws.boardInfo,
  allBoardIds: ws.boardIds,
  selectedBoards: () => selectionOf(store.get()),
  toggleBoardSelection: id => actions.toggleBoardSelection(id),
  selectBoards: ids => { const a = store.get().activeBoard; actions.selectBoards(ids, ids.includes(a) ? a : undefined); },
  selectAllBoards: () => actions.selectAllBoards(),
  moveBoards: moves => actions.moveArtboards(moves),
  setMarquee,
  onContextMenu,
  labelAt: ws.labelAt,
  pickOn: ws.pickOn,
  wheelMode: () => store.get().wheelNav,
  deleteSelectedBoards: () => boards.deleteBoards(),
  panView: ws.panBy,
  zoomViewAt: ws.zoomAtScreen,
  zoomViewBy: ws.zoomViewBy,
  fitActive: () => ws.fitBoard(),
  fitAll: ws.fitAll,
  actualSize: ws.actualSize,
  // 当前画板内
  pick: ws.pickAt,
  getCamera: () => store.get().camera,
  setCamera: actions.setCamera,
  setHover: hit => setUi('hover', hit ? hit.order : null),
  setDragSource: i => setUi('dragSource', i),
  setDropTarget: hit => setUi('dropTarget', hit ? hit.order : null),
  // 交换工具：只交换这两张卡片显示的图片
  onSwap: (a, b) => {
    if (a.order === b.order) return;
    actions.swapCards(a.order, a.slide.id, b.order, b.slide.id);
    toast(`已交换这两张卡片的图片（「${a.slide.name}」↔「${b.slide.name}」）`);
  },
  getAdjust,
  nextLift,
  toLayoutDelta: ws.toLayoutDelta,
  itemCenterClient: ws.itemCenterClient,
  itemCornersClient: ws.itemCornersClient,
  resetCrop: order => { actions.resetCrop(order); toast('已复位裁切'); },
  setItemAdjust: (order, patch) => actions.setItemAdjust(order, patch),
  resetItemAdjust: order => { actions.resetItemAdjust(order); toast('已复位这张卡片'); },
  getSelection: () => ui.selection,
  setSelection: (orders, primary) => setSelection(orders, primary),
  setItemAdjusts: list => actions.setItemAdjusts(list),
  itemRects: ws.itemRects,
  boardLocalRect: ws.boardLocalRect,
  layers: layerTools,
  getLayerSelection: () => ui.layerSel,
  applyEdits: edits => actions.applyEdits(edits),
  snapEnabled: () => store.get().snap,
  setGuides: alignment.setGuides,
  allCards: ws.allCards,
});

const hint = $('stage-hint');
const TOOL_HINTS = {
  select: '选择：拖动移动 · 拖角点缩放 · 拖角外侧旋转 · 空白处框选 · Shift/⌘ 加选 · ⌘A 全选 · 双击卡片复位',
  swap: '交换：把卡片拖到另一张上交换图片',
  rotate: '旋转：拖动卡片旋转 · Shift 按 15° 吸附',
  scale: '比例：拖动以中心等比缩放 · Shift 按 5% 吸附',
  crop: '裁切：拖动卡片平移图片 · 滚轮放大缩小 · 双击复位 · 右键切换「完整显示」',
  text: '文字：单击 = 点状文字 · 拖动 = 区块文字（自动换行）· 输入完按 Esc 或点别处结束 · 双击文字可再次编辑',
  rect: '矩形：拖动绘制 · Shift 正方形 · ⌥ 从中心',
  ellipse: '椭圆：拖动绘制 · Shift 正圆 · ⌥ 从中心',
  line: '直线：拖动绘制 · Shift 按 45° 吸附 · ⌥ 从中心 · 单击放一条默认长度的',
  pen: '钢笔：单击直角 · 拖动曲线 · Shift 45° · 拖动时 ⌥ 转角、空格移动锚点 · 点末点去掉控制柄 · 点首点闭合 · ⌘ 临时直接选择 · Enter 结束',
  direct: '直接选择：点锚点显示控制柄 · 拖锚点 / 控制柄（⌥ 打断，Shift 45°）· ⌥ 单击切换直角 / 平滑 · 双击加锚点 · Delete 删除 · 方向键微调',
  orbit: '构图：拖动调整画板内构图（3D 旋转 / Shift 平移）· 滚轮缩放构图',
  hand: '抓手：拖动平移视图',
  zoom: '放大镜：单击放大 · ⌥ 单击缩小',
  artboard: '画板：点击切换 · Shift/⌘ 单击加选 · 空白处拖动框选 · 拖动一起移动 · ⌥ 拖动复制 · ⌘D 复制 · ⌘A 全选 · Delete 删除所选',
};
function updateHint() {
  const s = store.get();
  const parts = [TOOL_HINTS[ui.tempHand ? 'hand' : ui.tool]];
  if (!s.slides.length) parts.push('拖入图片替换示例图');
  parts.push(s.wheelNav === 'scroll' ? '滚轮滚动 · ⌘ + 滚轮缩放' : '滚轮缩放', '空格 / 中键平移', '拖画板名称移动画板', 'Tab 隐藏面板');
  hint.textContent = parts.join('  ·  ');
}

/* ---------------- 同步 ---------------- */

// 每帧画完后：缩放手柄跟随卡片、工具条显示缩放比例、左栏高亮悬停的幻灯片
ws.hooks.afterRender = s => {
  resizeHandles.update();
  layerTools.syncEditor();
  toolbar.update({ tool: ui.tool, tempHand: ui.tempHand, viewZoom: view.zoom, adjustCount: Object.values(s.adjust[s.layoutId] || {}).filter(hasAdjust).length });
  if (ui.listHover == null) {
    const order = ui.dropTarget ?? ui.hover;
    const item = order != null && hasRealSlides() ? ws.findItem(order) : null;
    slidesPanel.highlight(item ? item.slideIndex : null);
  }
};

let hadSelection = false;
onUiChange(key => {
  if (key === 'browseAlbum') {
    const s = store.get();
    slidesPanel.render(listSlides(s));
    renderSlidesMode(s);
    albumBar.update(s);
  }
  if (key === 'selection' || key === 'layerSel') alignment.refreshAlign();
  if (key === 'selection' || key === 'layerSel') {
    syncInspector();
    // 新选中了对象：在「版式」页时切到「设计」页（「图层」页保持不动，方便连续管理图层）
    const has = inspector.hasSelection();
    if (has && !hadSelection && settings.currentTab() === 'layouts') settings.showMain('params');
    hadSelection = has;
  }
  ws.scheduleRender();
});

const SAVED_KEYS = ['slides', 'albums', 'assets', 'artboards', 'activeBoard', ...BOARD_KEYS];
const projectChanged = (a, b) => SAVED_KEYS.some(k => a[k] !== b[k]);

let prev = store.get();
setWheelMode(prev.wheelMode);
store.subscribe(s => {
  if (s.wheelMode !== prev.wheelMode) setWheelMode(s.wheelMode);
  if (s.slidesOwn !== prev.slidesOwn || s.artboards !== prev.artboards || s.activeBoard !== prev.activeBoard || s.albums !== prev.albums || s.albumId !== prev.albumId) {
    renderSlidesMode(s);
    albumBar.update(s);
  }
  mockups.update(s, prev);
  if (s.slides !== prev.slides || s.albums !== prev.albums || s.albumId !== prev.albumId) slidesPanel.render(listSlides(s));
  if (s.slides !== prev.slides) {
    // 只释放不再被任何画板使用的纹理
    ws.renderer.prune(new Set([...libraryOf(s), ...placeholders].map(x => x.id)));
  }
  if (s.layoutId !== prev.layoutId || s.project !== prev.project || s.activeBoard !== prev.activeBoard) {
    resetCardState();
    if (!toolAvailability(ui.tool).ok) ui.tool = 'select'; // 换版式后工具不可用就回到选择
  }
  if (s.project !== prev.project) {
    projectTitle.textContent = s.project?.name || '未命名项目';
    ws.clearBackgrounds();
    requestAnimationFrame(() => ws.fitBoard()); // 打开项目后显示当前画板
  }
  if (s.layers !== prev.layers || s.activeBoard !== prev.activeBoard || s.project !== prev.project) {
    layerTools.prune();
    // 项目里用到的字体（本机没装时也显示在字体列表里）
    setUsedFonts([...new Set(boardsOf(s).flatMap(b => (b.settings.layers || []).filter(l => l.type === 'text').map(l => l.fontFamily)))]);
  }
  if (projectChanged(s, prev)) controller.markDirty();
  settings.update(s);
  syncInspector(s);
  refreshUsed(s);
  topbarMenus.update(s);
  bgPicker.update(s);
  fadePicker.update(s);
  alignment.refreshSnap();
  sizePicker.update(s);
  refreshCopyTransparent(s.exportOpts);
  exporting.popover.update(s);
  refreshTools();
  prev = s;
  ws.scheduleRender();
});

slidesPanel.render(listSlides(prev));
renderSlidesMode(prev);
refreshUsed(prev);
topbarMenus.update(prev);
refreshTools();
ws.resize();
requestAnimationFrame(() => ws.fitBoard());

controller.init()
  .then(({ failed } = {}) => {
    if (failed) toast(`有 ${failed} 张图片无法读取`, { error: true });
  })
  .catch(err => {
    console.error(err);
    // 例如浏览器禁用了存储、隐私模式、以某些方式直接打开 HTML 文件：仍然可以正常使用，只是不会自动保存
    toast('当前环境无法使用浏览器存储：可以正常编辑和导出图片，但项目不会保存，刷新后会丢失。建议用 Chrome / Edge 打开', { error: true, duration: 8000 });
  });

// 便于调试 / 以后扩展
window.SlideGrid = {
  memory,
  store,
  actions,
  controller,
  history,
  ui,
  view,
  perf: ws.perf,
  render: ws.render,
  importFiles: importing.importFiles,
  renderToBlob: exporting.renderToBlob,
  pickAt: ws.pickAt,
  boardAt: ws.boardAt,
  itemRects: ws.itemRects,
  boardLocalRect: ws.boardLocalRect,
  setTool,
  fitBoard: ws.fitBoard,
  fitAll: ws.fitAll,
  addBoard: boards.addBoard,
  duplicateSelected: boards.duplicateSelected,
  deleteBoards: boards.deleteBoards,
  layers: layerTools,
  cards: { visible: () => visibleOf(activeCardScene()), stack: stackCards },
};
