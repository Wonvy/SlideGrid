import { store, actions } from '../state.js';
import { cachedScene, PULL_BACK, sortKey } from '../render/scene.js';
import { getLayout } from '../layouts/index.js';
import { itemCornersNdc } from '../render/picking.js';
import { sceneInput } from './boards.js';

/**
 * 卡片的前后顺序：上移一层 / 下移一层 / 置于顶层 / 置于底层，图层列表里拖动。
 * 前后记在卡片的 lift（手动调整）里：重新排好后按名次写回每张卡片的 lift。
 *   平面版式：lift 把卡片抬高一点（z = lift × 20），按远近自然叠在上面。版式本身给的 z（扇形、散落有一点点前后差）
 *             不超过 40，所以每一名相差 3（= 60 个世界单位）足以盖过它
 *   3D 版式：不动位置，只给挪动的那几张卡片的「远近」加一个偏移（bias），让它排到目标位置；
 *             别的卡片仍按真实的远近排，所以之后转动视角，前后大体还是对的（「恢复版式默认的前后」去掉所有偏移）
 * 另外两项也记在手动调整里：hidden（隐藏这张卡片）、above（拖出「幻灯片」一组，画在某个图层上面）。
 */
const LIFT_STEP = 3;
const MANY = 150; // 卡片太多（铺满型版式）时只调选中的卡片

export const activeCardScene = (s = store.get()) => cachedScene(sceneInput(s));
export const canStack = () => true;
const isFlatLayout = (s = store.get()) => getLayout(s.layoutId)?.category !== '3d';

/**
 * 3D 版式：把 moving 这几张卡片排到 next（从下到上的新顺序）里的位置——只改它们的 bias，别的卡片不动。
 * 返回要写回的调整 [{ order, patch }]（没有变化时为空）。
 */
function biasPatches(scene, next, moving) {
  const byOrder = new Map(scene.items.map(it => [it.order, it]));
  const keys = new Map(scene.items.map(it => [it.order, sortKey(it)]));
  const sel = new Set(moving);
  const out = [];
  for (let k = 0; k < next.length; k++) {
    const o = next[k];
    if (!sel.has(o)) continue;
    const it = byOrder.get(o);
    if (!it) continue;
    const lower = k > 0 ? keys.get(next[k - 1]) : undefined; // 前一张（可能刚挪过，用新的数）
    let upper;
    for (let j = k + 1; j < next.length; j++) if (!sel.has(next[j])) { upper = keys.get(next[j]); break; }
    const key = lower != null && upper != null ? (lower + upper) / 2 : lower != null ? lower + 1 : upper != null ? upper - 1 : keys.get(o);
    keys.set(o, key);
    const bias = key - (it.stack * 1e6 + it.depth);
    // 旧数据里的名次（lift）会压过 bias：挪过的卡片去掉它
    if (Math.abs(bias - (it.bias || 0)) > 1e-9 || it.rank) out.push({ order: o, patch: { bias: Math.abs(bias) < 1e-9 ? undefined : bias, lift: undefined } });
  }
  return out;
}

// 卡片在画板上的范围：四个角（NDC）+ 包围盒
function boxOf(scene, it) {
  const pts = itemCornersNdc(scene, it);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { pts, l: Math.min(...xs), r: Math.max(...xs), b: Math.min(...ys), t: Math.max(...ys) };
}
// 两张卡片在画面上是否重叠：先比包围盒，再用分离轴判断两个凸四边形（旋转过的卡片包围盒会偏大）
function overlaps(a, b) {
  if (!(a.l < b.r && b.l < a.r && a.b < b.t && b.b < a.t)) return false;
  for (const poly of [a.pts, b.pts]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const nx = q[1] - p[1], ny = p[0] - q[0];
      const proj = pts => pts.map(v => v[0] * nx + v[1] * ny);
      const pa = proj(a.pts), pb = proj(b.pts);
      if (Math.max(...pa) <= Math.min(...pb) + 1e-9 || Math.max(...pb) <= Math.min(...pa) + 1e-9) return false;
    }
  }
  return true;
}
const inBoard = b => b.r > -1 && b.l < 1 && b.t > -1 && b.b < 1;

/** 画板里看得见的卡片，从最上面到最下面（图层列表用）；max：最多几张 */
export function visibleCards(scene = activeCardScene(), max = 200) {
  const out = [];
  for (let i = scene.items.length - 1; i >= 0 && out.length < max; i--) {
    const it = scene.items[i];
    if (inBoard(boxOf(scene, it))) out.push(it);
  }
  return out;
}

/**
 * 调整卡片前后。dir > 0 往上、< 0 往下；toEnd：直接到最上 / 最下。
 * 上移一层 = 越过上面第一张和它重叠的卡片（不重叠的卡片前后无所谓）。返回是否有变化。
 */
export function stackCards(orders, dir, toEnd = false) {
  if (!canStack() || !orders.length) return false;
  const scene = activeCardScene();
  const list = scene.items.map(it => it.order); // 从下到上（绘制顺序）
  const sel = new Set(orders);
  const adjust = store.get().adjust[store.get().layoutId] || {};
  const flat = isFlatLayout();
  if (flat && list.length > MANY) {
    // 卡片很多：只把选中的放到最上 / 最下
    const lifts = Object.values(adjust).map(a => a.lift || 0);
    const lift = dir > 0 ? Math.max(0, ...lifts) + LIFT_STEP : Math.min(0, ...lifts) - LIFT_STEP;
    actions.setItemAdjusts(orders.map(order => ({ order, patch: { lift } })));
    return true;
  }
  let next = [...list];
  if (toEnd) {
    const a = next.filter(o => sel.has(o)), b = next.filter(o => !sel.has(o));
    next = dir > 0 ? [...b, ...a] : [...a, ...b];
  } else {
    const boxes = new Map(scene.items.map(it => [it.order, boxOf(scene, it)]));
    const moving = next.filter(o => sel.has(o));
    for (const o of dir > 0 ? moving.reverse() : moving) {
      const i = next.indexOf(o);
      let j = i + dir;
      while (j >= 0 && j < next.length && (sel.has(next[j]) || !overlaps(boxes.get(o), boxes.get(next[j])))) j += dir;
      if (j < 0 || j >= next.length) continue; // 已经在最上 / 最下（没有重叠的卡片了）
      next.splice(i, 1);
      next.splice(dir > 0 ? j : j, 0, o); // 删除后 j 前移了一位：往上插在它后面、往下插在它前面，都是 j
    }
  }
  if (!flat) {
    if (next.every((o, k) => o === list[k])) return false;
    const patches = biasPatches(scene, next, list.filter(o => sel.has(o)));
    if (!patches.length) return false;
    actions.setItemAdjusts(patches);
    return true;
  }
  return writeRanks(list, next);
}

// 按新的顺序（从下到上）写回每张卡片的 lift；没有变化时返回 false
function writeRanks(list, next) {
  if (next.every((o, k) => o === list[k])) return false;
  actions.setItemAdjusts(next.map((order, rank) => ({ order, patch: { lift: (rank + 1) * LIFT_STEP } })));
  return true;
}

/** 图层列表里能不能在卡片之间拖动调整前后：都可以（铺满型版式上千张卡片时，只在画板里看得见的那些之间排） */
export const canPlaceCards = () => true;

/**
 * 把卡片放到 target 这张卡片的上面 / 下面（图层列表里拖动）。place：'above'（盖住它）| 'below'。返回是否有变化。
 */
export function placeCards(orders, target, place) {
  if (!canPlaceCards() || !orders.length) return false;
  const list = activeCardScene().items.map(it => it.order); // 从下到上
  const sel = new Set(orders);
  if (sel.has(target)) return false;
  const next = list.filter(o => !sel.has(o));
  const at = next.indexOf(target);
  if (at < 0) return false;
  next.splice(place === 'above' ? at + 1 : at, 0, ...list.filter(o => sel.has(o)));
  return writeRanks(list, next);
}

/**
 * 图层列表里把卡片拖到某一行的上面 / 下面。drop：{ kind: 'card' | 'layer' | 'slides', id, place: 'above' | 'below' }
 *   拖到组里的卡片旁边：调整前后（原来拖出去的回到组里）
 *   拖到「幻灯片」这一行：回到组里，放在最上面
 *   拖到图层旁边：拖出组，画在那个位置（紧贴「幻灯片」一组的上面 = 组里的最上面）
 *   拖到已经拖出去的卡片旁边：和它在同一个位置，按上 / 下排
 * 返回是否有变化。
 */
export function dropCards(orders, drop) {
  if (!orders.length) return false;
  const s = store.get();
  const scene = activeCardScene(s);
  const layers = s.layers || [];
  const stack = [...layers.filter(l => l.under), ...layers.filter(l => !l.under)]; // 从下到上
  const valid = id => (id === PULL_BACK || layers.some(l => l.id === id) ? id : null);
  const adjust = s.adjust[s.layoutId] || {};
  const anchorOf = o => valid(adjust[o]?.above);
  const sel = new Set(orders);
  let anchor = null, rel = null;
  if (drop.kind === 'card') {
    if (sel.has(drop.id)) return false;
    anchor = anchorOf(drop.id);
    rel = drop;
  } else if (drop.kind === 'layer') {
    const i = stack.findIndex(l => l.id === drop.id);
    if (i < 0) return false;
    if (drop.place === 'above') anchor = drop.id;
    else if (stack[i].under) anchor = i > 0 ? stack[i - 1].id : PULL_BACK;
    else anchor = i > 0 && !stack[i - 1].under ? stack[i - 1].id : null; // 最下面那个图层的下面 = 回到组里最上面
  }
  // 只在图层列表里列出来的卡片（画板里看得见的）之间排：铺满型版式画板外还有成百上千张，不用管它们
  const list = visibleCards(scene).map(it => it.order).reverse(); // 从下到上
  const listed = new Set(list);
  const moving = list.filter(o => sel.has(o));
  if (!moving.length) return false;
  const patches = new Map(moving.map(o => [o, { above: anchor || undefined }]));
  const put = (o, patch) => patches.set(o, { ...patches.get(o), ...patch });
  if (rel) {
    const next = list.filter(o => !sel.has(o));
    const at = next.indexOf(rel.id);
    if (at < 0) return false;
    next.splice(rel.place === 'above' ? at + 1 : at, 0, ...moving);
    if (next.some((o, k) => o !== list[k])) {
      if (!isFlatLayout(s)) {
        // 3D 版式：只给挪动的卡片加远近的偏移
        for (const { order, patch } of biasPatches(scene, next, moving)) put(order, patch);
      } else {
        // 名次接在画板外那些卡片的后面
        const base = Math.max(0, ...Object.entries(adjust).filter(([o]) => !listed.has(+o)).map(([, a]) => a.lift || 0));
        next.forEach((o, rank) => put(o, { lift: base + (rank + 1) * LIFT_STEP }));
      }
    }
  } else if (!isFlatLayout(s)) {
    // 放到那个位置的最上面（3D 版式）：排到所有卡片后面画
    const all = scene.items.map(it => it.order);
    for (const { order, patch } of biasPatches(scene, [...all.filter(o => !sel.has(o)), ...moving], moving)) put(order, patch);
  } else {
    // 放到那个位置的最上面
    let top = Math.max(0, ...Object.values(adjust).map(a => a.lift || 0));
    for (const o of moving) put(o, { lift: (top += LIFT_STEP) });
  }
  const changed = [...patches].some(([o, p]) => Object.entries(p).some(([k, v]) => (adjust[o]?.[k] ?? undefined) !== v));
  if (!changed) return false;
  actions.setItemAdjusts([...patches].map(([order, patch]) => ({ order, patch })));
  return true;
}

/** 隐藏 / 显示卡片；把拖出去的卡片放回「幻灯片」一组 */
export const setCardsHidden = (orders, hidden) => actions.setItemAdjusts(orders.map(order => ({ order, patch: { hidden: hidden || undefined } })));
export const releaseCards = orders => actions.setItemAdjusts(orders.map(order => ({ order, patch: { above: undefined } })));

/** 图层列表用的卡片：画板里看得见的（从上到下）+ 隐藏的（排在最后，可以再显示） */
export const listCards = (scene = activeCardScene()) => [...visibleCards(scene), ...(scene.hidden || [])];

/** 有没有调过卡片的前后 / 恢复版式默认的前后 */
export const stackChanged = (s = store.get()) => Object.values(s.adjust[s.layoutId] || {}).some(a => a.lift || a.bias);
export function resetStack() {
  if (!stackChanged()) return false;
  actions.clearAdjustKey('lift');
  actions.clearAdjustKey('bias');
  return true;
}
