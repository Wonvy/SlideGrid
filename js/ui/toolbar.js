import { el } from './dom.js';
import { icon } from './icons.js';

// 预览区工具条：工具切换 + 缩放 + 重置卡片调整
export const TOOLS = [
  { id: 'select', icon: 'mouse-pointer-2', label: '排列', key: 'V', desc: '把卡片拖到另一张上交换图片' },
  { id: 'move', icon: 'move', label: '移动', key: 'M', desc: '拖动单张卡片调整位置；选中后拖角点等比缩放（Shift 锁定方向，方向键微调，+/- 缩放）' },
  { id: 'rotate', icon: 'rotate-cw', label: '旋转', key: 'R', desc: '拖动旋转单张卡片（Shift 按 15° 吸附）' },
  { id: 'hand', icon: 'hand', label: '抓手', key: 'H', desc: '平移画面（任何工具下按住空格或中键也可以）' },
  { id: 'orbit', icon: 'rotate-3d', label: '视角', key: 'O', desc: '旋转 3D 视角（3D 版式下右键拖动也可以）' },
];

export function createToolbar(root, { onTool, availability, onZoomIn, onZoomOut, onZoomReset, onResetAdjust }) {
  const buttons = new Map();
  const tools = el('div', { class: 'tb-group' });
  for (const t of TOOLS) {
    const b = el('button', { class: 'tb-btn', 'aria-label': t.label, onclick: () => onTool(t.id) },
      icon(t.icon, 17), el('span', { class: 'tb-key' }, t.key));
    buttons.set(t.id, b);
    tools.append(b);
  }

  const zoomLabel = el('button', { class: 'tb-zoom', title: '点击复位视图（缩放 100%、平移归零）', onclick: onZoomReset }, '100%');
  const zoom = el('div', { class: 'tb-group' },
    el('button', { class: 'tb-btn', title: '缩小', onclick: onZoomOut }, icon('zoom-out', 16)),
    zoomLabel,
    el('button', { class: 'tb-btn', title: '放大', onclick: onZoomIn }, icon('zoom-in', 16)),
  );
  const resetAdj = el('button', { class: 'tb-btn tb-text', title: '清除当前版式里所有卡片的移动 / 旋转', onclick: onResetAdjust },
    icon('undo-2', 15), el('span', {}, '重置卡片'));
  const extra = el('div', { class: 'tb-group' }, resetAdj);

  const bar = el('div', { class: 'toolbar', role: 'toolbar', 'aria-label': '预览工具' }, tools, zoom, extra);
  root.append(bar);

  return {
    update({ tool, tempHand, zoomValue, adjustCount }) {
      for (const t of TOOLS) {
        const b = buttons.get(t.id);
        const { ok, reason } = availability(t.id);
        b.classList.toggle('active', (tempHand ? 'hand' : tool) === t.id);
        b.classList.toggle('disabled', !ok);
        b.title = `${t.label}（${t.key}）：${ok ? t.desc : reason}`;
      }
      zoomLabel.textContent = `${Math.round((zoomValue || 1) * 100)}%`;
      extra.hidden = !adjustCount;
      resetAdj.querySelector('span').textContent = `重置卡片（${adjustCount}）`;
    },
  };
}
