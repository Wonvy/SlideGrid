import { layouts, getLayout } from '../layouts/index.js';
import { selectionOf } from '../state.js';
import { styleSchema } from '../style/schema.js';
import { buildControls } from './controls.js';
import { wheelModeSchema } from './wheel.js';
import { el, section } from './dom.js';
import { icon } from './icons.js';

const MAIN_TAB_KEY = 'slidegrid:right-tab';
const LAYOUT_TAB_KEY = 'slidegrid:layout-tab';
const store_ = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 忽略 */ } },
};

/**
 * 右侧面板：三个标签页，各自独立滚动。
 *   设计：跟随选择（类似 Figma）——选中图层时是图层属性，选中卡片时是卡片的裁切 / 位置，
 *         什么都没选时是画板设置：当前版式、版式参数、构图、样式、偏好
 *   版式：内置 / 我的版式（只负责选版式，不会误点）
 *   图层：当前画板的图层列表
 */
export function createSettingsPanel(root, { store, actions, notify = () => {}, imageCtx = {}, onBoardRequest = null }) {
  root.innerHTML = '';
  root.classList.add('right-panel');

  /* ================= 顶层标签 ================= */
  // 左侧竖排的图标栏切换页面，右边是页面标题 + 内容
  const TITLES = { params: '设计', layouts: '版式', layers: '图层' };
  const layerCount = el('span', { class: 'tab-count' });
  const tab = (k, ic, ...extra) => el('button', { class: 'rp-tab', role: 'tab', title: TITLES[k], 'aria-label': TITLES[k] }, icon(ic, 18), ...extra);
  const mainTabs = {
    params: tab('params', 'settings-2'),
    layouts: tab('layouts', 'layout-grid'),
    layers: tab('layers', 'layers', layerCount),
  };
  const pageTitle = el('div', { class: 'rp-title' });
  const panes = {
    params: el('div', { class: 'rp-pane', role: 'tabpanel' }),
    layouts: el('div', { class: 'rp-pane', role: 'tabpanel' }),
    layers: el('div', { class: 'rp-pane', role: 'tabpanel' }),
  };
  function showMain(name) {
    for (const k of Object.keys(panes)) {
      panes[k].hidden = k !== name;
      mainTabs[k].classList.toggle('active', k === name);
      mainTabs[k].setAttribute('aria-selected', String(k === name));
    }
    pageTitle.textContent = TITLES[name];
    store_.set(MAIN_TAB_KEY, name);
  }
  for (const k of Object.keys(mainTabs)) mainTabs[k].addEventListener('click', () => showMain(k));
  root.append(
    el('div', { class: 'rp-tabs rp-rail', role: 'tablist', 'aria-orientation': 'vertical' }, ...Object.values(mainTabs)),
    el('div', { class: 'rp-main' }, pageTitle, ...Object.values(panes)),
  );

  /* ================= 版式页：内置 / 我的版式 ================= */
  const builtin = el('div', { class: 'tab-body' });
  const layoutButtons = new Map();
  const pick = (l, thenParams) => {
    if (!actions.setLayout(l.id) && store.get().aspect === 'long') { notify(`「${l.name}」不支持长图模式`); return; }
    if (thenParams) showMain('params');
  };
  for (const [cat, title] of [['flat', '平面'], ['3d', '3D 透视']]) {
    const grid = el('div', { class: 'picker-grid' });
    for (const l of layouts.filter(x => x.category === cat)) {
      const ic = el('span', { class: 'layout-icon' });
      ic.innerHTML = l.icon;
      const btn = el('button', { class: 'layout-btn', title: l.name }, ic, el('span', { class: 'layout-name' }, l.name));
      btn.addEventListener('click', () => pick(l, false));
      btn.addEventListener('dblclick', () => pick(l, true)); // 双击：应用并去调参数
      layoutButtons.set(l.id, btn);
      grid.append(btn);
    }
    builtin.append(el('div', { class: 'picker-title' }, title), grid);
  }
  builtin.append(el('p', { class: 'note pane-hint' }, '单击应用版式 · 双击应用并切到「设计」'));
  const mine = el('div', { class: 'tab-body' });

  const tabBuiltin = el('button', { class: 'tab', onclick: () => showLayoutTab('builtin') }, '内置');
  const mineCount = el('span', { class: 'tab-count' });
  const tabMine = el('button', { class: 'tab', onclick: () => showLayoutTab('mine') }, icon('layout-template', 13), '我的版式', mineCount);
  function showLayoutTab(name) {
    builtin.hidden = name !== 'builtin';
    mine.hidden = name !== 'mine';
    tabBuiltin.classList.toggle('active', name === 'builtin');
    tabMine.classList.toggle('active', name === 'mine');
    store_.set(LAYOUT_TAB_KEY, name);
  }
  showLayoutTab(store_.get(LAYOUT_TAB_KEY) === 'mine' ? 'mine' : 'builtin');
  panes.layouts.append(el('div', { class: 'pane-body' }, el('div', { class: 'tabs' }, tabBuiltin, tabMine), builtin, mine));

  /* ================= 设计页（没有选择时：画板设置） ================= */
  // 当前版式卡片：一眼看到在调哪个版式，「更换」回到版式页
  const curIcon = el('span', { class: 'layout-icon' });
  const curName = el('div', { class: 'cur-name' });
  const curMeta = el('div', { class: 'cur-meta' });
  const current = el('div', { class: 'current-layout' },
    curIcon,
    el('div', { class: 'cur-text' }, curName, curMeta),
    el('button', { class: 'btn ghost small', title: '去「版式」页选择其他版式', onclick: () => showMain('layouts') }, '更换'));
  // 多选画板时的提示：修改会同步到所有选中的画板
  const multiText = el('span', {});
  const multiBanner = el('div', { class: 'multi-banner', hidden: true },
    icon('frame', 14), multiText,
    el('button', { class: 'btn ghost small', title: '只保留当前画板，退出批量编辑', onclick: () => actions.setActiveBoard(store.get().activeBoard) }, '只编辑当前'));
  // 设计页：选中图层 / 卡片时显示它们的属性（ui/inspector.js），否则显示画板设置
  const selectionSlot = el('div', { class: 'inspector', hidden: true });
  const boardBox = el('div');
  boardBox.append(multiBanner);
  panes.params.append(selectionSlot, boardBox);
  // 图层页
  const layersSlot = el('div', { class: 'inspector' });
  panes.layers.append(layersSlot);

  // 画板设置只有一级分组（标题 14px，都可折叠）：版式 → 构图 → 背景 / 卡片 / 渐隐遮罩 / 投影 → 偏好
  const resetBtn = (title, fn) => el('button', { class: 'icon-btn visible', title, 'aria-label': title, onclick: fn }, icon('rotate-ccw', 14));
  const paramsBox = el('div');
  boardBox.append(section('版式', el('div', {}, current, paramsBox), resetBtn('恢复当前版式的默认参数', () => actions.resetParams())));

  const cameraNote = el('p', { class: 'note compact' });
  boardBox.append(section('构图', cameraNote, resetBtn('复位构图（缩放、平移、3D 角度）', () => actions.resetCamera())));

  // 样式的各个分组直接作为一级分组（不再套一层「样式」）
  const styleBox = el('div', { class: 'groups-box' });
  const styleSection = styleBox;
  boardBox.append(styleBox);

  const prefsBox = el('div');
  boardBox.append(section('偏好', prefsBox, null, 'section:偏好', { collapsed: true }));

  const saved = store_.get(MAIN_TAB_KEY);
  showMain(saved in panes ? saved : 'params');

  /* ================= 同步 ================= */
  const s0 = store.get();
  const updateStyle = buildControls(styleBox, styleSchema, s0.style, actions.setStyle, { ...imageCtx, collapseKey: 'style' });
  const updatePrefs = buildControls(prefsBox, wheelModeSchema, s0, actions.setPref);
  let updateParams = () => {};
  let currentLayout = null;

  function update(s) {
    if (s.layoutId !== currentLayout) {
      currentLayout = s.layoutId;
      const layout = getLayout(currentLayout);
      updateParams = buildControls(paramsBox, layout.params, s.params[currentLayout], actions.setParam);
      layoutButtons.forEach((b, id) => b.classList.toggle('active', id === currentLayout));
      curIcon.innerHTML = layout.icon;
      curName.textContent = layout.name;
      curMeta.textContent = `${layout.category === '3d' ? '3D 透视' : '平面'}版式${layout.long ? ' · 支持长图' : ''}`;
      cameraNote.textContent = layout.category === '3d'
        ? '构图工具（O）：拖动旋转视角 · Shift 拖动平移 · 滚轮缩放'
        : '构图工具（O）：拖动平移 · 滚轮缩放';
    }
    const long = s.aspect === 'long';
    layoutButtons.forEach((b, id) => {
      const off = long && !getLayout(id).long;
      b.classList.toggle('disabled', off);
      b.title = off ? `${getLayout(id).name}（长图模式下不可用）` : getLayout(id).name;
    });
    updateParams(s.params[currentLayout]);
    updateStyle(s.style);
    updatePrefs(s);
    const n = selectionOf(s).length;
    multiBanner.hidden = n <= 1;
    multiText.textContent = `同时编辑 ${n} 个画板（构图、卡片调整除外）`;
  }
  update(s0);

  // 切到「设计」页（画板设置），展开「样式」里的某个分组并滚动到那里（工具条背景 / 遮罩面板的「更多设置」）
  function revealStyleGroup(name) {
    showMain('params');
    onBoardRequest?.(); // 有选中的图层 / 卡片时先取消选择，回到画板设置
    const group = [...styleBox.querySelectorAll('button.ctrl-group')].find(g => g.textContent === name);
    if (group?.classList.contains('collapsed')) group.click();
    (group || styleSection).scrollIntoView({ block: 'start', behavior: 'smooth' });
    styleSection.classList.add('flash');
    setTimeout(() => styleSection.classList.remove('flash'), 900);
  }

  return {
    update,
    revealBackground: () => revealStyleGroup('背景'),
    revealStyleGroup,
    presetsContainer: mine,
    selectionSlot,
    layersSlot,
    currentTab: () => Object.keys(panes).find(k => !panes[k].hidden),
    // 设计页显示选中对象的属性（true）还是画板设置（false）
    setSelectionMode(on) { selectionSlot.hidden = !on; boardBox.hidden = on; },
    setLayerCount: n => { layerCount.textContent = n ? String(n) : ''; },
    // 打开「版式」页的某个子标签（导入版式文件时用）
    showTab: name => { showMain('layouts'); showLayoutTab(name); },
    showMain,
    setPresetCount: n => { mineCount.textContent = n ? String(n) : ''; },
  };
}
