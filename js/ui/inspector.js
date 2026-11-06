import { buildControls } from './controls.js';
import { el, section } from './dom.js';
import { icon } from './icons.js';
import { schemaFor, cropSchema, cardSchema } from '../layers/schema.js';
import { applyLayerProp, typeName } from '../layers/model.js';

/**
 * 检查器（类似 Figma 右侧的设计面板），分两处：
 *   设计页（selectionSlot）：选中图层时显示图层属性；选中卡片时显示卡片的裁切和位置 / 旋转 / 缩放
 *   图层页（layersSlot）：新建文字 / 形状 / 路径，以及当前画板的图层列表（上面的在上层）——
 *     点击选中、显示 / 隐藏、锁定、上移 / 下移、双击改名、删除
 * 返回 hasSelection()：设计页是否在显示选中对象（否则显示画板设置）
 */
const TYPE_ICONS = { rect: 'square', ellipse: 'circle', text: 'type', path: 'pen-tool', image: 'image' };
const ADD_TOOLS = [
  { tool: 'text', icon: 'type', label: '文字', key: 'T' },
  { tool: 'rect', icon: 'square', label: '矩形', key: 'M' },
  { tool: 'ellipse', icon: 'circle', label: '椭圆', key: 'L' },
  { tool: 'line', icon: 'slash', label: '直线', key: '\\' },
  { tool: 'pen', icon: 'pen-tool', label: '钢笔', key: 'P' },
];

export function createInspector({ selectionSlot, layersSlot }, { store, actions, ui, selectLayers, getCards, reorder, clearAll, setTool, is3D }) {
  /* ---------- 设计页：选中对象的标题栏 ---------- */
  const selTitle = el('span', { class: 'sel-title' });
  const selBar = el('div', { class: 'sel-bar' }, selTitle,
    el('button', { class: 'btn ghost small', title: '取消选择，回到画板设置（Esc）', onclick: () => clearAll() }, icon('x', 13), '画板设置'));

  /* ---------- 选中的图层 ---------- */
  // 图层属性的各个分组（位置、文字、填充、描边、外观）直接作为一级分组
  const propsBox = el('div');
  const propsSection = el('div', { class: 'groups-box' }, propsBox);
  const resetBtn = (title, fn) => el('button', { class: 'icon-btn visible', title, 'aria-label': title, onclick: fn }, icon('rotate-ccw', 14));

  /* ---------- 选中的卡片：裁切 + 位置 ---------- */
  const cardAdjust = order => ({ fit: 'cover', cropZ: 1, cropX: 0, cropY: 0, dx: 0, dy: 0, rz: 0, s: 1, ...((store.get().adjust[store.get().layoutId] || {})[order]) });
  const setCards = (key, value) => actions.setItemAdjusts(getCards().map(order => ({ order, patch: { [key]: value } })));
  const cropBox = el('div');
  const cropSection = section('裁切', cropBox, resetBtn('复位选中卡片的裁切', () => getCards().forEach(o => actions.resetCrop(o))), 'section:card-crop');
  const updateCrop = buildControls(cropBox, cropSchema, cardAdjust(-1), setCards);
  const cardBox = el('div');
  const cardSection = section('位置', cardBox, resetBtn('复位选中卡片的位置、旋转和缩放', () => getCards().forEach(o => actions.setItemAdjust(o, { dx: 0, dy: 0, rz: 0, s: 1 }))), 'section:card-transform');
  const updateCard = buildControls(cardBox, cardSchema, { ...cardAdjust(-1), single: true }, setCards);

  selectionSlot.append(selBar, propsSection, cropSection, cardSection);

  /* ---------- 图层页 ---------- */
  const addRow = el('div', { class: 'layer-add' }, ADD_TOOLS.map(t =>
    el('button', { class: 'btn small', title: `${t.label}（${t.key}）`, onclick: () => setTool(t.tool) }, icon(t.icon, 13), t.label)));
  const list = el('div', { class: 'layer-list' });
  const empty = el('p', { class: 'note' }, '还没有图层。用上面的按钮或左侧工具栏添加文字、形状，或用钢笔绘制路径；图层画在幻灯片上面，一起导出。');
  layersSlot.append(section('图层', el('div', {}, addRow, empty, list), null, 'section:layer-list'));

  // 修改选中的图层（文字会重新测量尺寸，路径作用在锚点上）
  const setProp = (key, value) => actions.updateLayers(ui.layerSel, l => applyLayerProp(l, key, value));

  let propsKey = '';
  let updateProps = () => {};
  function renderProps(sel) {
    propsSection.hidden = !sel.length;
    if (!sel.length) { propsKey = ''; return; }
    const types = [...new Set(sel.map(l => l.type))].sort();
    const primary = sel[0];
    const values = { ...primary, x: Math.round(primary.x), y: Math.round(primary.y), w: Math.round(primary.w), h: Math.round(primary.h), rotation: Math.round(primary.rotation || 0) };
    if (types.join() !== propsKey) {
      propsKey = types.join();
      updateProps = buildControls(propsBox, schemaFor(types), values, setProp, { collapseKey: 'layer' });
    }
    updateProps(values);
  }

  function renderCards(s, cards) {
    const show = cards.length > 0 && !ui.layerSel.length;
    cropSection.hidden = !show || !s.slides.length;
    cardSection.hidden = !show || is3D();
    if (!show) return;
    const v = cardAdjust(cards[0]);
    updateCrop(v);
    updateCard({ ...v, dx: Math.round(v.dx), dy: Math.round(v.dy), rz: Math.round(v.rz * 10) / 10, single: cards.length === 1 });
  }

  let listKey = '';
  function renderList(s) {
    const layers = s.layers || [];
    empty.hidden = layers.length > 0;
    // 只在内容变化时重建列表
    const key = JSON.stringify([layers.map(l => [l.id, l.name, l.type, l.hidden, l.locked]), ui.layerSel]);
    if (key === listKey) return;
    listKey = key;
    list.innerHTML = '';
    for (const l of [...layers].reverse()) {
      const active = ui.layerSel.includes(l.id);
      const name = el('span', { class: 'layer-name', title: '双击重命名' }, l.name);
      name.addEventListener('dblclick', e => {
        e.stopPropagation();
        const v = prompt('图层名称', l.name)?.trim();
        if (v) actions.updateLayers([l.id], { name: v });
      });
      const btn = (ic, title, fn, on = false) => {
        const b = el('button', { class: `icon-btn visible layer-btn${on ? ' on' : ''}`, title }, icon(ic, 13));
        b.addEventListener('click', e => { e.stopPropagation(); fn(); });
        return b;
      };
      const row = el('div', { class: `layer-row${active ? ' active' : ''}${l.hidden ? ' is-hidden' : ''}` },
        el('span', { class: 'layer-type' }, icon(TYPE_ICONS[l.type] || 'square', 13)),
        name,
        btn('arrow-up', '上移一层（⌘ ]）', () => { selectLayers([l.id]); reorder(1); }),
        btn('arrow-down', '下移一层（⌘ [）', () => { selectLayers([l.id]); reorder(-1); }),
        btn(l.locked ? 'lock' : 'lock-open', l.locked ? '解锁' : '锁定（锁定后在画板上点不中）', () => actions.updateLayers([l.id], { locked: !l.locked }), l.locked),
        btn(l.hidden ? 'eye-off' : 'eye', l.hidden ? '显示' : '隐藏', () => actions.updateLayers([l.id], { hidden: !l.hidden }), l.hidden),
        btn('trash-2', '删除', () => { actions.setLayers(store.get().layers.filter(x => x.id !== l.id)); selectLayers(ui.layerSel.filter(x => x !== l.id)); }),
      );
      row.addEventListener('click', e => {
        const additive = e.shiftKey || e.metaKey || e.ctrlKey;
        selectLayers(additive ? (active ? ui.layerSel.filter(x => x !== l.id) : [...ui.layerSel, l.id]) : [l.id]);
      });
      list.append(row);
    }
  }

  let has = false;
  function update(s = store.get()) {
    const sel = (s.layers || []).filter(l => ui.layerSel.includes(l.id));
    const cards = getCards();
    has = sel.length > 0 || cards.length > 0;
    renderProps(sel);
    renderCards(s, cards);
    renderList(s);
    selTitle.textContent = sel.length
      ? (sel.length > 1 ? `已选 ${sel.length} 个图层` : `${typeName(sel[0].type)} · ${sel[0].name}`)
      : cards.length > 1 ? `已选 ${cards.length} 张卡片` : cards.length ? `卡片 · 第 ${cards[0] + 1} 个位置` : '';
  }
  update();
  return { update, hasSelection: () => has };
}
