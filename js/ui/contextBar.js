import { buildControls } from './controls.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { layerSchema, cropSchema } from '../layers/schema.js';
import { BOOLEAN_OPS } from '../layers/boolean.js';

/**
 * 顶部工具条的「上下文」部分：跟随当前选择显示最常用的属性（类似 Illustrator 的控制栏）。
 *   选中文字：字体、字号、字重、对齐、颜色、不透明度
 *   选中形状 / 路径：填充、描边颜色和粗细、不透明度
 *   选中多种图层：不透明度
 *   以上都带「上移 / 下移一层、删除」
 *   选中卡片：显示方式（填满 / 完整显示）、放大、复位裁切
 *   没有选择：不显示（工具条显示画板背景、渐隐遮罩）
 * 完整属性在右栏「设计」页。
 */
const pick = (keys, overrides = {}) => keys.map(k => {
  const d = layerSchema.find(x => x.key === k);
  return { ...d, ...(overrides[k] || {}) };
});
const COMPACT = {
  fontSize: { type: 'number', label: '字号', min: 4, max: 800 },
  strokeWidth: { type: 'number', label: '描边', min: 0, max: 200, step: 0.5 },
  fill: { label: '填充' },
  stroke: { label: '描边色', show: v => v.strokeWidth > 0 },
  color: { label: '颜色' },
  opacity: { label: '不透明度' },
};
const BARS = {
  text: pick(['fontFamily', 'fontSize', 'fontWeight', 'align', 'color', 'opacity'], COMPACT),
  shape: pick(['fillType', 'fill', 'strokeWidth', 'stroke', 'opacity'], { ...COMPACT, fillType: { label: '填充' }, fill: { label: '', show: v => v.fillType !== 'none' } }),
  mixed: pick(['opacity'], COMPACT),
};
const CARD_BAR = cropSchema.filter(d => d.key === 'fit' || d.key === 'cropZ');

export function createContextBar(slot, { store, ui, setLayerProp, setCards, getCards, resetCrop, reorder, removeLayers, typeName, booleanOp, booleanCount }) {
  const box = el('div', { class: 'ctx-controls' });
  const title = el('span', { class: 'ctx-title' });
  const actionsBox = el('div', { class: 'ctx-actions' });
  slot.append(title, box, actionsBox);

  const btn = (ic, label, fn) => el('button', { class: 'tb-btn', title: label, 'aria-label': label, onclick: fn }, icon(ic, 15));
  const layerActions = [
    btn('arrow-up', '上移一层（⌘ ]）', () => reorder(1)),
    btn('arrow-down', '下移一层（⌘ [）', () => reorder(-1)),
    btn('trash-2', '删除（Delete）', () => removeLayers()),
  ];
  const cardActions = [btn('rotate-ccw', '复位裁切', () => getCards().forEach(resetCrop))];
  // 选中两个以上形状时：布尔运算
  const boolActions = [el('span', { class: 'tb-sep' }), ...BOOLEAN_OPS.map(o => btn(o.icon, `${o.label}（布尔运算）`, () => booleanOp(o.id))), el('span', { class: 'tb-sep' })];

  let key = '';
  let updateControls = () => {};
  const cardValues = order => ({ fit: 'cover', cropZ: 1, ...((store.get().adjust[store.get().layoutId] || {})[order]) });

  // 返回当前上下文：'board' | 'layers' | 'cards'
  function update(s = store.get()) {
    const sel = (s.layers || []).filter(l => ui.layerSel.includes(l.id));
    const cards = getCards();
    let ctx = 'board', next = '', schema = null, values = null, onChange = null;
    if (sel.length) {
      const types = new Set(sel.map(l => l.type));
      const kind = types.size === 1 && types.has('text') ? 'text' : [...types].every(t => ['rect', 'ellipse', 'path'].includes(t)) ? 'shape' : 'mixed';
      ctx = 'layers';
      next = `layers:${kind}:${booleanCount() >= 2 ? 'bool' : ''}`;
      schema = BARS[kind];
      values = sel[0];
      onChange = setLayerProp;
      title.textContent = sel.length > 1 ? `${sel.length} 个图层` : typeName(sel[0].type);
    } else if (cards.length && s.slides.length) {
      ctx = 'cards';
      next = 'cards';
      schema = CARD_BAR;
      values = cardValues(cards[0]);
      onChange = setCards;
      title.textContent = cards.length > 1 ? `${cards.length} 张卡片` : '卡片';
    }
    slot.hidden = ctx === 'board';
    if (next !== key) {
      key = next;
      box.innerHTML = '';
      // 工具条不会滚动：悬停即可用滚轮调参（Shift 加速）
      updateControls = schema ? buildControls(box, schema, values, (k, v) => onChange(k, v), { wheelImmediate: true }) : () => {};
      const bool = ctx === 'layers' && next.endsWith('bool') ? boolActions : [];
      actionsBox.replaceChildren(...bool, ...(ctx === 'layers' ? layerActions : ctx === 'cards' ? cardActions : []));
    }
    if (values) updateControls(values);
    return ctx;
  }

  return { update };
}
