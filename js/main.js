import { store, actions, boardsOf, selectionOf } from './state.js';
import { aspectLabel } from './config.js';
import { getLayout } from './layouts/index.js';
import { Renderer } from './render/renderer.js';
import { buildScene, resolveCanvas } from './render/scene.js';
import { tileMatrix } from './render/math.js';
import { pickItem, itemCenterNdc, itemCornersNdc, ndcDeltaToLayout } from './render/picking.js';
import { paintBackground } from './render/background.js';
import { createPlaceholders } from './slides/placeholders.js';
import { createSlides, createAsset } from './slides/slideFactory.js';
import { collectFromDrop, collectFromInput } from './slides/importer.js';
import { renderToBlob, renderToCanvas, downloadBlob } from './export/exporter.js';
import { resolveLongSide, exportSize, sizeSchema } from './export/schema.js';
import { copyPngToClipboard } from './export/clipboard.js';
import { createZip } from './persist/zip.js';
import { createProjectController } from './project/controller.js';
import { createHistory } from './project/history.js';
import { view, toScreen, zoomViewAt, panView, fitRect, unionRect, MIN_ZOOM, MAX_ZOOM } from './workspace/view.js';
import { createSlidesPanel } from './ui/slidesPanel.js';
import { createSettingsPanel } from './ui/settingsPanel.js';
import { createTopbarMenus } from './ui/topbarMenus.js';
import { createExportPopover } from './ui/exportPopover.js';
import { createProjectDialog } from './ui/projectDialog.js';
import { buildControls } from './ui/controls.js';
import { attachViewportInteraction } from './ui/viewportInteraction.js';
import { createToolbar } from './ui/toolbar.js';
import { createBgPicker } from './ui/bgPicker.js';
import { createResizeHandles } from './ui/resizeHandles.js';
import { createPresetsPanel } from './ui/presetsPanel.js';
import { isPresetsFile } from './persist/presets.js';
import { initResizers } from './ui/resizer.js';
import { showContextMenu } from './ui/contextMenu.js';
import { toast } from './ui/toast.js';
import { setWheelMode } from './ui/wheel.js';
import { applyIcons } from './ui/icons.js';
import './core/noPageZoom.js';
import { clamp } from './core/utils.js';

applyIcons();

const $ = id => document.getElementById(id);
const stage = $('stage');
const viewport = $('viewport'); // 工作区：铺满中间区域，所有画板画在同一张画布上
const bgCanvas = $('bg-canvas');
const glCanvas = $('gl-canvas');
const bgCtx = bgCanvas.getContext('2d');

let renderer;
try {
  renderer = new Renderer(glCanvas);
} catch (err) {
  stage.innerHTML = `<div class="stage-error">${err.message}<br>请使用最新版 Chrome / Edge / Safari / Firefox</div>`;
  throw err;
}

const placeholders = createPlaceholders(9);
const slidesOf = s => (s.slides.length ? s.slides : placeholders);
const hasRealSlides = () => store.get().slides.length > 0;
const is3D = () => getLayout(store.get().layoutId).category === '3d';
const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
const safe = s => String(s).replace(/[\\/:*?"<>|]/g, '_');

/* ---------------- 画板 → 渲染输入 ---------------- */

// 背景图 / 幻灯片模糊背景用到的图片：preview 用于预览，source 用于导出时读取原图
function bgSourceOf(s, style) {
  if (style.bgType === 'image') {
    const a = s.assets[style.bgImageId];
    return a ? { preview: a.preview, source: a.file } : null;
  }
  if (style.bgType === 'slide') {
    const list = slidesOf(s);
    const sl = list[Math.min(list.length, Math.max(1, Math.round(style.bgSlide || 1))) - 1];
    return sl ? { preview: sl.preview, source: sl.source } : null;
  }
  return null;
}

// 某个画板（settings 为该画板的设置）的渲染输入
function boardInput(s, st) {
  const layout = getLayout(st.layoutId);
  return {
    slides: slidesOf(s),
    layout,
    params: st.params[layout.id],
    style: st.style,
    aspect: st.aspect, // 比例 id，长图为 'long'
    camera: st.camera,
    background: bgSourceOf(s, st.style),
    adjust: st.adjust[st.layoutId] || null,
  };
}
const activeSettings = s => ({ layoutId: s.layoutId, params: s.params, style: s.style, aspect: s.aspect, camera: s.camera, adjust: s.adjust });
const sceneInput = s => boardInput(s, activeSettings(s));
const canvasOf = s => resolveCanvas(sceneInput(s));
const boardWorldRect = (s, b) => {
  const { W, H } = resolveCanvas(boardInput(s, b.settings));
  return { x: b.x, y: b.y, w: W, h: H };
};

/* ---------------- 交互高亮状态（只影响预览，不进 store） ---------------- */

const ui = {
  hover: null,       // 悬停的 item（order）
  dragSource: null,  // 正在拖动的幻灯片序号
  dropTarget: null,  // 拖放目标 item（order）
  selected: null,    // 选择 / 旋转 / 比例工具选中的 item（order）
  listHover: null,   // 左侧列表悬停的幻灯片序号
  tool: 'select',    // 当前工具，见 ui/toolbar.js
  tempHand: false,   // 按住空格临时抓手
};
const ACCENT = [124 / 255, 140 / 255, 1];
const HL = {
  hover: { color: ACCENT, fill: 0.1, ring: 2.5 },
  target: { color: ACCENT, fill: 0.28, ring: 4 },
  source: { color: [0.05, 0.06, 0.08], fill: 0.6, ring: 0 },
  selected: { color: [1, 1, 1], fill: 0, ring: 2 },
};

function setUi(key, value) {
  if (ui[key] === value) return;
  ui[key] = value;
  scheduleRender();
}

/* ---------------- 工作区渲染 ---------------- */

const PASTEBOARD = '#0b0d11';
let frame = 0;
let viewDpr = dpr();
const boardInfo = new Map(); // 画板 id → { sx, sy, sw, sh（屏幕 CSS 像素）, W, H, zoom, scene }
let lastScene = null;        // 当前画板的场景
const scheduleRender = () => { if (!frame) frame = requestAnimationFrame(render); };

function buildOverlays(scene) {
  const overlays = [];
  const add = (item, kind) => overlays.push({ item, ...HL[kind], ring: HL[kind].ring * viewDpr });
  if (ui.dragSource != null) for (const it of scene.items) if (it.slideIndex === ui.dragSource) add(it, 'source');
  if (ui.listHover != null) for (const it of scene.items) if (it.slideIndex === ui.listHover) add(it, 'hover');
  if (ui.selected != null) {
    const it = scene.items.find(x => x.order === ui.selected);
    if (it) add(it, 'selected');
  }
  const targetOrder = ui.dropTarget ?? ui.hover;
  if (targetOrder != null) {
    const it = scene.items.find(x => x.order === targetOrder);
    if (it) add(it, ui.dropTarget != null ? 'target' : 'hover');
  }
  return overlays;
}

// 每个画板的背景缓存成一张小图（模糊等效果很耗时），再按视图缩放画到工作区
const BG_KEYS = ['bgType', 'bg1', 'bg2', 'bgAngle', 'bgImageId', 'bgFit', 'bgScale', 'bgSlide', 'bgBlur', 'bgDim', 'bgDimColor', 'vignette'];
const bgCache = new Map();
function boardBackground(id, style, background, W, H, screenLong) {
  const res = Math.min(2048, Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, screenLong)))));
  const cw = W >= H ? res : Math.max(1, Math.round((res * W) / H));
  const ch = W >= H ? Math.max(1, Math.round((res * H) / W)) : res;
  const image = background?.preview || null;
  const key = `${BG_KEYS.map(k => style[k]).join('|')}|${cw}x${ch}`;
  const hit = bgCache.get(id);
  if (hit && hit.key === key && hit.image === image) return hit.canvas;
  const canvas = hit?.canvas || document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  paintBackground(canvas.getContext('2d'), cw, ch, style, { image, unit: ch / H });
  bgCache.set(id, { key, image, canvas });
  return canvas;
}

let checkerPattern = null;
function checker() {
  if (checkerPattern) return checkerPattern;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = '#2a2e37'; g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#3a3f4b'; g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
  checkerPattern = bgCtx.createPattern(c, 'repeat');
  return checkerPattern;
}

function render() {
  frame = 0;
  const s = store.get();
  const d = viewDpr;
  const CW = bgCanvas.width, CH = bgCanvas.height;

  bgCtx.setTransform(1, 0, 0, 1, 0, 0);
  bgCtx.fillStyle = PASTEBOARD;
  bgCtx.fillRect(0, 0, CW, CH);
  renderer.clear();
  for (const slide of slidesOf(s)) renderer.setTexture(slide.id, slide.preview);

  boardInfo.clear();
  lastScene = null;
  const boards = boardsOf(s);
  const selected = new Set(selectionOf(s));
  for (const b of boards) {
    const input = boardInput(s, b.settings);
    const { W, H } = resolveCanvas(input);
    const [sx, sy] = toScreen(b.x, b.y);
    const sw = W * view.zoom, sh = H * view.zoom;
    const info = { id: b.id, name: b.name, sx, sy, sw, sh, W, H, x: b.x, y: b.y, zoom: view.zoom, scene: null };
    boardInfo.set(b.id, info);
    const active = b.id === s.activeBoard;

    // 画板名称（左上角上方）
    bgCtx.font = `${(active ? 600 : 400)} ${11.5 * d}px -apple-system, "PingFang SC", system-ui, sans-serif`;
    bgCtx.fillStyle = active ? '#a3afff' : selected.has(b.id) ? '#8b96d9' : '#6b7385';
    bgCtx.textBaseline = 'bottom';
    const labelText = `${b.name}  ·  ${aspectLabel(b.settings.aspect)}`;
    bgCtx.fillText(labelText, sx * d, (sy - 6) * d);
    // 名称标签的可点区域（CSS 像素）：拖动它可以移动画板
    info.label = { x: sx - 2, y: sy - 22, w: bgCtx.measureText(labelText).width / d + 6, h: 18 };

    const px = { x: sx * d, y: sy * d, w: sw * d, h: sh * d };
    if (px.x > CW || px.y > CH || px.x + px.w < 0 || px.y + px.h < 0) continue; // 在视野外

    // 画板投影 + 背景
    bgCtx.save();
    bgCtx.shadowColor = 'rgba(0,0,0,.5)';
    bgCtx.shadowBlur = 24 * d;
    bgCtx.shadowOffsetY = 6 * d;
    bgCtx.fillStyle = '#000';
    bgCtx.fillRect(px.x, px.y, px.w, px.h);
    bgCtx.restore();
    if (b.settings.style.bgType === 'transparent') {
      bgCtx.fillStyle = checker();
      bgCtx.fillRect(px.x, px.y, px.w, px.h);
    } else {
      bgCtx.drawImage(boardBackground(b.id, b.settings.style, input.background, W, H, Math.max(px.w, px.h)), px.x, px.y, px.w, px.h);
    }
    // 选中的画板描边；当前画板描边更粗
    if (s.artboards.length > 1 && (active || selected.has(b.id))) {
      const w = (active ? 2 : 1.25) * d;
      bgCtx.strokeStyle = active ? 'rgba(124,140,255,1)' : 'rgba(124,140,255,.7)';
      bgCtx.lineWidth = w;
      bgCtx.strokeRect(px.x - w, px.y - w, px.w + 2 * w, px.h + 2 * w);
    }

    // WebGL：只画画板在视野内的部分（用裁切矩阵，放大很多时也不会超出 WebGL 视口上限）
    const vx0 = Math.max(0, Math.floor(px.x)), vy0 = Math.max(0, Math.floor(px.y));
    const vx1 = Math.min(CW, Math.ceil(px.x + px.w)), vy1 = Math.min(CH, Math.ceil(px.y + px.h));
    if (vx1 <= vx0 || vy1 <= vy0) continue;
    info.scene = buildScene(input);
    if (active) lastScene = info.scene;
    const tile = tileMatrix(vx0 - px.x, vy0 - px.y, vx1 - vx0, vy1 - vy0, px.w, px.h);
    renderer.render(info.scene, tile, active ? buildOverlays(info.scene) : [], {
      viewport: [vx0, CH - vy1, vx1 - vx0, vy1 - vy0], clear: false,
    });
  }

  resizeHandles?.update();
  toolbar?.update({ tool: ui.tool, tempHand: ui.tempHand, viewZoom: view.zoom, adjustCount: Object.keys(s.adjust[s.layoutId] || {}).length });

  if (ui.listHover == null) {
    const hoverItem = ui.dropTarget ?? ui.hover;
    const item = hoverItem != null && hasRealSlides() && lastScene ? lastScene.items.find(x => x.order === hoverItem) : null;
    slidesPanel.highlight(item ? item.slideIndex : null);
  }
}

function resizeWorkspace() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  viewDpr = dpr();
  const pw = Math.max(1, Math.round(w * viewDpr)), ph = Math.max(1, Math.round(h * viewDpr));
  bgCanvas.width = pw;
  bgCanvas.height = ph;
  renderer.setSize(pw, ph);
  if (autoFit) (autoFit.all ? fitAll : fitBoard)(autoFit.id); // 没手动调过视图时，窗口变化后重新适配
  scheduleRender();
}
new ResizeObserver(resizeWorkspace).observe(viewport);

/* ---------------- 视图（缩放 / 平移 / 适合窗口） ---------------- */

const stageSize = () => [viewport.clientWidth, viewport.clientHeight];
// 最近一次是自动适配（而不是手动平移 / 缩放）时记下来，窗口大小变化后重新适配
let autoFit = null;
function fitBoard(id = store.get().activeBoard) {
  const s = store.get();
  const b = boardsOf(s).find(x => x.id === id);
  if (!b) return;
  fitRect(boardWorldRect(s, b), ...stageSize());
  autoFit = { id };
  scheduleRender();
}
function fitAll() {
  const s = store.get();
  fitRect(unionRect(boardsOf(s).map(b => boardWorldRect(s, b))), ...stageSize());
  autoFit = { all: true };
  scheduleRender();
}
function zoomAtScreen(sx, sy, factor) {
  zoomViewAt(sx, sy, clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM));
  autoFit = null;
  scheduleRender();
}
const zoomViewBy = k => { const [w, h] = stageSize(); zoomAtScreen(w / 2, h / 2, k); };
const actualSize = () => { const [w, h] = stageSize(); zoomAtScreen(w / 2, h / 2, 1 / view.zoom); };

/* ---------------- 坐标换算（当前画板） ---------------- */

const activeInfo = () => boardInfo.get(store.get().activeBoard);
function boardAt(clientX, clientY) {
  const r = viewport.getBoundingClientRect();
  const x = clientX - r.left, y = clientY - r.top;
  const boards = [...boardInfo.values()];
  for (let i = boards.length - 1; i >= 0; i--) {
    const b = boards[i];
    if (x >= b.sx && x <= b.sx + b.sw && y >= b.sy && y <= b.sy + b.sh) return b.id;
  }
  return null;
}
// 屏幕坐标 → 某个画板里的卡片（默认当前画板）
function pickIn(info, clientX, clientY) {
  if (!info?.scene) return null;
  const r = viewport.getBoundingClientRect();
  const x = clientX - r.left - info.sx, y = clientY - r.top - info.sy;
  if (x < 0 || y < 0 || x > info.sw || y > info.sh) return null;
  return pickItem(info.scene, (x / info.sw) * 2 - 1, 1 - (y / info.sh) * 2);
}
const pickAt = (clientX, clientY) => pickIn(activeInfo(), clientX, clientY);
function labelAt(clientX, clientY) {
  const r = viewport.getBoundingClientRect();
  const x = clientX - r.left, y = clientY - r.top;
  for (const b of [...boardInfo.values()].reverse()) {
    const l = b.label;
    if (l && x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h) return b.id;
  }
  return null;
}
const ndcToClient = ([x, y]) => {
  const r = viewport.getBoundingClientRect();
  const info = activeInfo();
  return [r.left + info.sx + ((x + 1) / 2) * info.sw, r.top + info.sy + ((1 - y) / 2) * info.sh];
};
const toLayoutDelta = (dxPx, dyPx) => {
  const info = activeInfo();
  return ndcDeltaToLayout(lastScene, (dxPx / info.sw) * 2, (-dyPx / info.sh) * 2);
};
const getAdjust = order => ({ ...((store.get().adjust[store.get().layoutId] || {})[order]) });
const nextLift = () => 1 + Math.max(0, ...Object.values(store.get().adjust[store.get().layoutId] || {}).map(a => a.lift || 0));

// 预览渲染（导出面板、项目缩略图、我的版式缩略图）：离屏渲染当前画板，用内存中的预览图，速度快
async function renderPreview(longSide, opts = {}) {
  return renderToCanvas(sceneInput(store.get()), { longSide, preview: true, ...opts });
}
let previewToken = 0;
async function drawPreview(canvas, { maxW = 300, maxH = 200, whiteFill = false } = {}) {
  const token = ++previewToken;
  const { W, H } = canvasOf(store.get());
  const a = W / H;
  let w = maxW, h = w / a;
  if (h > maxH) { h = maxH; w = h * a; }
  const k = dpr();
  const { canvas: src } = await renderPreview(Math.round(Math.max(w, h) * k), { fill: whiteFill ? '#ffffff' : null });
  if (token !== previewToken) return; // 已有更新的请求
  canvas.width = src.width;
  canvas.height = src.height;
  canvas.style.width = `${Math.round(w)}px`;
  canvas.style.height = `${Math.round(h)}px`;
  canvas.getContext('2d').drawImage(src, 0, 0);
}
const snapshot = async width => (await renderToBlob(sceneInput(store.get()), { longSide: Math.round(width * 1.6), format: 'jpg', quality: 0.85, preview: true })).blob;

/* ---------------- 项目 ---------------- */

const saveStatus = $('save-status');
const projectTitle = $('project-title');
let projectDialog = null;
const controller = createProjectController({
  store, actions, placeholders, snapshot,
  onStatus: text => {
    saveStatus.textContent = text;
    saveStatus.dataset.state = text;
  },
  onChange: () => projectDialog?.refresh(),
});
projectDialog = createProjectDialog({ store, controller, download: downloadBlob, toast });
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
  if (label) { ui.selected = null; toast(`已撤销：${label}`); }
}
function doRedo() {
  const label = history.redo();
  if (label) { ui.selected = null; toast(`已重做：${label}`); }
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

/* ---------------- 画板管理 ---------------- */

function activateBoard(id, { fit = true, keepSelection = false } = {}) {
  actions.setActiveBoard(id, { keepSelection });
  if (fit) fitBoard(id);
}
function addBoard({ duplicate = false } = {}) {
  const s = store.get();
  const rects = boardsOf(s).map(b => boardWorldRect(s, b));
  const cur = s.artboards.find(b => b.id === s.activeBoard);
  const x = Math.max(...rects.map(r => r.x + r.w)) + 160; // 放在最右侧画板的右边
  const board = actions.addArtboard({ x, y: cur.y, duplicate });
  fitBoard(board.id);
  toast(duplicate ? `已复制为「${board.name}」` : `已新建「${board.name}」`);
}
function renameBoard(id) {
  const b = store.get().artboards.find(x => x.id === id);
  const name = prompt('画板名称', b?.name)?.trim();
  if (name && name !== b.name) actions.renameArtboard(id, name);
}
// 删除画板（默认删除所有选中的画板），至少保留一个
function deleteBoards(ids = selectionOf(store.get())) {
  const s = store.get();
  if (s.artboards.length <= 1) { toast('至少保留一个画板', { error: true }); return; }
  if (ids.length >= s.artboards.length) ids = ids.filter(id => id !== s.activeBoard); // 保留当前画板
  const names = s.artboards.filter(b => ids.includes(b.id)).map(b => `「${b.name}」`);
  if (!names.length || !confirm(`删除画板 ${names.join('、')}？`)) return;
  const n = actions.removeArtboards(ids);
  ids.forEach(id => bgCache.delete(id));
  toast(`已删除 ${n} 个画板`);
}
const deleteBoard = id => deleteBoards([id]);
// 复制所有选中的画板，副本依次放在最右侧，并选中这些副本
function duplicateSelected() {
  const s = store.get();
  const ids = selectionOf(s);
  if (ids.length <= 1) { addBoard({ duplicate: true }); return; }
  const rects = boardsOf(s).map(b => boardWorldRect(s, b));
  let x = Math.max(...rects.map(r => r.x + r.w)) + 160;
  const created = [];
  for (const id of ids) {
    const b = boardsOf(store.get()).find(v => v.id === id);
    const r = boardWorldRect(store.get(), b);
    created.push(actions.addArtboard({ x, y: b.y, duplicate: true, from: id }).id);
    x += r.w + 160;
  }
  actions.selectBoards(created);
  fitAll();
  toast(`已复制 ${created.length} 个画板`);
}

/* ---------------- 导入图片 ---------------- */

async function runImport(listPromise, { replaceIndex = null } = {}) {
  let list;
  try {
    list = await listPromise;
  } catch (err) {
    console.error(err);
    toast('读取文件失败', { error: true });
    return;
  }
  if (!list.length) {
    toast('没有找到可用的图片', { error: true });
    return;
  }
  toast(`正在导入 0 / ${list.length}`, { sticky: true });
  const slides = await createSlides(list, (done, total) => toast(`正在导入 ${done} / ${total}`, { sticky: true }));
  const failed = list.length - slides.length;
  const tail = failed ? `，${failed} 张无法读取` : '';
  const current = store.get().slides;
  const base = current.length ? current : placeholders; // 还没有图片时，示例卡片就是空位
  const target = replaceIndex != null ? base[replaceIndex] : null;
  if (target && slides.length) {
    actions.replaceSlide(replaceIndex, slides, current.length ? null : placeholders);
    const verb = target.placeholder ? '放入' : '替换';
    const extra = slides.length > 1 ? `，并在其后插入 ${slides.length - 1} 张` : '';
    toast(`已${verb}第 ${replaceIndex + 1} 张${extra}${tail}`, { error: failed > 0 });
  } else {
    actions.fillSlots(slides);
    toast(`已导入 ${slides.length} 张${tail}`, { error: failed > 0 });
  }
}

// 拖入文件：.slidegrid → 导入项目；版式 .json → 导入版式；落在某张卡片上 → 放入/替换；否则追加
const overlay = $('drop-overlay');
const dropLabel = $('drop-label');
let dragDepth = 0;
let dropHit = null;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
const isProjectFile = f => /\.slidegrid$/i.test(f.name);

let dropOnBackground = null;
function endFileDrag() {
  dragDepth = 0;
  dropHit = null;
  overlay.classList.remove('show');
  document.body.classList.remove('file-drag');
  dropOnBackground?.classList.remove('drop-hover');
  dropOnBackground = null;
  setUi('dropTarget', null);
}

async function setBackgroundFile(file) {
  if (!file) return;
  try {
    toast('正在载入背景图…', { sticky: true });
    actions.setBackgroundImage(await createAsset({ file }));
    toast('已设置背景图');
  } catch (err) {
    console.error(err);
    toast('无法读取这张图片', { error: true });
  }
}
const bgInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', hidden: true });
document.body.append(bgInput);
bgInput.addEventListener('change', () => { setBackgroundFile(bgInput.files[0]); bgInput.value = ''; });

window.addEventListener('dragenter', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  overlay.classList.add('show');
  document.body.classList.add('file-drag');
});
window.addEventListener('dragover', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  const bgRow = e.target.closest?.('[data-drop="background"]') || null;
  if (bgRow !== dropOnBackground) {
    dropOnBackground?.classList.remove('drop-hover');
    bgRow?.classList.add('drop-hover');
    dropOnBackground = bgRow;
  }
  if (bgRow) {
    dropHit = null;
    setUi('dropTarget', null);
    dropLabel.textContent = '松开设为背景图';
    return;
  }
  // 幻灯片是所有画板共用的，落在任何画板的卡片上都可以放入 / 替换
  const board = boardAt(e.clientX, e.clientY);
  dropHit = board ? pickIn(boardInfo.get(board), e.clientX, e.clientY) : null;
  setUi('dropTarget', dropHit && board === store.get().activeBoard ? dropHit.order : null);
  dropLabel.textContent = !dropHit
    ? '松开以导入图片、文件夹、.slidegrid 项目或版式文件'
    : dropHit.slide.placeholder
      ? `松开放入第 ${dropHit.slideIndex + 1} 张`
      : `松开替换第 ${dropHit.slideIndex + 1} 张（${dropHit.slide.name}）`;
});
window.addEventListener('dragleave', e => {
  if (!hasFiles(e)) return;
  if (--dragDepth <= 0) endFileDrag();
});
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  const target = dropHit;
  const toBackground = !!dropOnBackground;
  endFileDrag();
  if (toBackground) {
    setBackgroundFile([...(e.dataTransfer.files || [])].find(f => f.type.startsWith('image/')));
    return;
  }
  const project = [...(e.dataTransfer.files || [])].find(isProjectFile);
  if (project) { importProject(project); return; }
  const layoutFile = [...(e.dataTransfer.files || [])].find(isPresetsFile);
  if (layoutFile) {
    settings.showTab('mine');
    presetsPanel.importFile(layoutFile);
    return;
  }
  // collectFromDrop 必须在事件里同步调用
  runImport(collectFromDrop(e.dataTransfer), { replaceIndex: target ? target.slideIndex : null });
});

const fileInput = $('file-input');
const folderInput = $('folder-input');
document.querySelectorAll('[data-action="pick-files"]').forEach(b => b.addEventListener('click', () => fileInput.click()));
document.querySelectorAll('[data-action="pick-folder"]').forEach(b => b.addEventListener('click', () => folderInput.click()));
for (const input of [fileInput, folderInput]) {
  input.addEventListener('change', () => {
    runImport(Promise.resolve(collectFromInput(input.files)));
    input.value = '';
  });
}
// 替换某一张：单独的文件选择框（取消选择不会影响普通导入）
let replaceIndex = null;
const replaceInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', hidden: true });
document.body.append(replaceInput);
replaceInput.addEventListener('change', () => {
  if (replaceInput.files.length && replaceIndex != null) runImport(Promise.resolve(collectFromInput(replaceInput.files)), { replaceIndex });
  replaceInput.value = '';
});
function pickReplacement(index) {
  replaceIndex = index;
  replaceInput.click();
}

/* ---------------- 粘贴剪贴板图片 ---------------- */

const pastedName = type => {
  const t = new Date();
  const ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  return `粘贴的图片-${[t.getHours(), t.getMinutes(), t.getSeconds()].map(n => String(n).padStart(2, '0')).join('')}.${ext}`;
};
// 选中卡片时替换它，否则追加为新幻灯片
function selectedSlideIndex() {
  if (ui.selected == null || !lastScene) return null;
  return lastScene.items.find(x => x.order === ui.selected)?.slideIndex ?? null;
}
function importPasted(files, replaceAt = selectedSlideIndex()) {
  const list = files.map(f => ({ file: new File([f], pastedName(f.type), { type: f.type }), path: '' }));
  runImport(Promise.resolve(list), { replaceIndex: replaceAt });
}
// ⌘V / Ctrl+V：浏览器的 paste 事件直接带有剪贴板里的图片，不需要额外授权
document.addEventListener('paste', e => {
  const t = e.target;
  if (/^(INPUT|TEXTAREA)$/.test(t?.tagName) || t?.isContentEditable) return;
  const files = [...(e.clipboardData?.items || [])]
    .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
    .map(it => it.getAsFile()).filter(Boolean);
  if (!files.length) {
    if (selectedSlideIndex() != null) toast('剪贴板里没有图片', { error: true });
    return;
  }
  e.preventDefault();
  importPasted(files);
});
// 右键菜单里的「粘贴」：用异步剪贴板接口读取（浏览器可能会请求授权）
async function pasteFromClipboard(replaceAt) {
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const it of items) {
      const type = it.types.find(x => x.startsWith('image/'));
      if (type) files.push(await it.getType(type));
    }
    if (!files.length) { toast('剪贴板里没有图片', { error: true }); return; }
    importPasted(files, replaceAt);
  } catch (err) {
    console.warn(err);
    toast('无法读取剪贴板，请改用 ⌘V / Ctrl+V 粘贴', { error: true, duration: 4000 });
  }
}

$('clear-btn').addEventListener('click', () => {
  if (hasRealSlides() && confirm('移除当前项目的全部图片？（设置会保留）')) actions.clearSlides();
});

/* ---------------- 导出 / 复制 ---------------- */

let busy = false;
function exportOptions(s, overrides = {}) {
  const o = s.exportOpts;
  return { longSide: resolveLongSide(o), format: o.format, quality: o.quality, ...overrides };
}

function exportInfo(s) {
  const { width, height } = exportSize(canvasOf(s), resolveLongSide(s.exportOpts));
  const board = s.artboards.find(b => b.id === s.activeBoard);
  const base = safe(s.project?.name || 'slidegrid');
  return {
    width, height,
    defaultName: s.exportOpts.scope === 'all' ? `${base}-全部画板`
      : s.exportOpts.scope === 'selected' && selectionOf(s).length > 1 ? `${base}-所选画板`
        : `${base}-${safe(board?.name || '画板')}-${width}x${height}`,
  };
}

async function withBusy(task) {
  if (busy) throw new Error('正在处理上一个任务');
  busy = true;
  $('copy-btn').disabled = true;
  $('export-btn').disabled = true;
  try {
    return await task();
  } finally {
    busy = false;
    $('copy-btn').disabled = false;
    $('export-btn').disabled = false;
  }
}

const progress = label => p => {
  exportPopover.setProgress(p);
  toast(`${label}… ${Math.round(p * 100)}%`, { sticky: true });
};

// 导出指定画板：一个画板直接下载图片，多个打包成 ZIP
async function exportBoards(ids, name) {
  const s = store.get();
  const boards = boardsOf(s).filter(b => ids.includes(b.id));
  const ext = s.exportOpts.format === 'jpg' ? 'jpg' : 'png';
  const base = safe(s.project?.name || 'slidegrid');
  if (boards.length === 1) {
    const b = boards[0];
    const { blob, width, height } = await renderToBlob(boardInput(s, b.settings), exportOptions(s, { onProgress: progress('正在导出') }));
    const file = name || `${base}-${safe(b.name)}-${width}x${height}.${ext}`;
    downloadBlob(blob, file);
    toast(`已导出 ${file}（${width} × ${height}）`);
    return;
  }
  const entries = [];
  for (let i = 0; i < boards.length; i++) {
    const b = boards[i];
    const { blob, width, height } = await renderToBlob(boardInput(s, b.settings), exportOptions(s, {
      onProgress: p => progress(`正在导出 ${i + 1}/${boards.length}`)((i + p) / boards.length),
    }));
    entries.push({ name: `${String(i + 1).padStart(2, '0')}-${safe(b.name)}-${width}x${height}.${ext}`, data: blob });
  }
  const file = name || `${base}-${boards.length}个画板.zip`;
  downloadBlob(await createZip(entries), file);
  toast(`已导出 ${boards.length} 个画板（${file}）`);
}

async function doExport(ids = null) {
  if (busy) return;
  exportPopover.setBusy(true);
  try {
    await withBusy(async () => {
      const s = store.get();
      if (ids) { await exportBoards(ids); return; } // 右键菜单：导出指定画板
      const scope = s.exportOpts.scope;
      const target = scope === 'all' ? s.artboards.map(b => b.id)
        : scope === 'selected' ? selectionOf(s)
          : [s.activeBoard];
      await exportBoards(target, exportPopover.filename());
    });
  } catch (err) {
    console.error(err);
    exportPopover.setError(`导出失败：${err.message}`);
    toast(`导出失败：${err.message}`, { error: true, duration: 5000 });
  } finally {
    exportPopover.setBusy(false);
  }
}

// 复制当前画板：剪贴板只支持 PNG。clipboard.write 必须在点击事件里同步发起。
function doCopy() {
  if (busy) return;
  const s = store.get();
  let size = null;
  const opts = exportOptions(s, { format: 'png', onProgress: progress('正在生成') });
  const blobPromise = renderToBlob(sceneInput(s), opts).then(r => { size = r; return r.blob; });
  withBusy(() => copyPngToClipboard(blobPromise))
    .then(() => toast(`已复制 ${size.width} × ${size.height} 到剪贴板`))
    .catch(err => {
      console.error(err);
      toast(`复制失败：${err.message}`, { error: true, duration: 5000 });
    });
}

$('copy-btn').addEventListener('click', doCopy);
$('export-btn').addEventListener('click', () => doExport());

/* ---------------- 界面 ---------------- */

const panels = initResizers($('app'));
document.querySelector('.slides-head .head-actions').append(panels.collapseButton('left'));

const slidesPanel = createSlidesPanel({
  listEl: $('slide-list'),
  countEl: $('slide-count'),
  emptyEl: $('empty-tip'),
  dropzone: $('dropzone'),
  footEl: $('slides-foot'),
  viewButtons: { grid: $('view-grid'), list: $('view-list') },
  onRemove: actions.removeSlide,
  onMove: actions.moveSlide,
  onHover: i => setUi('listHover', i), // 左侧悬停 → 当前画板里高亮这张图出现的所有位置
  onPick: () => fileInput.click(),
});
const settings = createSettingsPanel($('settings-panel'), {
  store, actions,
  notify: msg => toast(msg, { error: true }),
  imageCtx: {
    imageThumb: id => store.get().assets[id]?.thumb || null,
    pickImage: () => bgInput.click(),
    dropTarget: 'background',
  },
});
document.querySelector('#settings-panel .rp-tabs').append(panels.collapseButton('right'));
const presetsPanel = createPresetsPanel(settings.presetsContainer, {
  store, actions, snapshot, toast, download: downloadBlob,
  onCount: n => settings.setPresetCount(n),
});
const topbarMenus = createTopbarMenus($('board-bar'), {
  store, actions,
  onActivate: id => activateBoard(id),
  onAdd: addBoard,
  onDuplicateSelected: duplicateSelected,
  onRename: renameBoard,
  onDelete: deleteBoard,
  onDeleteSelected: () => deleteBoards(),
  onFitAll: fitAll,
});
const updateSizePicker = buildControls($('size-picker'), sizeSchema, store.get().exportOpts, actions.setExport);
const exportPopover = createExportPopover({ anchor: $('export-btn'), store, actions, drawPreview, info: exportInfo });

// 工具是否可用：单张卡片调整（选择 / 旋转 / 比例）只用于平面版式
function toolAvailability(id) {
  if (['select', 'rotate', 'scale'].includes(id) && is3D()) return { ok: false, reason: '3D 版式暂不支持单张卡片调整，可在平面版式中使用' };
  return { ok: true, reason: '' };
}
function setTool(id) {
  if (!toolAvailability(id).ok) {
    toast(toolAvailability(id).reason, { error: true });
    return;
  }
  ui.tool = id;
  if (!['select', 'rotate', 'scale'].includes(id)) ui.selected = null;
  refreshTools();
  scheduleRender();
}
function refreshTools() {
  updateHint();
  interaction?.updateCursor();
  scheduleRender();
}

const toolbar = createToolbar($('app'), {
  onTool: setTool,
  availability: toolAvailability,
  onZoomIn: () => zoomViewBy(1.25),
  onZoomOut: () => zoomViewBy(0.8),
  onFit: () => fitBoard(),
  onFitAll: fitAll,
  onActualSize: actualSize,
  onResetAdjust: () => {
    actions.resetAdjust();
    ui.selected = null;
    toast('已重置当前画板的卡片调整');
  },
});

/* ---------------- 右键菜单 ---------------- */

function onContextMenu({ clientX, clientY, board }) {
  const s = store.get();
  const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';
  if (!board) {
    showContextMenu(clientX, clientY, [
      { title: '工作区' },
      { label: '新建画板', icon: 'plus', action: () => addBoard({ duplicate: false }) },
      { label: '粘贴图片为新幻灯片', icon: 'clipboard-paste', shortcut: `${mod}V`, action: () => pasteFromClipboard(null) },
      { sep: true },
      { label: '适合全部画板', icon: 'maximize', shortcut: `${mod}⌥0`, action: fitAll },
      { label: '全选画板', icon: 'check', shortcut: `${mod}A`, action: () => actions.selectAllBoards() },
    ]);
    return;
  }

  // 右键点到的画板：不在选中集合里就只选它（与 Illustrator 一致）
  const inSelection = selectionOf(s).includes(board);
  const info = boardInfo.get(board);
  const card = pickIn(info, clientX, clientY);
  if (board !== s.activeBoard || !inSelection) activateBoard(board, { fit: false, keepSelection: inSelection });
  const sel = selectionOf(store.get());
  const multi = sel.length > 1;
  const b = store.get().artboards.find(x => x.id === board);
  const flat = !is3D();

  const items = [];
  if (card) {
    const slide = card.slide;
    const real = !slide.placeholder;
    const adjusted = !!(store.get().adjust[store.get().layoutId] || {})[card.order];
    items.push(
      { title: `第 ${card.slideIndex + 1} 张 · ${real ? slide.name : '空位'}` },
      { label: real ? '替换图片…' : '放入图片…', icon: 'image-plus', action: () => pickReplacement(card.slideIndex) },
      { label: real ? '用剪贴板图片替换' : '粘贴剪贴板图片', icon: 'clipboard-paste', shortcut: `${mod}V`, action: () => pasteFromClipboard(card.slideIndex) },
      flat && { label: '选中这张卡片', icon: 'mouse-pointer-2', action: () => { setTool('select'); setUi('selected', card.order); } },
      flat && adjusted && { label: '复位这张卡片', icon: 'undo-2', action: () => actions.resetItemAdjust(card.order) },
      real && { label: '在左侧列表中定位', icon: 'locate', action: () => { panels.setHidden('left', false); slidesPanel.highlight(card.slideIndex); } },
      real && { label: '从项目中移除这张图', icon: 'trash-2', danger: true, action: () => actions.removeSlide(slide.id) },
      { sep: true },
    );
  }
  items.push(
    { title: multi ? `已选 ${sel.length} 个画板` : b.name },
    !multi && { label: '适合窗口', icon: 'scan', shortcut: `${mod}0`, action: () => fitBoard(board) },
    !multi && { label: '重命名…', icon: 'pencil', action: () => renameBoard(board) },
    { label: '画板背景…', icon: 'images', action: () => bgPicker.open() },
    { label: multi ? `复制所选的 ${sel.length} 个画板` : '复制画板', icon: 'copy', action: duplicateSelected },
    { label: multi ? `导出所选的 ${sel.length} 个画板（ZIP）` : '导出此画板', icon: 'download', action: () => doExport(sel) },
    { sep: true },
    s.artboards.length > 1 && { label: multi ? `删除所选的 ${sel.length} 个画板` : '删除画板', icon: 'trash-2', danger: true, action: () => deleteBoards(sel) },
  );
  showContextMenu(clientX, clientY, items);
}

// 画板框选的矩形
const marquee = Object.assign(document.createElement('div'), { className: 'marquee', hidden: true });
viewport.append(marquee);
function setMarquee(r) {
  marquee.hidden = !r;
  if (r) Object.assign(marquee.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
}

// 工具条上的「画板背景」：快速切换类型、预设色板、自定义颜色
const bgPicker = createBgPicker(toolbar.bgSlot, {
  store, actions,
  pickImage: () => bgInput.click(),
  onMore: () => settings.revealBackground(),
});

// 选中卡片的缩放手柄：选择 / 旋转 / 比例工具下、平面版式中显示
let resizeHandles = null;
resizeHandles = createResizeHandles(viewport, {
  getTarget: () => {
    if (ui.selected == null || !lastScene || is3D() || ui.tempHand) return null;
    if (!['select', 'rotate', 'scale'].includes(ui.tool)) return null;
    return lastScene.items.find(x => x.order === ui.selected) || null;
  },
  cornersClient: item => itemCornersNdc(lastScene, item).map(ndcToClient),
  centerClient: item => ndcToClient(itemCenterNdc(lastScene, item)),
  getAdjust,
  setItemAdjust: (order, patch) => actions.setItemAdjust(order, patch),
  toLayoutDelta,
  nextLift,
});

let interaction = null;
interaction = attachViewportInteraction(viewport, {
  getTool: () => ui.tool,
  setTool,
  toolAvailable: id => toolAvailability(id).ok,
  is3D,
  canSwap: hasRealSlides,
  getSlide: i => store.get().slides[i],
  onTempHand: on => { ui.tempHand = on; refreshTools(); },
  // 画板与视图
  boardAt,
  activeBoard: () => store.get().activeBoard,
  activateBoard,
  boardRect: id => boardInfo.get(id),
  allBoardIds: () => [...boardInfo.keys()],
  selectedBoards: () => selectionOf(store.get()),
  toggleBoardSelection: id => actions.toggleBoardSelection(id),
  selectBoards: ids => { const a = store.get().activeBoard; actions.selectBoards(ids, ids.includes(a) ? a : undefined); },
  selectAllBoards: () => actions.selectAllBoards(),
  moveBoards: moves => actions.moveArtboards(moves),
  setMarquee,
  onContextMenu,
  labelAt,
  pickOn: (id, x, y) => pickIn(boardInfo.get(id), x, y),
  wheelMode: () => store.get().wheelNav,
  deleteSelectedBoards: () => deleteBoards(),
  panView: (dx, dy) => { panView(dx, dy); autoFit = null; scheduleRender(); },
  zoomViewAt: zoomAtScreen,
  zoomViewBy,
  fitActive: () => fitBoard(),
  fitAll,
  actualSize,
  // 当前画板内
  pick: pickAt,
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
  toLayoutDelta,
  itemCenterClient: item => ndcToClient(itemCenterNdc(lastScene, item)),
  setItemAdjust: (order, patch) => actions.setItemAdjust(order, patch),
  resetItemAdjust: order => { actions.resetItemAdjust(order); toast('已复位这张卡片'); },
  getSelected: () => ui.selected,
  setSelected: order => setUi('selected', order),
});

const hint = $('stage-hint');
const TOOL_HINTS = {
  select: '选择：拖动卡片移动 · 拖角点等比缩放 · 方向键微调 · 双击卡片复位',
  swap: '交换：把卡片拖到另一张上交换图片',
  rotate: '旋转：拖动卡片旋转 · Shift 按 15° 吸附',
  scale: '比例：拖动以中心等比缩放 · Shift 按 5% 吸附',
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

const projectChanged = (a, b) =>
  a.slides !== b.slides || a.assets !== b.assets || a.layoutId !== b.layoutId || a.params !== b.params ||
  a.style !== b.style || a.aspect !== b.aspect || a.camera !== b.camera || a.adjust !== b.adjust ||
  a.artboards !== b.artboards || a.activeBoard !== b.activeBoard;

let prev = store.get();
setWheelMode(prev.wheelMode);
store.subscribe(s => {
  if (s.wheelMode !== prev.wheelMode) setWheelMode(s.wheelMode);
  if (s.slides !== prev.slides) {
    slidesPanel.render(s.slides);
    renderer.prune(new Set(slidesOf(s).map(x => x.id)));
  }
  if (s.layoutId !== prev.layoutId || s.project !== prev.project || s.activeBoard !== prev.activeBoard) {
    Object.assign(ui, { hover: null, dropTarget: null, selected: null });
    if (!toolAvailability(ui.tool).ok) ui.tool = 'select'; // 换版式后工具不可用就回到选择
  }
  if (s.project !== prev.project) {
    projectTitle.textContent = s.project?.name || '未命名项目';
    bgCache.clear();
    requestAnimationFrame(() => fitBoard()); // 打开项目后显示当前画板
  }
  if (projectChanged(s, prev)) controller.markDirty();
  settings.update(s);
  topbarMenus.update(s);
  bgPicker.update(s);
  updateSizePicker(s.exportOpts);
  exportPopover.update(s);
  refreshTools();
  prev = s;
  scheduleRender();
});

slidesPanel.render(prev.slides);
topbarMenus.update(prev);
refreshTools();
resizeWorkspace();
requestAnimationFrame(() => fitBoard());

controller.init()
  .then(({ failed } = {}) => {
    if (failed) toast(`有 ${failed} 张图片无法读取`, { error: true });
  })
  .catch(err => {
    console.error(err);
    toast(`无法打开本地项目：${err.message}`, { error: true, duration: 6000 });
  });

// 便于调试 / 以后扩展
window.SlideGrid = {
  store,
  actions,
  controller,
  importFiles: (files, opts) => runImport(Promise.resolve(collectFromInput(files)), opts),
  renderToBlob: opts => renderToBlob(sceneInput(store.get()), opts),
  pickAt,
  boardAt,
  history,
  ui,
  view,
  setTool,
  fitBoard,
  fitAll,
  addBoard,
  duplicateSelected,
  deleteBoards,
};
