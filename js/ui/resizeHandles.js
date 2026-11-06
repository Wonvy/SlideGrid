import { clamp } from '../core/utils.js';
import { el } from './dom.js';
import { iconCursor } from './icons.js';

const ROTATE_CURSOR = iconCursor('rotate-cw', 'crosshair');
const normAngle = d => ((((d + 180) % 360) + 360) % 360) - 180;

/**
 * 选中卡片的四个角点：缩放（等比）和旋转。
 *   拖动角点：对角固定；按住 ⌥/Alt：以中心为基准
 *   拖动角点外侧（光标变成旋转）：绕中心旋转，Shift 按 15° 吸附
 * 手柄是叠在预览区上的 DOM 元素，跟随卡片的旋转 / 位置；在 pointerdown 时阻止冒泡，
 * 因此不会触发预览区的其他工具。
 *
 * 依赖（由 main.js 提供）：
 *   getTarget() → 当前选中的 scene item 或 null
 *   cornersClient(item) / centerClient(item) → 屏幕坐标
 *   getAdjust(order) / setItemAdjust(order, patch) / nextLift()
 *   toLayoutDelta(dxPx, dyPx) → 版式坐标中的位移
 */
export function createResizeHandles(viewport, opts) {
  const { getTarget, cornersClient, centerClient, getAdjust, setItemAdjust, toLayoutDelta, nextLift } = opts;

  const layer = el('div', { class: 'resize-layer', hidden: true });
  const badge = el('div', { class: 'resize-badge', hidden: true });
  const handles = [0, 1, 2, 3].map(() => el('div', { class: 'resize-handle', title: '拖动等比缩放（⌥ 以中心为基准）' }));
  // 角点外侧的旋转区域（在手柄下面）
  const zones = [0, 1, 2, 3].map(() => el('div', { class: 'rotate-zone', title: '拖动旋转（Shift 按 15° 吸附）' }));
  layer.append(...zones, ...handles, badge);
  viewport.append(layer);

  let drag = null;

  handles.forEach((h, i) => {
    h.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const item = getTarget();
      if (!item) return;
      e.stopPropagation(); // 不交给预览区的移动 / 旋转工具
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      const corners = cornersClient(item);
      const a = { dx: 0, dy: 0, ...getAdjust(item.order) };
      drag = {
        order: item.order,
        start: corners[i],
        opposite: corners[(i + 2) % 4],
        center: centerClient(item),
        s0: a.s > 0 ? a.s : 1,
        adj: a,
        lifted: false,
      };
      layer.classList.add('dragging');
    });

    h.addEventListener('pointermove', e => {
      if (!drag) return;
      const anchor = e.altKey ? drag.center : drag.opposite;
      // 把指针投影到「锚点 → 起始角点」方向上，得到缩放倍数
      const vx = drag.start[0] - anchor[0], vy = drag.start[1] - anchor[1];
      const t = ((e.clientX - anchor[0]) * vx + (e.clientY - anchor[1]) * vy) / (vx * vx + vy * vy || 1);
      const s1 = clamp(drag.s0 * t, 0.1, 8);
      const k = s1 / drag.s0;
      // 锚点不动：新的中心 = 锚点 + (原中心 - 锚点) × k
      const cx = anchor[0] + (drag.center[0] - anchor[0]) * k;
      const cy = anchor[1] + (drag.center[1] - anchor[1]) * k;
      const [lx, ly] = toLayoutDelta(cx - drag.center[0], cy - drag.center[1]);
      setItemAdjust(drag.order, {
        s: s1,
        dx: drag.adj.dx + lx,
        dy: drag.adj.dy + ly,
        ...(drag.lifted ? {} : { lift: nextLift() }),
      });
      drag.lifted = true;
      const r = viewport.getBoundingClientRect();
      badge.hidden = false;
      badge.textContent = `${Math.round(s1 * 100)}%`;
      badge.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 14}px)`;
    });

    const end = () => {
      if (!drag) return;
      drag = null;
      badge.hidden = true;
      layer.classList.remove('dragging');
    };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  });

  // 旋转：逐段累加角度，避免跨过 ±180° 时跳一整圈
  let rot = null;
  zones.forEach(z => {
    z.style.cursor = ROTATE_CURSOR;
    z.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const item = getTarget();
      if (!item) return;
      e.stopPropagation();
      e.preventDefault();
      z.setPointerCapture(e.pointerId);
      const [cx, cy] = centerClient(item);
      const a = { rz: 0, ...getAdjust(item.order) };
      rot = { order: item.order, cx, cy, rz0: a.rz || 0, prev: Math.atan2(e.clientY - cy, e.clientX - cx), turned: 0, lifted: false };
      layer.classList.add('dragging');
    });
    z.addEventListener('pointermove', e => {
      if (!rot) return;
      const ang = Math.atan2(e.clientY - rot.cy, e.clientX - rot.cx);
      let step = ang - rot.prev;
      if (step > Math.PI) step -= 2 * Math.PI;
      if (step < -Math.PI) step += 2 * Math.PI;
      rot.prev = ang;
      rot.turned += (step * 180) / Math.PI;
      let rz = normAngle(rot.rz0 - rot.turned); // 屏幕 y 向下，顺时针为负
      if (e.shiftKey) rz = Math.round(rz / 15) * 15;
      setItemAdjust(rot.order, { rz, ...(rot.lifted ? {} : { lift: nextLift() }) });
      rot.lifted = true;
      const r = viewport.getBoundingClientRect();
      badge.hidden = false;
      badge.textContent = `${Math.round(-rz)}°`;
      badge.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 14}px)`;
    });
    const end = () => {
      if (!rot) return;
      rot = null;
      badge.hidden = true;
      layer.classList.remove('dragging');
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
  });

  // 屏幕方向 → 对应的缩放光标
  function cursorFor(dx, dy) {
    const a = (((Math.atan2(dy, dx) * 180) / Math.PI) % 180 + 180) % 180;
    if (a < 22.5 || a >= 157.5) return 'ew-resize';
    if (a < 67.5) return 'nwse-resize';
    if (a < 112.5) return 'ns-resize';
    return 'nesw-resize';
  }

  /** 每次渲染后调用：同步手柄位置 */
  function update() {
    const item = getTarget();
    if (!item) { layer.hidden = true; return; }
    const r = viewport.getBoundingClientRect();
    const corners = cornersClient(item);
    const [cx, cy] = centerClient(item);
    corners.forEach(([x, y], i) => {
      const h = handles[i];
      h.style.transform = `translate(${x - r.left}px, ${y - r.top}px)`;
      h.style.cursor = cursorFor(x - cx, y - cy);
      // 旋转区域：沿「中心 → 角点」方向往外放一点
      const d = Math.hypot(x - cx, y - cy) || 1;
      const ox = ((x - cx) / d) * 10, oy = ((y - cy) / d) * 10;
      zones[i].style.transform = `translate(${x - r.left + ox}px, ${y - r.top + oy}px)`;
    });
    layer.hidden = false;
  }

  return { update, isDragging: () => !!drag || !!rot };
}
