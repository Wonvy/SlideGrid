import { el } from './dom.js';
import { icon } from './icons.js';

// 工作区工具条：工具切换（快捷键参照 Illustrator）+ 视图缩放 + 重置卡片调整
export const TOOLS = [
  { id: 'select', icon: 'mouse-pointer-2', label: '选择', key: 'V', desc: '点选卡片，拖动移动位置，拖四个角等比缩放（Shift 锁定方向，方向键微调）' },
  { id: 'swap', icon: 'arrow-left-right', label: '交换', key: 'X', desc: '把卡片拖到另一张上交换图片' },
  { id: 'rotate', icon: 'rotate-cw', label: '旋转', key: 'R', desc: '拖动旋转卡片（Shift 按 15° 吸附）' },
  { id: 'scale', icon: 'scaling', label: '比例', key: 'S', desc: '拖动以卡片中心等比缩放（Shift 按 5% 吸附，+/- 键微调）' },
  { id: 'orbit', icon: 'rotate-3d', label: '构图', key: 'O', desc: '调整画板内的构图（会导出）：3D 拖动旋转 / Shift+拖动平移，平面拖动平移，滚轮缩放' },
  { sep: true },
  { id: 'hand', icon: 'hand', label: '抓手', key: 'H', desc: '平移视图（任何工具下按住空格或中键也可以）' },
  { id: 'zoom', icon: 'search', label: '放大镜', key: 'Z', desc: '单击放大视图，按住 ⌥ 单击缩小（Ctrl/⌘ + 滚轮也可以）' },
  { id: 'artboard', icon: 'frame', label: '画板', key: '⇧O', desc: '点击切换画板，拖动移动画板位置，Delete 删除画板' },
];

export function createToolbar(root, { onTool, availability, onZoomIn, onZoomOut, onFit, onFitAll, onActualSize, onResetAdjust }) {
  const buttons = new Map();
  const tools = el('div', { class: 'tb-group' });
  for (const t of TOOLS) {
    if (t.sep) { tools.append(el('span', { class: 'tb-sep' })); continue; }
    const b = el('button', { class: 'tb-btn', 'aria-label': t.label, onclick: () => onTool(t.id) },
      icon(t.icon, 17), el('span', { class: 'tb-key' }, t.key));
    buttons.set(t.id, b);
    tools.append(b);
  }

  const zoomLabel = el('button', { class: 'tb-zoom', title: '视图缩放（不影响导出）· 点击 = 100%（⌘/Ctrl + 1）', onclick: onActualSize }, '100%');
  const zoom = el('div', { class: 'tb-group' },
    el('button', { class: 'tb-btn', title: '缩小视图（⌘/Ctrl + -）', onclick: onZoomOut }, icon('zoom-out', 16)),
    zoomLabel,
    el('button', { class: 'tb-btn', title: '放大视图（⌘/Ctrl + =）', onclick: onZoomIn }, icon('zoom-in', 16)),
    el('button', { class: 'tb-btn', title: '适合当前画板（⌘/Ctrl + 0）', onclick: onFit }, icon('scan', 16)),
    el('button', { class: 'tb-btn', title: '适合全部画板（⌘/Ctrl + ⌥ + 0）', onclick: onFitAll }, icon('maximize', 16)),
  );
  const resetAdj = el('button', { class: 'tb-btn tb-text', title: '清除当前画板里所有卡片的移动 / 旋转 / 缩放', onclick: onResetAdjust },
    icon('undo-2', 15), el('span', {}, '重置卡片'));
  const extra = el('div', { class: 'tb-group' }, resetAdj);

  // 画板背景按钮由 main.js 挂进来（见 ui/bgPicker.js）
  const bgSlot = el('div', { class: 'tb-group' });

  const bar = el('div', { class: 'toolbar', role: 'toolbar', 'aria-label': '工具' }, tools, bgSlot, zoom, extra);
  root.append(bar);

  return {
    bgSlot,
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
