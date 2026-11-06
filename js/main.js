import { store, actions, selectionOf, libraryOf, boardsOf, BOARD_KEYS } from './state.js';
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
import { placeholders, slidesOf, hasRealSlides, is3D, getAdjust, nextLift } from './app/boards.js';
import { ui, setUi, setSelection, clearSelection, resetCardState, onUiChange } from './app/uiState.js';
import { createWorkspace } from './app/workspace.js';
import { createImporting } from './app/importing.js';
import { createExporting } from './app/exporting.js';
import { createBoardOps } from './app/boardOps.js';
import { createAlignment } from './app/alignment.js';
import { createContextMenus } from './app/contextMenus.js';
import { createLayerTools } from './app/layerTools.js';
import { createInspector } from './ui/inspector.js';
import { createContextBar } from './ui/contextBar.js';
import { setUsedFonts } from './ui/fontPicker.js';
import { applyLayerProp, typeName, createLayer } from './layers/model.js';
import { deviceSize, deviceOf, deviceAspect, findScreen } from './layers/devices.js';
import { openQuadPicker } from './ui/quadPicker.js';

// 矩形 [x, y, w, h] → 四个角（左上、右上、右下、左下）
const rectQuad = ([x, y, w, h]) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
import { createMockupPanel } from './ui/mockupPanel.js';

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
  if (!hasRealSlides()) return;
  const msg = store.get().slidesOwn
    ? '移除当前画板的全部图片？（这个画板单独设置了图片，其他画板不受影响）'
    : '清空共用的图片列表？（跟随它的画板都会清空；单独设置过图片的画板不受影响）';
  if (confirm(msg)) actions.clearSlides();
});

// 左栏顶部：当前画板的图片来源（跟随共用列表 / 单独设置）
const slidesMode = $('slides-mode');
function renderSlidesMode(s) {
  const boards = boardsOf(s);
  const following = boards.filter(b => !b.settings.slidesOwn).length;
  if (s.slidesOwn) {
    slidesMode.hidden = false;
    slidesMode.className = 'slides-mode own';
    slidesMode.replaceChildren(
      el('span', { class: 'sm-text', title: '在画布上单独交换 / 替换 / 移除过卡片，这个画板有自己的图片列表，共用列表的变化不影响它' },
        icon('frame', 14), '此画板单独设置了图片'),
      el('button', { class: 'btn ghost small', title: '改回跟随共用列表（这个画板单独的顺序和替换会丢失）', onclick: () => { actions.followLibrary(); toast('已恢复跟随共用图片'); } }, '恢复跟随'),
      el('button', { class: 'btn ghost small', title: '把这个画板的图片列表设为共用列表，跟随的画板一起更新', onclick: () => { actions.shareBoardSlides(); toast('已设为共用图片'); } }, '设为共用'),
    );
  } else if (boards.length > 1) {
    slidesMode.hidden = false;
    slidesMode.className = 'slides-mode';
    slidesMode.replaceChildren(el('span', { class: 'sm-text', title: '这里的修改会同步到所有跟随的画板；在画布上单独交换 / 替换 / 移除某张卡片时，只改那个画板' },
      icon('images', 14), `共用图片 · ${following} 个画板跟随`));
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
  onRemove: id => actions.removeSlide(id),
  onMove: actions.moveSlide,
  onHover: i => setUi('listHover', i), // 左侧悬停 → 当前画板里高亮这张图出现的所有位置
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

// 样机：把设备加到当前画板中间（样机图层）；多台时依次显示下一张、稍微错开
// 把样机加到当前画板中间：宽度不超过画板的 62%、高度不超过 72%；多台时依次显示下一张、稍微错开
function addDeviceLayer(props, label, asset = null) {
  const s = store.get();
  const { W, H } = canvasOf(s);
  const list = s.layers || [];
  const used = list.filter(l => l.type === 'device').length;
  const aspect = deviceAspect(props.device, props);
  const { w, h } = deviceSize(props.device, Math.min(W * 0.62, (H * 0.72) / aspect), props);
  const l = createLayer('device', {
    ...props, w, h,
    slide: (used % slidesOf(s).length) + 1,
    x: (W - w) / 2 + used * 32, y: (H - h) / 2 + used * 32,
  }, list);
  if (asset) actions.addAssetLayers([asset], [l]);
  else actions.setLayers([...list, l]);
  setTool('select');
  clearSelection();
  layerTools.select([l.id]);
  toast(`已添加${label}样机`);
}
const mockupPanel = createMockupPanel(settings.mockupSlot, {
  getSlide: () => slidesOf(store.get())[0]?.preview,
  onAdd(p, frame) {
    const n = (store.get().layers || []).filter(x => x.type === 'device' && x.device === p.device).length + 1;
    addDeviceLayer({ device: p.device, yaw: p.yaw || 0, pitch: p.pitch || 0, frame, name: `${deviceOf(p.device).label} ${n}` }, `「${p.label}」`);
  },
  // 上传 PNG 样机：先自动识别透明的屏幕区域作为初始位置，再弹窗让用户拖四个角对准屏幕（支持透视）
  async onUpload(file) {
    let asset;
    try {
      toast('正在读取样机…', { sticky: true });
      asset = await importing.createAsset({ file });
    } catch (err) {
      console.error(err);
      toast('无法读取这张图片', { error: true });
      return;
    }
    toast('拖动四个角对准屏幕', { duration: 1500 });
    const found = findScreen(asset.preview);
    const auto = found && rectQuad(found);
    const quad = await openQuadPicker({
      image: asset.preview, quad: auto || rectQuad([0.2, 0.2, 0.6, 0.6]), auto,
      preview: slidesOf(store.get())[0]?.preview, screenOnTop: !found,
    });
    if (!quad) { asset.preview?.close?.(); return; }
    const name = file.name.replace(/\.[^.]+$/, '');
    addDeviceLayer({ device: 'custom', frameAssetId: asset.id, frameW: asset.width, frameH: asset.height, quad, screenOnTop: !found, name }, `「${name}」`, asset);
  },
  onAddCustom: t => addDeviceLayer({ device: 'custom', frameAssetId: t.frameAssetId, frameW: t.frameW, frameH: t.frameH, screen: t.screen, quad: t.quad, screenOnTop: t.screenOnTop, name: t.name }, `「${t.name}」`),
  // 本项目所有画板里用到的 PNG 样机（按外框去重）
  getCustom() {
    const s = store.get();
    const seen = new Map();
    for (const b of boardsOf(s)) {
      for (const l of b.settings.layers || []) {
        if (l.type !== 'device' || l.device !== 'custom' || !s.assets[l.frameAssetId] || seen.has(l.frameAssetId)) continue;
        seen.set(l.frameAssetId, { frameAssetId: l.frameAssetId, frameW: l.frameW, frameH: l.frameH, screen: l.screen, quad: l.quad, screenOnTop: l.screenOnTop, name: l.name.replace(/ \d+$/, ''), frameImg: s.assets[l.frameAssetId].preview });
      }
    }
    return [...seen.values()];
  },
});

// 检查器：「设计」页里选中对象的属性、「图层」页的图层列表
const inspector = createInspector({ selectionSlot: settings.selectionSlot, layersSlot: settings.layersSlot }, {
  store, actions, ui, is3D, setTool,
  onDeviceImage: l => importing.pickDeviceImage(l),
  // 重新调整 PNG 样机的屏幕四角
  async onDeviceQuad(l) {
    const frame = store.get().assets[l.frameAssetId]?.preview;
    if (!frame) return;
    const found = findScreen(frame);
    const quad = await openQuadPicker({
      title: '调整屏幕区域', image: frame, quad: l.quad || rectQuad(l.screen || [0.1, 0.1, 0.8, 0.8]), auto: found && rectQuad(found),
      preview: l.imageId ? store.get().assets[l.imageId]?.preview : slidesOf(store.get())[(l.slide || 1) - 1]?.preview, screenOnTop: !!l.screenOnTop,
    });
    if (quad) actions.updateLayers([l.id], { quad });
  },
  selectLayers: ids => layerTools.select(ids),
  getCards: () => ui.selection,
  reorder: dir => layerTools.reorder(dir),
  clearAll: () => { clearSelection(); layerTools.clear(); },
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

interaction = attachViewportInteraction(viewport, {
  getTool: () => ui.tool,
  setTool,
  toolAvailable: id => toolAvailability(id).ok,
  is3D,
  canSwap: hasRealSlides,
  getSlide: i => store.get().slides[i],
  onTempHand: on => { ui.tempHand = on; refreshTools(); },
  // 画板与视图
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
  onSwap: (a, b) => {
    actions.swapSlides(a, b);
    toast(`已交换第 ${a + 1} 张和第 ${b + 1} 张`);
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
  artboard: '画板：点击切换 · Shift/⌘ 单击加选 · 空白处拖动框选 · 拖动一起移动 · ⌘A 全选 · Delete 删除所选',
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
  toolbar.update({ tool: ui.tool, tempHand: ui.tempHand, viewZoom: view.zoom, adjustCount: Object.keys(s.adjust[s.layoutId] || {}).length });
  if (ui.listHover == null) {
    const order = ui.dropTarget ?? ui.hover;
    const item = order != null && hasRealSlides() ? ws.findItem(order) : null;
    slidesPanel.highlight(item ? item.slideIndex : null);
  }
};

let hadSelection = false;
onUiChange(key => {
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

const SAVED_KEYS = ['slides', 'library', 'assets', 'artboards', 'activeBoard', ...BOARD_KEYS];
const projectChanged = (a, b) => SAVED_KEYS.some(k => a[k] !== b[k]);

let prev = store.get();
setWheelMode(prev.wheelMode);
store.subscribe(s => {
  if (s.wheelMode !== prev.wheelMode) setWheelMode(s.wheelMode);
  if (s.slidesOwn !== prev.slidesOwn || s.artboards !== prev.artboards || s.activeBoard !== prev.activeBoard) renderSlidesMode(s);
  if (s.slides !== prev.slides || s.assets !== prev.assets || (s.layers !== prev.layers && s.activeBoard === prev.activeBoard && s.layers.length !== prev.layers.length)) mockupPanel.update();
  if (s.slides !== prev.slides) {
    slidesPanel.render(s.slides);
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

slidesPanel.render(prev.slides);
renderSlidesMode(prev);
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
};
