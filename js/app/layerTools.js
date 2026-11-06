import { store, actions, boardsOf } from '../state.js';
import {
  createLayer, measureText, hitLayer, moveLayer, mapToFrame, selectionFrame, frameHandles, corners,
  pathOf, syncPathBox, insertAnchor, nearestOnPath, bounds, rotatePoint, fontOf, FONTS,
} from '../layers/model.js';
import { snapRect, moveRect, intersects } from '../workspace/snap.js';
import { iconCursor } from '../ui/icons.js';
import { ui, setUi } from './uiState.js';

/**
 * 图层的鼠标 / 键盘交互（类似 Figma）：
 *   M 矩形  L 椭圆：拖动绘制（Shift 正方形 / 正圆，⌥ 从中心），单击放一个默认大小的
 *   T 文字：单击输入文字；选择工具下双击文字可编辑
 *   P 钢笔：单击加直角锚点，按住拖动拉出曲线控制柄；点第一个锚点闭合；Enter / Esc 结束；Backspace 删除上一个锚点
 *   A 直接选择：编辑路径锚点——拖锚点 / 控制柄（⌥ 拖控制柄打断对称），⌥ 单击锚点切换直角 / 平滑，
 *     双击路径插入锚点，Delete 删除选中的锚点；选择工具下双击路径也会进入
 *   选择工具：点选图层（在卡片上面优先），Shift / ⌘ 加选，拖动移动（吸附），拖选框的角 / 边缩放（Shift 等比、⌥ 以中心），
 *     拖角外侧旋转（Shift 按 15°）；方向键微调，Delete 删除，⌘D 复制，⌘] / ⌘[ 上移 / 下移一层
 *
 * 和卡片的关系：图层和卡片可以一起选中、一起移动（作为一步撤销）。
 */
const HANDLE = 5;        // 选框手柄半径（屏幕像素）
const ROTATE_ZONE = 18;  // 角外侧多大范围内拖动 = 旋转
const PICK_TOL = 4;      // 点选容差（屏幕像素）
export const LAYER_TOOLS = ['rect', 'ellipse', 'text', 'pen', 'direct'];
const ACCENT = '#7c8cff';

export function createLayerTools({ ws, viewport, getTool, setTool, setGuides, snapEnabled, getCardSelection, setCardSelection, cardPatches, onSelectionChange }) {
  let pen = null;        // 正在绘制的路径：{ id, cursor }
  let editing = null;    // 正在编辑的文字：{ id, box }
  let anchorSel = [];    // 直接选择工具下选中的锚点序号
  let lastPointer = null;

  /* ---------------- 基础 ---------------- */

  const S = () => store.get();
  const layersOf = () => S().layers || [];
  const byId = id => layersOf().find(l => l.id === id);
  const selected = () => layersOf().filter(l => ui.layerSel.includes(l.id));
  const info = () => ws.boardInfo(S().activeBoard);
  const local = e => { const r = viewport.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const toBoard = ([lx, ly], i = info()) => ({ x: (lx - i.sx) / i.zoom, y: (ly - i.sy) / i.zoom });
  const toScreen = (p, i = info()) => [i.sx + p.x * i.zoom, i.sy + p.y * i.zoom];
  const tol = () => PICK_TOL / (info()?.zoom || 1);

  function select(ids) {
    const next = [...new Set(ids)];
    if (next.join() === ui.layerSel.join()) return;
    anchorSel = [];
    setUi('layerSel', next);
    onSelectionChange?.();
  }
  const clear = () => select([]);

  const setLayers = layers => actions.setLayers(layers);
  const replace = (list, changed) => {
    const m = new Map(changed.map(l => [l.id, l]));
    return list.map(l => m.get(l.id) || l);
  };

  // 点中的最上层图层（锁定 / 隐藏的跳过）
  function layerAt(p, list = layersOf(), t = tol()) {
    for (let i = list.length - 1; i >= 0; i--) {
      const l = list[i];
      if (!l.locked && hitLayer(l, p, t)) return l;
    }
    return null;
  }

  // 图层在屏幕上的范围（相对工作区）
  const screenRect = (l, i = info()) => {
    const b = bounds(l);
    const [x0, y0] = toScreen({ x: b.x, y: b.y }, i), [x1, y1] = toScreen({ x: b.x + b.w, y: b.y + b.h }, i);
    return { l: x0, t: y0, r: x1, b: y1 };
  };
  const rects = (exclude = []) => {
    const i = info();
    if (!i) return [];
    return layersOf().filter(l => !l.hidden && !exclude.includes(l.id)).map(l => screenRect(l, i));
  };
  function selectionRect() {
    const list = selected();
    if (!list.length) return null;
    const rs = list.map(l => screenRect(l));
    return { l: Math.min(...rs.map(r => r.l)), t: Math.min(...rs.map(r => r.t)), r: Math.max(...rs.map(r => r.r)), b: Math.max(...rs.map(r => r.b)) };
  }

  /* ---------------- 移动（可带上选中的卡片） ---------------- */

  // 返回 mover(mxPx, myPx) → 新的图层列表（不写入 store，由调用方和卡片调整一起提交）
  function beginMove() {
    const start = layersOf();
    const ids = new Set(ui.layerSel);
    const z = info().zoom;
    return (mx, my) => start.map(l => (ids.has(l.id) && !l.locked ? moveLayer(l, mx / z, my / z) : l));
  }

  // 选择工具拖动图层：吸附到画板、卡片和其他图层；同时选中的卡片一起移动
  function moveHandler(e) {
    const mover = beginMove();
    const cards = getCardSelection();
    const cardMove = cards.length ? cardPatches(cards) : null;
    const startRect = selectionRect();
    const cardRects = ws.itemRects().filter(x => !cards.includes(x.order)).map(x => x.rect);
    const br = ws.boardLocalRect(S().activeBoard);
    const targets = [br, ...cardRects.filter(r => intersects(r, br)), ...rects(ui.layerSel)];
    return {
      move(ev, dx, dy) {
        let mx = dx, my = dy;
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) my = 0; else mx = 0; }
        if (snapEnabled() && !(ev.metaKey || ev.ctrlKey) && startRect) {
          const r = snapRect(moveRect(startRect, mx, my), targets);
          mx += r.dx; my += r.dy;
          setGuides(r.guides);
        } else setGuides(null);
        actions.applyEdits({ layers: mover(mx, my), adjusts: cardMove ? cardMove(mx, my) : null });
      },
    };
  }

  /* ---------------- 选框：缩放 / 旋转 ---------------- */

  function frameScreen() {
    const list = selected().filter(l => !l.locked);
    if (!list.length) return null;
    const f = selectionFrame(list);
    return f && { f, list, handles: frameHandles(f) };
  }

  // 屏幕点 → 选框的手柄：{ kind: 'resize', key } | { kind: 'rotate' } | null
  function handleAt(lx, ly) {
    const fs = frameScreen();
    if (!fs) return null;
    const i = info();
    for (const [key, p] of Object.entries(fs.handles)) {
      const [hx, hy] = toScreen(p, i);
      if (Math.hypot(lx - hx, ly - hy) <= HANDLE + 3) return { kind: 'resize', key, fs };
    }
    // 角的外侧：旋转
    for (const key of ['nw', 'ne', 'se', 'sw']) {
      const [hx, hy] = toScreen(fs.handles[key], i);
      const d = Math.hypot(lx - hx, ly - hy);
      if (d > HANDLE + 3 && d <= ROTATE_ZONE) {
        // 只认选框外侧
        const [cx, cy] = toScreen({ x: fs.f.cx, y: fs.f.cy }, i);
        if (Math.hypot(lx - cx, ly - cy) > Math.hypot(hx - cx, hy - cy)) return { kind: 'rotate', key, fs };
      }
    }
    return null;
  }

  const CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
  const HANDLE_ANGLE = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };
  const resizeCursor = (key, rotation) => CURSORS[Math.round(((HANDLE_ANGLE[key] + rotation) % 180 + 180) % 180 / 45) % 4];

  function transformHandler(h, e) {
    const { f, list } = h.fs;
    const all = layersOf();
    const keep = list.length === 1 && list[0].type === 'text'; // 文字只能等比缩放
    const i = info();
    if (h.kind === 'rotate') {
      const c = toScreen({ x: f.cx, y: f.cy }, i);
      const a0 = Math.atan2(local(e)[1] - c[1], local(e)[0] - c[0]);
      return {
        move(ev) {
          const [lx, ly] = local(ev);
          let deg = ((Math.atan2(ly - c[1], lx - c[0]) - a0) * 180) / Math.PI;
          let rotation = f.rotation + deg;
          if (ev.shiftKey) rotation = Math.round(rotation / 15) * 15;
          deg = rotation - f.rotation;
          const to = { ...f, rotation: f.rotation + deg };
          setLayers(replace(all, list.map(l => mapToFrame(l, f, to))));
        },
      };
    }
    const [ux, uy] = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] }[h.key];
    return {
      move(ev) {
        const p = toBoard(local(ev), i);
        // 转到选框自身的坐标系（去掉旋转）
        const q = rotatePoint(p, { x: f.cx, y: f.cy }, -f.rotation);
        const fromCenter = ev.altKey;
        const ax = f.cx - (ux * f.w) / 2, ay = f.cy - (uy * f.h) / 2; // 对边 / 对角（固定点）
        let w = f.w, h2 = f.h;
        if (ux) w = fromCenter ? Math.abs(q.x - f.cx) * 2 : Math.abs(q.x - ax);
        if (uy) h2 = fromCenter ? Math.abs(q.y - f.cy) * 2 : Math.abs(q.y - ay);
        if ((ev.shiftKey || keep) && ux && uy) {
          const k = Math.max(w / f.w, h2 / f.h);
          w = f.w * k; h2 = f.h * k;
        } else if (keep) {
          const k = ux ? w / f.w : h2 / f.h;
          w = f.w * k; h2 = f.h * k;
        }
        w = Math.max(1, w); h2 = Math.max(1, h2);
        let cx = f.cx, cy = f.cy;
        if (!fromCenter) {
          if (ux) cx = ax + (ux * w) / 2;
          if (uy) cy = ay + (uy * h2) / 2;
        }
        const c = rotatePoint({ x: cx, y: cy }, { x: f.cx, y: f.cy }, f.rotation);
        const to = { cx: c.x, cy: c.y, w, h: h2, rotation: f.rotation };
        setLayers(replace(all, list.map(l => mapToFrame(l, f, to))));
      },
    };
  }

  /* ---------------- 绘制新图层 ---------------- */

  function shapeHandler(type, e) {
    const i = info();
    const p0 = toBoard(local(e), i);
    let id = null;
    const make = (p, ev) => {
      let dx = p.x - p0.x, dy = p.y - p0.y;
      if (ev.shiftKey) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
      const x = ev.altKey ? p0.x - Math.abs(dx) : Math.min(p0.x, p0.x + dx);
      const y = ev.altKey ? p0.y - Math.abs(dy) : Math.min(p0.y, p0.y + dy);
      const w = Math.max(1, Math.abs(dx) * (ev.altKey ? 2 : 1)), h = Math.max(1, Math.abs(dy) * (ev.altKey ? 2 : 1));
      return { x, y, w, h };
    };
    return {
      move(ev) {
        const box = make(toBoard(local(ev), i), ev);
        const list = layersOf();
        if (!id) {
          const l = createLayer(type, box, list);
          id = l.id;
          setLayers([...list, l]);
          select([id]);
        } else {
          setLayers(list.map(l => (l.id === id ? { ...l, ...box } : l)));
        }
      },
      up(ev, moved) {
        if (!moved) {
          // 单击：以点击处为中心放一个默认大小的
          const list = layersOf();
          const size = type === 'ellipse' ? { w: 200, h: 200 } : { w: 280, h: 180 };
          const l = createLayer(type, { x: p0.x - size.w / 2, y: p0.y - size.h / 2, ...size }, list);
          setLayers([...list, l]);
          id = l.id;
        }
        select([id]);
        setTool('select');
      },
    };
  }

  /* ---------------- 文字编辑 ---------------- */

  function startEdit(id, { selectAll = true } = {}) {
    finishEdit();
    const l = byId(id);
    if (!l || l.type !== 'text') return;
    select([id]);
    const box = document.createElement('textarea');
    box.className = 'text-editor';
    box.spellcheck = false;
    box.value = l.text;
    viewport.append(box);
    editing = { id, box };
    box.addEventListener('input', () => {
      const cur = byId(id);
      if (cur) setLayers(layersOf().map(x => (x.id === id ? measureText({ ...x, text: box.value }) : x)));
      syncEditor();
    });
    box.addEventListener('keydown', ev => {
      ev.stopPropagation(); // 输入时不触发工具快捷键
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey))) { ev.preventDefault(); box.blur(); }
    });
    box.addEventListener('blur', () => finishEdit());
    syncEditor();
    box.focus();
    if (selectAll) box.select();
    ws.scheduleRender();
  }

  // 编辑框跟随图层位置、视图缩放
  function syncEditor() {
    if (!editing) return;
    const l = byId(editing.id), i = info();
    if (!l || !i) { finishEdit(); return; }
    const z = i.zoom;
    const [x, y] = toScreen({ x: l.x, y: l.y }, i);
    Object.assign(editing.box.style, {
      left: `${x}px`, top: `${y}px`,
      width: `${Math.max(l.w, l.fontSize) * z + l.fontSize * z * 0.6}px`, height: `${l.h * z + 2}px`,
      font: fontOf({ ...l, fontSize: l.fontSize * z }),
      lineHeight: String(l.lineHeight),
      letterSpacing: `${(l.letterSpacing || 0) * z}px`,
      color: l.color, textAlign: l.align,
      transform: `rotate(${l.rotation || 0}deg)`,
      transformOrigin: `${(l.w * z) / 2}px ${(l.h * z) / 2}px`,
    });
  }

  function finishEdit() {
    if (!editing) return;
    const { id, box } = editing;
    editing = null;
    box.remove();
    const l = byId(id);
    if (l && !l.text.trim()) { setLayers(layersOf().filter(x => x.id !== id)); clear(); }
    ws.scheduleRender();
  }

  /* ---------------- 钢笔 ---------------- */

  function finishPen() {
    if (!pen) return;
    const l = byId(pen.id);
    pen = null;
    if (l && l.anchors.length < 2) { setLayers(layersOf().filter(x => x.id !== l.id)); clear(); }
    else if (l) select([l.id]);
    ws.scheduleRender();
  }

  function penHandler(e) {
    const i = info();
    const p = toBoard(local(e), i);
    let list = layersOf();
    let l = pen && byId(pen.id);
    if (l && l.anchors.length >= 2) {
      // 点第一个锚点：闭合路径
      const [fx, fy] = toScreen(l.anchors[0], i);
      const [lx, ly] = local(e);
      if (Math.hypot(lx - fx, ly - fy) <= 8) {
        setLayers(list.map(x => (x.id === l.id ? syncPathBox({ ...x, closed: true, fillType: x.fillType === 'none' ? 'solid' : x.fillType, fillAlpha: x.fillType === 'none' ? 0.35 : x.fillAlpha }) : x)));
        finishPen();
        return true;
      }
    }
    if (!l) {
      l = createLayer('path', { anchors: [] }, list);
      pen = { id: l.id, cursor: null };
      list = [...list, l];
    }
    const id = l.id;
    const index = l.anchors.length;
    const anchor = { x: p.x, y: p.y, hi: null, ho: null };
    setLayers(list.map(x => (x.id === id ? syncPathBox({ ...x, anchors: [...x.anchors, anchor] }) : x)));
    select([id]);
    // 按住拖动：拉出对称的控制柄（平滑锚点）
    return {
      move(ev) {
        const q = toBoard(local(ev), i);
        const ho = { x: q.x, y: q.y }, hi = { x: 2 * p.x - q.x, y: 2 * p.y - q.y };
        setLayers(layersOf().map(x => (x.id === id
          ? syncPathBox({ ...x, anchors: x.anchors.map((a, k) => (k === index ? { ...a, hi, ho } : a)) }) : x)));
      },
    };
  }

  /* ---------------- 直接选择：编辑锚点 ---------------- */

  const editPath = () => {
    const l = selected();
    return l.length === 1 && l[0].type === 'path' && !l[0].locked ? l[0] : null;
  };

  // 屏幕点 → 锚点或控制柄：{ index, part: 'anchor' | 'hi' | 'ho' }
  function anchorPartAt(l, lx, ly) {
    const i = info();
    for (let k = l.anchors.length - 1; k >= 0; k--) {
      const a = l.anchors[k];
      for (const part of ['hi', 'ho']) {
        if (!a[part]) continue;
        const [hx, hy] = toScreen(a[part], i);
        if (Math.hypot(lx - hx, ly - hy) <= 6) return { index: k, part };
      }
    }
    for (let k = l.anchors.length - 1; k >= 0; k--) {
      const [ax, ay] = toScreen(l.anchors[k], i);
      if (Math.hypot(lx - ax, ly - ay) <= 7) return { index: k, part: 'anchor' };
    }
    return null;
  }

  function directHandler(e) {
    const [lx, ly] = local(e);
    const p = toBoard([lx, ly]);
    const path = editPath();
    if (path) {
      const hit = anchorPartAt(path, lx, ly);
      if (hit) {
        const id = path.id;
        if (hit.part === 'anchor') {
          if (e.altKey) {
            // ⌥ 单击锚点：直角 ↔ 平滑
            const a = path.anchors[hit.index];
            const n = path.anchors.length;
            const prev = path.anchors[(hit.index - 1 + n) % n], next = path.anchors[(hit.index + 1) % n];
            let patch;
            if (a.hi || a.ho) patch = { hi: null, ho: null };
            else {
              const dx = (next.x - prev.x) / 6, dy = (next.y - prev.y) / 6;
              patch = { hi: { x: a.x - dx, y: a.y - dy }, ho: { x: a.x + dx, y: a.y + dy } };
            }
            setLayers(layersOf().map(x => (x.id === id ? syncPathBox({ ...x, anchors: x.anchors.map((v, k) => (k === hit.index ? { ...v, ...patch } : v)) }) : x)));
            anchorSel = [hit.index];
            return true;
          }
          if (e.shiftKey) {
            anchorSel = anchorSel.includes(hit.index) ? anchorSel.filter(k => k !== hit.index) : [...anchorSel, hit.index];
            ws.scheduleRender();
            return true;
          }
          if (!anchorSel.includes(hit.index)) anchorSel = [hit.index];
          // 拖动选中的锚点（控制柄跟着走）
          const start = path.anchors;
          const z = info().zoom;
          return {
            move(ev, dx, dy) {
              const mx = dx / z, my = dy / z;
              const mv = q => (q ? { x: q.x + mx, y: q.y + my } : q);
              setLayers(layersOf().map(x => (x.id === id
                ? syncPathBox({ ...x, anchors: start.map((a, k) => (anchorSel.includes(k) ? { x: a.x + mx, y: a.y + my, hi: mv(a.hi), ho: mv(a.ho) } : a)) }) : x)));
            },
          };
        }
        // 拖动控制柄：另一侧对称（⌥ 打断，只动这一侧）
        anchorSel = [hit.index];
        const other = hit.part === 'hi' ? 'ho' : 'hi';
        return {
          move(ev) {
            const q = toBoard(local(ev));
            setLayers(layersOf().map(x => {
              if (x.id !== id) return x;
              const anchors = x.anchors.map((a, k) => {
                if (k !== hit.index) return a;
                const out = { ...a, [hit.part]: { x: q.x, y: q.y } };
                if (!ev.altKey && a[other]) {
                  const len = Math.hypot(a[other].x - a.x, a[other].y - a.y);
                  const d = Math.hypot(q.x - a.x, q.y - a.y) || 1;
                  out[other] = { x: a.x - ((q.x - a.x) / d) * len, y: a.y - ((q.y - a.y) / d) * len };
                }
                return out;
              });
              return syncPathBox({ ...x, anchors });
            }));
          },
        };
      }
    }
    // 点到某个图层：选中它（路径进入锚点编辑），拖动 = 移动
    const l = layerAt(p);
    if (l) {
      if (!ui.layerSel.includes(l.id)) { select([l.id]); setCardSelection([]); }
      anchorSel = [];
      return moveHandler(e);
    }
    clear();
    return true;
  }

  /* ---------------- 指针入口（由 viewportInteraction 调用） ---------------- */

  /**
   * 返回值：null = 不处理（交给卡片 / 画板逻辑）；true = 已处理，不需要拖动；
   *        { move(ev, dx, dy), up?(ev, moved) } = 开始拖动
   */
  function pointerDown(e, tool, board) {
    lastPointer = e;
    if (editing) finishEdit();
    const s = S();
    // 绘制类工具：点在别的画板上先切换过去
    if (['rect', 'ellipse', 'text', 'pen'].includes(tool)) {
      if (!board) return true;
      if (board !== s.activeBoard) { finishPen(); actions.setActiveBoard(board); }
      if (tool === 'text') {
        const p = toBoard(local(e));
        const list = layersOf();
        const l = createLayer('text', {}, list);
        const placed = { ...l, x: p.x, y: p.y - l.h / 2 };
        setLayers([...list, placed]);
        setTool('select');
        startEdit(placed.id);
        return true;
      }
      if (tool === 'pen') return penHandler(e);
      setCardSelection([]);
      return shapeHandler(tool, e);
    }
    if (tool === 'direct') {
      if (!board) { clear(); return true; }
      if (board !== s.activeBoard) actions.setActiveBoard(board);
      return directHandler(e);
    }
    if (tool !== 'select') return null;

    // 选择工具：先看选框手柄，再看图层
    const [lx, ly] = local(e);
    const h = board === s.activeBoard || !board ? handleAt(lx, ly) : null;
    if (h) return transformHandler(h, e);
    if (!board) return null;
    // 点在其他画板的图层上：切换过去并选中
    let list = layersOf(), i = info();
    if (board !== s.activeBoard) {
      const other = boardsOf(s).find(b => b.id === board);
      const bi = ws.boardInfo(board);
      const hit = other && bi ? layerAt(toBoard([lx, ly], bi), other.settings.layers || [], PICK_TOL / bi.zoom) : null;
      if (!hit) return null;
      actions.setActiveBoard(board);
      list = layersOf(); i = info();
    }
    const hit = layerAt(toBoard([lx, ly], i), list);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!hit) return null;
    if (additive) {
      select(ui.layerSel.includes(hit.id) ? ui.layerSel.filter(x => x !== hit.id) : [...ui.layerSel, hit.id]);
      return true;
    }
    if (!ui.layerSel.includes(hit.id)) { select([hit.id]); setCardSelection([]); }
    return moveHandler(e);
  }

  function dblclick(e, tool) {
    const i = info();
    if (!i) return false;
    const [lx, ly] = local(e);
    const p = toBoard([lx, ly], i);
    const path = editPath();
    if (tool === 'direct' && path) {
      // 双击路径：在最近的位置插入锚点
      const near = nearestOnPath(path, p);
      if (near && near.d * i.zoom <= 8) {
        const { layer, index } = insertAnchor(path, near.seg, near.t);
        setLayers(layersOf().map(x => (x.id === path.id ? layer : x)));
        anchorSel = [index];
        return true;
      }
    }
    if (tool !== 'select' && tool !== 'direct') return false;
    const hit = layerAt(p);
    if (!hit) return false;
    if (hit.type === 'text') { startEdit(hit.id); return true; }
    if (hit.type === 'path') { select([hit.id]); setTool('direct'); return true; }
    return true;
  }

  /* ---------------- 键盘 ---------------- */

  function keydown(e) {
    const tool = getTool();
    const mod = e.metaKey || e.ctrlKey;
    if (pen && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); finishPen(); return true; }
    if (pen && e.key === 'Backspace') {
      e.preventDefault();
      const l = byId(pen.id);
      if (l) setLayers(layersOf().map(x => (x.id === l.id ? syncPathBox({ ...x, anchors: x.anchors.slice(0, -1) }) : x)));
      return true;
    }
    if (tool === 'direct' && anchorSel.length && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      const l = editPath();
      if (!l) return false;
      const anchors = l.anchors.filter((_, k) => !anchorSel.includes(k));
      anchorSel = [];
      setLayers(anchors.length < 2 ? layersOf().filter(x => x.id !== l.id) : layersOf().map(x => (x.id === l.id ? syncPathBox({ ...x, anchors, closed: x.closed && anchors.length > 2 }) : x)));
      if (anchors.length < 2) clear();
      return true;
    }
    if (!ui.layerSel.length || tool === 'artboard') return false;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      setLayers(layersOf().filter(l => !ui.layerSel.includes(l.id) || l.locked));
      clear();
      return true;
    }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return true; }
    // ⌘] / ⌘[ 上移 / 下移一层，加 Shift 置顶 / 置底（按物理键判断，Shift 时 e.key 会变成 } {）
    if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft')) { e.preventDefault(); reorder(e.code === 'BracketRight' ? 1 : -1, e.shiftKey); return true; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && !mod) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const [ax, ay] = arrows[e.key];
      setLayers(layersOf().map(l => (ui.layerSel.includes(l.id) && !l.locked ? moveLayer(l, ax * step, ay * step) : l)));
      return !getCardSelection().length; // 同时选中卡片时，卡片也继续响应方向键
    }
    return false;
  }

  // ⌘D：复制选中的图层（略微错开），并选中副本
  function duplicate() {
    const list = layersOf();
    const copies = selected().map(l => ({ ...moveLayer(JSON.parse(JSON.stringify(l)), 20, 20), id: `${l.id}_${Math.random().toString(36).slice(2, 6)}`, name: `${l.name} 副本` }));
    setLayers([...list, ...copies]);
    select(copies.map(c => c.id));
  }

  // 上移 / 下移一层（toEnd：置顶 / 置底）
  function reorder(dir, toEnd = false) {
    let list = [...layersOf()];
    const ids = new Set(ui.layerSel);
    if (toEnd) {
      const sel = list.filter(l => ids.has(l.id)), rest = list.filter(l => !ids.has(l.id));
      list = dir > 0 ? [...rest, ...sel] : [...sel, ...rest];
    } else {
      const idx = list.map((l, k) => (ids.has(l.id) ? k : -1)).filter(k => k >= 0);
      for (const k of dir > 0 ? idx.reverse() : idx) {
        const j = k + dir;
        if (j < 0 || j >= list.length || ids.has(list[j].id)) continue;
        [list[k], list[j]] = [list[j], list[k]];
      }
    }
    setLayers(list);
  }

  /* ---------------- 悬停 / 光标 ---------------- */

  function hover(e, tool, board) {
    lastPointer = e;
    if (pen) { pen.cursor = toBoard(local(e)); ws.scheduleRender(); }
    if (['rect', 'ellipse'].includes(tool)) return 'crosshair';
    if (tool === 'text') return 'text';
    if (tool === 'pen') {
      const l = pen && byId(pen.id);
      if (l && l.anchors.length >= 2) {
        const [fx, fy] = toScreen(l.anchors[0]);
        const [lx, ly] = local(e);
        if (Math.hypot(lx - fx, ly - fy) <= 8) return 'pointer'; // 闭合
      }
      return 'crosshair';
    }
    if (tool !== 'select' && tool !== 'direct') { if (ui.layerHover) setUi('layerHover', null); return null; }
    const [lx, ly] = local(e);
    if (tool === 'select' && board === S().activeBoard) {
      const h = handleAt(lx, ly);
      if (h) { setUi('layerHover', null); return h.kind === 'rotate' ? ROTATE_CURSOR : resizeCursor(h.key, h.fs.f.rotation); }
    }
    if (tool === 'direct') {
      const path = editPath();
      if (path && anchorPartAt(path, lx, ly)) return 'default';
    }
    const hit = board === S().activeBoard && info() ? layerAt(toBoard([lx, ly])) : null;
    setUi('layerHover', hit ? hit.id : null);
    return hit ? (tool === 'direct' ? 'default' : 'move') : null;
  }

  /* ---------------- 选框 ---------------- */

  // 与屏幕矩形相交的图层
  function inRect(r) {
    const box = { l: r.x, t: r.y, r: r.x + r.w, b: r.y + r.h };
    return layersOf().filter(l => !l.hidden && !l.locked && intersects(screenRect(l), box)).map(l => l.id);
  }

  /* ---------------- 叠加层：选框、手柄、锚点、钢笔预览 ---------------- */

  function drawOverlay(g, d) {
    const i = info();
    if (!i) return;
    const tool = getTool();
    const P = p => toScreen(p, i).map(v => v * d);
    g.save();
    g.lineWidth = d;
    const outline = l => {
      g.beginPath();
      if (l.type === 'path') {
        g.save();
        g.setTransform(i.zoom * d, 0, 0, i.zoom * d, i.sx * d, i.sy * d);
        g.lineWidth = 1 / i.zoom;
        g.strokeStyle = ACCENT;
        g.stroke(pathOf(l));
        g.restore();
        return;
      }
      corners(l).map(P).forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.strokeStyle = ACCENT;
      g.stroke();
    };
    // 悬停
    const hov = ui.layerHover && byId(ui.layerHover);
    if (hov && !ui.layerSel.includes(hov.id) && ['select', 'direct'].includes(tool)) outline(hov);
    // 选中
    const sel = selected();
    sel.forEach(outline);
    const path = tool === 'direct' ? editPath() : null;
    if (path) {
      // 锚点和控制柄
      path.anchors.forEach((a, k) => {
        const [ax, ay] = P(a);
        for (const part of ['hi', 'ho']) {
          if (!a[part]) continue;
          const [hx, hy] = P(a[part]);
          g.strokeStyle = ACCENT;
          g.beginPath(); g.moveTo(ax, ay); g.lineTo(hx, hy); g.stroke();
          g.beginPath(); g.arc(hx, hy, 3.5 * d, 0, Math.PI * 2);
          g.fillStyle = '#fff'; g.fill(); g.stroke();
        }
        const s = 4 * d;
        g.fillStyle = anchorSel.includes(k) ? ACCENT : '#fff';
        g.strokeStyle = ACCENT;
        g.fillRect(ax - s, ay - s, 2 * s, 2 * s);
        g.strokeRect(ax - s, ay - s, 2 * s, 2 * s);
      });
    } else if (tool === 'select' && sel.length && !editing) {
      const fs = frameScreen();
      if (fs) {
        if (sel.length > 1 || fs.list[0].type === 'path') {
          const pts = ['nw', 'ne', 'se', 'sw'].map(k => P(fs.handles[k]));
          g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
          g.strokeStyle = ACCENT; g.stroke();
        }
        for (const p of Object.values(fs.handles)) {
          const [x, y] = P(p), s = HANDLE * d * 0.8;
          g.fillStyle = '#fff'; g.strokeStyle = ACCENT;
          g.fillRect(x - s, y - s, 2 * s, 2 * s);
          g.strokeRect(x - s, y - s, 2 * s, 2 * s);
        }
      }
    }
    // 钢笔：从最后一个锚点到鼠标的预览线
    const pl = pen && byId(pen.id);
    if (pl && tool === 'pen') {
      pl.anchors.forEach((a, k) => {
        const [ax, ay] = P(a), s = (k === 0 ? 4.5 : 3.5) * d;
        g.fillStyle = k === 0 ? ACCENT : '#fff'; g.strokeStyle = ACCENT;
        g.fillRect(ax - s, ay - s, 2 * s, 2 * s); g.strokeRect(ax - s, ay - s, 2 * s, 2 * s);
      });
      const last = pl.anchors[pl.anchors.length - 1];
      if (last && pen.cursor) {
        const [ax, ay] = P(last), [cx, cy] = P(pen.cursor);
        g.setLineDash([4 * d, 4 * d]);
        g.strokeStyle = ACCENT;
        g.beginPath(); g.moveTo(ax, ay);
        if (last.ho) { const [hx, hy] = P(last.ho); g.quadraticCurveTo(hx, hy, cx, cy); } else g.lineTo(cx, cy);
        g.stroke();
      }
    }
    g.restore();
  }

  // 切换工具：结束钢笔绘制；离开直接选择时清掉锚点选择
  function onToolChange(tool) {
    if (tool !== 'pen') finishPen();
    if (tool !== 'direct') anchorSel = [];
    if (!['select', 'direct', ...LAYER_TOOLS].includes(tool) && tool !== 'crop') clear();
    ws.scheduleRender();
  }

  // 切换画板 / 项目、撤销后，选中的图层可能不存在了
  function prune() {
    const ids = new Set(layersOf().map(l => l.id));
    if (ui.layerSel.some(id => !ids.has(id))) select(ui.layerSel.filter(id => ids.has(id)));
    if (pen && !ids.has(pen.id)) pen = null;
    if (editing && !ids.has(editing.id)) finishEdit();
  }

  return {
    pointerDown, dblclick, keydown, hover, inRect, beginMove, selectionRect, rects, drawOverlay,
    // 屏幕坐标下当前画板最上层的图层（右键菜单用）
    layerAtClient: (x, y) => (info() ? layerAt(toBoard(local({ clientX: x, clientY: y }))) : null),
    remove: ids => { setLayers(layersOf().filter(l => !ids.includes(l.id))); select(ui.layerSel.filter(id => !ids.includes(id))); },
    select, clear, prune, onToolChange, syncEditor, startEdit, duplicate, reorder,
    // 全选当前画板的图层，返回选中的数量
    selectAll: () => { const ids = layersOf().filter(l => !l.hidden && !l.locked).map(l => l.id); select(ids); return ids.length; },
    editingId: () => editing?.id || null,
    isBusy: () => !!pen || !!editing,
  };
}

const ROTATE_CURSOR = iconCursor('rotate-cw', 'crosshair');
export { FONTS };
