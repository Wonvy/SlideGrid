/**
 * 图层属性面板的控件定义（ui/controls.js 的 schema）。types：适用的图层类型；
 * 多选时只显示所有选中图层都有的属性，修改作用于全部选中的图层。
 */
import { DEVICES, FRAMES } from './devices.js';

const SHAPES = ['rect', 'ellipse', 'path'];
const ALL = ['rect', 'ellipse', 'text', 'path', 'image', 'device'];
const fillOn = v => v.fillType !== 'none';

export const layerSchema = [
  { group: '位置', types: ALL },
  { key: 'x', label: 'X', type: 'number', step: 1, half: true, types: ALL },
  { key: 'y', label: 'Y', type: 'number', step: 1, half: true, types: ALL },
  { key: 'w', label: '宽', type: 'number', step: 1, min: 1, half: true, types: [...SHAPES, 'image', 'device'] },
  { key: 'h', label: '高', type: 'number', step: 1, min: 1, half: true, types: [...SHAPES, 'image', 'device'] },
  { key: 'rotation', label: '旋转', type: 'number', step: 1, unit: '°', types: ['rect', 'ellipse', 'text', 'image', 'device'] },

  { group: '样机', types: ['device'] },
  { key: 'device', label: '设备', type: 'select', types: ['device'], show: v => v.device !== 'custom', options: Object.entries(DEVICES).map(([value, d]) => ({ value, label: d.label, icon: d.icon })) },
  { key: 'yaw', label: '左右角度', type: 'range', min: -60, max: 60, step: 1, unit: '°', types: ['device'], show: v => v.device !== 'custom' },
  { key: 'pitch', label: '俯视角度', type: 'range', min: -20, max: 45, step: 1, unit: '°', types: ['device'], show: v => v.device !== 'custom' },
  { key: 'slide', label: '显示第几张', type: 'number', min: 1, max: 999, step: 1, types: ['device'], show: v => !v.imageId },
  {
    key: 'fit', label: '显示方式', type: 'select', types: ['device'],
    options: [{ value: 'cover', label: '填满屏幕' }, { value: 'contain', label: '完整显示' }],
  },
  { key: 'screenZoom', label: '画面放大', type: 'range', min: 1, max: 4, step: 0.01, default: 1, types: ['device'] },
  { key: 'screenX', label: '水平位置', type: 'range', min: -1, max: 1, step: 0.01, default: 0, half: true, types: ['device'], show: v => (v.screenZoom || 1) > 1 || v.fit !== 'contain' },
  { key: 'screenY', label: '垂直位置', type: 'range', min: -1, max: 1, step: 0.01, default: 0, half: true, types: ['device'], show: v => (v.screenZoom || 1) > 1 || v.fit !== 'contain' },
  { key: 'frame', label: '外观', type: 'select', types: ['device'], show: v => v.device !== 'custom', options: Object.entries(FRAMES).map(([value, f]) => ({ value, label: f.label })) },
  { key: 'shadow', label: '投影', type: 'toggle', types: ['device'] },
  { key: 'reflection', label: '倒影', type: 'toggle', types: ['device'] },

  { group: '文字', types: ['text'] },
  { key: 'text', label: '内容', type: 'textarea', types: ['text'] },
  { key: 'fontFamily', label: '字体', type: 'font', types: ['text'] },
  { key: 'fontSize', label: '字号', type: 'range', min: 8, max: 400, types: ['text'] },
  {
    key: 'fontWeight', label: '字重', type: 'select', types: ['text'],
    options: [{ value: 300, label: '细' }, { value: 400, label: '常规' }, { value: 600, label: '中粗' }, { value: 700, label: '粗' }, { value: 900, label: '特粗' }],
  },
  {
    key: 'align', label: '对齐', type: 'select', types: ['text'], iconInPanel: true,
    options: [{ value: 'left', label: '左对齐', icon: 'align-left' }, { value: 'center', label: '居中', icon: 'align-center' }, { value: 'right', label: '右对齐', icon: 'align-right' }],
  },
  { key: 'area', label: '自动换行（区块文字）', type: 'toggle', types: ['text'] },
  { key: 'lineHeight', label: '行高', type: 'range', min: 0.8, max: 3, step: 0.05, types: ['text'] },
  { key: 'letterSpacing', label: '字间距', type: 'range', min: -20, max: 60, types: ['text'] },
  { key: 'color', label: '颜色', type: 'color', types: ['text'] },

  { group: '填充', types: SHAPES },
  {
    key: 'fillType', label: '类型', type: 'select', types: SHAPES,
    options: [{ value: 'none', label: '无', icon: 'ban' }, { value: 'solid', label: '纯色', icon: 'square' }, { value: 'linear', label: '线性渐变', icon: 'gradient' }],
  },
  { key: 'fill', label: v => (v.fillType === 'linear' ? '起始色' : '颜色'), type: 'color', half: true, types: SHAPES, show: fillOn },
  { key: 'fill2', label: '结束色', type: 'color', half: true, types: SHAPES, show: v => v.fillType === 'linear' },
  { key: 'fillAlpha', label: v => (v.fillType === 'linear' ? '起始' : '不透明度'), type: 'range', min: 0, max: 1, step: 0.01, half: true, types: SHAPES, show: fillOn },
  { key: 'fill2Alpha', label: '结束', type: 'range', min: 0, max: 1, step: 0.01, half: true, types: SHAPES, show: v => v.fillType === 'linear' },
  { key: 'fillAngle', label: '渐变方向', type: 'range', min: 0, max: 360, unit: '°', types: SHAPES, show: v => v.fillType === 'linear' },

  { group: '描边', types: SHAPES },
  { key: 'strokeWidth', label: '粗细', type: 'range', min: 0, max: 60, step: 0.5, types: SHAPES },
  { key: 'stroke', label: '颜色', type: 'color', types: SHAPES, show: v => v.strokeWidth > 0 },

  { group: '外观', types: ALL },
  { key: 'radius', label: '圆角', type: 'range', min: 0, max: 400, types: ['rect', 'image'] },
  { key: 'opacity', label: '不透明度', type: 'range', min: 0, max: 1, step: 0.01, types: ALL },
];

// 选中图层类型都适用的控件（分组标题下没有控件时去掉标题）
export function schemaFor(types) {
  const fits = d => types.every(t => d.types.includes(t));
  const out = [];
  for (const d of layerSchema) {
    if (!fits(d)) continue;
    if (d.group && out.length && out[out.length - 1].group) out.pop();
    out.push(d);
  }
  if (out.length && out[out.length - 1].group) out.pop();
  return out;
}

// 选中卡片的裁切控件
export const cropSchema = [
  {
    key: 'fit', label: '显示方式', type: 'select', default: 'cover',
    options: [{ value: 'cover', label: '填满（裁切）' }, { value: 'contain', label: '完整显示' }],
  },
  { key: 'cropZ', label: '放大', type: 'range', min: 1, max: 4, step: 0.01, default: 1, show: v => v.fit !== 'contain' },
  { key: 'cropX', label: '水平位置', type: 'range', min: -1, max: 1, step: 0.01, default: 0, show: v => v.fit !== 'contain' },
  { key: 'cropY', label: '垂直位置', type: 'range', min: -1, max: 1, step: 0.01, default: 0, show: v => v.fit !== 'contain' },
];

// 选中卡片的位置 / 旋转 / 缩放（手动调整；dx / dy 只在单选时显示）
export const cardSchema = [
  { key: 'dx', label: 'X', type: 'number', step: 1, default: 0, half: true, show: v => v.single },
  { key: 'dy', label: 'Y', type: 'number', step: 1, default: 0, half: true, show: v => v.single },
  { key: 'rz', label: '旋转', type: 'range', min: -180, max: 180, step: 0.5, default: 0, unit: '°' },
  { key: 's', label: '缩放', type: 'range', min: 0.1, max: 4, step: 0.01, default: 1 },
];
