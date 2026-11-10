import { store, actions } from '../state.js';
import { cachedScene } from '../render/scene.js';
import { itemCornersNdc } from '../render/picking.js';
import { sceneInput, is3D } from './boards.js';

/**
 * 卡片的前后顺序（平面版式）：上移一层 / 下移一层 / 置于顶层 / 置于底层。
 * 前后由卡片的 lift（手动调整里的「抬高」，z = lift × 20）决定：重新排好后按名次写回每张卡片的 lift。
 * 版式本身给的 z（扇形、散落有一点点前后差）不超过 40，所以每一名相差 3（= 60 个世界单位）足以盖过它。
 * 3D 版式的前后由空间位置决定，不能调。
 */
const LIFT_STEP = 3;
const MANY = 150; // 卡片太多（铺满型版式）时只调选中的卡片

export const activeCardScene = (s = store.get()) => cachedScene(sceneInput(s));
export const canStack = () => !is3D();

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
  if (list.length > MANY) {
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
  if (next.every((o, k) => o === list[k])) return false;
  actions.setItemAdjusts(next.map((order, rank) => ({ order, patch: { lift: (rank + 1) * LIFT_STEP } })));
  return true;
}
