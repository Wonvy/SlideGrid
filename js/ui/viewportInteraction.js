import { clamp } from '../core/utils.js';
import { zoomAround, panFactor } from '../render/scene.js';
import { el } from './dom.js';
import { iconCursor } from './icons.js';
import { stackCards } from '../app/cardOrder.js';
import { snapRect, moveRect, unionRects, intersects } from '../workspace/snap.js';

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
 *   V 选择（拖角点缩放、拖角外侧旋转）  C 裁切  X 交换  S 比例  O 构图  H 抓手  Z 放大镜  ⇧O 画板
 *   T 文字  M 矩形  L 椭圆  P 钢笔  A 直接选择（图层相关见 app/layerTools.js，图层优先于卡片）
 *
 * 裁切：拖动卡片平移里面的图片，滚轮放大 / 缩小图片，双击复位（3D 版式也可用）
 *
 * 选择（与 Illustrator 一致）：
 *   画板外空白处拖动        框选画板（Shift/⌘ 追加）；单击空白处 = 取消选择
 *   画板内空白处拖动        框选卡片（平面版式；Shift/⌘ 追加）
 *   Shift/⌘ + 单击卡片     加选 / 减选；Shift/⌘ + 从卡片上拖动 = 追加框选（铺满型版式没有空白时用）
 *   Shift/⌘ + 单击其他画板  加选 / 减选画板
 *   ⌘A                    全选当前画板的卡片（平面版式、卡片工具下）；画板工具 / 3D 版式下全选画板
 *   ⇧⌘A / Esc             取消选择
 *   画板工具：单击选择、拖动移动（多选时一起移动，按住 Alt 复制后拖动副本）、Delete 删除所选、⌘D 复制；
 *   任何工具下拖画板名称都可以移动画板（同样支持 Alt 复制）
 */
export function attachViewportInteraction(target, opts) {
  const {
    getTool, setTool, toolAvailable, is3D, canSwap, getSlide, onTempHand, cardSelectable = () => false,
    // 画板与视图
    boardAt, activeBoard, activateBoard, boardRect, deleteSelectedBoards,
    selectedBoards, toggleBoardSelection, selectBoards, selectAllBoards, moveBoards, setMarquee,
    duplicateBoards = () => {}, duplicateBoardsInPlace = () => null,
    panView, zoomViewAt, zoomViewBy, fitActive, fitAll, actualSize,
    // 当前画板内
    pick, getCamera, setCamera, allBoardIds, onContextMenu, labelAt, wheelMode,
    setHover, setDragSource, setDropTarget, onSwap,
    getAdjust, nextLift, toLayoutDelta, itemCenterClient, itemCornersClient,
    setItemAdjusts, resetItemAdjust,
    // 卡片多选 / 吸附
    getSelection, setSelection, itemRects, boardLocalRect, snapEnabled, setGuides, allCards,
    // 图层（可选）：layers 为 createLayerTools() 的结果；applyEdits 一次提交卡片和图层的修改
    layers = null, getLayerSelection = () => [], applyEdits,
  } = opts;

  // 吸附目标：当前画板 + 画板内（不在 exclude 里的）卡片，屏幕坐标
  function cardTargets(exclude) {
    const ex = new Set(exclude);
    const targets = [...itemRects().filter(x => !ex.has(x.order)).map(x => x.rect), ...(layers?.rects(getLayerSelection()) || [])];
    const br = boardLocalRect(activeBoard());
    return br ? [br, ...targets.filter(r => intersects(r, br))] : targets;
  }
  const selectionRect = orders => {
    const map = new Map(itemRects().map(x => [x.order, x.rect]));
    const rs = orders.map(o => map.get(o)).filter(Boolean);
    const lr = layers?.selectionRect();
    if (lr) rs.push(lr);
    return rs.length ? unionRects(rs) : null;
  };
  // 拖动开始时记录各画板位置和吸附目标。按住 Alt（⌥）：先在原地复制所选画板，拖动的是副本（原画板不动，副本可以吸附到原画板）
  function boardDragState(e) {
    const ids = selectedBoards();
    const others = allBoardIds().filter(id => !ids.includes(id)).map(boardLocalRect).filter(Boolean);
    const state = {
      starts: ids.map(id => ({ id, x: boardRect(id).x, y: boardRect(id).y })),
      startRect: unionRects(ids.map(boardLocalRect).filter(Boolean)),
      targets: others,
      zoom: boardRect(activeBoard()).zoom,
    };
    if (e?.altKey) {
      const copies = duplicateBoardsInPlace(ids);
      if (copies?.length === ids.length) {
        state.targets = [...others, ...ids.map(boardLocalRect).filter(Boolean)];
        state.starts = state.starts.map((st, i) => ({ ...st, id: copies[i] }));
        target.style.cursor = 'copy'; // 拖动副本的过程中一直显示「复制」指针
      }
    }
    return state;
  }
  // 吸附（按住 ⌘/Ctrl 临时关闭）
  function snapDelta(rect, targets, dx, dy, e) {
    if (!rect || !snapEnabled() || e.metaKey || e.ctrlKey) { setGuides(null); return [dx, dy]; }
    const r = snapRect(moveRect(rect, dx, dy), targets);
    setGuides(r.guides);
    return [dx + r.dx, dy + r.dy];
  }

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
  const isAdditive = e => e.shiftKey || e.metaKey || e.ctrlKey;
  const deselectAll = () => { setSelection([]); layers?.clear(); selectBoards([activeBoard()]); };

  /* ---------- 键盘 ---------- */

  window.addEventListener('keydown', e => {
    if (e.key === 'Alt') { altDown = true; updateCursor(); }
    if (isTyping(e) || document.querySelector('dialog[open]')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (layers?.keydown(e)) return; // 钢笔 Enter / Esc、删除图层、⌘D、⌘[ ]、方向键微调图层…

    // 视图快捷键（会阻止浏览器自带的页面缩放）
    if (mod && (e.code === 'Digit0' || e.code === 'Numpad0')) { e.preventDefault(); (e.altKey ? fitAll : fitActive)(); return; }
    if (mod && (e.code === 'Digit1' || e.code === 'Numpad1')) { e.preventDefault(); actualSize(); return; }
    if (mod && (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd')) { e.preventDefault(); zoomViewBy(1.25); return; }
    if (mod && (e.key === '-' || e.code === 'NumpadSubtract')) { e.preventDefault(); zoomViewBy(0.8); return; }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      if (e.shiftKey) { deselectAll(); return; } // ⇧⌘A：取消选择
      // 卡片工具 + 平面版式：全选当前画板的卡片；否则全选画板
      if (cardTools.has(getTool()) && !is3D() && toolAvailable(getTool())) { setSelection(allCards()); layers?.selectAll(); }
      else if (getTool() === 'select' && layers?.selectAll()) { /* 3D 版式：全选图层 */ }
      else selectAllBoards();
      return;
    }
    // ⌘D / Ctrl+D：复制所选画板（选中图层时由上面的图层快捷键处理）
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateBoards(); return; }
    // ⌘] / ⌘[：选中的卡片上移 / 下移一层，加 Shift 置顶 / 置底（平面版式）
    if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft') && getSelection().length) {
      e.preventDefault();
      stackCards(getSelection(), e.code === 'BracketRight' ? 1 : -1, e.shiftKey);
      return;
    }
    if (mod || e.altKey) return;

    if (e.code === 'Space') {
      e.preventDefault();
      if (!spaceDown) { spaceDown = true; onTempHand(true); updateCursor(); }
      return;
    }

    const key = e.key.toLowerCase();
    if (key === 'o' && e.shiftKey) { setTool('artboard'); return; }
    const TOOL_KEYS = {
      v: 'select', c: 'crop', x: 'swap', s: 'scale', o: 'orbit', h: 'hand', z: 'zoom',
      t: 'text', m: 'rect', l: 'ellipse', p: 'pen', a: 'direct', '\\': 'line',
    };
    if (!e.shiftKey && TOOL_KEYS[key]) { setTool(TOOL_KEYS[key]); updateCursor(); return; }

    if (e.key === 'Escape') { deselectAll(); if (getTool() !== 'artboard') setTool('select'); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && getTool() === 'artboard') {
      e.preventDefault();
      deleteSelectedBoards();
      return;
    }

    const sel = getSelection();
    const tool = getTool();
    if (!sel.length || !cardTools.has(tool)) return;
    const each = fn => setItemAdjusts(sel.map(o => ({ order: o, patch: fn({ dx: 0, dy: 0, rz: 0, ...getAdjust(o) }) })));
    const scaled = (a, k) => ({ s: clamp((a.s > 0 ? a.s : 1) * k, 0.1, 8) });
    // + / -：以各自中心等比缩放选中的卡片
    if (['=', '+', '-', '_'].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 0.01 : 0.05;
      each(a => scaled(a, e.key === '-' || e.key === '_' ? 1 - step : 1 + step));
      return;
    }
    // 方向键：选择工具移动、旋转工具旋转、比例工具缩放
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (!arrows[e.key]) return;
    e.preventDefault();
    const [ax, ay] = arrows[e.key];
    if (tool === 'select') {
      const step = e.shiftKey ? 10 : 1;
      each(a => ({ dx: a.dx + ax * step, dy: a.dy + ay * step }));
    } else if (tool === 'rotate') {
      each(a => ({ rz: normAngle(a.rz - (ax || -ay) * (e.shiftKey ? 15 : 1)) }));
    } else {
      each(a => scaled(a, 1 + (ax || ay) * (e.shiftKey ? 0.01 : 0.05)));
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
    // 拖名称移动画板；按住 Alt（⌥）时是复制画板，指针显示「复制」
    if (labelAt(e.clientX, e.clientY)) return altDown ? 'copy' : 'move';
    const b = boardAt(e.clientX, e.clientY);
    if (tool === 'artboard') return b ? (altDown ? 'copy' : 'move') : 'default';
    if (!b) return 'default';
    if (b !== activeBoard()) return 'pointer'; // 点击切换到这个画板
    if (tool === 'orbit') return is3D() ? 'move' : 'grab';
    const hit = pick(e.clientX, e.clientY);
    if (!hit) return cardTools.has(tool) && !is3D() ? 'crosshair' : tool === 'select' ? (altDown ? 'copy' : 'move') : 'default';
    if (tool === 'swap') return canSwap() ? 'grab' : 'default';
    if (tool === 'crop') return drag?.mode === 'crop' ? 'grabbing' : 'grab';
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

  // 与框（工作区坐标）相交的卡片 / 画板
  const cardsInRect = r => {
    const box = { l: r.x, t: r.y, r: r.x + r.w, b: r.y + r.h };
    return itemRects().filter(x => intersects(x.rect, box)).map(x => x.order);
  };
  const boardsInRect = r => allBoardIds().filter(id => {
    const b = boardRect(id);
    return b && b.sx < r.x + r.w && b.sx + b.sw > r.x && b.sy < r.y + r.h && b.sy + b.sh > r.y;
  });

  // 框选画板：记录起点和原有选择（Shift/⌘ 时追加）
  let pendingMarquee = null;
  function startBoardMarquee(e, additive) {
    const [sx, sy] = local(e);
    pendingMarquee = { sx, sy, additive, base: selectedBoards() };
  }

  target.addEventListener('pointerdown', e => {
    lastEvent = e;
    let mode = null;
    let layerResult = null;
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
        Object.assign(extra, boardDragState(e));
      } else if (tool === 'zoom') {
        const [sx, sy] = local(e);
        zoomViewAt(sx, sy, e.altKey ? 1 / 1.6 : 1.6);
        return;
      } else if (layers && tool !== 'artboard' && (layerResult = layers.pointerDown(e, tool, b))) {
        // 图层（在卡片上面）：绘制、点选、移动、缩放、旋转、编辑锚点
        if (layerResult === true) return;
        mode = 'layer';
        extra.handler = layerResult;
      } else if (tool === 'artboard') {
        const additive = isAdditive(e);
        if (!b) {
          startBoardMarquee(e, additive);
          mode = 'marquee';
        } else if (additive) {
          toggleBoardSelection(b);
          return;
        } else {
          // 点在已选画板上：保留多选并一起拖动；否则只选这一个
          activateBoard(b, { fit: false, keepSelection: selectedBoards().includes(b) });
          mode = 'moveBoards';
          Object.assign(extra, boardDragState(e));
        }
      } else if (!b) {
        // 画板外的空白处：框选画板；单击 = 取消选择
        const additive = isAdditive(e);
        if (!additive) { setSelection([]); layers?.clear(); }
        startBoardMarquee(e, additive);
        mode = 'marquee';
      } else {
        const additive = isAdditive(e);
        if (b !== activeBoard()) {
          if (additive) { toggleBoardSelection(b); return; } // 加选画板
          // 先切换到这个画板，再按当前工具继续处理（可以直接选中 / 拖动那个画板里的卡片）
          activateBoard(b, { fit: false, keepSelection: selectedBoards().includes(b) });
        }
        const hit = pick(e.clientX, e.clientY);
        const flat = !is3D();
        if (tool === 'orbit') {
          mode = is3D() && !e.shiftKey ? 'orbit' : 'contentPan';
        } else if (tool === 'swap') {
          if (hit && canSwap()) { mode = 'swap'; Object.assign(extra, { src: hit.slideIndex, srcHit: hit, ghost: null, target: null }); }
        } else if (tool === 'crop') {
          setSelection(hit ? [hit.order] : []);
          if (hit) {
            // 卡片在屏幕上的两条边（宽、高方向），用来把屏幕位移换算成卡片内的位移（3D 透视下也成立）
            const [lb, rb, , lt] = itemCornersClient(hit);
            mode = 'crop';
            Object.assign(extra, {
              order: hit.order, uv: hit.uv, adj: { ...getAdjust(hit.order) },
              ex: [rb[0] - lb[0], rb[1] - lb[1]], ey: [lt[0] - lb[0], lt[1] - lb[1]],
            });
          }
        } else if (cardTools.has(tool)) {
          const ok = hit && flat && toolAvailable(tool); // 3D 版式不能单独调整卡片
          if (!flat && hit && tool === 'select' && cardSelectable()) {
            // 有单卡设置的 3D 版式（等距展台、分组展台）：点选卡片（Shift / ⌘ 加选、减选），在「设计」页调抬起
            const cur = getSelection();
            layers?.clear();
            if (additive) setSelection(cur.includes(hit.order) ? cur.filter(o => o !== hit.order) : [...cur, hit.order], hit.order);
            else setSelection([hit.order]);
          } else if (flat && (additive || !hit)) {
            // 空白处拖动：框选卡片；Shift/⌘：追加框选，没拖动就是单击加选 / 减选卡片
            if (!additive) { setSelection([]); layers?.clear(); }
            mode = 'cardMarquee';
            Object.assign(extra, {
              sx: local(e)[0], sy: local(e)[1], base: getSelection(), layerBase: getLayerSelection(), toggle: ok ? hit.order : null,
            });
          } else if (!ok) {
            // 3D 版式：选择工具拖画板空白处 = 移动画板
            setSelection([]);
            layers?.clear();
            if (tool === 'select') {
              mode = 'moveBoards';
              Object.assign(extra, boardDragState(e));
            }
          } else {
            // 按在已选的卡片上：一起操作；否则只选这一张
            const keep = getSelection().includes(hit.order);
            const sel = keep ? getSelection() : [hit.order];
            if (!keep) layers?.clear(); // 点了没选中的卡片：只选它
            setSelection(sel, hit.order);
            if (keep && tool === 'select' && getLayerSelection().length) extra.layerMover = layers.beginMove(); // 与选中的图层一起移动
            mode = tool === 'select' ? 'move' : tool;
            extra.items = sel.map(o => ({ o, adj: { dx: 0, dy: 0, rz: 0, ...getAdjust(o) } }));
            const [cx, cy] = itemCenterClient(hit);
            Object.assign(extra, {
              cx, cy, prevA: Math.atan2(e.clientY - cy, e.clientX - cx), turned: 0,
              d0: Math.hypot(e.clientX - cx, e.clientY - cy) || 1,
            });
            if (mode === 'move') Object.assign(extra, { startRect: selectionRect(sel), targets: cardTargets(sel) });
          }
        }
        extra.hit = hit;
      }
    }
    if (mode === 'marquee') Object.assign(extra, pendingMarquee);
    pendingMarquee = null;
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
      const lc = layers && !spaceDown ? layers.hover(e, effectiveTool(), b) : null;
      if (lc) { setHover(null); target.style.cursor = lc; return; }
      const showHover = b && b === activeBoard() && ['select', 'crop', 'swap', 'rotate', 'scale'].includes(effectiveTool());
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
        const z = drag.zoom || boardRect(activeBoard()).zoom; // Alt 复制出的新画板这一帧可能还没有布局信息
        const [mx, my] = snapDelta(drag.startRect, drag.targets, dx, dy, e); // 吸附到其他画板
        moveBoards(drag.starts.map(st => ({ id: st.id, x: st.x + mx / z, y: st.y + my / z })));
        break;
      }
      case 'cardMarquee': {
        const [cx, cy] = local(e);
        drag.rect = { x: Math.min(drag.sx, cx), y: Math.min(drag.sy, cy), w: Math.abs(cx - drag.sx), h: Math.abs(cy - drag.sy) };
        setMarquee(drag.rect);
        // 拖动过程中实时选中框到的卡片（高亮跟着变）
        const next = [...new Set([...drag.base, ...cardsInRect(drag.rect)])];
        const nextLayers = layers ? [...new Set([...drag.layerBase, ...layers.inRect(drag.rect)])] : [];
        const key = `${next.join(',')}|${nextLayers.join(',')}`;
        if (key !== drag.liveKey) { drag.liveKey = key; setSelection(next); layers?.select(nextLayers); }
        break;
      }
      case 'marquee': {
        const [cx, cy] = local(e);
        drag.rect = { x: Math.min(drag.sx, cx), y: Math.min(drag.sy, cy), w: Math.abs(cx - drag.sx), h: Math.abs(cy - drag.sy) };
        setMarquee(drag.rect);
        // 实时选中框到的画板（描边高亮跟着变）
        const hits = boardsInRect(drag.rect);
        const next = drag.additive ? [...new Set([...drag.base, ...hits])] : hits.length ? hits : [activeBoard()];
        const key = next.join(',');
        if (key !== drag.liveKey) { drag.liveKey = key; selectBoards(next); }
        break;
      }
      case 'crop': {
        // 屏幕位移 = a × 卡片宽方向 + b × 卡片高方向（向上），a / b 为占卡片宽高的比例
        const { ex, ey, uv, adj } = drag;
        if (adj.fit === 'contain') break; // 完整显示时没有可移动的范围
        const det = ex[0] * ey[1] - ex[1] * ey[0] || 1e-9;
        const a = (dx * ey[1] - dy * ey[0]) / det;
        const b = (ex[0] * dy - ex[1] * dx) / det;
        const patch = {};
        // 图片跟着鼠标走：向右拖 = 露出左边（cropX 变小）；向上拖 = 露出下面（cropY 变大）
        if (uv[0] < 0.999) patch.cropX = clamp((adj.cropX || 0) - (2 * a * uv[0]) / (1 - uv[0]), -1, 1);
        if (uv[1] < 0.999) patch.cropY = clamp((adj.cropY || 0) + (2 * b * uv[1]) / (1 - uv[1]), -1, 1);
        if (Object.keys(patch).length) setItemAdjusts([{ order: drag.order, patch }]);
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
        [mx, my] = snapDelta(drag.startRect, drag.targets, mx, my, e); // 吸附到卡片 / 画板
        const [lx, ly] = toLayoutDelta(mx, my);
        if (first) drag.lift = nextLift();
        const patches = drag.items.map(({ o, adj }) => ({ order: o, patch: { dx: adj.dx + lx, dy: adj.dy + ly, lift: drag.lift } }));
        if (drag.layerMover) applyEdits({ adjusts: patches, layers: drag.layerMover(mx, my) });
        else setItemAdjusts(patches);
        break;
      }
      case 'layer':
        drag.handler.move?.(e, dx, dy);
        break;
      case 'rotate': {
        // 逐段累加角度，避免跨过 ±180° 时跳一整圈
        const a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
        let step = a - drag.prevA;
        if (step > Math.PI) step -= 2 * Math.PI;
        if (step < -Math.PI) step += 2 * Math.PI;
        drag.prevA = a;
        drag.turned += (step * 180) / Math.PI;
        if (first) drag.lift = nextLift();
        setItemAdjusts(drag.items.map(({ o, adj }) => {
          let rz = normAngle(adj.rz - drag.turned); // 屏幕 y 向下，顺时针为负
          if (e.shiftKey) rz = Math.round(rz / 15) * 15;
          return { order: o, patch: { rz, lift: drag.lift } };
        }));
        break;
      }
      case 'scale': {
        // 以卡片中心等比缩放：按指针到中心的距离变化
        const k = Math.hypot(e.clientX - drag.cx, e.clientY - drag.cy) / drag.d0;
        if (first) drag.lift = nextLift();
        setItemAdjusts(drag.items.map(({ o, adj }) => {
          let s = clamp((adj.s > 0 ? adj.s : 1) * k, 0.1, 8);
          if (e.shiftKey) s = Math.round(s * 20) / 20; // Shift 按 5% 吸附
          return { order: o, patch: { s, lift: drag.lift } };
        }));
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

  const end = e => {
    if (!drag) return;
    setGuides(null);
    if (drag.mode === 'layer') drag.handler.up?.(e, drag.active);
    if (drag.mode === 'cardMarquee') {
      setMarquee(null);
      if (drag.active && drag.rect) {
        setSelection([...new Set([...drag.base, ...cardsInRect(drag.rect)])]);
      } else if (drag.toggle != null) {
        // 没有拖动：Shift/⌘ + 单击卡片 = 加选 / 减选
        const cur = drag.base;
        setSelection(cur.includes(drag.toggle) ? cur.filter(o => o !== drag.toggle) : [...cur, drag.toggle]);
      }
    }
    if (drag.mode === 'marquee') {
      setMarquee(null);
      if (!drag.active || !drag.rect) {
        if (!drag.additive) selectBoards([activeBoard()]); // 单击空白处：只保留当前画板
      } else {
        const hits = boardsInRect(drag.rect);
        if (hits.length) selectBoards(drag.additive ? [...new Set([...drag.base, ...hits])] : hits);
      }
    }
    if (drag.mode === 'swap' && drag.active) {
      drag.ghost?.remove();
      setDragSource(null);
      setDropTarget(null);
      if (drag.target) onSwap(drag.srcHit, drag.target);
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
    if (!mod && getTool() === 'crop' && b && b === activeBoard()) {
      // 裁切工具：滚轮放大 / 缩小卡片里的图片（鼠标下的卡片，没有就用选中的卡片）
      const hit = pick(e.clientX, e.clientY);
      const order = hit ? hit.order : getSelection()[0];
      if (order != null) {
        const a = getAdjust(order);
        if (a.fit !== 'contain') {
          const z = clamp((a.cropZ || 1) * Math.exp(-e.deltaY * 0.0015), 1, 8);
          setItemAdjusts([{ order, patch: { cropZ: Math.round(z * 1000) / 1000 } }]);
          if (hit) setSelection([order]);
        }
        return;
      }
    }
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
    if (layers?.dblclick(e, tool)) return; // 双击文字编辑、双击路径编辑锚点 / 插入锚点
    const b = boardAt(e.clientX, e.clientY);
    if (!b) { fitActive(); return; } // 双击空白处：适合当前画板
    if (b === activeBoard() && cardTools.has(tool)) {
      const hit = pick(e.clientX, e.clientY);
      if (hit && !is3D() && toolAvailable(tool)) resetItemAdjust(hit.order);
    }
    if (b === activeBoard() && tool === 'crop') {
      const hit = pick(e.clientX, e.clientY);
      if (hit) opts.resetCrop?.(hit.order); // 双击：复位裁切
    }
  });

  return { updateCursor };
}
