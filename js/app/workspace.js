import { store, boardsOf, selectionOf } from '../state.js';
import { aspectLabel } from '../config.js';
import { Renderer } from '../render/renderer.js';
import { cachedScene, cachedCanvas } from '../render/scene.js';
import { tileMatrix } from '../render/math.js';
import { pickItem, itemCenterNdc, itemCornersNdc, ndcDeltaToLayout } from '../render/picking.js';
import { paintBackground } from '../render/background.js';
import { rectOfPoints, intersects } from '../workspace/snap.js';
import { view, toScreen, zoomViewAt, panView, fitRect, unionRect, MIN_ZOOM, MAX_ZOOM } from '../workspace/view.js';
import { clamp } from '../core/utils.js';
import { drawLayers } from '../layers/draw.js';
import { slidesOf, boardInput, boardWorldRect } from './boards.js';
import { ui } from './uiState.js';

/**
 * 工作区：所有画板画在同一张画布上（2D 画布画画板背景 / 名称，WebGL 画幻灯片）。
 * 负责渲染循环、视图（缩放 / 平移 / 适合窗口）和屏幕坐标 ↔ 画板 / 卡片的换算。
 *
 * 性能：
 *   - 场景按输入缓存（render/scene.js），只有改动过的画板会重新排版
 *   - 视野外的画板、画板里视野外的卡片都不画（renderer.visibleItems）
 *   - 画板背景缓存成小图，只在样式或显示尺寸档位变化时重画
 */
const PASTEBOARD = '#0b0d11';
const ACCENT = [124 / 255, 140 / 255, 1];
const HL = {
  hover: { color: ACCENT, fill: 0.08, ring: 2 },
  target: { color: ACCENT, fill: 0.28, ring: 4 },
  source: { color: [0.05, 0.06, 0.08], fill: 0.6, ring: 0 },
  // 选中：主题色粗描边 + 浅色填充，浅色 / 深色幻灯片上都看得清
  selected: { color: ACCENT, fill: 0.2, ring: 3 },
  selectedEdge: { color: [1, 1, 1], fill: 0, ring: 1 },
};
const BG_KEYS = ['bgType', 'bg1', 'bg2', 'bgAngle', 'bgImageId', 'bgFit', 'bgScale', 'bgSlide', 'bgBlur', 'bgDim', 'bgDimColor', 'vignette'];
const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

export function createWorkspace({ viewport, bgCanvas, glCanvas, fgCanvas }) {
  const renderer = new Renderer(glCanvas); // 不支持 WebGL2 时抛错，由调用方提示
  const bgCtx = bgCanvas.getContext('2d');
  const fgCtx = fgCanvas.getContext('2d'); // 图层（文字、形状、路径）和选框，画在幻灯片上面
  // afterRender(s)：每帧画完后；drawOverlay(ctx, dpr)：在当前画板上画选框 / 手柄；editingLayer()：正在编辑、不画的文字图层
  const hooks = { afterRender: null, drawOverlay: null, editingLayer: null };

  let frame = 0;
  let viewDpr = dpr();
  const boardInfo = new Map(); // 画板 id → { sx, sy, sw, sh（屏幕 CSS 像素）, W, H, zoom, scene, label }
  let lastScene = null;        // 当前画板的场景
  const scheduleRender = () => { if (!frame) frame = requestAnimationFrame(render); };

  /* ---------------- 高亮 ---------------- */

  function buildOverlays(scene) {
    const overlays = [];
    const add = (item, kind) => overlays.push({ item, ...HL[kind], ring: HL[kind].ring * viewDpr });
    if (ui.dragSource != null) for (const it of scene.items) if (it.slideIndex === ui.dragSource) add(it, 'source');
    if (ui.listHover != null) for (const it of scene.items) if (it.slideIndex === ui.listHover) add(it, 'hover');
    if (ui.selection.length) {
      const sel = new Set(ui.selection);
      for (const it of scene.items) if (sel.has(it.order)) { add(it, 'selected'); add(it, 'selectedEdge'); }
    }
    const targetOrder = ui.dropTarget ?? ui.hover;
    if (targetOrder != null) {
      const it = scene.items.find(x => x.order === targetOrder);
      if (it) add(it, ui.dropTarget != null ? 'target' : 'hover');
    }
    return overlays;
  }

  /* ---------------- 画板背景 ---------------- */

  // 每个画板的背景缓存成一张小图（模糊等效果很耗时），再按视图缩放画到工作区
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

  /* ---------------- 渲染 ---------------- */

  // 最近 120 帧的耗时（毫秒），调试用：SlideGrid.perf
  const perf = {
    frames: [],
    push(ms) { this.frames.push(ms); if (this.frames.length > 120) this.frames.shift(); },
    get avg() { return this.frames.reduce((a, b) => a + b, 0) / (this.frames.length || 1); },
  };

  function render() {
    const t0 = performance.now();
    renderFrame();
    perf.push(performance.now() - t0);
  }

  function renderFrame() {
    frame = 0;
    const s = store.get();
    const d = viewDpr;
    const CW = bgCanvas.width, CH = bgCanvas.height;

    bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    bgCtx.fillStyle = PASTEBOARD;
    bgCtx.fillRect(0, 0, CW, CH);
    renderer.clear();
    fgCtx.setTransform(1, 0, 0, 1, 0, 0);
    fgCtx.clearRect(0, 0, CW, CH);
    const skip = hooks.editingLayer?.() || null;

    boardInfo.clear();
    lastScene = null;
    const selected = new Set(selectionOf(s));
    for (const b of boardsOf(s)) {
      const input = boardInput(s, b.settings);
      const { W, H } = cachedCanvas(input);
      const [sx, sy] = toScreen(b.x, b.y);
      const sw = W * view.zoom, sh = H * view.zoom;
      const info = { id: b.id, name: b.name, sx, sy, sw, sh, W, H, x: b.x, y: b.y, zoom: view.zoom, scene: null };
      boardInfo.set(b.id, info);
      const active = b.id === s.activeBoard;

      // 画板名称（左上角上方）
      bgCtx.font = `${(active ? 600 : 400)} ${12 * d}px -apple-system, "PingFang SC", system-ui, sans-serif`;
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
      for (const slide of input.slides) renderer.setTexture(slide.id, slide.preview); // 同一来源不会重复上传
      info.scene = cachedScene(input);
      if (active) lastScene = info.scene;
      const tile = tileMatrix(vx0 - px.x, vy0 - px.y, vx1 - vx0, vy1 - vy0, px.w, px.h);
      renderer.render(info.scene, tile, active ? buildOverlays(info.scene) : [], {
        viewport: [vx0, CH - vy1, vx1 - vx0, vy1 - vy0], clear: false,
      });
    }
    // 图层：单独一遍画在最上面，不按画板裁切（画板外的部分也能看到、点选，类似 Illustrator；导出时才裁切）。
    // 画板本身不在视野里时，伸进视野的图层也照样画
    for (const b of boardsOf(s)) {
      if (!b.settings.layers?.length) continue;
      const [sx, sy] = toScreen(b.x, b.y);
      fgCtx.save();
      fgCtx.setTransform(view.zoom * d, 0, 0, view.zoom * d, sx * d, sy * d);
      drawLayers(fgCtx, b.settings.layers, { skip, assets: s.assets });
      fgCtx.restore();
    }
    // 当前画板的选框、手柄、锚点（不裁切，可以超出画板）
    if (boardInfo.get(s.activeBoard)) {
      fgCtx.setTransform(1, 0, 0, 1, 0, 0);
      hooks.drawOverlay?.(fgCtx, d);
    }
    hooks.afterRender?.(s);
  }

  function resizeWorkspace() {
    const w = viewport.clientWidth, h = viewport.clientHeight;
    viewDpr = dpr();
    const pw = Math.max(1, Math.round(w * viewDpr)), ph = Math.max(1, Math.round(h * viewDpr));
    bgCanvas.width = fgCanvas.width = pw;
    bgCanvas.height = fgCanvas.height = ph;
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
  const panBy = (dx, dy) => { panView(dx, dy); autoFit = null; scheduleRender(); };

  /* ---------------- 坐标换算 ---------------- */

  const activeInfo = () => boardInfo.get(store.get().activeBoard);
  const local = (clientX, clientY) => {
    const r = viewport.getBoundingClientRect();
    return [clientX - r.left, clientY - r.top];
  };
  // 屏幕坐标下的画板（后画的在上面）
  function boardAt(clientX, clientY) {
    const [x, y] = local(clientX, clientY);
    const boards = [...boardInfo.values()];
    for (let i = boards.length - 1; i >= 0; i--) {
      const b = boards[i];
      if (x >= b.sx && x <= b.sx + b.sw && y >= b.sy && y <= b.sy + b.sh) return b.id;
    }
    return null;
  }
  // 屏幕坐标 → 某个画板里的卡片
  function pickIn(info, clientX, clientY) {
    if (!info?.scene) return null;
    const [lx, ly] = local(clientX, clientY);
    const x = lx - info.sx, y = ly - info.sy;
    if (x < 0 || y < 0 || x > info.sw || y > info.sh) return null;
    return pickItem(info.scene, (x / info.sw) * 2 - 1, 1 - (y / info.sh) * 2);
  }
  const pickAt = (clientX, clientY) => pickIn(activeInfo(), clientX, clientY);
  const pickOn = (id, clientX, clientY) => pickIn(boardInfo.get(id), clientX, clientY);
  // 画板名称标签（拖动它移动画板）
  function labelAt(clientX, clientY) {
    const [x, y] = local(clientX, clientY);
    for (const b of [...boardInfo.values()].reverse()) {
      const l = b.label;
      if (l && x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h) return b.id;
    }
    return null;
  }
  // 当前画板的场景：切换画板后、下一帧画出来之前也能用（同一次点击里切换画板并选中卡片）
  const activeScene = () => activeInfo()?.scene || lastScene;
  // 当前画板的 NDC → 屏幕坐标
  const ndcToClient = ([x, y]) => {
    const r = viewport.getBoundingClientRect();
    const info = activeInfo();
    return [r.left + info.sx + ((x + 1) / 2) * info.sw, r.top + info.sy + ((1 - y) / 2) * info.sh];
  };
  // 屏幕上的位移（CSS 像素）→ 当前画板版式坐标里的位移
  const toLayoutDelta = (dxPx, dyPx) => {
    const info = activeInfo();
    return ndcDeltaToLayout(activeScene(), (dxPx / info.sw) * 2, (-dyPx / info.sh) * 2);
  };
  const itemCenterClient = item => ndcToClient(itemCenterNdc(activeScene(), item));
  const itemCornersClient = item => itemCornersNdc(activeScene(), item).map(ndcToClient);
  const findItem = order => activeScene()?.items.find(x => x.order === order) || null;
  const allCards = () => activeScene()?.items.map(x => x.order) || [];

  // 当前画板里每张卡片在屏幕上的范围（相对工作区，CSS 像素），按场景 + 画板位置缓存
  const rectCache = new WeakMap();
  function itemRects() {
    const info = activeInfo();
    if (!info?.scene) return [];
    const cached = rectCache.get(info.scene);
    if (cached && cached.sx === info.sx && cached.sy === info.sy && cached.sw === info.sw) return cached.list;
    const toLocal = ([x, y]) => [info.sx + ((x + 1) / 2) * info.sw, info.sy + ((1 - y) / 2) * info.sh];
    const area = { l: -200, t: -200, r: viewport.clientWidth + 200, b: viewport.clientHeight + 200 };
    const list = [];
    for (const it of info.scene.items) {
      const rect = rectOfPoints(itemCornersNdc(info.scene, it).map(toLocal));
      if (intersects(rect, area)) list.push({ order: it.order, rect });
    }
    rectCache.set(info.scene, { sx: info.sx, sy: info.sy, sw: info.sw, list });
    return list;
  }
  function boardLocalRect(id) {
    const b = boardInfo.get(id);
    return b ? { l: b.sx, t: b.sy, r: b.sx + b.sw, b: b.sy + b.sh } : null;
  }

  return {
    renderer,
    hooks,
    perf,
    render,
    scheduleRender,
    resize: resizeWorkspace,
    lastScene: () => lastScene,
    activeScene,
    boardInfo: id => boardInfo.get(id),
    boardIds: () => [...boardInfo.keys()],
    forgetBoard: id => bgCache.delete(id),
    clearBackgrounds: () => bgCache.clear(),
    // 视图
    fitBoard, fitAll, zoomAtScreen, zoomViewBy, actualSize, panBy,
    // 坐标
    boardAt, pickIn, pickAt, pickOn, labelAt, ndcToClient, toLayoutDelta, itemCenterClient, itemCornersClient, findItem, allCards,
    itemRects, boardLocalRect,
  };
}
