import * as m4 from './math.js';
import { DEG } from '../core/utils.js';
import { cameraRot } from './orient.js';
import { aspectValue, isLongAspect, parsePixels } from '../config.js';
import { cardAspect } from '../style/schema.js';

// 世界坐标：画布高度固定为 1000，宽度 = 1000 × 画布比例，原点在画布中心，y 轴向上。
// 长图模式：宽度固定为 LONG_W，高度由版式内容决定。
export const WORLD_H = 1000;
export const LONG_W = 1600;

// 版式结果在画布上占据的上下范围（考虑 Z 轴旋转）
function verticalExtent(items) {
  let minY = Infinity, maxY = -Infinity;
  for (const it of items) {
    const a = (it.rz || 0) * DEG;
    const ey = Math.abs((it.w / 2) * Math.sin(a)) + Math.abs((it.h / 2) * Math.cos(a));
    minY = Math.min(minY, it.y - ey);
    maxY = Math.max(maxY, it.y + ey);
  }
  return Number.isFinite(minY) ? maxY - minY : 0;
}

/**
 * 计算画布的世界尺寸 { W, H, long }。
 * 长图模式下先用一个极高的画布试排，量出内容高度，再加上下边距。
 */
export function resolveCanvas({ slides, layout, params, aspect, style }) {
  if (!isLongAspect(aspect)) {
    const a = typeof aspect === 'number' ? aspect : aspectValue(aspect);
    // px：精确像素尺寸的画板（导出「画板尺寸」时用）
    return { W: WORLD_H * a, H: WORLD_H, long: false, px: parsePixels(aspect) };
  }
  const W = LONG_W;
  const n = slides.length; // 长图模式不限制数量
  if (!n || !layout.long) return { W, H: W * 16 / 9, long: true };
  const probe = layout.compute({ n, aspect: cardAspect(style, slides), W, H: 1e5, p: params, long: true }) || {};
  const margin = params.margin ?? 80;
  const H = Math.max(W * 0.3, verticalExtent(probe.items || []) + 2 * margin);
  return { W, H, long: true };
}

// 实际使用的相机类型：版式给的，或立方体视图里切换的（user.proj：'ortho' 正交 / 'persp' 透视）
export function effectiveCamera(cam = { type: 'ortho' }, user = {}) {
  if (user.proj === 'ortho') return { type: 'ortho' };
  if (user.proj === 'persp') return { type: 'perspective', fov: cam.type === 'perspective' ? cam.fov : 32 };
  return cam;
}

function makeCamera(layoutCam, user, W, H) {
  const cam = effectiveCamera(layoutCam, user);
  const rot = cameraRot(user); // pitch / yaw（构图工具）+ q（立方体视图）
  const zoom = user.zoom || 1;
  const pan = m4.translation(user.panX || 0, user.panY || 0, 0);
  if (cam.type === 'perspective') {
    const fov = (cam.fov || 35) * DEG;
    // 让 z=0 平面恰好铺满画布高度：平面版式与 3D 版式使用同一套尺寸
    const dist = (H / 2) / Math.tan(fov / 2);
    return {
      proj: m4.perspective(fov, W / H, dist * 0.01, dist * 100),
      view: m4.multiplyAll(pan, m4.translation(0, 0, -dist / zoom), rot),
    };
  }
  return {
    proj: m4.ortho(-W / 2, W / 2, -H / 2, H / 2, -1e5, 1e5),
    view: m4.multiplyAll(pan, m4.scaling(zoom, zoom, zoom), rot),
  };
}

/**
 * 以屏幕上的某点为中心缩放：返回新的 { zoom, panX, panY }。
 * (cx, cy) 为该点相对画布中心的偏移（世界单位，y 向上）。
 */
export function zoomAround(camera, perspective, cx, cy, nextZoom) {
  const z = camera.zoom || 1, px = camera.panX || 0, py = camera.panY || 0;
  if (perspective) {
    // 屏幕位置 s = zoom × (pan + p)
    return { zoom: nextZoom, panX: px + cx / nextZoom - cx / z, panY: py + cy / nextZoom - cy / z };
  }
  // 屏幕位置 s = pan + zoom × p
  const k = nextZoom / z;
  return { zoom: nextZoom, panX: cx - k * (cx - px), panY: cy - k * (cy - py) };
}

// 屏幕上移动 1 个世界单位，对应 pan 需要变化多少
export const panFactor = (camera, perspective) => (perspective ? 1 / (camera.zoom || 1) : 1);

const clamp1 = v => Math.max(-1, Math.min(1, Number(v) || 0));

/**
 * 图片按 cover 方式填满卡片，再按裁切参数放大 / 平移。返回 [sx, sy, ox, oy]：
 * sx / sy 为卡片里显示的图片宽高占比，ox / oy 为左上角偏移（uv 坐标，y 向下）。
 * crop：{ cropZ ≥ 1 放大, cropX / cropY ∈ [-1, 1] 在可移动范围内的位置（0 = 居中，正值 = 显示右侧 / 下方） }
 */
export function cropUV(imgAspect, cellAspect, crop = null) {
  let sx = 1, sy = 1;
  if (imgAspect > cellAspect) sx = cellAspect / imgAspect;
  else sy = imgAspect / cellAspect;
  const z = Math.max(1, Number(crop?.cropZ) || 1);
  sx /= z;
  sy /= z;
  const ox = (1 - sx) * (0.5 + clamp1(crop?.cropX) / 2);
  const oy = (1 - sy) * (0.5 + clamp1(crop?.cropY) / 2);
  return [sx, sy, ox, oy];
}

// 版式要排几张卡片：有「数量」参数（> 0）时最多这么多张，否则和图片一样多；长图模式要把所有图片排下来，不限制
const cardCount = (params, n, long = false) => (!long && params?.count > 0 ? Math.max(1, Math.min(n, Math.round(params.count))) : n);

// 卡片的手动调整里除了「固定显示哪张图」（slide）之外还有别的（位置、旋转、缩放、裁切）
export const hasAdjust = a => !!a && Object.keys(a).some(k => k !== 'slide');

/**
 * 每个位置用第几张幻灯片。
 *   'layout'（默认）：按版式给的序号循环（it.i % n）
 *   'visible'：先给画板里看得见的卡片（卡片中心投影在画板内），按行从上到下、行内从左到右；
 *   'center'：先给看得见的卡片，从画板中心向外。
 *   两种方式下，画板外的卡片接着往后分配（离画板越近越先），这样可见区域里尽量不重复。
 * project(it) → 卡片中心、上边中点、下边中点的齐次裁剪坐标 [[x, y, z, w] × 3]；aspect：画板宽高比（算距离时把横向拉回实际比例）
 */
function assignSlides(raw, n, mode, project, aspect) {
  if (mode !== 'visible' && mode !== 'center') return raw.map(it => ((it.i % n) + n) % n);
  const pts = raw.map((it, order) => {
    const [c, top, bottom] = project(it);
    if (c[3] <= 1e-6) return { order, x: 0, y: 0, h: 0, visible: false, far: Infinity };
    const x = c[0] / c[3], y = -c[1] / c[3]; // y 向下
    const h = top[3] > 1e-6 && bottom[3] > 1e-6 ? Math.abs(top[1] / top[3] - bottom[1] / bottom[3]) : 0; // 屏幕上的卡片高度
    const visible = x >= -1 && x <= 1 && y >= -1 && y <= 1;
    // 离画板的远近：画板外的卡片按到画板中心的距离排
    return { order, x, y, h, visible, far: Math.hypot(x * aspect, y) };
  });
  const vis = pts.filter(p => p.visible);
  if (mode === 'center') {
    vis.sort((a, b) => a.far - b.far || Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
  } else {
    // 按行：和这一行第一张的中心相差不到半张卡片高度的算同一行；行内从左到右
    vis.sort((a, b) => a.y - b.y);
    let row = 0, head = vis[0];
    for (const p of vis) {
      if (p.y - head.y > Math.max(0.01, Math.min(head.h, p.h || head.h) * 0.5)) { row++; head = p; }
      p.row = row;
    }
    vis.sort((a, b) => a.row - b.row || a.x - b.x);
  }
  const rest = pts.filter(p => !p.visible).sort((a, b) => a.far - b.far || a.order - b.order);
  const out = new Array(raw.length);
  [...vis, ...rest].forEach((p, k) => { out[p.order] = k % n; });
  return out;
}

/**
 * 把「幻灯片 + 版式 + 参数」转换成渲染器可以直接绘制的场景。
 * 预览和导出共用这一函数。
 */
export function buildScene({ slides, layout, params, style, aspect, camera, adjust = null, pool = null, albums = null }) {
  const { W, H, long, px } = resolveCanvas({ slides, layout, params, aspect, style });
  const n = slides.length;
  const empty = { W, H, long, px, items: [], viewProj: m4.identity(), coplanar: true, style, hidden: [], pulled: [] };
  empty.main = empty;
  if (!n) return empty;

  const slideAspect = cardAspect(style, slides); // 卡片的宽高比：跟随图片，或画板样式里固定的比例
  // 版式的「数量」参数：只排这么多张卡片（图片仍按 n 张循环分配）
  // cards：每张卡片的手动调整（版式可以读取自己的单卡设置，例如等距展台的「抬起」）；albums：分组版式按图集取图
  const result = layout.compute({ n: cardCount(params, n, long), aspect: slideAspect, W, H, p: params, long, cards: adjust || {}, albums: albums || [] }) || {};
  // 手动调整（移动 / 旋转工具）按位置序号叠加在版式结果上
  const flatLayout = layout.category !== '3d';
  const raw = (result.items || []).filter(it => it.w > 0 && it.h > 0).map((it, order) => {
    const a = adjust?.[order];
    if (!a || !hasAdjust(a)) return it;
    const k = a.s > 0 ? a.s : 1; // 等比缩放
    return {
      ...it,
      x: (it.x || 0) + (a.dx || 0),
      y: (it.y || 0) + (a.dy || 0),
      w: it.w * k,
      h: it.h * k,
      rz: (it.rz || 0) + (a.rz || 0),
      // 调整过前后的卡片：平面版式抬高一点（z），按远近自然叠在上面；3D 版式不动位置，只改绘制的先后（rank）
      z: (it.z || 0) + (flatLayout ? (a.lift || 0) * 20 : 0),
      rank: flatLayout ? 0 : a.lift || 0,
      adjusted: true,
      crop: a,
    };
  });

  const g = result.group || {};
  const groupM = m4.compose(g.x || 0, g.y || 0, g.z || 0, (g.rx || 0) * DEG, (g.ry || 0) * DEG, (g.rz || 0) * DEG, g.s ?? 1);
  const { proj, view } = makeCamera(result.camera || { type: 'ortho' }, camera || {}, W, H);
  const viewProj = m4.multiply(proj, view);

  // 顺序本身有意义的版式（主图、扇形、层叠、环形）始终按版式顺序：第一张就是主图 / 最前面那张
  const slideOf = assignSlides(raw, n, layout.ordered ? 'layout' : style?.slideOrder, it => {
    const model = m4.multiply(groupM, m4.compose(it.x || 0, it.y || 0, it.z || 0, (it.rx || 0) * DEG, (it.ry || 0) * DEG, (it.rz || 0) * DEG, 1));
    const mvp = m4.multiply(viewProj, model);
    return [[0, 0], [0, -it.h / 2], [0, it.h / 2]].map(([x, y]) => m4.transformVec4(mvp, [x, y, 0, 1]));
  }, W / H);

  // 交换 / 替换单张：卡片的手动调整里记了 slide（幻灯片 id）时，这个位置固定显示那一张（只影响这张卡片）；
  // 可以是这个画板图片列表里的，也可以是别的图集里的（在 pool 里找）
  const indexById = new Map(slides.map((x, i) => [x.id, i]));
  const extraSlides = new Map(); // 不在这个画板列表里的图片（渲染前要上传贴图）
  const albumById = new Map((albums || []).map(a => [a.id, a.slides.filter(x => !x.placeholder)]));
  let items = raw.map((it, order) => {
    const pinned = adjust?.[order]?.slide;
    const inList = pinned != null && indexById.has(pinned);
    // 分组版式：卡片指定了图集（album）和图集里的第几张（ai）
    const fromAlbum = albumById.get(it.album);
    const grouped = pinned == null && fromAlbum?.length ? fromAlbum[((it.ai || 0) % fromAlbum.length + fromAlbum.length) % fromAlbum.length] : null;
    const foreign = grouped && !indexById.has(grouped.id) ? grouped
      : pinned != null && !inList ? pool?.get(pinned) : null;
    const slideIndex = inList ? indexById.get(pinned) : grouped && indexById.has(grouped.id) ? indexById.get(grouped.id) : slideOf[order];
    const slide = foreign || slides[slideIndex];
    if (foreign) extraSlides.set(foreign.id, foreign);
    const model = m4.multiply(groupM, m4.compose(
      it.x || 0, it.y || 0, it.z || 0, (it.rx || 0) * DEG, (it.ry || 0) * DEG, (it.rz || 0) * DEG, 1,
    ));
    const depth = m4.multiply(view, model)[14]; // 视图空间中心点的 z
    // 抬起的卡片：远近效果（渐隐、景深）按它下面那块桌面算，整张一样——不然抬向镜头的卡片会比周围更「近」，被模糊掉
    const fxDepth = it.floor ? m4.transformVec4(m4.multiply(view, groupM), [it.x || 0, it.y || 0, 0, 1])[2] : null;
    const imgAspect = slide.aspect || slideAspect;
    let w = it.w, h = it.h;
    if (it.crop?.fit === 'contain') {
      // 完整显示：卡片收缩到图片比例（居中放在原来的位置里），不裁切
      if (imgAspect > w / h) h = w / imgAspect; else w = h * imgAspect;
    }
    // order：在版式结果中的序号（同一版式下稳定，用于悬停/拖放定位）
    // slideIndex：对应第几张幻灯片（铺满型版式中会重复出现）
    return {
      slide, slideIndex, model, w, h, order, depth, adjusted: !!it.adjusted, stack: it.stack ?? 0, rank: it.rank || 0, lifted: !!it.floor, fxDepth,
      opacity: it.opacity ?? 1,
      // 图层列表里的操作：hidden 隐藏这张卡片；pulled 把它拖出「幻灯片」一组，画在某个图层的上面（值为图层 id，或 PULL_BACK = 最底下）
      hidden: !!adjust?.[order]?.hidden, pulled: adjust?.[order]?.above || null,
      uv: it.crop?.fit === 'contain' ? [1, 1, 0, 0] : cropUV(imgAspect, w / h, it.crop),
    };
  });
  // 由远及近绘制；版式给了 stack（叠放层级，例如桌面上一堆卡片谁压着谁）时先按 stack，同一层再按远近
  // 拖出组的卡片排在后面（画在图层之间，比组里的卡片靠前；拖到最底下的排在前面），点选时也就先点中它们
  const tier = it => (it.pulled === PULL_BACK ? -1 : it.pulled ? 1 : 0);
  // 3D 版式里手动调过前后的（rank）优先于版式自己的叠放层级（stack）；没调过的 rank 都是 0，照旧按 stack、远近
  const sorted = items.sort((a, b) => (tier(a) - tier(b)) || (a.rank - b.rank) || (a.stack - b.stack) || (a.depth - b.depth) || (a.order - b.order));
  // 隐藏的卡片不画、点不中（图层列表里还列着，可以再显示）
  const hiddenItems = sorted.filter(it => it.hidden);
  if (hiddenItems.length) items = sorted.filter(it => !it.hidden);

  // 抬起的卡片在桌面上的影子（版式给了 floorShadow 强度，卡片带 floor：竖直投到桌面上的形状）
  // 光从左上方略偏后：抬得越高，影子越淡、越散，也往右前方挪得越多（从卡片旁边露出来）
  const floors = [];
  const fs = Number(result.floorShadow) || 0;
  if (fs > 0) {
    for (const it of raw) {
      if (!it.floor) continue;
      const elev = Math.max(0, it.z || 0);
      const size = Math.min(it.w, it.h);
      floors.push({
        model: m4.multiplyAll(groupM, m4.translation((it.x || 0) + elev * 0.45, (it.y || 0) - elev * 0.4, 0),
          m4.scaling(it.floor.sx ?? 1, it.floor.sy ?? 1, 1), m4.rotationZ((it.rz || 0) * DEG)),
        w: it.w, h: it.h,
        blur: size * 0.04 + elev * 0.4,
        alpha: Math.min(1, fs * 0.85 / (1 + elev / (size * 0.9))),
        stack: it.floor.stack ?? (it.stack ?? 0) - 0.5,
      });
    }
    floors.sort((a, b) => a.stack - b.stack);
  }

  // 远处渐隐 / 景深：画板里看得见的卡片（中心在画板内）的远近范围
  let depthFx = null;
  const fx = result.depthFx;
  if (fx && (fx.fade > 0 || fx.dof > 0)) {
    let far = Infinity, near = -Infinity;
    const up = []; // 画板里抬起的卡片（自动对焦用）
    let mid = null, midDist = Infinity; // 离画板中心最近的卡片（没有抬起的卡片时对焦在它上面）
    for (const it of items) {
      const c = m4.transformVec4(viewProj, [it.model[12], it.model[13], it.model[14], 1]);
      if (c[3] <= 1e-6 || Math.abs(c[0] / c[3]) > 1 || Math.abs(c[1] / c[3]) > 1) continue;
      const d = it.fxDepth ?? it.depth;
      far = Math.min(far, d); near = Math.max(near, d);
      if (it.lifted) up.push(d);
      const dist = Math.hypot((c[0] / c[3]) * W / H, c[1] / c[3]);
      if (dist < midDist) { midDist = dist; mid = d; }
    }
    if (near > far) {
      let focus = typeof fx.focus === 'number' ? fx.focus : 0.5;
      if (fx.focus === 'auto') {
        // 对焦在抬起的卡片上（等距展台 / 分组展台抬起的卡片、满铺堆叠的主卡片）
        // 有主次顺序的版式（纵深层叠、环形展台）：对焦在第一张（最前面 / 主图）上
        const hero = layout.ordered ? items.find(it => it.order === 0) : null;
        const at = up.length ? up.reduce((a, d) => a + d, 0) / up.length : hero ? hero.fxDepth ?? hero.depth : mid;
        if (at != null) focus = Math.min(1, Math.max(0, (at - far) / (near - far)));
      }
      depthFx = { fade: +fx.fade || 0, dof: +fx.dof || 0, focus, far, near, dofPad: (+fx.dof || 0) * 0.035 };
    }
  }

  const z0 = raw[0]?.z || 0;
  const coplanar = raw.every(it => (it.z || 0) === z0 && !it.rx && !it.ry);

  const scene = {
    W, H, long, px, items, viewProj, coplanar: coplanar && !floors.length && items.every(it => !it.rank), style, groupM, floors, depthFx,
    extraSlides: [...extraSlides.values()], ortho: effectiveCamera(result.camera, camera || {}).type !== 'perspective', layoutCamera: result.camera || { type: 'ortho' },
    hidden: hiddenItems,
  };
  // 拖出「幻灯片」一组的卡片：主场景（main）里不画它们，按所在的位置各自成一个小场景（pulled），
  // 由工作区 / 导出在画图层的过程中插进去画。scene.items 仍是全部看得见的卡片（点选、列表、对齐都用它）
  const groups = new Map();
  for (const it of items) if (it.pulled) (groups.get(it.pulled) || groups.set(it.pulled, []).get(it.pulled)).push(it);
  scene.pulled = [...groups].map(([anchor, list]) => ({ anchor, scene: { ...scene, items: list, floors: [], coplanar: false, hidden: [], pulled: [] } }));
  scene.main = groups.size ? { ...scene, items: items.filter(it => !it.pulled), pulled: [] } : scene;
  return scene;
}

// 卡片「拖到所有图层下面」时的位置标记（adjust[版式][位置].above 的特殊值）
export const PULL_BACK = '__back__';

/**
 * 估算导出时每张图需要的纹理分辨率（长边像素），避免把所有原图都按原尺寸塞进显存。
 * 返回 Map<slideId, longSidePx>；画面外的图不计入。
 */
export function textureNeeds(scene, pxW, pxH) {
  const needs = new Map();
  for (const it of scene.items) {
    const id = it.slide.id;
    const mvp = m4.multiply(scene.viewProj, it.model);
    const hw = it.w / 2, hh = it.h / 2;
    const pts = [];
    let behind = false;
    for (const [x, y] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
      const v = m4.transformVec4(mvp, [x, y, 0, 1]);
      if (v[3] <= 1e-6) { behind = true; break; }
      pts.push([(v[0] / v[3] * 0.5 + 0.5) * pxW, (0.5 - v[1] / v[3] * 0.5) * pxH]);
    }
    if (behind) { needs.set(id, Infinity); continue; }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    if (Math.max(...xs) < 0 || Math.min(...xs) > pxW || Math.max(...ys) < 0 || Math.min(...ys) > pxH) continue;

    let ppu = 0; // 每世界单位对应的最大像素数
    for (let k = 0; k < 4; k++) {
      const a = pts[k], b = pts[(k + 1) % 4];
      ppu = Math.max(ppu, Math.hypot(b[0] - a[0], b[1] - a[1]) / (k % 2 === 0 ? it.w : it.h));
    }
    const imgW = (ppu * it.w) / it.uv[0];
    const imgH = (ppu * it.h) / it.uv[1];
    const a = it.slide.aspect || 1;
    const longSide = a >= 1 ? Math.max(imgW, imgH * a) : Math.max(imgH, imgW / a);
    needs.set(id, Math.max(needs.get(id) || 0, longSide * 1.25));
  }
  return needs;
}

/* ---------------- 缓存 ----------------
 * store 里的数据「改了就换新对象」，所以只要输入的各个字段引用不变，结果就不变。
 * 工作区每帧要为每个画板取场景 / 尺寸，用缓存避免重复排版（铺满型版式一个画板上千张卡片）；
 * 场景对象保持不变也让点选、对齐用的投影缓存（按 scene 缓存）在帧之间持续有效。
 */
const SCENE_KEYS = ['slides', 'layout', 'params', 'style', 'aspect', 'camera', 'adjust', 'pool', 'albums'];
const CANVAS_KEYS = ['slides', 'layout', 'params', 'aspect', 'style'];

function memo(fn, keys, size) {
  const entries = []; // 最近使用的在最后
  return input => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (keys.every(k => e.input[k] === input[k])) {
        if (i !== entries.length - 1) entries.push(...entries.splice(i, 1));
        return e.out;
      }
    }
    const out = fn(input);
    entries.push({ input: Object.fromEntries(keys.map(k => [k, input[k]])), out });
    if (entries.length > size) entries.shift();
    return out;
  };
}

// 与 buildScene / resolveCanvas 相同，但结果按输入缓存（不要修改返回的对象）
export const cachedScene = memo(buildScene, SCENE_KEYS, 48);
export const cachedCanvas = memo(resolveCanvas, CANVAS_KEYS, 96);
