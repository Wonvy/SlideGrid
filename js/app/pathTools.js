import { createLayer, contoursOf, withContours, updateContour, insertAnchor, nearestOnPath } from '../layers/model.js';
import { tr } from '../i18n/i18n.js';

/**
 * 钢笔（P）与直接选择（A），操作方式参照 Illustrator。
 *
 * 钢笔：
 *   单击                 直角锚点
 *   按住拖动              平滑锚点，拉出对称的控制柄
 *     + Shift            锚点 / 控制柄方向按 45° 约束
 *     + ⌥                打断：只调离开的一侧控制柄（转角）
 *     + 空格             移动正在放置的锚点
 *   点最后一个锚点        去掉它离开的控制柄，下一段从直角开始；按住拖动 = 单独拉出新的离开控制柄
 *   点第一个锚点          闭合路径（按住拖动调整起点的控制柄，⌥ 只调进入的一侧）
 *   ⌘ / Ctrl            临时切到直接选择：拖锚点 / 控制柄
 *   Enter / Esc          结束；Backspace 删除上一个锚点
 *   没在画时，对选中的路径：点线段 = 添加锚点，点锚点 = 删除锚点，点开放路径的端点 = 从那里继续画
 *
 * 直接选择：
 *   点锚点选中（Shift 加选），拖动移动所选锚点；选中锚点后显示它的控制柄
 *   拖控制柄：另一侧对称（⌥ 打断），Shift 按 45° 约束
 *   ⌥ 单击锚点：直角 ↔ 平滑；双击路径：插入锚点；Delete 删除所选锚点；方向键微调锚点
 *
 * 路径可以有多个子路径（粘贴 SVG 得到的复合路径），锚点地址为 { c, i }。
 */
const ACCENT = '#7c8cff';
const HINTS = { close: '闭合路径', convert: '转为直角', add: '添加锚点', remove: '删除锚点', resume: '继续绘制' };
const key = (c, i) => `${c}:${i}`;

export function createPathTools(api) {
  const { layersOf, byId, select, setLayers, info, local, toBoard, toScreen, editPath, setTool, moveHandler, layerAt, setCardSelection, clear, scheduleRender } = api;

  let pen = null;           // 正在绘制：{ id, c }
  let cursor = null;        // 钢笔预览：{ p（画板坐标）, screen, hint }
  let anchorSel = [];       // 直接选择：选中的锚点 'c:i'
  let space = false;        // 空格（钢笔拖动时移动锚点）

  window.addEventListener('keydown', e => { if (e.code === 'Space') space = true; });
  window.addEventListener('keyup', e => { if (e.code === 'Space') space = false; });
  window.addEventListener('blur', () => { space = false; });

  const patch = (id, fn) => setLayers(layersOf().map(x => (x.id === id ? fn(x) : x)));
  const anchorsOf = (l, c) => contoursOf(l)[c]?.anchors || [];
  const nearScreen = (pt, lx, ly, r = 8) => { const [x, y] = toScreen(pt); return Math.hypot(lx - x, ly - y) <= r; };
  const mirror = (a, q) => ({ x: 2 * a.x - q.x, y: 2 * a.y - q.y });

  // Shift：以 a 为原点，把 q 的方向约束到 45° 的倍数（长度取投影）
  function snap45(a, q) {
    const dx = q.x - a.x, dy = q.y - a.y;
    const ang = Math.atan2(dy, dx), snapped = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy) * Math.cos(ang - snapped);
    return { x: a.x + Math.cos(snapped) * len, y: a.y + Math.sin(snapped) * len };
  }

  // 修改某个锚点
  const setAnchor = (l, c, i, fn) => updateContour(l, c, k => ({ ...k, anchors: k.anchors.map((a, j) => (j === i ? fn(a) : a)) }));

  // 屏幕点 → 锚点（只认锚点）
  function anchorAt(l, lx, ly) {
    const cs = contoursOf(l);
    for (let c = cs.length - 1; c >= 0; c--) {
      for (let i = cs[c].anchors.length - 1; i >= 0; i--) if (nearScreen(cs[c].anchors[i], lx, ly, 7)) return { c, i };
    }
    return null;
  }
  // 屏幕点 → 选中锚点的控制柄，或锚点：{ c, i, part }
  function partAt(l, lx, ly) {
    const cs = contoursOf(l);
    for (const s of anchorSel) {
      const [c, i] = s.split(':').map(Number);
      const a = cs[c]?.anchors[i];
      if (!a) continue;
      for (const part of ['hi', 'ho']) if (a[part] && nearScreen(a[part], lx, ly, 6)) return { c, i, part };
    }
    const hit = anchorAt(l, lx, ly);
    return hit && { ...hit, part: 'anchor' };
  }

  // 删除锚点：子路径不足 2 个锚点时去掉这个子路径，没有子路径时删除整个图层
  function removeAnchors(l, keys) {
    const contours = contoursOf(l)
      .map((k, c) => {
        const anchors = k.anchors.filter((_, i) => !keys.includes(key(c, i)));
        return { anchors, closed: k.closed && anchors.length > 2 };
      })
      .filter(k => k.anchors.length >= 2);
    if (!contours.length) { setLayers(layersOf().filter(x => x.id !== l.id)); clear(); return; }
    patch(l.id, x => withContours(x, contours));
  }

  /* ---------------- 钢笔 ---------------- */

  function finishPen() {
    if (!pen) return;
    const l = byId(pen.id);
    pen = null;
    if (l && anchorsOf(l, 0).length < 2 && contoursOf(l).length <= 1) { setLayers(layersOf().filter(x => x.id !== l.id)); clear(); }
    else if (l) select([l.id]);
    scheduleRender();
  }

  // 没在画时，钢笔放在选中路径上能做什么：{ hint, ... }
  function penTarget(lx, ly) {
    const path = editPath();
    if (!path) return null;
    const hit = anchorAt(path, lx, ly);
    if (hit) {
      const k = contoursOf(path)[hit.c];
      const end = !k.closed && (hit.i === 0 || hit.i === k.anchors.length - 1);
      return { hint: end ? 'resume' : 'remove', path, hit };
    }
    const near = nearestOnPath(path, toBoard([lx, ly]));
    if (near && near.d * info().zoom <= 6) return { hint: 'add', path, near };
    return null;
  }

  // 正在画时，钢笔放在第一个 / 最后一个锚点上
  function drawTarget(lx, ly) {
    const l = pen && byId(pen.id);
    if (!l) return null;
    const a = anchorsOf(l, pen.c);
    if (a.length >= 2 && nearScreen(a[0], lx, ly)) return { hint: 'close', l, a };
    if (a.length && nearScreen(a[a.length - 1], lx, ly)) return { hint: 'convert', l, a };
    return { hint: null, l, a };
  }

  function penDown(e) {
    const [lx, ly] = local(e);
    // ⌘ / Ctrl：临时直接选择
    if (e.metaKey || e.ctrlKey) {
      const cur = pen && byId(pen.id);
      if (cur) select([cur.id]);
      return directDown(e);
    }
    let p = toBoard([lx, ly]);

    if (!pen) {
      const t = penTarget(lx, ly);
      if (t?.hint === 'resume') {
        // 从开放路径的端点继续画：起点时先把子路径反过来，统一往末尾加
        const { path, hit } = t;
        if (hit.i === 0 && anchorsOf(path, hit.c).length > 1) {
          patch(path.id, x => updateContour(x, hit.c, k => ({ ...k, anchors: [...k.anchors].reverse().map(a => ({ ...a, hi: a.ho, ho: a.hi })) })));
        }
        pen = { id: path.id, c: hit.c };
        return true;
      }
      if (t?.hint === 'remove') { removeAnchors(t.path, [key(t.hit.c, t.hit.i)]); return true; }
      if (t?.hint === 'add') {
        const { layer, at } = insertAnchor(t.path, t.near.seg, t.near.t);
        patch(t.path.id, () => layer);
        anchorSel = [key(at.c, at.i)];
        return true;
      }
    }

    const d = drawTarget(lx, ly);
    if (d?.hint === 'convert') {
      // 点最后一个锚点：去掉离开的控制柄；拖动：单独拉出新的离开控制柄
      const { l, a } = d, c = pen.c, i = a.length - 1, last = a[i];
      patch(l.id, x => setAnchor(x, c, i, v => ({ ...v, ho: null })));
      return {
        move(ev) {
          let q = toBoard(local(ev));
          if (ev.shiftKey) q = snap45(last, q);
          patch(l.id, x => setAnchor(x, c, i, v => ({ ...v, ho: q })));
        },
      };
    }
    if (d?.hint === 'close') {
      // 闭合；拖动调整起点的控制柄
      const { l, a } = d, c = pen.c, first = a[0];
      patch(l.id, x => {
        const closed = updateContour(x, c, k => ({ ...k, closed: true }));
        // 第一次闭合时给个半透明填充，方便看出是封闭形状
        return x.fillType === 'none' && contoursOf(x).length === 1 ? { ...closed, fillType: 'solid', fillAlpha: 0.35 } : closed;
      });
      const id = l.id;
      return {
        move(ev) {
          let q = toBoard(local(ev));
          if (ev.shiftKey) q = snap45(first, q);
          patch(id, x => setAnchor(x, c, 0, v => (ev.altKey ? { ...v, hi: mirror(v, q) } : { ...v, ho: q, hi: mirror(v, q) })));
        },
        up() { finishPen(); },
      };
    }

    // 加一个锚点
    let l = d?.l;
    if (d?.a.length && e.shiftKey) p = snap45(d.a[d.a.length - 1], p);
    if (!l) {
      l = createLayer('path', { contours: [{ anchors: [], closed: false }] }, layersOf());
      setLayers([...layersOf(), l]);
      pen = { id: l.id, c: 0 };
      setCardSelection([]);
    }
    const id = l.id, c = pen.c;
    const index = anchorsOf(byId(id), c).length;
    patch(id, x => updateContour(x, c, k => ({ ...k, anchors: [...k.anchors, { x: p.x, y: p.y, hi: null, ho: null }] })));
    select([id]);

    let broken = false, prev = null;
    return {
      move(ev) {
        let q = toBoard(local(ev));
        const cur = anchorsOf(byId(id), c)[index];
        if (!cur) return;
        if (space) {
          // 空格：移动正在放置的锚点（控制柄一起）
          if (prev) {
            const dx = q.x - prev.x, dy = q.y - prev.y;
            const mv = h => (h ? { x: h.x + dx, y: h.y + dy } : h);
            patch(id, x => setAnchor(x, c, index, v => ({ x: v.x + dx, y: v.y + dy, hi: mv(v.hi), ho: mv(v.ho) })));
          }
          prev = q;
          return;
        }
        prev = q;
        if (ev.shiftKey) q = snap45(cur, q);
        if (ev.altKey) broken = true; // ⌥：之后只动离开的控制柄
        patch(id, x => setAnchor(x, c, index, v => ({ ...v, ho: q, hi: broken ? v.hi : mirror(v, q) })));
      },
    };
  }

  /* ---------------- 直接选择 ---------------- */

  function directDown(e) {
    const [lx, ly] = local(e);
    const path = editPath();
    const hit = path && partAt(path, lx, ly);
    if (hit && hit.part === 'anchor') {
      const k = key(hit.c, hit.i);
      if (e.altKey) {
        // ⌥ 单击：直角 ↔ 平滑
        const a = anchorsOf(path, hit.c);
        const v = a[hit.i], n = a.length;
        const prevA = a[(hit.i - 1 + n) % n], nextA = a[(hit.i + 1) % n];
        const smooth = !(v.hi || v.ho);
        const dx = (nextA.x - prevA.x) / 6, dy = (nextA.y - prevA.y) / 6;
        patch(path.id, x => setAnchor(x, hit.c, hit.i, u => (smooth ? { ...u, hi: { x: u.x - dx, y: u.y - dy }, ho: { x: u.x + dx, y: u.y + dy } } : { ...u, hi: null, ho: null })));
        anchorSel = [k];
        return true;
      }
      if (e.shiftKey) {
        anchorSel = anchorSel.includes(k) ? anchorSel.filter(s => s !== k) : [...anchorSel, k];
        scheduleRender();
        return true;
      }
      if (!anchorSel.includes(k)) anchorSel = [k];
      // 拖动选中的锚点（控制柄跟着走）
      const start = path;
      const z = info().zoom;
      const sel = anchorSel.map(s => s.split(':').map(Number));
      return {
        move(ev, dx, dy) {
          const mx = dx / z, my = dy / z;
          const mv = q => (q ? { x: q.x + mx, y: q.y + my } : q);
          let next = start;
          for (const [c, i] of sel) next = setAnchor(next, c, i, a => ({ x: a.x + mx, y: a.y + my, hi: mv(a.hi), ho: mv(a.ho) }));
          patch(start.id, () => next);
        },
      };
    }
    if (hit) {
      // 控制柄：另一侧对称（⌥ 打断），Shift 45°
      const other = hit.part === 'hi' ? 'ho' : 'hi';
      return {
        move(ev) {
          patch(path.id, x => setAnchor(x, hit.c, hit.i, a => {
            let q = toBoard(local(ev));
            if (ev.shiftKey) q = snap45(a, q);
            const out = { ...a, [hit.part]: q };
            if (!ev.altKey && a[other]) {
              const len = Math.hypot(a[other].x - a.x, a[other].y - a.y);
              const dd = Math.hypot(q.x - a.x, q.y - a.y) || 1;
              out[other] = { x: a.x - ((q.x - a.x) / dd) * len, y: a.y - ((q.y - a.y) / dd) * len };
            }
            return out;
          }));
        },
      };
    }
    // 点到图层：选中它（路径显示锚点），拖动 = 移动
    const l = layerAt(toBoard([lx, ly]));
    if (l) {
      if (!api.isSelected(l.id)) { select([l.id]); setCardSelection([]); }
      anchorSel = [];
      return moveHandler(e);
    }
    clear();
    return true;
  }

  // 双击路径：插入锚点
  function dblclick(e) {
    const path = editPath();
    if (!path) return false;
    const [lx, ly] = local(e);
    const near = nearestOnPath(path, toBoard([lx, ly]));
    if (!near || near.d * info().zoom > 8) return false;
    const { layer, at } = insertAnchor(path, near.seg, near.t);
    patch(path.id, () => layer);
    anchorSel = [key(at.c, at.i)];
    return true;
  }

  /* ---------------- 键盘 ---------------- */

  function keydown(e, tool) {
    if (pen && (e.key === 'Enter' || e.key === 'Escape')) { e.preventDefault(); finishPen(); return true; }
    if (pen && e.key === 'Backspace') {
      e.preventDefault();
      const l = byId(pen.id);
      if (l) patch(l.id, x => updateContour(x, pen.c, k => ({ ...k, anchors: k.anchors.slice(0, -1) })));
      return true;
    }
    if (tool !== 'direct' || !anchorSel.length) return false;
    const l = editPath();
    if (!l) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeAnchors(l, anchorSel);
      anchorSel = [];
      return true;
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && !(e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const [ax, ay] = arrows[e.key].map(v => v * (e.shiftKey ? 10 : 1));
      const mv = q => (q ? { x: q.x + ax, y: q.y + ay } : q);
      let next = l;
      for (const s of anchorSel) {
        const [c, i] = s.split(':').map(Number);
        next = setAnchor(next, c, i, a => ({ x: a.x + ax, y: a.y + ay, hi: mv(a.hi), ho: mv(a.ho) }));
      }
      patch(l.id, () => next);
      return true;
    }
    return false;
  }

  /* ---------------- 悬停 ---------------- */

  function hover(e, tool) {
    const [lx, ly] = local(e);
    if (tool === 'pen') {
      let p = toBoard([lx, ly]);
      const d = pen ? drawTarget(lx, ly) : null;
      const hint = pen ? d?.hint : penTarget(lx, ly)?.hint;
      if (pen && !hint && e.shiftKey && d?.a.length) p = snap45(d.a[d.a.length - 1], p);
      cursor = { p, screen: [lx, ly], hint: hint || null };
      scheduleRender();
      return 'crosshair';
    }
    if (tool === 'direct') {
      const path = editPath();
      if (path && partAt(path, lx, ly)) return 'default';
    }
    return null;
  }

  /* ---------------- 叠加层 ---------------- */

  function drawAnchors(g, d, P, l, { handles }) {
    contoursOf(l).forEach((k, c) => {
      k.anchors.forEach((a, i) => {
        const sel = anchorSel.includes(key(c, i));
        const [ax, ay] = P(a);
        if (handles(c, i, sel)) {
          for (const part of ['hi', 'ho']) {
            if (!a[part]) continue;
            const [hx, hy] = P(a[part]);
            g.strokeStyle = ACCENT;
            g.beginPath(); g.moveTo(ax, ay); g.lineTo(hx, hy); g.stroke();
            g.beginPath(); g.arc(hx, hy, 3.5 * d, 0, Math.PI * 2);
            g.fillStyle = '#fff'; g.fill(); g.stroke();
          }
        }
        const s = 3.5 * d;
        g.fillStyle = sel ? ACCENT : '#fff';
        g.strokeStyle = ACCENT;
        g.fillRect(ax - s, ay - s, 2 * s, 2 * s);
        g.strokeRect(ax - s, ay - s, 2 * s, 2 * s);
      });
    });
  }

  function drawOverlay(g, d, P, tool) {
    const path = editPath();
    if (tool === 'direct' && path) drawAnchors(g, d, P, path, { handles: (c, i, sel) => sel });
    if (tool !== 'pen') return;
    const l = pen && byId(pen.id);
    if (!l && path) drawAnchors(g, d, P, path, { handles: () => false }); // 钢笔：显示选中路径的锚点（可加 / 删 / 继续）
    if (l) {
      const a = anchorsOf(l, pen.c);
      drawAnchors(g, d, P, l, { handles: (c, i) => c === pen.c && i === a.length - 1 });
      // 第一个锚点稍大，提示可以闭合
      if (a[0]) {
        const [fx, fy] = P(a[0]), s = 5 * d;
        g.strokeStyle = ACCENT;
        g.strokeRect(fx - s, fy - s, 2 * s, 2 * s);
      }
      // 从最后一个锚点到鼠标的预览（按离开的控制柄弯曲）
      const last = a[a.length - 1];
      if (last && cursor && !cursor.hint) {
        const [ax, ay] = P(last), [cx, cy] = P(cursor.p);
        const [hx, hy] = P(last.ho || last);
        g.save();
        g.setLineDash([4 * d, 4 * d]);
        g.strokeStyle = ACCENT;
        g.beginPath(); g.moveTo(ax, ay); g.bezierCurveTo(hx, hy, cx, cy, cx, cy); g.stroke();
        g.restore();
      }
    }
    // 光标旁的提示（闭合 / 转为直角 / 添加锚点…）
    if (cursor?.hint) {
      const text = tr(HINTS[cursor.hint]);
      g.save();
      g.font = `${12 * d}px -apple-system, "PingFang SC", system-ui, sans-serif`;
      const w = g.measureText(text).width + 12 * d, h = 20 * d;
      const x = (cursor.screen[0] + 14) * d, y = (cursor.screen[1] + 14) * d;
      g.fillStyle = 'rgba(14, 16, 20, .9)';
      g.beginPath(); g.roundRect(x, y, w, h, 5 * d); g.fill();
      g.fillStyle = '#fff';
      g.textBaseline = 'middle';
      g.fillText(text, x + 6 * d, y + h / 2);
      g.restore();
    }
  }

  return {
    penDown, directDown, dblclick, keydown, hover, drawOverlay, finishPen,
    isDrawing: () => !!pen,
    drawingId: () => pen?.id || null,
    resetAnchors: () => { anchorSel = []; },
    // 切换工具 / 撤销后：正在画的路径不存在了就结束
    prune: ids => { if (pen && !ids.has(pen.id)) pen = null; },
    leave: () => { cursor = null; },
  };
}
