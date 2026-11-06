import { layouts, getLayout } from '../layouts/index.js';
import { styleSchema } from '../style/schema.js';
import { buildControls } from './controls.js';
import { wheelModeSchema } from './wheel.js';
import { el, section } from './dom.js';
import { icon } from './icons.js';

const TAB_KEY = 'slidegrid:layout-tab';

// 右侧设置面板：版式（内置 / 我的版式）、版式参数、视角、样式、偏好。每个区块都可以折叠。
export function createSettingsPanel(root, { store, actions, notify = () => {}, imageCtx = {} }) {
  root.innerHTML = '';

  /* ---------- 版式：内置 / 我的版式 ---------- */
  const builtin = el('div', { class: 'tab-body' });
  const layoutButtons = new Map();
  for (const [cat, title] of [['flat', '平面'], ['3d', '3D 透视']]) {
    const grid = el('div', { class: 'picker-grid' });
    for (const l of layouts.filter(x => x.category === cat)) {
      const ic = el('span', { class: 'layout-icon' });
      ic.innerHTML = l.icon;
      const btn = el('button', {
        class: 'layout-btn', title: l.name,
        onclick: () => { if (!actions.setLayout(l.id) && store.get().aspect === 'long') notify(`「${l.name}」不支持长图模式`); },
      }, ic, el('span', { class: 'layout-name' }, l.name));
      layoutButtons.set(l.id, btn);
      grid.append(btn);
    }
    builtin.append(el('div', { class: 'picker-title' }, title), grid);
  }
  const mine = el('div', { class: 'tab-body' });

  const tabBuiltin = el('button', { class: 'tab', onclick: () => showTab('builtin') }, '内置');
  const mineCount = el('span', { class: 'tab-count' });
  const tabMine = el('button', { class: 'tab', onclick: () => showTab('mine') }, icon('layout-template', 13), '我的版式', mineCount);
  function showTab(name) {
    builtin.hidden = name !== 'builtin';
    mine.hidden = name !== 'mine';
    tabBuiltin.classList.toggle('active', name === 'builtin');
    tabMine.classList.toggle('active', name === 'mine');
    try { localStorage.setItem(TAB_KEY, name); } catch { /* 忽略 */ }
  }
  let initialTab = 'builtin';
  try { initialTab = localStorage.getItem(TAB_KEY) === 'mine' ? 'mine' : 'builtin'; } catch { /* 忽略 */ }
  showTab(initialTab);

  root.append(section('版式', el('div', {}, el('div', { class: 'tabs' }, tabBuiltin, tabMine), builtin, mine)));

  /* ---------- 版式参数 ---------- */
  const paramsBox = el('div');
  root.append(section('版式参数', paramsBox,
    el('button', { class: 'btn ghost small', title: '恢复当前版式的默认参数', onclick: () => actions.resetParams() }, icon('rotate-ccw', 13), '恢复默认')));

  /* ---------- 视角 ---------- */
  const cameraNote = el('p', { class: 'note' });
  root.append(section('视角', cameraNote,
    el('button', { class: 'btn ghost small', title: '复位视图', onclick: () => actions.resetCamera() }, icon('rotate-ccw', 13), '复位')));

  /* ---------- 样式 ---------- */
  const styleBox = el('div');
  root.append(section('样式', styleBox));

  /* ---------- 偏好（跨项目） ---------- */
  const prefsBox = el('div');
  root.append(section('偏好', prefsBox));

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
      cameraNote.textContent = layout.category === '3d'
        ? '视角工具（O）或右键拖动旋转；中键 / 空格拖动平移；滚轮缩放；双击空白处复位。视图会一起导出。'
        : '抓手工具（H）、中键或空格拖动平移；滚轮缩放；双击空白处复位。视图会一起导出。';
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
  }

  update(s0);
  return {
    update,
    presetsContainer: mine,
    showTab,
    setPresetCount: n => { mineCount.textContent = n ? String(n) : ''; },
  };
}
