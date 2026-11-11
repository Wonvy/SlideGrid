import { fitFolds } from './fold.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { attachWheel } from './wheel.js';
import { clamp } from '../core/utils.js';

// 工作区：左侧竖排的工具栏（工具切换，快捷键参照 Illustrator）+ 顶部浮动工具条（背景、遮罩、吸附、对齐、视图缩放、重置卡片）
export const TOOLS = [
  { id: 'select', icon: 'mouse-pointer-2', label: '选择', key: 'V', desc: '点选卡片 / 图层，拖动移动，拖四个角缩放，拖角外侧旋转（Shift 锁定方向 / 15° 吸附，方向键微调）' },
  { id: 'crop', icon: 'crop', label: '裁切', key: 'C', desc: '调整卡片里显示图片的哪一部分：拖动平移图片，滚轮放大缩小，双击复位（平面和 3D 版式都可用）' },
  { id: 'swap', icon: 'arrow-left-right', label: '交换', key: 'X', desc: '把卡片拖到另一张上交换图片' },
  { id: 'orbit', icon: 'rotate-3d', label: '构图', key: 'O', desc: '调整画板内的构图（会导出）：3D 拖动旋转 / Shift+拖动平移，平面拖动平移，滚轮缩放' },
  { sep: true },
  { id: 'text', icon: 'type', label: '文字', key: 'T', desc: '单击添加点状文字，拖动创建区块文字（按框宽自动换行）；选择工具下双击文字可编辑' },
  { id: 'rect', icon: 'square', label: '矩形', key: 'M', desc: '拖动绘制矩形（Shift 正方形，⌥ 从中心），单击放一个默认大小的' },
  { id: 'ellipse', icon: 'circle', label: '椭圆', key: 'L', desc: '拖动绘制椭圆（Shift 正圆，⌥ 从中心）' },
  { id: 'line', icon: 'slash', label: '直线', key: '\\', desc: '拖动绘制直线（Shift 按 45° 吸附，⌥ 从中心），单击放一条默认长度的；画好后可以用直接选择工具拖端点' },
  { id: 'pen', icon: 'pen-tool', label: '钢笔', key: 'P', desc: '单击直角锚点，拖动拉出曲线（Shift 45°，⌥ 转角，空格移动锚点）；点首点闭合，Enter 结束；对选中路径：点线段加锚点、点锚点删除、点端点继续画' },
  { id: 'direct', icon: 'mouse-pointer', label: '直接选择', key: 'A', desc: '编辑路径锚点：拖锚点 / 控制柄（⌥ 打断对称），⌥ 单击切换直角 / 平滑，双击路径插入锚点，Delete 删除锚点' },
  { sep: true },
  { id: 'hand', icon: 'hand', label: '抓手', key: 'H', desc: '平移视图（任何工具下按住空格或中键也可以）' },
  { id: 'zoom', icon: 'search', label: '放大镜', key: 'Z', desc: '单击放大视图，按住 ⌥ 单击缩小（Ctrl/⌘ + 滚轮也可以）' },
  { id: 'artboard', icon: 'frame', label: '画板', key: '⇧O', desc: '点击切换画板，拖动移动画板位置（按住 ⌥ 拖动 = 复制），⌘D 复制，Delete 删除画板' },
];

function makeToolstripDraggable(root, stage, tools, handle) {
  const inset = 12;
  let offset = null;
  let grab = null;

  function position(x, y) {
    const bounds = stage.getBoundingClientRect();
    const origin = root.getBoundingClientRect();
    offset = {
      x: clamp(x, inset, Math.max(inset, bounds.width - tools.offsetWidth - inset)),
      y: clamp(y, inset, Math.max(inset, bounds.height - tools.offsetHeight - inset)),
    };
    tools.style.left = `${bounds.left - origin.left + offset.x}px`;
    tools.style.top = `${bounds.top - origin.top + offset.y}px`;
  }

  const reset = () => {
    offset = null;
    tools.style.removeProperty('left');
    tools.style.removeProperty('top');
  };

  const atEdge = e => { const button = e.target.closest('button'); return !button || button === handle; };
  tools.addEventListener('pointerdown', e => {
    if (e.button !== 0 || grab || !atEdge(e)) return;
    const bounds = tools.getBoundingClientRect();
    grab = { id: e.pointerId, x: e.clientX - bounds.left, y: e.clientY - bounds.top };
    tools.setPointerCapture(e.pointerId);
    tools.classList.add('dragging');
  });
  tools.addEventListener('pointermove', e => {
    if (grab?.id !== e.pointerId) return;
    const bounds = stage.getBoundingClientRect();
    position(e.clientX - bounds.left - grab.x, e.clientY - bounds.top - grab.y);
  });
  tools.addEventListener('lostpointercapture', () => {
    grab = null;
    tools.classList.remove('dragging');
  });
  tools.addEventListener('dblclick', e => { if (atEdge(e)) reset(); });
  handle.addEventListener('keydown', e => {
    if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      reset();
      return;
    }
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    const bounds = stage.getBoundingClientRect();
    const current = tools.getBoundingClientRect();
    position(current.left - bounds.left + delta[0] * 8, current.top - bounds.top + delta[1] * 8);
  });
  new ResizeObserver(() => { if (offset) position(offset.x, offset.y); }).observe(stage);
}

export function createToolbar(root, { stage, statusBar, onTool, availability, onZoomIn, onZoomOut, onFit, onFitAll, onActualSize, onResetAdjust }) {
  const buttons = new Map();
  const handle = el('button', { type: 'button', class: 'toolstrip-grip', 'aria-label': '移动工具条', title: '拖动工具条 · 双击复位 · 方向键移动，Home 复位' });
  const tools = el('div', { class: 'toolstrip', role: 'toolbar', 'aria-label': '工具', 'aria-orientation': 'vertical' }, handle);
  makeToolstripDraggable(root, stage, tools, handle);
  for (const t of TOOLS) {
    if (t.sep) { tools.append(el('span', { class: 'ts-sep' })); continue; }
    const b = el('button', { class: 'tb-btn', 'aria-label': t.label, onclick: () => onTool(t.id) }, icon(t.icon, 17)); // 快捷键在提示里
    buttons.set(t.id, b);
    tools.append(b);
  }

  const zoomLabel = el('button', { class: 'tb-zoom', title: '视图缩放（不影响导出）· 点击 = 100%（⌘/Ctrl + 1）· 滚轮放大缩小', onclick: onActualSize }, '100%');
  attachWheel(zoomLabel, steps => (steps > 0 ? onZoomIn() : onZoomOut()), { immediate: true });
  const viewSlot = el('div', { class: 'tb-group tb-view' }); // 吸附开关等，由 main.js 挂进来
  const zoom = el('div', { class: 'tb-group' },
    el('button', { class: 'tb-btn', title: '缩小视图（⌘/Ctrl + -）', onclick: onZoomOut }, icon('zoom-out', 16)),
    zoomLabel,
    el('button', { class: 'tb-btn', title: '放大视图（⌘/Ctrl + =）', onclick: onZoomIn }, icon('zoom-in', 16)),
    el('button', { class: 'tb-btn', title: '适合当前画板（⌘/Ctrl + 0）', onclick: onFit }, icon('fit-board', 16)),
    el('button', { class: 'tb-btn', title: '适合全部画板（⌘/Ctrl + ⌥ + 0）', onclick: onFitAll }, icon('fit-all', 16)),
  );
  const resetAdj = el('button', { class: 'tb-btn tb-text', title: '清除当前画板里所有卡片的移动 / 旋转 / 缩放', onclick: onResetAdjust },
    icon('undo-2', 15), el('span', {}, '重置卡片'));
  const extra = el('div', { class: 'tb-group' }, resetAdj);

  // 顶部工具条随选择变化：
  //   ctxSlot   选中图层 / 卡片时的常用属性（ui/contextBar.js）
  //   bgSlot    没有选择时：画板背景、渐隐遮罩
  //   alignSlot 选中卡片 / 图层时：对齐、分布
  //   viewSlot + 缩放：在画布右下角的视图条里，始终显示
  const ctxSlot = el('div', { class: 'tb-group tb-ctx', hidden: true });
  const bgSlot = el('div', { class: 'tb-group' });
  const alignSlot = el('div', { class: 'tb-group tb-align', hidden: true });

  const bar = el('div', { class: 'toolbar', role: 'toolbar', 'aria-label': '属性' }, ctxSlot, bgSlot, alignSlot, extra);
  // 吸附开关和视图缩放放在状态栏右侧
  const viewbar = el('div', { class: 'viewbar', role: 'toolbar', 'aria-label': '视图' }, viewSlot, zoom);
  root.append(tools, bar);
  statusBar.append(viewbar);

  // 宽度够时按钮组整排显示，放不下时才折叠成下拉按钮：内容或窗口变化后重新排一次
  let fitQueued = false;
  const queueFit = () => {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(() => { fitQueued = false; fitFolds(bar); });
  };
  new MutationObserver(queueFit).observe(bar, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  const ro = new ResizeObserver(queueFit);
  ro.observe(root);
  ro.observe(bar);

  return {
    viewbar,
    ctxSlot,
    bgSlot,
    alignSlot,
    viewSlot,
    update({ tool, tempHand, viewZoom, adjustCount }) {
      for (const t of TOOLS) {
        if (t.sep) continue;
        const b = buttons.get(t.id);
        const { ok, reason } = availability(t.id);
        b.classList.toggle('active', (tempHand ? 'hand' : tool) === t.id);
        b.classList.toggle('disabled', !ok);
        b.title = `${t.label}（${t.key}）：${ok ? t.desc : reason}`;
      }
      zoomLabel.textContent = `${Math.round((viewZoom || 1) * 100)}%`;
      extra.hidden = !adjustCount;
      resetAdj.querySelector('span').textContent = `重置卡片（${adjustCount}）`;
    },
  };
}
