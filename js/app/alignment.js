import { store, actions } from '../state.js';
import { unionRects, alignOffsets, distributeOffsets } from '../workspace/snap.js';
import { icon } from '../ui/icons.js';
import { getAdjust, is3D } from './boards.js';
import { ui } from './uiState.js';

/**
 * 对齐 / 分布（工具条上选中卡片或图层时出现）、吸附开关和吸附时的粉色参考线。
 * 卡片和图层可以一起对齐：多选时在选中的对象之间对齐，只选一个时对齐到画板。
 * layers（可选）：{ selectedRects() → [{ id, rect }], offsetLayers([{ id, dx, dy }]) → 新图层列表 }
 */
const ALIGN = [
  { mode: 'left', icon: 'align-start-vertical', label: '左对齐' },
  { mode: 'hcenter', icon: 'align-center-vertical', label: '水平居中' },
  { mode: 'right', icon: 'align-end-vertical', label: '右对齐' },
  { mode: 'top', icon: 'align-start-horizontal', label: '顶对齐' },
  { mode: 'vcenter', icon: 'align-center-horizontal', label: '垂直居中' },
  { mode: 'bottom', icon: 'align-end-horizontal', label: '底对齐' },
];
const DISTRIBUTE = [
  { axis: 'x', icon: 'align-horizontal-distribute-center', label: '水平等距分布' },
  { axis: 'y', icon: 'align-vertical-distribute-center', label: '垂直等距分布' },
];

const button = (cls, ic, title, onClick) => {
  const b = Object.assign(document.createElement('button'), { className: cls, title });
  b.append(icon(ic, 16));
  b.addEventListener('click', onClick);
  return b;
};

export function createAlignment({ ws, viewport, alignSlot, snapSlot, layers = () => null }) {
  /* ---------- 参考线 ---------- */
  const guideLayer = Object.assign(document.createElement('div'), { className: 'guide-layer' });
  viewport.append(guideLayer);
  function setGuides(list) {
    guideLayer.replaceChildren(...(list || []).map(g => {
      const d = document.createElement('div');
      d.className = 'guide';
      if (g.x != null) Object.assign(d.style, { left: `${g.x}px`, top: `${g.y1}px`, width: '1px', height: `${Math.max(1, g.y2 - g.y1)}px` });
      else Object.assign(d.style, { top: `${g.y}px`, left: `${g.x1}px`, height: '1px', width: `${Math.max(1, g.x2 - g.x1)}px` });
      return d;
    }));
  }

  /* ---------- 对齐 / 分布 ---------- */
  // 选中的卡片（平面版式）和图层：[{ o | id, r }]
  const selectedRects = () => {
    const map = new Map(ws.itemRects().map(x => [x.order, x.rect]));
    const cards = is3D() ? [] : ui.selection.filter(o => map.has(o)).map(o => ({ o, r: map.get(o) }));
    const ls = (layers()?.selectedRects() || []).map(x => ({ id: x.id, r: x.rect }));
    return [...cards, ...ls];
  };
  // 屏幕上的位移 → 卡片的手动调整 / 图层的位置，一起提交（一步撤销）
  function applyOffsets(items, offsets) {
    const adjusts = [], moves = [];
    items.forEach((it, i) => {
      if (it.id) { moves.push({ id: it.id, dx: offsets[i][0], dy: offsets[i][1] }); return; }
      const [lx, ly] = ws.toLayoutDelta(offsets[i][0], offsets[i][1]);
      const a = getAdjust(it.o);
      adjusts.push({ order: it.o, patch: { dx: (a.dx || 0) + lx, dy: (a.dy || 0) + ly } });
    });
    actions.applyEdits({ adjusts, layers: moves.length ? layers().offsetLayers(moves) : null });
  }
  function alignSelection(mode) {
    const items = selectedRects();
    if (!items.length) return;
    const ref = items.length > 1 ? unionRects(items.map(x => x.r)) : ws.boardLocalRect(store.get().activeBoard);
    applyOffsets(items, alignOffsets(items.map(x => x.r), ref, mode));
  }
  function distributeSelection(axis) {
    const items = selectedRects();
    if (items.length < 3) return;
    applyOffsets(items, distributeOffsets(items.map(x => x.r), axis));
  }

  const alignButtons = ALIGN.map(a => ({ ...a, b: button('tb-btn', a.icon, a.label, () => alignSelection(a.mode)) }));
  const distButtons = DISTRIBUTE.map(d => ({ ...d, b: button('tb-btn', d.icon, `${d.label}（选中 3 张以上）`, () => distributeSelection(d.axis)) }));
  alignSlot.append(...alignButtons.map(x => x.b), Object.assign(document.createElement('span'), { className: 'tb-sep' }), ...distButtons.map(x => x.b));

  function refreshAlign() {
    const n = (is3D() ? 0 : ui.selection.length) + ui.layerSel.length;
    alignSlot.hidden = !n;
    for (const a of alignButtons) a.b.title = n > 1 ? `${a.label}（选中的 ${n} 个对象）` : `${a.label}到画板`;
    for (const d of distButtons) { d.b.disabled = n < 3; d.b.classList.toggle('disabled', n < 3); }
  }

  /* ---------- 吸附开关 ---------- */
  const snapBtn = button('tb-btn tb-snap', 'magnet', '', () => actions.setPref('snap', !store.get().snap));
  snapSlot.append(snapBtn);
  function refreshSnap() {
    const on = store.get().snap;
    snapBtn.classList.toggle('active-soft', on);
    snapBtn.title = on ? '吸附对齐：开（拖动时按住 ⌘/Ctrl 临时关闭）' : '吸附对齐：关';
  }

  refreshAlign();
  refreshSnap();
  return { setGuides, alignSelection, distributeSelection, refreshAlign, refreshSnap };
}
