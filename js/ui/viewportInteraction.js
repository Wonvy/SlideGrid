import { clamp } from '../core/utils.js';
import { zoomAround, panFactor } from '../render/scene.js';
import { el } from './dom.js';
import { iconCursor } from './icons.js';

const ROTATE_CURSOR = iconCursor('rotate-cw', 'crosshair');
const ZOOM_IN_CURSOR = iconCursor('zoom-in', 'zoom-in');
const ZOOM_OUT_CURSOR = iconCursor('zoom-out', 'zoom-out');
const normAngle = d => ((((d + 180) % 360) + 360) % 360) - 180; // 规范到 [-180, 180)

/**
 * 工作区鼠标 / 键盘交互（参照 Illustrator）。
 *
 * 导航（任何工具下都可用，只改变视图，不会改动作品）：
 *   滚轮                  以鼠标位置为中心缩放视图（偏好里可改为「滚动视图」）
 *   Shift + 滚轮          左右平移
 *   拖动画板名称           在任何工具下移动画板；选择工具下拖画板空白处也可以
 *   空格按住 / 中键拖动      平移视图
 *   ⌘/Ctrl + 0            适合当前画板；⌘/Ctrl + ⌥ + 0 适合全部画板
 *   ⌘/Ctrl + 1            100%；⌘/Ctrl + = / -  放大 / 缩小
 *
 * 工具（左键只执行当前工具）：
 *   V 选择  X 交换  R 旋转  S 比例  O 构图  H 抓手  Z 放大镜  ⇧O 画板
 *
 * 画板多选：画板工具下 Shift/⌘ + 单击加选减选、在空白处拖动框选、拖动任一选中画板一起移动、
 *          Delete 删除所选；任何工具下 ⌘A 全选画板、Shift/⌘ + 单击其他画板加选。
 */
export function attachViewportInteraction(target, opts) {
  const {
    getTool, setTool, toolAvailable, is3D, canSwap, getSlide, onTempHand,
    // 画板与视图
    boardAt, activeBoard, activateBoard, boardRect, deleteSelectedBoards,
    selectedBoards, toggleBoardSelection, selectBoards, selectAllBoards, moveBoards, setMarquee,
    panView, zoomViewAt, zoomViewBy, fitActive, fitAll, actualSize,
    // 当前画板内
    pick, getCamera, setCamera, allBoardIds, onContextMenu, labelAt, wheelMode,
    setHover, setDragSource, setDropTarget, onSwap,
    getAdjust, nextLift, toLayoutDelta, itemCenterClient,
    setItemAdjust, resetItemAdjust, getSelected, setSelected,
  } = opts;

  let drag = null;
  let spaceDown = false;
  let altDown = false;
  let lastEvent = null;

  const isTyping = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
  const effectiveTool = () => (spaceDown ? 'hand' : getTool());
  const local = e => {
    const r = target.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const cardTools = new Set(['select', 'rotate', 'scale']);
  const pickBoard = (id, e) => opts.pickOn?.(id, e.clientX, e.clientY) || null;

  /* ---------- 键盘 ---------- */

  window.addEventListener('keydown', e => {
    if (e.key === 'Alt') { altDown = true; updateCursor(); }
    if (isTyping(e) || document.querySelector('dialog[open]')) return;
    const mod = e.metaKey || e.ctrlKey;

    // 视图快捷键（会阻止浏览器自带的页面缩放）
    if (mod && (e.code === 'Digit0' || e.code === 'Numpad0')) { e.preventDefault(); (e.altKey ? fitAll : fitActive)(); return; }
    if (mod && (e.code === 'Digit1' || e.code === 'Numpad1')) { e.preventDefault(); actualSize(); return; }
    if (mod && (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd')) { e.preventDefault(); zoomViewBy(1.25); return; }
    if (mod && (e.key === '-' || e.code === 'NumpadSubtract')) { e.preventDefault(); zoomViewBy(0.8); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAllBoards(); return; }
    if (mod || e.altKey) return;

    if (e.code === 'Space') {
      e.preventDefault();
      if (!spaceDown) { spaceDown = true; onTempHand(true); updateCursor(); }
      return;
    }

    const key = e.key.toLowerCase();
    if (key === 'o' && e.shiftKey) { setTool('artboard'); return; }
    const TOOL_KEYS = { v: 'select', x: 'swap', r: 'rotate', s: 'scale', o: 'orbit', h: 'hand', z: 'zoom' };
    if (!e.shiftKey && TOOL_KEYS[key]) { setTool(TOOL_KEYS[key]); updateCursor(); return; }

    if (e.key === 'Escape') { setSelected(null); selectBoards([activeBoard()]); setTool('select'); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && getTool() === 'artboard') {
      e.preventDefault();
      deleteSelectedBoards();
      return;
    }

    const sel = getSelected();
    const tool = getTool();
    if (sel == null || !cardTools.has(tool)) return;
    const a = getAdjust(sel);
    // + / -：以中心等比缩放选中的卡片
    if (['=', '+', '-', '_'].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 0.01 : 0.05;
      const s = clamp((a.s > 0 ? a.s : 1) * (e.key === '-' || e.key === '_' ? 1 - step : 1 + step), 0.1, 8);
      setItemAdjust(sel, { s });
      return;
    }
    // 方向键：选择工具移动、旋转工具旋转、比例工具缩放
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (!arrows[e.key]) return;
    e.preventDefault();
    const [ax, ay] = arrows[e.key];
    if (tool === 'select') {
      const step = e.shiftKey ? 10 : 1;
      setItemAdjust(sel, { dx: (a.dx || 0) + ax * step, dy: (a.dy || 0) + ay * step });
    } else if (tool === 'rotate') {
      setItemAdjust(sel, { rz: normAngle((a.rz || 0) - (ax || -ay) * (e.shiftKey ? 15 : 1)) });
    } else {
      const k = 1 + (ax || ay) * (e.shiftKey ? 0.01 : 0.05);
      setItemAdjust(sel, { s: clamp((a.s > 0 ? a.s : 1) * k, 0.1, 8) });
    }
  });
  window.addEventListener('keyup', e => {
    if (e.key === 'Alt') { altDown = false; updateCursor(); }
    if (e.code === 'Space' && spaceDown) { spaceDown = false; onTempHand(false); updateCursor(); }
  });
  window.addEventListener('blur', () => {
    altDown = false;
    if (spaceDown) { spaceDown = false; onTempHand(false); }
  });

  /* ---------- 光标 ---------- */

  function cursorFor(e) {
    if (!e) return 'default';
    const tool = effectiveTool();
    if (tool === 'hand') return drag?.mode === 'pan' ? 'grabbing' : 'grab';
    if (tool === 'zoom') return altDown ? ZOOM_OUT_CURSOR : ZOOM_IN_CURSOR;
    if (labelAt(e.clientX, e.clientY)) return 'move'; // 拖名称移动画板
    const b = boardAt(e.clientX, e.clientY);
    if (tool === 'artboard') return b ? 'move' : 'default';
    if (!b) return 'default';
    if (b !== activeBoard()) return tool === 'select' ? 'move' : 'pointer'; // 点击切换到这个画板
    if (tool === 'orbit') return is3D() ? 'move' : 'grab';
    const hit = pick(e.clientX, e.clientY);
    if (!hit) return tool === 'select' ? 'move' : 'default';
    if (tool === 'swap') return canSwap() ? 'grab' : 'default';
    if (!toolAvailable(tool)) return 'not-allowed';
    if (tool === 'select') return 'move';
    if (tool === 'rotate') return ROTATE_CURSOR;
    if (tool === 'scale') return 'nwse-resize';
    return 'default';
  }
  function updateCursor() {
    if (drag && drag.mode !== 'pan') return;
    target.style.cursor = cursorFor(lastEvent);
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

  /* ---------- 鼠标 ---------- */

  // 右键菜单：内容由 main.js 根据点到的画板 / 卡片生成
  target.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (drag) return;
    onContextMenu({ clientX: e.clientX, clientY: e.clientY, board: boardAt(e.clientX, e.clientY) });
  });
  target.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });

  target.addEventListener('pointerdown', e => {
    lastEvent = e;
    let mode = null;
    const extra = {};

    if (e.button === 1) {
      mode = 'pan';
    } else if (e.button === 0) {
      const tool = effectiveTool();
      const b = boardAt(e.clientX, e.clientY);

      const label = labelAt(e.clientX, e.clientY);
      if (tool === 'hand') {
        mode = 'pan';
      } else if (label && tool !== 'zoom') {
        // 拖动画板名称：在任何工具下都能移动画板（属于多选时一起移动）
        const keep = selectedBoards().includes(label);
        activateBoard(label, { fit: false, keepSelection: keep });
        mode = 'moveBoards';
        extra.starts = selectedBoards().map(id => ({ id, x: boardRect(id).x, y: boardRect(id).y }));
      } else if (tool === 'zoom') {
        const [sx, sy] = local(e);
        zoomViewAt(sx, sy, e.altKey ? 1 / 1.6 : 1.6);
        return;
      } else if (tool === 'artboard') {
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        if (!b) {
          // 空白处拖动：框选画板（Shift/⌘ 时追加到现有选择）
          const [sx, sy] = local(e);
          mode = 'marquee';
          Object.assign(extra, { sx, sy, additive, base: selectedBoards() });
        } else if (additive) {
          toggleBoardSelection(b);
          return;
        } else {
          // 点在已选画板上：保留多选并一起拖动；否则只选这一个
          activateBoard(b, { fit: false, keepSelection: selectedBoards().includes(b) });
          mode = 'moveBoards';
          extra.starts = selectedBoards().map(id => ({ id, x: boardRect(id).x, y: boardRect(id).y }));
        }
      } else {
        if (!b) { setSelected(null); return; }
        if (b !== activeBoard()) {
          if (e.shiftKey || e.metaKey || e.ctrlKey) { toggleBoardSelection(b); return; } // 加选画板
          const keep = selectedBoards().includes(b);
          activateBoard(b, { fit: false, keepSelection: keep }); // 先切换画板
          // 选择工具：按在画板空白处可以直接拖走这个画板
          if (tool !== 'select' || pickBoard(b, e)) return;
          mode = 'moveBoards';
          extra.starts = selectedBoards().map(id => ({ id, x: boardRect(id).x, y: boardRect(id).y }));
        }
        const hit = mode ? null : pick(e.clientX, e.clientY);
        if (tool === 'orbit') {
          mode = is3D() && !e.shiftKey ? 'orbit' : 'contentPan';
        } else if (tool === 'swap') {
          if (hit && canSwap()) { mode = 'swap'; Object.assign(extra, { src: hit.slideIndex, ghost: null, target: null }); }
        } else if (mode === 'moveBoards') {
          // 已在上面开始拖动画板
        } else if (cardTools.has(tool)) {
          const ok = hit && toolAvailable(tool);
          setSelected(ok ? hit.order : null);
          if (!ok && tool === 'select') {
            // 选择工具：拖画板上没有卡片的地方 = 移动画板（3D 版式里也可以）
            mode = 'moveBoards';
            extra.starts = selectedBoards().map(id => ({ id, x: boardRect(id).x, y: boardRect(id).y }));
          }
          if (ok) {
            mode = tool === 'select' ? 'move' : tool;
            extra.adj = { dx: 0, dy: 0, rz: 0, ...getAdjust(hit.order) };
            const [cx, cy] = itemCenterClient(hit);
            Object.assign(extra, {
              cx, cy, prevA: Math.atan2(e.clientY - cy, e.clientX - cx), turned: 0,
              d0: Math.hypot(e.clientX - cx, e.clientY - cy) || 1,
            });
          }
        }
        extra.hit = hit;
      }
    }
    if (!mode) return;
    e.preventDefault(); // 中键默认会进入自动滚动
    target.setPointerCapture(e.pointerId);
    drag = { mode, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, cam: { ...getCamera() }, active: false, ...extra };
    if (mode === 'pan') target.style.cursor = 'grabbing';
    setHover(null);
  });

  target.addEventListener('pointermove', e => {
    lastEvent = e;
    if (!drag) {
      const b = boardAt(e.clientX, e.clientY);
      const showHover = b && b === activeBoard() && ['select', 'swap', 'rotate', 'scale'].includes(effectiveTool());
      setHover(showHover ? pick(e.clientX, e.clientY) : null);
      updateCursor();
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.active && Math.hypot(dx, dy) < 3) return;
    const first = !drag.active;
    drag.active = true;

    switch (drag.mode) {
      case 'pan':
        panView(e.clientX - drag.lx, e.clientY - drag.ly);
        break;
      case 'moveBoards': {
        const z = boardRect(activeBoard()).zoom;
        moveBoards(drag.starts.map(st => ({ id: st.id, x: st.x + dx / z, y: st.y + dy / z })));
        break;
      }
      case 'marquee': {
        const [cx, cy] = local(e);
        drag.rect = { x: Math.min(drag.sx, cx), y: Math.min(drag.sy, cy), w: Math.abs(cx - drag.sx), h: Math.abs(cy - drag.sy) };
        setMarquee(drag.rect);
        break;
      }
      case 'orbit':
        setCamera({ yaw: drag.cam.yaw + dx * 0.25, pitch: clamp(drag.cam.pitch + dy * 0.25, -89, 89) });
        break;
      case 'contentPan': {
        // 构图平移：屏幕像素 → 画板世界单位
        const k = (1 / boardRect(activeBoard()).zoom) * panFactor(drag.cam, is3D());
        setCamera({ panX: (drag.cam.panX || 0) + dx * k, panY: (drag.cam.panY || 0) - dy * k });
        break;
      }
      case 'move': {
        let mx = dx, my = dy;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) my = 0; else mx = 0; } // Shift 锁定方向
        const [lx, ly] = toLayoutDelta(mx, my);
        setItemAdjust(drag.hit.order, { dx: drag.adj.dx + lx, dy: drag.adj.dy + ly, ...(first ? { lift: nextLift() } : {}) });
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
      case 'scale': {
        // 以卡片中心等比缩放：按指针到中心的距离变化
        const d = Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy);
        const s0 = drag.adj.s > 0 ? drag.adj.s : 1;
        let s = clamp(s0 * (d / drag.d0), 0.1, 8);
        if (e.shiftKey) s = Math.round(s * 20) / 20; // Shift 按 5% 吸附
        setItemAdjust(drag.hit.order, { s, ...(first ? { lift: nextLift() } : {}) });
        break;
      }
      case 'swap': {
        if (first) {
          drag.ghost = makeGhost(drag.src);
          setDragSource(drag.src);
        }
        drag.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`;
        const hit = pick(e.clientX, e.clientY);
        drag.target = hit && hit.slideIndex !== drag.src ? hit : null;
        setDropTarget(drag.target);
        break;
      }
    }
    drag.lx = e.clientX;
    drag.ly = e.clientY;
  });

  const end = () => {
    if (!drag) return;
    if (drag.mode === 'marquee') {
      setMarquee(null);
      if (!drag.active || !drag.rect) {
        if (!drag.additive) selectBoards([activeBoard()]); // 单击空白处：只保留当前画板
      } else {
        // 与框相交的画板
        const r = drag.rect;
        const hits = [];
        for (const id of allBoardIds()) {
          const b = boardRect(id);
          if (b && b.sx < r.x + r.w && b.sx + b.sw > r.x && b.sy < r.y + r.h && b.sy + b.sh > r.y) hits.push(id);
        }
        if (hits.length) selectBoards(drag.additive ? [...new Set([...drag.base, ...hits])] : hits);
      }
    }
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
  target.addEventListener('pointerleave', () => { if (!drag) setHover(null); });

  // 滚轮：滚动 / 缩放视图；构图工具下在当前画板上滚动 = 缩放构图（会导出）
  target.addEventListener('wheel', e => {
    e.preventDefault();
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    const b = boardAt(e.clientX, e.clientY);
    if (!mod && getTool() === 'orbit' && b && b === activeBoard()) {
      const r = boardRect(b);
      const [sx, sy] = local(e);
      const cx = (sx - r.sx - r.sw / 2) / r.zoom;
      const cy = -(sy - r.sy - r.sh / 2) / r.zoom;
      const cam = getCamera();
      setCamera(zoomAround(cam, is3D(), cx, cy, clamp((cam.zoom || 1) * Math.exp(-e.deltaY * 0.0015), 0.2, 8)));
      return;
    }
    let dy = e.deltaY, dx = e.deltaX;
    if (e.deltaMode === 1) { dx *= 33; dy *= 33; }
    const [sx, sy] = local(e);
    // 触控板捏合（ctrlKey + 小增量）更灵敏，鼠标滚轮每格约 22%
    const zoomBy = d => zoomViewAt(sx, sy, Math.exp(-d * (e.ctrlKey && !e.metaKey && Math.abs(d) < 40 ? 0.01 : 0.0025)));
    if (e.shiftKey) { panView(-(dx || dy), 0); return; } // Shift + 滚轮：左右平移
    if (wheelMode() === 'scroll') {
      // 偏好「滚动视图」：滚轮滚动，Ctrl/⌘/⌥ + 滚轮缩放
      if (mod) zoomBy(dy); else panView(-dx, -dy);
      return;
    }
    // 默认：滚轮以鼠标位置为中心缩放视图
    zoomBy(dy);
  }, { passive: false });

  target.addEventListener('dblclick', e => {
    if (e.button !== 0) return;
    const tool = getTool();
    const b = boardAt(e.clientX, e.clientY);
    if (!b) { fitActive(); return; } // 双击空白处：适合当前画板
    if (b === activeBoard() && cardTools.has(tool)) {
      const hit = pick(e.clientX, e.clientY);
      if (hit && toolAvailable(tool)) resetItemAdjust(hit.order);
    }
  });

  return { updateCursor };
}
