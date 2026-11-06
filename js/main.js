import { store, actions } from './state.js';
import { isLongAspect } from './config.js';
import { getLayout } from './layouts/index.js';
import { Renderer } from './render/renderer.js';
import { buildScene, resolveCanvas } from './render/scene.js';
import { pickItem, itemCenterNdc, itemCornersNdc, ndcDeltaToLayout } from './render/picking.js';
import { paintBackground } from './render/background.js';
import { createPlaceholders } from './slides/placeholders.js';
import { createSlides, createAsset } from './slides/slideFactory.js';
import { collectFromDrop, collectFromInput } from './slides/importer.js';
import { renderToBlob, downloadBlob } from './export/exporter.js';
import { resolveLongSide, exportSize, sizeSchema } from './export/schema.js';
import { copyPngToClipboard } from './export/clipboard.js';
import { createProjectController } from './project/controller.js';
import { createSlidesPanel } from './ui/slidesPanel.js';
import { createSettingsPanel } from './ui/settingsPanel.js';
import { createAspectBar } from './ui/aspectBar.js';
import { createExportPopover } from './ui/exportPopover.js';
import { createProjectDialog } from './ui/projectDialog.js';
import { buildControls } from './ui/controls.js';
import { attachViewportInteraction } from './ui/viewportInteraction.js';
import { createToolbar } from './ui/toolbar.js';
import { createResizeHandles } from './ui/resizeHandles.js';
import { createPresetsPanel } from './ui/presetsPanel.js';
import { isPresetsFile } from './persist/presets.js';
import { initResizers } from './ui/resizer.js';
import { toast } from './ui/toast.js';
import { setWheelMode } from './ui/wheel.js';
import { applyIcons } from './ui/icons.js';

applyIcons();

const $ = id => document.getElementById(id);
const stage = $('stage');
const viewport = $('viewport');
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
const isLong = () => isLongAspect(store.get().aspect);
const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

// 背景图 / 幻灯片模糊背景用到的图片：preview 用于预览，source 用于导出时读取原图
function bgSourceOf(s) {
  if (s.style.bgType === 'image') {
    const a = s.assets[s.style.bgImageId];
    return a ? { preview: a.preview, source: a.file } : null;
  }
  if (s.style.bgType === 'slide') {
    const list = slidesOf(s);
    const sl = list[Math.min(list.length, Math.max(1, Math.round(s.style.bgSlide || 1))) - 1];
    return sl ? { preview: sl.preview, source: sl.source } : null;
  }
  return null;
}

function sceneInput(s) {
  const layout = getLayout(s.layoutId);
  return {
    slides: slidesOf(s),
    layout,
    params: s.params[layout.id],
    style: s.style,
    aspect: s.aspect, // 比例 id，长图为 'long'
    camera: s.camera,
    background: bgSourceOf(s),
    adjust: s.adjust[s.layoutId] || null,
  };
}
const canvasOf = s => resolveCanvas(sceneInput(s));

/* ---------------- 交互高亮状态（只影响预览，不进 store） ---------------- */

const ui = {
  hover: null,       // 悬停的 item（order）
  dragSource: null,  // 正在拖动的幻灯片序号
  dropTarget: null,  // 拖放目标 item（order）
  selected: null,    // 移动 / 旋转工具选中的 item（order）
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

/* ---------------- 渲染 ---------------- */

let frame = 0;
let lastScene = null;
let viewDpr = dpr();
const scheduleRender = () => { if (!frame) frame = requestAnimationFrame(render); };

function buildOverlays(scene) {
  const overlays = [];
  const add = (item, kind) => overlays.push({ item, ...HL[kind], ring: HL[kind].ring * viewDpr });
  if (ui.dragSource != null) {
    for (const it of scene.items) if (it.slideIndex === ui.dragSource) add(it, 'source');
  }
  if (ui.listHover != null) {
    for (const it of scene.items) if (it.slideIndex === ui.listHover) add(it, 'hover');
  }
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

function render() {
  frame = 0;
  const s = store.get();
  const input = sceneInput(s);
  for (const slide of input.slides) renderer.setTexture(slide.id, slide.preview);
  lastScene = buildScene(input);
  renderer.render(lastScene, null, buildOverlays(lastScene));
  paintBg(s, input.background);

  resizeHandles?.update();

  if (ui.listHover == null) {
    const hoverItem = ui.dropTarget ?? ui.hover;
    const item = hoverItem != null && hasRealSlides() ? lastScene.items.find(x => x.order === hoverItem) : null;
    slidesPanel.highlight(item ? item.slideIndex : null);
  }
}

// 背景只在相关参数、图片或尺寸变化时重绘（模糊比较耗时）
const BG_KEYS = ['bgType', 'bg1', 'bg2', 'bgAngle', 'bgImageId', 'bgFit', 'bgScale', 'bgSlide', 'bgBlur', 'bgDim', 'bgDimColor', 'vignette'];
let bgCache = { key: '', image: null };
function paintBg(s, background) {
  const image = background?.preview || null;
  const key = `${BG_KEYS.map(k => s.style[k]).join('|')}|${bgCanvas.width}x${bgCanvas.height}|${lastScene.H}`;
  if (key === bgCache.key && image === bgCache.image) return;
  bgCache = { key, image };
  paintBackground(bgCtx, bgCanvas.width, bgCanvas.height, s.style, { image, unit: bgCanvas.height / lastScene.H });
}

// 普通画布：等比放进舞台；长图：按舞台宽度铺开，舞台纵向滚动
let canvasKey = '';
function fitViewport() {
  const s = store.get();
  const { W, H, long } = canvasOf(s);
  canvasKey = `${Math.round(W)}x${Math.round(H)}`;
  stage.classList.toggle('long', long);
  const rect = stage.getBoundingClientRect();
  const pad = 40;
  const availW = Math.max(50, rect.width - pad * 2);
  const availH = Math.max(50, rect.height - pad * 2 - 16 - 48); // 48：顶部工具条
  const a = W / H;
  let w, h;
  if (long) {
    w = Math.min(availW, 900);
    h = w / a;
  } else {
    w = availW; h = w / a;
    if (h > availH) { h = availH; w = h * a; }
  }
  viewport.style.width = `${Math.round(w)}px`;
  viewport.style.height = `${Math.round(h)}px`;
  // 长图很高时降低像素密度，避免超出 WebGL 限制
  viewDpr = Math.min(dpr(), renderer.maxViewport / h, Math.sqrt(48e6 / (w * h)));
  const pw = Math.round(w * viewDpr), ph = Math.round(h * viewDpr);
  bgCanvas.width = pw;
  bgCanvas.height = ph;
  bgCache.key = ''; // 改尺寸会清空画布，需要重画背景
  renderer.setSize(pw, ph);
  scheduleRender();
}

new ResizeObserver(fitViewport).observe(stage);

// 屏幕坐标 → 命中的 item（不在预览区内返回 null）
function pickAt(clientX, clientY) {
  const r = viewport.getBoundingClientRect();
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
  return pickItem(lastScene, ((clientX - r.left) / r.width) * 2 - 1, 1 - ((clientY - r.top) / r.height) * 2);
}

function drawChecker(ctx, w, h, size = 8) {
  ctx.fillStyle = '#2a2e37';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#3a3f4b';
  for (let y = 0; y < h; y += size) for (let x = (y / size) % 2 ? size : 0; x < w; x += size * 2) ctx.fillRect(x, y, size, size);
}

// 把当前画面画进一个小画布（导出面板预览、项目缩略图）
// cover：铺满目标尺寸并从顶部裁切（缩略图用）；whiteFill：透明背景以白色填充（JPG 预览）
function drawPreview(canvas, { maxW = 440, maxH = 320, cover = false, whiteFill = false } = {}) {
  const transparent = store.get().style.bgType === 'transparent';
  const sw = bgCanvas.width, sh = bgCanvas.height;
  let w, h, sx = 0, cw = sw, ch = sh;
  if (cover) {
    w = maxW; h = maxH;
    const scale = Math.max(w / sw, h / sh);
    cw = w / scale; ch = h / scale;
    sx = (sw - cw) / 2;
  } else {
    const a = sw / sh;
    w = maxW; h = w / a;
    if (h > maxH) { h = maxH; w = h * a; }
  }
  const k = cover ? 1 : dpr();
  canvas.width = Math.max(1, Math.round(w * k));
  canvas.height = Math.max(1, Math.round(h * k));
  if (!cover) {
    canvas.style.width = `${Math.round(w)}px`;
    canvas.style.height = `${Math.round(h)}px`;
  }
  const ctx = canvas.getContext('2d');
  const saved = { ...ui };
  Object.assign(ui, { hover: null, dragSource: null, dropTarget: null, selected: null, listHover: null });
  render(); // WebGL 画布在下一帧会被清空，所以同步渲染后立即拷贝
  Object.assign(ui, saved);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!transparent) ctx.drawImage(bgCanvas, sx, 0, cw, ch, 0, 0, canvas.width, canvas.height);
  else if (whiteFill) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  else if (cover) drawChecker(ctx, canvas.width, canvas.height, 10); // 缩略图是 JPG，画上棋盘格表示透明
  ctx.drawImage(glCanvas, sx, 0, cw, ch, 0, 0, canvas.width, canvas.height);
  scheduleRender();
}

const snapshot = width => {
  const c = document.createElement('canvas');
  drawPreview(c, { maxW: width, maxH: Math.round(width * 0.625), cover: true });
  return new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
};

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

// 拖入文件：.slidegrid → 导入项目；落在某张卡片上 → 放入/替换；否则追加
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
  dropHit = pickAt(e.clientX, e.clientY);
  setUi('dropTarget', dropHit ? dropHit.order : null);
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
$('clear-btn').addEventListener('click', () => {
  if (hasRealSlides() && confirm('移除当前项目的全部图片？（设置会保留）')) actions.clearSlides();
});

/* ---------------- 导出 / 复制 ---------------- */

let busy = false;
function exportOptions(s, overrides = {}) {
  const o = s.exportOpts;
  return {
    longSide: resolveLongSide(o),
    format: o.format,
    quality: o.quality,
    ...overrides,
  };
}

function exportInfo(s) {
  const { width, height } = exportSize(canvasOf(s), resolveLongSide(s.exportOpts));
  const base = (s.project?.name || 'slidegrid').replace(/[\\/:*?"<>|]/g, '_');
  return { width, height, defaultName: `${base}-${width}x${height}` };
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

async function doExport() {
  if (busy) return;
  exportPopover.setBusy(true);
  try {
    await withBusy(async () => {
      const s = store.get();
      const name = exportPopover.filename();
      const { blob, width, height } = await renderToBlob(sceneInput(s), exportOptions(s, { onProgress: progress('正在导出') }));
      downloadBlob(blob, name);
      toast(`已导出 ${name}（${width} × ${height}）`);
    });
  } catch (err) {
    console.error(err);
    exportPopover.setError(`导出失败：${err.message}`);
    toast(`导出失败：${err.message}`, { error: true, duration: 5000 });
  } finally {
    exportPopover.setBusy(false);
  }
}

// 复制：剪贴板只支持 PNG。clipboard.write 必须在点击事件里同步发起。
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
$('export-btn').addEventListener('click', doExport);

/* ---------------- 界面 ---------------- */

initResizers($('app'));

const slidesPanel = createSlidesPanel({
  listEl: $('slide-list'),
  countEl: $('slide-count'),
  emptyEl: $('empty-tip'),
  dropzone: $('dropzone'),
  footEl: $('slides-foot'),
  viewButtons: { grid: $('view-grid'), list: $('view-list') },
  onRemove: actions.removeSlide,
  onMove: actions.moveSlide,
  onHover: i => setUi('listHover', i), // 左侧悬停 → 预览区高亮这张图出现的所有位置
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
const presetsPanel = createPresetsPanel(settings.presetsContainer, {
  store, actions, snapshot, toast, download: downloadBlob,
  onCount: n => settings.setPresetCount(n),
});
const aspectBar = createAspectBar($('aspect-bar'), { onSelect: actions.setAspect });
const updateSizePicker = buildControls($('size-picker'), sizeSchema, store.get().exportOpts, actions.setExport);
const exportPopover = createExportPopover({ anchor: $('export-btn'), store, actions, drawPreview, info: exportInfo });

// 工具是否可用：移动 / 旋转卡片只用于平面版式；视角只用于 3D
function toolAvailability(id) {
  const three = is3D();
  if ((id === 'move' || id === 'rotate') && three) return { ok: false, reason: '3D 版式暂不支持单张调整，可在平面版式中使用' };
  if (id === 'orbit' && !three) return { ok: false, reason: '仅 3D 版式可用' };
  if (id === 'select' && !hasRealSlides()) return { ok: true, reason: '' };
  return { ok: true, reason: '' };
}
function setTool(id) {
  if (!toolAvailability(id).ok) {
    toast(toolAvailability(id).reason, { error: true });
    return;
  }
  ui.tool = id;
  if (id !== 'move' && id !== 'rotate') ui.selected = null;
  refreshTools();
  scheduleRender();
}
function refreshTools() {
  const s = store.get();
  toolbar.update({
    tool: ui.tool,
    tempHand: ui.tempHand,
    zoomValue: s.camera.zoom,
    adjustCount: Object.keys(s.adjust[s.layoutId] || {}).length,
  });
  updateHint(s);
  interaction?.updateCursor();
}

const zoomBy = k => {
  const cam = store.get().camera;
  actions.setCamera({ zoom: Math.min(8, Math.max(0.2, (cam.zoom || 1) * k)) });
};
const toolbar = createToolbar($('app'), {
  onTool: setTool,
  availability: toolAvailability,
  onZoomIn: () => zoomBy(1.25),
  onZoomOut: () => zoomBy(0.8),
  onZoomReset: () => actions.resetCamera(),
  onResetAdjust: () => {
    actions.resetAdjust();
    ui.selected = null;
    toast('已重置当前版式的卡片调整');
  },
});

// 屏幕坐标换算（移动 / 旋转 / 缩放共用）
const ndcToClient = ([x, y]) => {
  const r = viewport.getBoundingClientRect();
  return [r.left + ((x + 1) / 2) * r.width, r.top + ((1 - y) / 2) * r.height];
};
const toLayoutDelta = (dxPx, dyPx) => {
  const r = viewport.getBoundingClientRect();
  return ndcDeltaToLayout(lastScene, (dxPx / r.width) * 2, (-dyPx / r.height) * 2);
};
const getAdjust = order => ({ ...((store.get().adjust[store.get().layoutId] || {})[order]) });
const nextLift = () => 1 + Math.max(0, ...Object.values(store.get().adjust[store.get().layoutId] || {}).map(a => a.lift || 0));

// 选中卡片的缩放手柄：移动 / 旋转工具下、平面版式中显示
let resizeHandles = null;
resizeHandles = createResizeHandles(viewport, {
  getTarget: () => {
    if (ui.selected == null || !lastScene || is3D() || ui.tempHand) return null;
    if (ui.tool !== 'move' && ui.tool !== 'rotate') return null;
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
  pick: (nx, ny) => pickItem(lastScene, nx, ny),
  getTool: () => ui.tool,
  setTool,
  toolAvailable: id => toolAvailability(id).ok,
  is3D,
  canSwap: hasRealSlides,
  wheelScrolls: isLong,
  getSlide: i => store.get().slides[i],
  worldPerPx: () => (lastScene ? lastScene.W : canvasOf(store.get()).W) / viewport.clientWidth,
  getCamera: () => store.get().camera,
  setCamera: actions.setCamera,
  resetCamera: actions.resetCamera,
  setHover: hit => setUi('hover', hit ? hit.order : null),
  setDragSource: i => setUi('dragSource', i),
  setDropTarget: hit => setUi('dropTarget', hit ? hit.order : null),
  onSwap: (a, b) => {
    actions.swapSlides(a, b);
    toast(`已交换第 ${a + 1} 张和第 ${b + 1} 张`);
  },
  // 单张卡片调整
  getAdjust,
  nextLift,
  toLayoutDelta,
  itemCenterClient: item => ndcToClient(itemCenterNdc(lastScene, item)),
  setItemAdjust: (order, patch) => actions.setItemAdjust(order, patch),
  resetItemAdjust: order => { actions.resetItemAdjust(order); toast('已复位这张卡片'); },
  getSelected: () => ui.selected,
  setSelected: order => setUi('selected', order),
  onTempHand: on => { ui.tempHand = on; refreshTools(); },
});

const hint = $('stage-hint');
const TOOL_HINTS = {
  select: '排列：把卡片拖到另一张上交换',
  move: '移动：拖动卡片调整位置 · 拖角点缩放（⌥ 以中心）· +/- 缩放 · 方向键微调 · 双击卡片复位',
  rotate: '旋转：拖动卡片旋转 · Shift 按 15° 吸附 · 拖角点缩放 · 双击卡片复位',
  hand: '抓手：拖动平移画面',
  orbit: '视角：拖动旋转 3D 视角',
};
function updateHint(s) {
  const parts = [TOOL_HINTS[ui.tempHand ? 'hand' : ui.tool]];
  if (!s.slides.length) parts.push('拖入图片替换示例图');
  parts.push('中键 / 空格平移', isLongAspect(s.aspect) ? '⌘ + 滚轮缩放' : '滚轮缩放');
  hint.textContent = parts.join(' · ');
}

const projectChanged = (a, b) =>
  a.slides !== b.slides || a.assets !== b.assets || a.layoutId !== b.layoutId || a.params !== b.params ||
  a.style !== b.style || a.aspect !== b.aspect || a.camera !== b.camera || a.adjust !== b.adjust;

let prev = store.get();
setWheelMode(prev.wheelMode);
store.subscribe(s => {
  if (s.wheelMode !== prev.wheelMode) setWheelMode(s.wheelMode);
  viewport.classList.toggle('transparent', s.style.bgType === 'transparent');
  if (s.slides !== prev.slides) {
    slidesPanel.render(s.slides);
    renderer.prune(new Set(slidesOf(s).map(x => x.id)));
  }
  if (s.layoutId !== prev.layoutId || s.project !== prev.project) {
    Object.assign(ui, { hover: null, dropTarget: null, selected: null });
    if (!toolAvailability(ui.tool).ok) ui.tool = 'select'; // 换版式后工具不可用就回到排列
  }
  if (s.project !== prev.project) projectTitle.textContent = s.project?.name || '未命名项目';
  if (projectChanged(s, prev)) controller.markDirty();
  // 画布尺寸变化（换比例，或长图内容高度变化）时重新适配预览区
  const c = canvasOf(s);
  if (s.aspect !== prev.aspect || `${Math.round(c.W)}x${Math.round(c.H)}` !== canvasKey) fitViewport();
  settings.update(s);
  aspectBar.update(s.aspect);
  updateSizePicker(s.exportOpts);
  exportPopover.update(s);
  refreshTools();
  prev = s;
  scheduleRender();
});

slidesPanel.render(prev.slides);
viewport.classList.toggle('transparent', prev.style.bgType === 'transparent');
aspectBar.update(prev.aspect);
refreshTools();
fitViewport();

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
  ui,
  setTool,
};
