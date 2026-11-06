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
 * 右侧面板：两个标签页，各自独立滚动。
 *   版式：内置 / 我的版式（只负责选版式）
 *   参数：当前版式卡片、版式参数、构图、样式、偏好（只负责调参数，不会误点到版式）
 */
export function createSettingsPanel(root, { store, actions, notify = () => {}, imageCtx = {} }) {
  root.innerHTML = '';
  root.classList.add('right-panel');

  /* ================= 顶层标签 ================= */
  const mainTabs = {
    layouts: el('button', { class: 'rp-tab', role: 'tab' }, icon('layout-grid', 15), '版式'),
    params: el('button', { class: 'rp-tab', role: 'tab' }, icon('settings-2', 15), '参数'),
  };
  const panes = {
    layouts: el('div', { class: 'rp-pane', role: 'tabpanel' }),
    params: el('div', { class: 'rp-pane', role: 'tabpanel' }),
  };
  function showMain(name) {
    for (const k of Object.keys(panes)) {
      panes[k].hidden = k !== name;
      mainTabs[k].classList.toggle('active', k === name);
      mainTabs[k].setAttribute('aria-selected', String(k === name));
    }
    store_.set(MAIN_TAB_KEY, name);
  }
  mainTabs.layouts.addEventListener('click', () => showMain('layouts'));
  mainTabs.params.addEventListener('click', () => showMain('params'));
  root.append(el('div', { class: 'rp-tabs', role: 'tablist' }, mainTabs.layouts, mainTabs.params), panes.layouts, panes.params);

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
  builtin.append(el('p', { class: 'note pane-hint' }, '单击应用版式 · 双击应用并切到「参数」'));
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

  /* ================= 参数页 ================= */
  // 当前版式卡片：一眼看到在调哪个版式，「更换」回到版式页
  const curIcon = el('span', { class: 'layout-icon' });
  const curName = el('div', { class: 'cur-name' });
  const curMeta = el('div', { class: 'cur-meta' });
  const current = el('div', { class: 'current-layout' },
    curIcon,
    el('div', { class: 'cur-text' }, curName, curMeta),
    el('button', { class: 'btn small', title: '去「版式」页选择其他版式', onclick: () => showMain('layouts') }, icon('layout-grid', 13), '更换'));
  // 多选画板时的提示：修改会同步到所有选中的画板
  const multiText = el('span', {});
  const multiBanner = el('div', { class: 'multi-banner', hidden: true },
    icon('frame', 14), multiText,
    el('button', { class: 'btn ghost small', title: '只保留当前画板，退出批量编辑', onclick: () => actions.setActiveBoard(store.get().activeBoard) }, '只编辑当前'));
  // 检查器（选中图层 / 卡片的属性、图层列表）放在最上面，见 ui/inspector.js
  const inspectorSlot = el('div', { class: 'inspector' });
  panes.params.append(inspectorSlot, multiBanner, current);

  const paramsBox = el('div');
  panes.params.append(section('版式参数', paramsBox,
    el('button', { class: 'btn ghost small', title: '恢复当前版式的默认参数', onclick: () => actions.resetParams() }, icon('rotate-ccw', 13), '恢复默认')));

  const cameraNote = el('p', { class: 'note' });
  panes.params.append(section('构图', cameraNote,
    el('button', { class: 'btn ghost small', title: '复位构图（缩放、平移、3D 角度）', onclick: () => actions.resetCamera() }, icon('rotate-ccw', 13), '复位')));

  const styleBox = el('div');
  const styleSection = section('样式', styleBox);
  panes.params.append(styleSection);

  const prefsBox = el('div');
  panes.params.append(section('偏好', prefsBox));

  showMain(store_.get(MAIN_TAB_KEY) === 'layouts' ? 'layouts' : 'params');

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
        ? '用「构图」工具（O）调整：拖动旋转 3D 视角，Shift + 拖动平移，滚轮缩放。构图会一起导出。'
        : '用「构图」工具（O）调整：拖动平移，滚轮缩放。构图会一起导出（与工作区的视图缩放无关）。';
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
    multiText.textContent = `正在同时编辑 ${n} 个画板：样式、比例、版式和参数会一起修改（构图、卡片调整除外）`;
  }
  update(s0);

  // 切到「参数」页，展开「样式」里的某个分组并滚动到那里（工具条背景 / 遮罩面板的「更多设置」）
  function revealStyleGroup(name) {
    showMain('params');
    if (styleSection.classList.contains('collapsed')) styleSection.querySelector('.section-toggle').click();
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
    inspectorSlot,
    isParamsShown: () => !panes.params.hidden,
    // 打开「版式」页的某个子标签（导入版式文件时用）
    showTab: name => { showMain('layouts'); showLayoutTab(name); },
    showMain,
    setPresetCount: n => { mineCount.textContent = n ? String(n) : ''; },
  };
}
