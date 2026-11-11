import { buildControls } from './controls.js';
import { el, section } from './dom.js';
import { icon } from './icons.js';
import { schemaFor, cropSchema, cardSchema } from '../layers/schema.js';
import { applyLayerProp, typeName } from '../layers/model.js';
import { FADE_PRESETS } from '../style/schema.js';
import { showContextMenu } from './contextMenu.js';

/**
 * 检查器（类似 Figma 右侧的设计面板），分两处：
 *   设计页（selectionSlot）：选中图层时显示图层属性；选中卡片时显示卡片的裁切和位置 / 旋转 / 缩放
 *   图层页（layersSlot）：新建文字 / 形状 / 路径，以及当前画板的图层列表（上面的在上层）——
 *     点击选中（Shift / ⌘ 多选）、显示 / 隐藏、锁定、双击改名；拖动调整前后（选中多个时一起拖）；右键菜单。
 *     幻灯片作为一组列在中间：组里是渐隐遮罩（开启时）和画板里看得见的每张卡片（上面的在前）；
 *     图层可以拖过这一组（放到幻灯片下面）；平面版式里卡片也能拖动调整前后
 *   cards：{ list() → 看得见的卡片（从上到下）, select(orders), canStack(), canDrag(), place(orders, target, place) → 是否有变化,
 *            resetStack(), stackChanged(), hover(order) }
 *   placeLayers(ids, target, place)：把图层放到 target（图层 id 或 slidesId）的上面 / 下面，返回是否有变化
 *   menus：{ layer(x, y, layer, { rename }), card(x, y, card) }：右键菜单（和画布上的是同一套）
 *   onFade()：打开渐隐遮罩的设置
 * 返回 hasSelection()：设计页是否在显示选中对象（否则显示画板设置）
 */
const TYPE_ICONS = { rect: 'square', ellipse: 'circle', text: 'type', path: 'pen-tool', image: 'image', device: 'laptop' };
const ADD_TOOLS = [
  { tool: 'text', icon: 'type', label: '文字', key: 'T' },
  { tool: 'rect', icon: 'square', label: '矩形', key: 'M' },
  { tool: 'ellipse', icon: 'circle', label: '椭圆', key: 'L' },
  { tool: 'line', icon: 'slash', label: '直线', key: '\\' },
  { tool: 'pen', icon: 'pen-tool', label: '钢笔', key: 'P' },
];

export function createInspector({ selectionSlot, layersSlot }, { store, actions, ui, selectLayers, getCards, placeLayers, slidesId = '__slides__', menus, clearAll, setTool, is3D, cardParams = () => null, cards, onFade = () => {}, notify = () => {}, onDeviceImage = () => {}, onDeviceQuad = () => {} }) {
  /* ---------- 设计页：选中对象的标题栏 ---------- */
  const selTitle = el('span', { class: 'sel-title' });
  const selBar = el('div', { class: 'sel-bar' }, selTitle,
    el('button', { class: 'btn ghost small', title: '取消选择，回到画板设置（Esc）', onclick: () => clearAll() }, icon('x', 13), '画板设置'));

  /* ---------- 选中的图层 ---------- */
  // 图层属性的各个分组（位置、文字、填充、描边、外观）直接作为一级分组
  const propsBox = el('div');
  // 只选中一个样机时：更换屏幕图片 / 改回显示幻灯片（也可以把图片、左栏的幻灯片拖到样机上）
  const deviceUseSlide = el('button', { class: 'btn', title: '屏幕改回显示画板的幻灯片' }, icon('images', 14), '用幻灯片');
  const deviceRow = el('div', { class: 'device-image-row', hidden: true },
    el('button', { class: 'btn', title: '选择一张图片放进样机的屏幕（也可以把图片拖到样机上，或选中后粘贴）', onclick: () => { const l = selectedDevice(); if (l) onDeviceImage(l); } },
      icon('image-plus', 14), '更换屏幕图片…'),
    deviceUseSlide);
  // PNG 样机：重新对准屏幕的四个角
  const deviceQuad = el('button', { class: 'btn', title: '重新拖动四个角，对准 PNG 里屏幕的位置', onclick: () => { const l = selectedDevice(); if (l) onDeviceQuad(l); } },
    icon('scan', 14), '调整屏幕区域…');
  const deviceQuadRow = el('div', { class: 'device-image-row', hidden: true }, deviceQuad);
  deviceUseSlide.addEventListener('click', () => { const l = selectedDevice(); if (l) actions.setDeviceImage(l.id, null); });
  const selectedDevice = () => {
    const l = ui.layerSel.length === 1 ? (store.get().layers || []).find(x => x.id === ui.layerSel[0]) : null;
    return l?.type === 'device' ? l : null;
  };
  const propsSection = el('div', { class: 'groups-box' }, propsBox, deviceRow, deviceQuadRow);
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

  // 3D 版式的单卡设置（等距展台 / 分组展台的「抬起」）：schema 来自版式的 cardParams，缺的值用版式参数补上
  const raiseBox = el('div');
  const raiseSection = section('抬起', raiseBox, resetBtn('选中的卡片改回跟随版式', () => actions.setItemAdjusts(getCards().map(order => ({ order, patch: { raise: 'auto', raiseAngle: undefined, raiseHeight: undefined, raiseEdge: undefined, raiseTurn: undefined } })))), 'section:card-raise');
  let raiseSchema = null;
  let updateRaise = () => {};
  const raiseValues = order => {
    const s = store.get();
    const p = s.params[s.layoutId] || {};
    const a = cardAdjust(order);
    return { raise: a.raise || 'auto', raiseAngle: a.raiseAngle ?? p.angle ?? 58, raiseHeight: a.raiseHeight ?? p.height ?? 36, raiseEdge: a.raiseEdge ?? p.edge ?? 'bottom', raiseTurn: a.raiseTurn ?? 0 };
  };
  function renderRaise(cards) {
    const schema = cardParams?.() || null;
    raiseSection.hidden = !schema || !cards.length || ui.layerSel.length > 0;
    if (raiseSection.hidden) return;
    if (schema !== raiseSchema) { raiseSchema = schema; updateRaise = buildControls(raiseBox, schema, raiseValues(cards[0]), setCards, { markChanged: true }); }
    updateRaise(raiseValues(cards[0]));
  }

  selectionSlot.append(selBar, propsSection, raiseSection, cropSection, cardSection);

  /* ---------- 图层页 ---------- */
  const addRow = el('div', { class: 'layer-add' }, ADD_TOOLS.map(t =>
    el('button', { class: 'btn small', title: `${t.label}（${t.key}）`, onclick: () => setTool(t.tool) }, icon(t.icon, 13), t.label)));
  const list = el('div', { class: 'layer-list' });
  const dropLine = el('div', { class: 'layer-drop', hidden: true }); // 拖动时的插入位置
  const empty = el('p', { class: 'note' }, '用上面的按钮或左侧工具栏添加文字、形状，或用钢笔绘制路径。图层默认在幻灯片上面，拖到「幻灯片」下面就放到卡片后面。');
  const hint = el('p', { class: 'note layer-hint' }, '拖动调整前后顺序 · 右键更多操作 · 双击改名');
  layersSlot.append(section('图层', el('div', {}, addRow, empty, list, hint), null, 'section:layer-list'));

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
    const dev = selectedDevice();
    deviceRow.hidden = !dev;
    deviceQuadRow.hidden = dev?.device !== 'custom';
    deviceUseSlide.hidden = !dev?.imageId;
  }

  function renderCards(s, cards) {
    renderRaise(cards);
    const show = cards.length > 0 && !ui.layerSel.length;
    cropSection.hidden = !show || !s.slides.length;
    cardSection.hidden = !show || is3D();
    if (!show) return;
    const v = cardAdjust(cards[0]);
    updateCrop(v);
    updateCard({ ...v, dx: Math.round(v.dx), dy: Math.round(v.dy), rz: Math.round(v.rz * 10) / 10, single: cards.length === 1 });
  }

  // 幻灯片一组：折叠状态记在本机
  const GROUP_KEY = 'slidegrid:layers-slides-open';
  let groupOpen = (() => { try { return localStorage.getItem(GROUP_KEY) !== '0'; } catch { return true; } })();
  const setGroupOpen = v => { groupOpen = v; try { localStorage.setItem(GROUP_KEY, v ? '1' : '0'); } catch { /* 忽略 */ } listKey = ''; renderList(store.get()); };

  const fadeName = st => {
    const p = FADE_PRESETS.find(x => x.id !== 'none' && Object.entries(x.patch).every(([k, v]) => st[k] === v));
    return p ? p.label : { solid: '单色', linear: '线性', mirror: '两端', radial: '径向' }[st.fadeType] || '自定义';
  };
  const btn = (ic, title, fn, on = false) => {
    const b = el('button', { class: `icon-btn visible layer-btn${on ? ' on' : ''}`, title }, icon(ic, 13));
    b.addEventListener('click', e => { e.stopPropagation(); fn(); });
    return b;
  };
  const spacer = () => el('span', { class: 'layer-btn-space' });

  // 卡片的小缩略图（左栏列表的缩略图缩小画上去）
  const thumbOf = slide => {
    const c = el('canvas', { class: 'layer-thumb' });
    c.width = 40; c.height = 26;
    const img = slide?.thumb || slide?.preview;
    const g = c.getContext('2d');
    if (img?.width) {
      const k = Math.max(40 / img.width, 26 / img.height);
      g.drawImage(img, (40 - img.width * k) / 2, (26 - img.height * k) / 2, img.width * k, img.height * k);
    } else {
      g.fillStyle = 'rgba(255,255,255,.08)';
      g.fillRect(0, 0, 40, 26);
    }
    return c;
  };

  // 点击选中：Shift / ⌘ / Ctrl 加选或取消
  const toggled = (sel, id, e) => (e.shiftKey || e.metaKey || e.ctrlKey ? (sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]) : [id]);

  // 就地改名：把名称换成输入框，回车 / 失去焦点保存，Esc 取消
  function startRename(id) {
    const row = list.querySelector(`.layer-row[data-kind="layer"][data-id="${CSS.escape(id)}"]`);
    const l = (store.get().layers || []).find(x => x.id === id);
    const name = row?.querySelector('.layer-name');
    if (!l || !name) return;
    const input = el('input', { class: 'text-input layer-rename', type: 'text', value: l.name, 'aria-label': '图层名称' });
    let done = false;
    const finish = save => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (input.isConnected) input.replaceWith(name);
      if (save && v && v !== l.name) actions.updateLayers([id], { name: v });
    };
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    for (const t of ['click', 'dblclick']) input.addEventListener(t, e => e.stopPropagation());
    name.replaceWith(input);
    input.focus();
    input.select();
  }

  function layerRow(l) {
    const active = ui.layerSel.includes(l.id);
    const name = el('span', { class: 'layer-name', title: '双击重命名' }, l.name);
    name.addEventListener('dblclick', e => { e.stopPropagation(); startRename(l.id); });
    const row = el('div', { class: `layer-row${active ? ' active' : ''}${l.hidden ? ' is-hidden' : ''}${l.under ? ' under' : ''}`, 'data-kind': 'layer', 'data-id': l.id },
      el('span', { class: 'layer-type' }, icon(TYPE_ICONS[l.type] || 'square', 13)),
      name,
      btn(l.locked ? 'lock' : 'lock-open', l.locked ? '解锁' : '锁定（锁定后在画板上点不中）', () => actions.updateLayers([l.id], { locked: !l.locked }), l.locked),
      btn(l.hidden ? 'eye-off' : 'eye', l.hidden ? '显示' : '隐藏', () => actions.updateLayers([l.id], { hidden: !l.hidden }), l.hidden),
    );
    row.addEventListener('click', e => selectLayers(toggled(ui.layerSel, l.id, e)));
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      const cur = (store.get().layers || []).find(x => x.id === l.id);
      if (cur) menus.layer(e.clientX, e.clientY, cur, { rename: x => startRename(x.id) });
    });
    return row;
  }

  function slidesGroup(s, list) {
    const st = s.style;
    const fadeOn = st.fadeType && st.fadeType !== 'none';
    const total = list.length;
    const head = el('div', { class: 'layer-row layer-group', 'data-kind': 'slides' },
      el('span', { class: `layer-caret${groupOpen ? ' open' : ''}` }, icon('chevron-down', 13)),
      el('span', { class: 'layer-type' }, icon('images', 13)),
      el('span', { class: 'layer-name' }, '幻灯片'),
      el('span', { class: 'layer-meta' }, total ? `${total} 张卡片` : '没有图片'),
    );
    head.title = '画板里的所有卡片（WebGL 绘制）。上面的图层盖在卡片上，下面的图层在卡片后面';
    head.addEventListener('click', () => setGroupOpen(!groupOpen));
    head.addEventListener('contextmenu', e => {
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, [
        { title: '幻灯片' },
        { label: groupOpen ? '收起' : '展开', icon: 'chevron-down', action: () => setGroupOpen(!groupOpen) },
        total > 0 && { label: `选中全部 ${total} 张卡片`, icon: 'check', action: () => cards.select(list.map(it => it.order)) },
        { label: fadeOn ? '调整渐隐遮罩…' : '添加渐隐遮罩…', icon: 'fade', action: () => onFade() },
        cards.canStack() && cards.stackChanged() && { sep: true },
        cards.canStack() && cards.stackChanged() && { label: '恢复版式默认的前后', icon: 'rotate-ccw', action: () => cards.resetStack() },
      ]);
    });
    const out = [head];
    if (!groupOpen) return out;
    if (fadeOn) {
      const hidden = !!st.fadeHidden;
      const row = el('div', { class: `layer-row layer-child layer-mask${hidden ? ' is-hidden' : ''}` },
        el('span', { class: 'layer-type' }, icon('fade', 13)),
        el('span', { class: 'layer-name' }, `渐隐遮罩 · ${fadeName(st)}`),
        btn(hidden ? 'eye-off' : 'eye', hidden ? '显示遮罩' : '隐藏遮罩（设置保留）', () => actions.patchStyle({ fadeHidden: !hidden }), hidden),
        btn('trash-2', '移除遮罩', () => actions.patchStyle({ fadeType: 'none', fadeHidden: false })),
      );
      row.title = '作用在所有卡片上的遮罩，点击调整方向、范围和不透明度';
      row.addEventListener('click', () => onFade());
      row.addEventListener('contextmenu', e => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          { title: '渐隐遮罩' },
          { label: '调整…', icon: 'fade', action: () => onFade() },
          { label: hidden ? '显示遮罩' : '隐藏遮罩（设置保留）', icon: hidden ? 'eye' : 'eye-off', action: () => actions.patchStyle({ fadeHidden: !hidden }) },
          { label: '移除遮罩', icon: 'trash-2', danger: true, action: () => actions.patchStyle({ fadeType: 'none', fadeHidden: false }) },
        ]);
      });
      out.push(row);
    }
    const stackable = cards.canStack();
    const draggable = cards.canDrag();
    for (const it of list) {
      const order = it.order;
      const active = ui.selection.includes(order);
      const real = !it.slide.placeholder;
      const row = el('div', { class: `layer-row layer-child layer-card${active ? ' active' : ''}`, 'data-kind': 'card', 'data-id': String(order) },
        thumbOf(real ? it.slide : null),
        el('span', { class: 'layer-name' }, real ? it.slide.name : '空位'),
        el('span', { class: 'layer-meta' }, `#${it.slideIndex + 1}`),
      );
      const label = real ? it.slide.name : '空位';
      row.title = draggable ? `${label} · 点击选中，拖动调整前后，右键更多操作`
        : stackable ? `${label} · 点击选中，右键调整前后（卡片太多，不能拖动）`
          : `${label} · 3D 版式里卡片的前后由空间位置决定`;
      row.addEventListener('click', e => cards.select(toggled(ui.selection, order, e)));
      row.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (!ui.selection.includes(order)) cards.select([order]);
        menus.card(e.clientX, e.clientY, it);
      });
      row.addEventListener('mouseenter', () => { if (!dragging) cards.hover(order); });
      row.addEventListener('mouseleave', () => cards.hover(null));
      out.push(row);
    }
    if (total && !stackable) {
      out.push(el('div', { class: 'layer-row layer-child layer-empty' },
        el('span', { class: 'layer-name' }, cardParams?.() ? '3D 版式：前后由空间位置决定，可选中卡片在「设计」页抬起 / 放平' : '3D 版式：卡片前后由空间位置决定，不能调整前后')));
    }
    if (!total) out.push(el('div', { class: 'layer-row layer-child layer-empty' }, el('span', { class: 'layer-name' }, '左侧导入图片后显示在这里')));
    return out;
  }

  let listKey = '';
  let lastCards = null;
  function renderList(s) {
    const layers = s.layers || [];
    empty.hidden = layers.length > 0;
    const cardList = cards.list();
    // 只在内容变化时重建列表
    const key = JSON.stringify([
      layers.map(l => [l.id, l.name, l.type, l.hidden, l.locked, !!l.under]), ui.layerSel, ui.selection,
      s.style.fadeType, s.style.fadeHidden, s.style.fadeAngle, s.style.fadeStart, s.style.fadeEnd, s.style.fadeFrom, s.style.fadeTo,
      groupOpen, cards.canStack(), cards.canDrag(),
    ]);
    if (key === listKey && cardList === lastCards) return;
    if (dragging) cancelDrag(); // 列表要重建了（撤销、切换画板…）：放弃这次拖动
    listKey = key;
    lastCards = cardList;
    const above = layers.filter(l => !l.under).reverse();
    const below = layers.filter(l => l.under).reverse();
    list.replaceChildren(...above.map(layerRow), ...slidesGroup(s, cardList), ...below.map(layerRow), dropLine);
    hint.hidden = !layers.length && !cardList.length;
  }

  /* ---------- 拖动调整前后 ----------
   * 图层：可以拖到任何图层的上面 / 下面，也可以拖过「幻灯片」一组（整组算一层）；选中多个时一起拖。
   * 卡片（平面版式）：在卡片之间拖动。列表里上面的在前面，所以「放在某一行上面」= 盖住它。
   */
  let dragging = null; // { kind, ids, drop: { target, place } | null }
  let suppressClick = false;
  const rowsOf = kind => [...list.querySelectorAll(`.layer-row[data-kind="${kind}"]`)];
  const scroller = () => { for (let n = list.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n; } return null; };

  // 可以放的位置：一个个「块」（从上到下）。图层拖动时「幻灯片」整组是一个块
  function blocksFor(d) {
    const moving = new Set(d.ids);
    if (d.kind === 'card') {
      return rowsOf('card').filter(r => !moving.has(r.dataset.id)).map(r => ({ id: +r.dataset.id, top: r.getBoundingClientRect().top, bottom: r.getBoundingClientRect().bottom }));
    }
    const out = [];
    for (const r of list.children) {
      if (!r.classList.contains('layer-row')) continue;
      const box = r.getBoundingClientRect();
      if (r.dataset.kind === 'layer') { if (!moving.has(r.dataset.id)) out.push({ id: r.dataset.id, top: box.top, bottom: box.bottom }); }
      else if (r.dataset.kind === 'slides') out.push({ id: slidesId, top: box.top, bottom: box.bottom, group: true });
      else if (out.length && out[out.length - 1].group) out[out.length - 1].bottom = box.bottom; // 组里的行（遮罩、卡片、提示）
    }
    return out;
  }
  function dropAt(d, y) {
    const blocks = blocksFor(d);
    if (!blocks.length) return null;
    for (const b of blocks) if (y < (b.top + b.bottom) / 2) return { target: b.id, place: 'above', y: b.top - 1 };
    const last = blocks[blocks.length - 1];
    return { target: last.id, place: 'below', y: last.bottom + 1 };
  }
  function showDrop(d) {
    dropLine.hidden = !d.drop;
    if (!d.drop) return;
    const box = list.getBoundingClientRect();
    dropLine.style.top = `${d.drop.y - box.top - 1}px`;
    dropLine.style.left = d.kind === 'card' ? '14px' : '0';
  }
  let scrollTimer = 0;
  function autoScroll(y) {
    cancelAnimationFrame(scrollTimer);
    const sc = scroller();
    if (!sc || !dragging) return;
    const box = sc.getBoundingClientRect();
    const v = y < box.top + 28 ? -8 : y > box.bottom - 28 ? 8 : 0;
    if (!v) return;
    const tick = () => {
      if (!dragging) return;
      const before = sc.scrollTop;
      sc.scrollTop += v;
      if (sc.scrollTop === before) return;
      dragging.drop = dropAt(dragging, y);
      showDrop(dragging);
      scrollTimer = requestAnimationFrame(tick);
    };
    scrollTimer = requestAnimationFrame(tick);
  }
  function endDrag() {
    cancelAnimationFrame(scrollTimer);
    dropLine.hidden = true;
    list.classList.remove('is-dragging');
    document.body.classList.remove('layer-dragging');
    for (const r of list.querySelectorAll('.layer-row.dragging')) r.classList.remove('dragging');
    dragging = null;
  }
  let cancelDrag = () => {};

  list.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('button, input')) return;
    const row = e.target.closest('.layer-row');
    const kind = row?.dataset.kind;
    if (kind !== 'layer' && !(kind === 'card' && cards.canDrag())) return;
    const id = row.dataset.id;
    const x0 = e.clientX, y0 = e.clientY;
    const move = ev => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
        // 拖的这一行在选中的里面：一起拖；否则只拖这一行（并选中它）
        let ids;
        if (kind === 'layer') {
          if (!ui.layerSel.includes(id)) selectLayers([id]);
          ids = [...ui.layerSel];
        } else {
          if (!ui.selection.includes(+id)) cards.select([+id]);
          ids = ui.selection.map(String);
        }
        dragging = { kind, ids, drop: null };
        cards.hover(null);
        list.classList.add('is-dragging');
        document.body.classList.add('layer-dragging');
        for (const r of rowsOf(kind)) r.classList.toggle('dragging', ids.includes(r.dataset.id));
      }
      ev.preventDefault();
      dragging.drop = dropAt(dragging, ev.clientY);
      showDrop(dragging);
      autoScroll(ev.clientY);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      cancelDrag = () => {};
    };
    const up = () => {
      const d = dragging;
      stop();
      if (!d) return;
      endDrag();
      suppressClick = true; // 松手后的那次点击不算选中
      setTimeout(() => { suppressClick = false; }, 0);
      if (!d.drop) return;
      const ok = d.kind === 'layer' ? placeLayers(d.ids, d.drop.target, d.drop.place) : cards.place(d.ids.map(Number), d.drop.target, d.drop.place);
      if (!ok && d.kind === 'card') notify('前后顺序没有变化');
    };
    const cancel = () => { stop(); if (dragging) endDrag(); };
    const key = ev => { if (ev.key === 'Escape' && dragging) { ev.preventDefault(); ev.stopPropagation(); cancel(); } };
    cancelDrag = cancel;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
  });
  list.addEventListener('click', e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);
  list.addEventListener('contextmenu', e => e.preventDefault());

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
