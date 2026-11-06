import { clamp } from '../core/utils.js';
import { zoomAround, panFactor } from '../render/scene.js';
import { el } from './dom.js';
import { iconCursor } from './icons.js';

const ROTATE_CURSOR = iconCursor('rotate-cw', 'crosshair');
const normAngle = d => ((((d + 180) % 360) + 360) % 360) - 180; // 规范到 [-180, 180)

/**
 * 预览区鼠标 / 键盘交互。原则：左键只执行「当前工具」，其他操作固定在互不冲突的按键上。
 *
 *   左键      当前工具：排列（拖到另一张上交换）/ 移动卡片 / 旋转卡片 / 抓手平移 / 3D 视角
 *   中键拖动   平移（任何工具下）
 *   右键拖动   3D：旋转视角；平面：平移
 *   空格按住   临时切换为抓手
 *   滚轮      以光标为中心缩放（长图模式需按住 ⌘/Ctrl）
 *   双击      空白处：复位视图；移动 / 旋转工具下双击卡片：复位这张卡片
 *   键盘      V 排列 · M 移动 · R 旋转 · H 抓手 · O 视角 · Esc 取消选择 · 方向键微调 · +/- 缩放选中卡片
 *   缩放手柄  见 resizeHandles.js（选中卡片的四个角）
 */
export function attachViewportInteraction(target, opts) {
  const {
    pick, getTool, setTool, toolAvailable, is3D, canSwap, getSlide, worldPerPx,
    getCamera, setCamera, resetCamera,
    setHover, setDragSource, setDropTarget, onSwap,
    getAdjust, nextLift, toLayoutDelta, itemCenterClient,
    setItemAdjust, resetItemAdjust, getSelected, setSelected, onTempHand,
  } = opts;

  let drag = null;
  let spaceDown = false;
  let lastHit = null;

  const isTyping = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
  const effectiveTool = () => (spaceDown ? 'hand' : getTool());

  /* ---------- 键盘 ---------- */

  const TOOL_KEYS = { v: 'select', m: 'move', r: 'rotate', h: 'hand', o: 'orbit' };
  window.addEventListener('keydown', e => {
    if (isTyping(e) || document.querySelector('dialog[open]')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!spaceDown) { spaceDown = true; onTempHand(true); updateCursor(); }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (TOOL_KEYS[key]) {
      setTool(TOOL_KEYS[key]);
      updateCursor();
      return;
    }
    if (e.key === 'Escape') {
      setSelected(null);
      setTool('select');
      return;
    }
    const sel = getSelected();
    // + / -：等比缩放选中的卡片（以中心为基准）
    if (sel != null && (getTool() === 'move' || getTool() === 'rotate') && ['=', '+', '-', '_'].includes(e.key)) {
      e.preventDefault();
      const a = getAdjust(sel);
      const step = e.shiftKey ? 0.01 : 0.05;
      const s = Math.min(8, Math.max(0.1, (a.s > 0 ? a.s : 1) * (e.key === '-' || e.key === '_' ? 1 - step : 1 + step)));
      setItemAdjust(sel, { s });
      return;
    }
    // 方向键：微调选中的卡片
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (sel == null || !arrows[e.key]) return;
    const tool = getTool();
    if (tool !== 'move' && tool !== 'rotate') return;
    e.preventDefault();
    const a = getAdjust(sel);
    const step = e.shiftKey ? 10 : 1;
    const [ax, ay] = arrows[e.key];
    if (tool === 'move') setItemAdjust(sel, { dx: (a.dx || 0) + ax * step, dy: (a.dy || 0) + ay * step });
    else setItemAdjust(sel, { rz: normAngle((a.rz || 0) - (ax || -ay) * (e.shiftKey ? 15 : 1)) });
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space' && spaceDown) { spaceDown = false; onTempHand(false); updateCursor(); }
  });
  window.addEventListener('blur', () => { if (spaceDown) { spaceDown = false; onTempHand(false); } });

  /* ---------- 鼠标 ---------- */

  const hitAt = e => {
    const r = target.getBoundingClientRect();
    return pick(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
  };

  function cursorFor(hit) {
    const tool = effectiveTool();
    if (tool === 'hand') return 'grab';
    if (tool === 'orbit') return is3D() ? 'move' : 'not-allowed';
    if (!hit) return 'default';
    if (tool === 'select') return canSwap() ? 'grab' : 'default';
    if (tool === 'move') return toolAvailable('move') ? 'move' : 'not-allowed';
    if (tool === 'rotate') return toolAvailable('rotate') ? ROTATE_CURSOR : 'not-allowed';
    return 'default';
  }
  function updateCursor() {
    if (drag) return;
    target.style.cursor = cursorFor(lastHit);
  }

  function makeGhost(slideIndex) {
    const slide = getSlide(slideIndex);
    const ghost = el('div', { class: 'drag-ghost' });
    if (slide?.thumb) {
      const c = document.createElement('canvas');
      const s = Math.min(1, 240 / slide.thumb.width);
      c.width = Math.round(slide.thumb.width * s);
      c.height = Math.round(slide.thumb.height * s);
      c.getContext('2d').drawImage(slide.thumb, 0, 0, c.width, c.height);
      ghost.append(c);
    }
    document.body.append(ghost);
    return ghost;
  }

  target.addEventListener('contextmenu', e => e.preventDefault());
  target.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });

  target.addEventListener('pointerdown', e => {
    const hit = hitAt(e);
    let mode = null;
    if (e.button === 1) mode = 'pan';
    else if (e.button === 2) mode = is3D() ? 'orbit' : 'pan';
    else if (e.button === 0) {
      const tool = effectiveTool();
      if (tool === 'hand') mode = 'pan';
      else if (tool === 'orbit') mode = is3D() ? 'orbit' : null;
      else if (tool === 'select') mode = hit && canSwap() ? 'swap' : null;
      else if (tool === 'move') mode = hit && toolAvailable('move') ? 'move' : null;
      else if (tool === 'rotate') mode = hit && toolAvailable('rotate') ? 'rotate' : null;
      if (tool === 'move' || tool === 'rotate') setSelected(mode ? hit.order : null);
    }
    if (!mode) return;
    e.preventDefault(); // 中键默认会进入自动滚动
    target.setPointerCapture(e.pointerId);
    drag = { mode, x: e.clientX, y: e.clientY, cam: { ...getCamera() }, active: false, hit };
    if (mode === 'swap') Object.assign(drag, { src: hit.slideIndex, ghost: null, target: null });
    if (mode === 'move' || mode === 'rotate') {
      drag.adj = { dx: 0, dy: 0, rz: 0, ...getAdjust(hit.order) };
      if (mode === 'rotate') {
        const [cx, cy] = itemCenterClient(hit);
        Object.assign(drag, { cx, cy, prevA: Math.atan2(e.clientY - cy, e.clientX - cx), turned: 0 });
      }
    }
    target.style.cursor = mode === 'orbit' ? 'move' : mode === 'rotate' ? target.style.cursor : 'grabbing';
    setHover(null);
  });

  target.addEventListener('pointermove', e => {
    if (!drag) {
      lastHit = hitAt(e);
      setHover(lastHit);
      updateCursor();
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.active && Math.hypot(dx, dy) < 3) return;
    const first = !drag.active;
    drag.active = true;

    switch (drag.mode) {
      case 'orbit':
        setCamera({ yaw: drag.cam.yaw + dx * 0.25, pitch: clamp(drag.cam.pitch + dy * 0.25, -89, 89) });
        break;
      case 'pan': {
        const k = worldPerPx() * panFactor(drag.cam, is3D());
        setCamera({ panX: (drag.cam.panX || 0) + dx * k, panY: (drag.cam.panY || 0) - dy * k });
        break;
      }
      case 'move': {
        // Shift：锁定水平或垂直方向
        let mx = dx, my = dy;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) my = 0; else mx = 0; }
        const [lx, ly] = toLayoutDelta(mx, my);
        setItemAdjust(drag.hit.order, {
          dx: drag.adj.dx + lx, dy: drag.adj.dy + ly,
          ...(first ? { lift: nextLift() } : {}),
        });
        break;
      }
      case 'rotate': {
        // 逐段累加角度，避免跨过 ±180° 时跳一整圈
        const a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
        let step = a - drag.prevA;
        if (step > Math.PI) step -= 2 * Math.PI;
        if (step < -Math.PI) step += 2 * Math.PI;
        drag.prevA = a;
        drag.turned += (step * 180) / Math.PI;
        let rz = normAngle(drag.adj.rz - drag.turned); // 屏幕 y 向下，顺时针为负
        if (e.shiftKey) rz = Math.round(rz / 15) * 15;
        setItemAdjust(drag.hit.order, { rz, ...(first ? { lift: nextLift() } : {}) });
        break;
      }
      case 'swap': {
        if (first) {
          drag.ghost = makeGhost(drag.src);
          setDragSource(drag.src);
        }
        drag.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`;
        const hit = hitAt(e);
        drag.target = hit && hit.slideIndex !== drag.src ? hit : null;
        setDropTarget(drag.target);
        break;
      }
    }
  });

  const end = () => {
    if (!drag) return;
    if (drag.mode === 'swap' && drag.active) {
      drag.ghost?.remove();
      setDragSource(null);
      setDropTarget(null);
      if (drag.target) onSwap(drag.src, drag.target.slideIndex);
    }
    drag = null;
    updateCursor();
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
  target.addEventListener('pointerleave', () => {
    if (drag) return;
    lastHit = null;
    setHover(null);
  });

  target.addEventListener('wheel', e => {
    // 长图模式下滚轮用于上下滚动，按住 ⌘/Ctrl（或触控板双指捏合）才缩放
    if (opts.wheelScrolls?.() && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.sgHandled = true;
    const cam = getCamera();
    const r = target.getBoundingClientRect();
    const k = worldPerPx();
    const cx = (e.clientX - r.left - r.width / 2) * k;
    const cy = -(e.clientY - r.top - r.height / 2) * k;
    const next = clamp((cam.zoom || 1) * Math.exp(-e.deltaY * 0.0015), 0.2, 8);
    setCamera(zoomAround(cam, is3D(), cx, cy, next));
  }, { passive: false });

  target.addEventListener('dblclick', e => {
    if (e.button !== 0) return;
    const hit = hitAt(e);
    const tool = getTool();
    if (hit && (tool === 'move' || tool === 'rotate') && toolAvailable(tool)) resetItemAdjust(hit.order);
    else if (!hit) resetCamera();
  });

  return { updateCursor };
}
