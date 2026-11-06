import { buildControls } from './controls.js';
import { el, section } from './dom.js';
import { icon } from './icons.js';
import { schemaFor, cropSchema } from '../layers/schema.js';
import { measureText, moveLayer, mapToFrame, typeName } from '../layers/model.js';

/**
 * 「参数」页顶部的检查器（类似 Figma 右侧的设计面板）：
 *   选中的图层：位置、文字、填充（可做透明渐变）、描边、外观；多选时只显示共同的属性，一起修改
 *   选中的卡片：裁切（填满 / 完整显示、放大、位置）
 *   图层列表：当前画板的全部图层（上面的在上层）——点击选中、显示 / 隐藏、锁定、上移 / 下移、双击改名、删除
 */
const TYPE_ICONS = { rect: 'square', ellipse: 'circle', text: 'type', path: 'pen-tool' };
const TEXT_METRICS = new Set(['text', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing']);

export function createInspector(root, { store, actions, ui, selectLayers, getCards, reorder }) {
  /* ---------- 选中的图层 ---------- */
  const propsBox = el('div');
  const propsTitle = el('span', { class: 'inspector-count' });
  const propsSection = section('图层属性', propsBox, propsTitle, 'section:layer-props');

  /* ---------- 选中的卡片：裁切 ---------- */
  const cropBox = el('div');
  const cropSection = section('卡片裁切', cropBox,
    el('button', { class: 'btn ghost small', title: '复位选中卡片的裁切', onclick: () => getCards().forEach(o => actions.resetCrop(o)) }, icon('rotate-ccw', 13), '复位'),
    'section:card-crop');
  const cropAdjust = order => ({ fit: 'cover', cropZ: 1, cropX: 0, cropY: 0, ...((store.get().adjust[store.get().layoutId] || {})[order]) });
  const updateCrop = buildControls(cropBox, cropSchema, cropAdjust(-1), (key, value) => {
    actions.setItemAdjusts(getCards().map(order => ({ order, patch: { [key]: value } })));
  });

  /* ---------- 图层列表 ---------- */
  const list = el('div', { class: 'layer-list' });
  const listSection = section('图层', list, null, 'section:layer-list');

  root.append(propsSection, cropSection, listSection);

  // 修改选中的图层：文字相关属性要重新测量尺寸；路径的尺寸 / 位置作用在锚点上
  function setProp(key, value) {
    const ids = ui.layerSel;
    actions.updateLayers(ids, l => {
      if (l.type === 'path' && ['x', 'y'].includes(key)) return moveLayer(l, key === 'x' ? value - l.x : 0, key === 'y' ? value - l.y : 0);
      if (l.type === 'path' && ['w', 'h'].includes(key)) {
        const f = { cx: l.x + l.w / 2, cy: l.y + l.h / 2, w: l.w, h: l.h, rotation: 0 };
        const w = key === 'w' ? value : l.w, h = key === 'h' ? value : l.h;
        return mapToFrame(l, f, { cx: l.x + w / 2, cy: l.y + h / 2, w, h, rotation: 0 });
      }
      const next = { ...l, [key]: value };
      return l.type === 'text' && TEXT_METRICS.has(key) ? measureText(next) : next;
    });
  }

  let propsKey = '';
  let updateProps = () => {};
  function renderProps(s) {
    const sel = (s.layers || []).filter(l => ui.layerSel.includes(l.id));
    propsSection.hidden = !sel.length;
    if (!sel.length) { propsKey = ''; return; }
    const types = [...new Set(sel.map(l => l.type))];
    const key = types.sort().join(',');
    const primary = sel[0];
    const values = { ...primary, x: Math.round(primary.x), y: Math.round(primary.y), w: Math.round(primary.w), h: Math.round(primary.h), rotation: Math.round(primary.rotation || 0) };
    if (key !== propsKey) {
      propsKey = key;
      updateProps = buildControls(propsBox, schemaFor(types), values, setProp, { collapseKey: 'layer' });
    }
    updateProps(values);
    propsTitle.textContent = sel.length > 1 ? `${sel.length} 个` : typeName(primary.type);
  }

  function renderCrop(s) {
    const cards = getCards();
    cropSection.hidden = !cards.length || !s.slides.length;
    if (cropSection.hidden) return;
    updateCrop(cropAdjust(cards[0]));
  }

  let listKey = '';
  function renderList(s) {
    const layers = s.layers || [];
    listSection.hidden = !layers.length;
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

  function update(s = store.get()) {
    renderProps(s);
    renderCrop(s);
    renderList(s);
  }
  update();
  return { update };
}
