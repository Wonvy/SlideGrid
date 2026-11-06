import { layouts, getLayout } from '../layouts/index.js';
import { selectionOf } from '../state.js';
import { styleSchema } from '../style/schema.js';
import { buildControls } from './controls.js';
import { wheelModeSchema } from './wheel.js';
import { el, section, isCollapsed, setCollapsed } from './dom.js';
import { icon } from './icons.js';

const MAIN_TAB_KEY = 'slidegrid:right-tab';
const LAYOUT_TAB_KEY = 'slidegrid:layout-tab';
const store_ = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 忽略 */ } },
};

/**
 * 右侧面板：左边竖排图标栏切换页面（参照 Screen Studio），每页独立滚动。
 *   设计：跟随选择（类似 Figma）——选中图层时是图层属性，选中卡片时是卡片的裁切 / 位置，
 *         什么都没选时是当前画板的版式参数和构图
 *   版式：内置 / 我的版式（只负责选版式，不会误点）
 *   设计：版式参数、卡片样式（圆角、描边等）、构图
 *   背景 / 投影 / 渐隐遮罩：画板样式，各自一页（与选择无关，随时可调）
 *   图层：当前画板的图层列表
 *   样机：把幻灯片放进笔记本 / 显示器 / 平板 / 投影幕（添加为样机图层）
 *   偏好：滚轮等操作习惯（图标栏底部）
 */
export function createSettingsPanel(root, { store, actions, notify = () => {}, imageCtx = {}, onBoardRequest = null }) {
  root.innerHTML = '';
  root.classList.add('right-panel');

  /* ================= 顶层标签 ================= */
  // 左侧竖排的图标栏切换页面，右边是页面标题 + 内容
  const TITLES = { params: '设计', layouts: '版式', bg: '背景', shadow: '投影', fade: '渐隐遮罩', layers: '图层', mockup: '样机', prefs: '偏好' };
  // 样式页对应 style/schema.js 里的分组（「卡片」分组放在设计页里，见下）
  const STYLE_PAGES = { bg: '背景', shadow: '投影', fade: '渐隐遮罩' };
  const layerCount = el('span', { class: 'tab-count' });
  const tab = (k, ic, ...extra) => el('button', { class: 'rp-tab', role: 'tab', title: TITLES[k], 'aria-label': TITLES[k] }, icon(ic, 18), ...extra);
  const mainTabs = {
    params: tab('params', 'sliders-horizontal'),
    layouts: tab('layouts', 'layout-grid'),
    bg: tab('bg', 'paint-bucket'),
    shadow: tab('shadow', 'sun-dim'),
    fade: tab('fade', 'fade'),
    layers: tab('layers', 'layers', layerCount),
    mockup: tab('mockup', 'laptop'),
    prefs: tab('prefs', 'cog'),
  };
  mainTabs.prefs.classList.add('rp-bottom');
  const pageTitle = el('div', { class: 'rp-title' });
  const panes = Object.fromEntries(Object.keys(TITLES).map(k => [k, el('div', { class: 'rp-pane', role: 'tabpanel' })]));
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
  // 多选画板时的提示：修改会同步到所有选中的画板（在任何页都显示）
  const multiText = el('span', {});
  const multiBanner = el('div', { class: 'multi-banner', hidden: true },
    icon('frame', 14), multiText,
    el('button', { class: 'btn ghost small', title: '只保留当前画板，退出批量编辑', onclick: () => actions.setActiveBoard(store.get().activeBoard) }, '只编辑当前'));
  const sep = () => el('span', { class: 'rp-sep' });
  const t = mainTabs;
  root.append(
    el('div', { class: 'rp-tabs rp-rail', role: 'tablist', 'aria-orientation': 'vertical' },
      t.layouts, t.params, sep(), t.bg, t.shadow, t.fade, sep(), t.layers, t.mockup, t.prefs),
    el('div', { class: 'rp-main' }, pageTitle, multiBanner, ...Object.values(panes)),
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
    // 分组标题：点击折叠 / 展开（与其他页面的分组一致，状态会记住）
    const key = `layouts:${cat}`;
    const head = el('button', { class: 'ctrl-group picker-group', title: '折叠 / 展开', 'aria-expanded': 'true' }, el('span', {}, title), icon('chevron-down', 16));
    const apply = () => {
      const c = isCollapsed(key);
      head.classList.toggle('collapsed', c);
      head.setAttribute('aria-expanded', String(!c));
      grid.hidden = c;
    };
    head.addEventListener('click', () => { setCollapsed(key, !isCollapsed(key)); apply(); });
    apply();
    builtin.append(head, grid);
  }
  builtin.append(el('p', { class: 'note pane-hint' }, '单击应用版式 · 双击应用并切到「设计」'));
  const mine = el('div', { class: 'tab-body' });
  // 「我的版式」的保存 / 导入 / 导出固定在页面底部（列表单独滚动）
  const presetsFooter = el('div', { class: 'rp-footer', hidden: true });

  const tabBuiltin = el('button', { class: 'tab', onclick: () => showLayoutTab('builtin') }, '内置');
  const mineCount = el('span', { class: 'tab-count' });
  const tabMine = el('button', { class: 'tab', onclick: () => showLayoutTab('mine') }, icon('layout-template', 13), '我的版式', mineCount);
  function showLayoutTab(name) {
    builtin.hidden = name !== 'builtin';
    mine.hidden = name !== 'mine';
    tabBuiltin.classList.toggle('active', name === 'builtin');
    tabMine.classList.toggle('active', name === 'mine');
    presetsFooter.hidden = name !== 'mine';
    store_.set(LAYOUT_TAB_KEY, name);
  }
  showLayoutTab(store_.get(LAYOUT_TAB_KEY) === 'mine' ? 'mine' : 'builtin');
  panes.layouts.classList.add('has-footer');
  panes.layouts.append(el('div', { class: 'pane-body' }, el('div', { class: 'tabs' }, tabBuiltin, tabMine), builtin, mine), presetsFooter);

  /* ================= 设计页（没有选择时：画板设置） ================= */
  // 当前版式卡片：一眼看到在调哪个版式，「更换」回到版式页
  const curIcon = el('span', { class: 'layout-icon' });
  const curName = el('div', { class: 'cur-name' });
  const curMeta = el('div', { class: 'cur-meta' });
  const current = el('div', { class: 'current-layout' },
    curIcon,
    el('div', { class: 'cur-text' }, curName, curMeta),
    el('button', { class: 'btn ghost small', title: '去「版式」页选择其他版式', onclick: () => showMain('layouts') }, '更换'));
  // 设计页：选中图层 / 卡片时显示它们的属性（ui/inspector.js），否则显示画板设置
  const selectionSlot = el('div', { class: 'inspector', hidden: true });
  const boardBox = el('div');
  // 设计页底部固定「保存当前版式」（只在显示画板设置时出现，见 presetsPanel 的 saveFooter）
  const designFooter = el('div', { class: 'rp-footer design-footer' });
  panes.params.classList.add('has-footer');
  panes.params.append(el('div', { class: 'design-body' }, selectionSlot, boardBox), designFooter);
  // 图层页
  const layersSlot = el('div', { class: 'inspector' });
  panes.layers.append(layersSlot);
  // 样机页（ui/mockupPanel.js 填充）
  const mockupSlot = el('div', { class: 'page-body' });
  panes.mockup.append(mockupSlot);

  // 设计页（没有选择时）：版式参数、构图
  const resetBtn = (title, fn) => el('button', { class: 'icon-btn visible', title, 'aria-label': title, onclick: fn }, icon('rotate-ccw', 14));
  const paramsBox = el('div');
  boardBox.append(section('版式', el('div', {}, current, paramsBox), resetBtn('恢复当前版式的默认参数', () => actions.resetParams())));

  // 卡片样式（style/schema.js 的「卡片」分组）
  const cardStyleBox = el('div');
  boardBox.append(section('卡片', cardStyleBox));

  // 构图：没有可调的参数，只在用构图工具调整过之后出现（显示调整了什么 + 复位）
  const cameraNote = el('p', { class: 'note compact' });
  const cameraSection = section('构图', cameraNote, resetBtn('复位构图（缩放、平移、3D 角度）', () => actions.resetCamera()));
  boardBox.append(cameraSection);

  // 样式各页：直接放这一组的参数（页面标题就是分组名）
  const styleBoxes = {};
  for (const k of Object.keys(STYLE_PAGES)) {
    styleBoxes[k] = el('div');
    panes[k].append(el('div', { class: 'page-body' }, styleBoxes[k]));
  }
  // 偏好页
  const prefsBox = el('div');
  panes.prefs.append(el('div', { class: 'page-body' }, prefsBox));

  const saved = store_.get(MAIN_TAB_KEY);
  showMain(saved in panes ? saved : 'params');

  /* ================= 同步 ================= */
  const s0 = store.get();
  // styleSchema 按分组切开，每页一份
  const groupItems = name => {
    const i = styleSchema.findIndex(d => d.group === name);
    const j = styleSchema.findIndex((d, k) => k > i && d.group);
    return styleSchema.slice(i + 1, j < 0 ? undefined : j);
  };
  const styleUpdaters = Object.entries(STYLE_PAGES).map(([k, name]) =>
    buildControls(styleBoxes[k], groupItems(name), s0.style, actions.setStyle, imageCtx));
  styleUpdaters.push(buildControls(cardStyleBox, groupItems('卡片'), s0.style, actions.setStyle, imageCtx));
  const updateStyle = st => styleUpdaters.forEach(u => u(st));
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
    }
    const cam = s.camera || {};
    const changed = [
      Math.abs((cam.zoom ?? 1) - 1) > 1e-3 ? `缩放 ${Math.round((cam.zoom ?? 1) * 100)}%` : '',
      Math.abs(cam.panX || 0) > 1e-3 || Math.abs(cam.panY || 0) > 1e-3 ? '平移' : '',
      Math.abs(cam.yaw || 0) > 1e-3 || Math.abs(cam.pitch || 0) > 1e-3 ? '3D 角度' : '',
    ].filter(Boolean);
    cameraSection.hidden = !changed.length;
    cameraNote.textContent = `已调整：${changed.join('、')}（构图工具 O）`;
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

  // 打开某个样式页（工具条背景 / 遮罩面板的「更多设置」）
  function revealStyleGroup(name) {
    const page = Object.keys(STYLE_PAGES).find(k => STYLE_PAGES[k] === name) || (name === '卡片' ? 'params' : 'bg');
    showMain(page);
    panes[page].classList.add('flash');
    setTimeout(() => panes[page].classList.remove('flash'), 900);
  }

  return {
    update,
    revealBackground: () => revealStyleGroup('背景'),
    revealStyleGroup,
    presetsContainer: mine,
    presetsFooter,
    designFooter,
    mockupSlot,
    selectionSlot,
    layersSlot,
    currentTab: () => Object.keys(panes).find(k => !panes[k].hidden),
    // 设计页显示选中对象的属性（true）还是画板设置（false）
    setSelectionMode(on) { selectionSlot.hidden = !on; boardBox.hidden = on; designFooter.hidden = on; },
    setLayerCount: n => { layerCount.textContent = n ? String(n) : ''; },
    // 打开「版式」页的某个子标签（导入版式文件时用）
    showTab: name => { showMain('layouts'); showLayoutTab(name); },
    showMain,
    setPresetCount: n => { mineCount.textContent = n ? String(n) : ''; },
  };
}
