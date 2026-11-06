import { buildControls } from './controls.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { layerSchema, cropSchema } from '../layers/schema.js';
import { BOOLEAN_OPS } from '../layers/boolean.js';
import { createMenu } from './menu.js';
import { foldGroup } from './fold.js';

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
  text: pick(['fontFamily', 'fontSize', 'fontWeight', 'align', 'color'], COMPACT),
  // 填充：类型、颜色、填充不透明度（渐变时为起点的不透明度）；然后是描边和整体不透明度
  shape: pick(['fillType', 'fill', 'fillAlpha', 'strokeWidth', 'stroke', 'opacity'], {
    ...COMPACT,
    fillType: { label: '填充类型' },
    fill: { label: '填充颜色', show: v => v.fillType !== 'none' },
    fillAlpha: { label: v => (v.fillType === 'linear' ? '起点' : '填充'), show: v => v.fillType !== 'none' },
    opacity: { label: '整体' },
  }),
  mixed: pick(['opacity'], COMPACT),
};
const CARD_BAR = cropSchema.filter(d => d.key === 'fit' || d.key === 'cropZ');

export function createContextBar(slot, { store, ui, setLayerProp, setCards, getCards, resetCrop, reorder, removeLayers, typeName, booleanOp, booleanCount }) {
  const box = el('div', { class: 'ctx-controls' });
  const title = el('span', { class: 'ctx-title' });
  const actionsBox = el('div', { class: 'ctx-actions' });
  slot.append(title, box, actionsBox);

  const btn = (ic, label, fn) => el('button', { class: 'tb-btn', title: label, 'aria-label': label, onclick: fn }, icon(ic, 15));
  // 下拉按钮：点开是一列菜单项（节省工具条宽度）
  const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';
  function menuBtn(ic, label, items) {
    const b = el('button', { class: 'tb-btn tb-menu-btn', title: label, 'aria-label': label }, icon(ic, 15), icon('chevron-down', 12));
    createMenu(b, {
      align: 'center',
      render(pop, close) {
        const list = typeof items === 'function' ? items() : items;
        pop.replaceChildren(el('div', { class: 'menu-title' }, label), ...list.map(it => {
          if (it.sep) return el('div', { class: 'menu-sep' });
          if (it.title) return el('div', { class: 'menu-title' }, it.title);
          const row = el('button', { class: 'menu-item' },
            el('span', { class: 'menu-check' }, it.icon ? icon(it.icon, 14) : null),
            el('span', { class: 'menu-label' }, it.label),
            it.shortcut ? el('span', { class: 'menu-meta' }, it.shortcut) : null);
          row.addEventListener('click', () => { close(); it.action(); });
          return row;
        }));
      },
    });
    return b;
  }
  // 排列（层级）和布尔运算：宽度够时整排显示按钮，放不下时折叠成下拉菜单（见 fold.js）
  const group = (ic, label, items, priority) => foldGroup({
    priority,
    inline: items.map(it => btn(it.icon, it.shortcut ? `${it.label}（${it.shortcut}）` : it.label, it.action)),
    trigger: menuBtn(ic, label, items),
  });
  const arrange = group('layers', '排列', [
    { label: '上移一层', icon: 'arrow-up', shortcut: `${mod}]`, action: () => reorder(1) },
    { label: '下移一层', icon: 'arrow-down', shortcut: `${mod}[`, action: () => reorder(-1) },
    { label: '置于顶层', icon: 'arrow-up-to-line', shortcut: `⇧${mod}]`, action: () => reorder(1, true) },
    { label: '置于底层', icon: 'arrow-down-to-line', shortcut: `⇧${mod}[`, action: () => reorder(-1, true) },
  ], 1);
  const boolean = group('squares-unite', '布尔运算', BOOLEAN_OPS.map(o => ({ label: o.label, icon: o.icon, action: () => booleanOp(o.id) })), 2);
  const sep = () => el('span', { class: 'tb-fold-gap' });
  const layerActions = [arrange, sep(), btn('trash-2', '删除（Delete）', () => removeLayers())];
  const cardActions = [btn('rotate-ccw', '复位裁切', () => getCards().forEach(resetCrop))];
  const boolActions = [boolean, sep()]; // 选中两个以上形状时才出现

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
      updateControls = schema ? buildControls(box, schema, values, (k, v) => onChange(k, v), { wheelImmediate: true, inline: true }) : () => {};
      const bool = ctx === 'layers' && next.endsWith('bool') ? boolActions : [];
      actionsBox.replaceChildren(...bool, ...(ctx === 'layers' ? layerActions : ctx === 'cards' ? cardActions : []));
    }
    if (values) updateControls(values);
    return ctx;
  }

  return { update };
}
