import { layouts, getLayout } from '../layouts/index.js';
import { selectionOf } from '../state.js';
import { styleSchema, FADE_PRESETS } from '../style/schema.js';
import { buildControls } from './controls.js';
import { wheelModeSchema } from './wheel.js';
import { THEMES, themePref, setThemePref, onThemeChange } from './theme.js';
import { languages, languagePref, setLanguage, importLanguage, removeLanguage, languageFileText, DEFAULT as DEFAULT_LANG } from '../i18n/i18n.js';
import { el, section, isCollapsed, setCollapsed } from './dom.js';
import { icon } from './icons.js';

const MAIN_TAB_KEY = 'slidegrid:right-tab';
const LAYOUT_TAB_KEY = 'slidegrid:layout-tab';
const store_ = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 忽略 */ } },
};

/**
 * 右侧面板：顶部一排标签切换页面（设计 / 版式 / 样机，右边是偏好），每页独立滚动。
 *   设计：跟随选择（类似 Figma）——选中图层时是图层属性，选中卡片时是卡片的裁切 / 位置；
 *         什么都没选时是当前画板的设置，从上到下一组一组排开：版式参数、卡片、构图、背景、投影、渐隐遮罩。
 *         投影、渐隐遮罩的标题上有开关，一键关掉 / 打开（设置保留）
 *   版式：内置 / 我的版式（只负责选版式，不会误点）
 *   样机：把幻灯片放进笔记本 / 显示器 / 平板 / 投影幕（添加为样机图层）
 *   偏好：滚轮等操作习惯
 * 图层列表不在这里：在左栏下方单独一组（见 main.js、ui/inspector.js）。
 */
export function createSettingsPanel(root, { store, actions, notify = () => {}, imageCtx = {}, onBoardRequest = null, layoutPreview = null, beforeReload = null }) {
  root.innerHTML = '';
  root.classList.add('right-panel');

  /* ================= 顶层标签 ================= */
  const TITLES = { params: '设计', layouts: '版式', mockup: '样机', prefs: '偏好' };
  const tab = k => el('button', { class: 'rp-tab', role: 'tab', 'data-tab': k }, TITLES[k]);
  const mainTabs = {
    params: tab('params'),
    layouts: tab('layouts'),
    mockup: tab('mockup'),
    prefs: el('button', { class: 'icon-btn visible rp-prefs', role: 'tab', 'data-tab': 'prefs', title: '偏好（滚轮等操作习惯）', 'aria-label': '偏好' }, icon('cog', 16)),
  };
  const panes = Object.fromEntries(Object.keys(TITLES).map(k => [k, el('div', { class: 'rp-pane', role: 'tabpanel' })]));
  function showMain(name) {
    for (const k of Object.keys(panes)) {
      panes[k].hidden = k !== name;
      mainTabs[k].classList.toggle('active', k === name);
      mainTabs[k].setAttribute('aria-selected', String(k === name));
    }
    store_.set(MAIN_TAB_KEY, name);
  }
  for (const k of Object.keys(mainTabs)) mainTabs[k].addEventListener('click', () => showMain(k));
  // 多选画板时的提示：修改会同步到所有选中的画板（在任何页都显示）
  const multiText = el('span', {});
  const multiBanner = el('div', { class: 'multi-banner', hidden: true },
    icon('frame', 14), multiText,
    el('button', { class: 'btn ghost small', title: '只保留当前画板，退出批量编辑', onclick: () => actions.setActiveBoard(store.get().activeBoard) }, '只编辑当前'));
  const t = mainTabs;
  root.append(
    el('div', { class: 'rp-top' },
      el('div', { class: 'rp-tabs', role: 'tablist' }, t.params, t.layouts, t.mockup),
      t.prefs),
    el('div', { class: 'rp-main' }, multiBanner, ...Object.values(panes)),
  );

  /* ================= 版式悬停预览 ================= */
  // 鼠标停在版式上：用当前画板的图片和这个版式现在的参数渲染一张小图，显示在面板左边（不用点进去就知道效果）
  const preview = (() => {
    const box = el('div', { class: 'layout-preview', hidden: true });
    const frame = el('div', { class: 'lp-frame' });
    const title = el('div', { class: 'lp-title' });
    const hint = el('div', { class: 'lp-hint' }, '单击应用 · 双击应用并调参数');
    box.append(frame, el('div', { class: 'lp-foot' }, title, hint));
    document.body.append(box);
    const cache = new Map(); // layoutId → { key, canvas }
    let timer = 0, token = 0;
    // 影响预览的状态：任何一项变了就重新渲染
    const keyOf = (s, id) => [s.slides, s.params[id], s.style, s.aspect, s.layers, s.albums, s.adjust[id], s.camera, s.assets];
    const same = (a, b) => a && a.length === b.length && a.every((x, i) => x === b[i]);
    const place = anchor => {
      const r = anchor.getBoundingClientRect();
      const w = box.offsetWidth, h = box.offsetHeight;
      box.style.left = `${Math.max(8, r.left - w - 12)}px`;
      box.style.top = `${Math.min(window.innerHeight - h - 8, Math.max(8, r.top + r.height / 2 - h / 2))}px`;
    };
    const show = (l, anchor) => {
      if (!layoutPreview) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const s = store.get();
        if (s.aspect === 'long' || !s.slides.length) return;
        const my = ++token;
        title.textContent = l.name;
        const key = keyOf(s, l.id);
        let hit = cache.get(l.id);
        if (!hit || !same(hit.key, key)) {
          frame.replaceChildren(el('div', { class: 'lp-loading' }, '正在生成预览…'));
          box.hidden = false;
          place(anchor);
          let canvas = null;
          try { canvas = await layoutPreview(l.id); } catch { canvas = null; }
          if (my !== token) return;
          if (!canvas) { box.hidden = true; return; }
          hit = { key, canvas };
          cache.set(l.id, hit);
        }
        frame.replaceChildren(hit.canvas);
        box.hidden = false;
        place(anchor);
      }, 180);
    };
    const hide = () => { clearTimeout(timer); token++; box.hidden = true; };
    return { show, hide };
  })();

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
      btn.addEventListener('click', () => { preview.hide(); pick(l, false); });
      btn.addEventListener('dblclick', () => pick(l, true)); // 双击：应用并去调参数
      btn.addEventListener('mouseenter', () => preview.show(l, btn));
      btn.addEventListener('mouseleave', () => preview.hide());
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
  // 随机种子的历史（每个版式各记各的）：「换一组」之前的值，「上一个」退回
  const seedHistory = new Map();
  const seedsOf = layoutId => {
    const list = k => {
      const id = `${layoutId}:${k}`;
      if (!seedHistory.has(id)) seedHistory.set(id, []);
      return seedHistory.get(id);
    };
    return { push: (k, v) => { const l = list(k); l.push(v); if (l.length > 50) l.shift(); }, pop: k => list(k).pop(), size: k => list(k).length };
  };
  // 有随机种子的版式（散落、空中飘落、满铺堆叠）：版式卡片上直接放一个「换一种摆法」
  const diceBtn = el('button', { class: 'icon-btn visible', title: '随机换一种摆法（「随机种子」里可以退回上一个）', 'aria-label': '随机换一种摆法' }, icon('shuffle', 15));
  diceBtn.addEventListener('click', () => {
    const s = store.get(), def = getLayout(s.layoutId).params.find(d => d.type === 'seed');
    if (!def) return;
    seedsOf(s.layoutId).push(def.key, s.params[s.layoutId]?.[def.key] ?? def.default);
    actions.setParam(def.key, Math.floor(Math.random() * 1e6));
  });
  const current = el('div', { class: 'current-layout' },
    curIcon,
    el('div', { class: 'cur-text' }, curName, curMeta),
    diceBtn,
    el('button', { class: 'btn ghost small', title: '去「版式」页选择其他版式', onclick: () => showMain('layouts') }, '更换'));
  // 设计页：选中图层 / 卡片时显示它们的属性（ui/inspector.js），否则显示画板设置
  const selectionSlot = el('div', { class: 'inspector', hidden: true });
  const boardBox = el('div');
  // 设计页底部固定「保存当前版式」（只在显示画板设置时出现，见 presetsPanel 的 saveFooter）
  const designFooter = el('div', { class: 'rp-footer design-footer' });
  panes.params.classList.add('has-footer');
  panes.params.append(el('div', { class: 'design-body' }, selectionSlot, boardBox), designFooter);
  // 样机页（ui/mockupPanel.js 填充）
  const mockupSlot = el('div', { class: 'page-body' });
  panes.mockup.append(mockupSlot);

  // 设计页（没有选择时）：版式参数、构图
  const resetBtn = (title, fn) => el('button', { class: 'icon-btn visible', title, 'aria-label': title, onclick: fn }, icon('rotate-ccw', 14));
  const paramsBox = el('div');
  boardBox.append(section('版式', el('div', {}, current, paramsBox), resetBtn('恢复当前版式的默认参数', () => actions.resetParams())));

  // 卡片样式（style/schema.js 的「卡片」分组）
  const cardStyleBox = el('div');
  const cardSection = section('卡片', cardStyleBox);
  boardBox.append(cardSection);

  // 构图：没有可调的参数，只在用构图工具调整过之后出现（显示调整了什么 + 复位）
  const cameraNote = el('p', { class: 'note compact' });
  const cameraSection = section('构图', cameraNote, resetBtn('复位构图（缩放、平移、3D 角度、投影）', () => actions.resetCamera()));
  boardBox.append(cameraSection);

  // 画板样式：背景、投影、渐隐遮罩各一组，接在构图后面。投影、渐隐遮罩可以用标题上的开关整个关掉（设置保留）
  const fadeOn = st => !!st.fadeType && st.fadeType !== 'none' && !st.fadeHidden;
  const STYLE_GROUPS = {
    背景: {},
    投影: { isOn: st => !st.shadowHidden, set: on => actions.setStyle('shadowHidden', !on) },
    渐隐遮罩: {
      isOn: fadeOn,
      // 打开：还没选过类型时先用「底部渐隐」；关掉：只是隐藏（类型、范围都保留）
      set: on => {
        const st = store.get().style;
        if (!on) actions.patchStyle({ fadeHidden: true });
        else if (!st.fadeType || st.fadeType === 'none') actions.patchStyle({ ...FADE_PRESETS.find(p => p.id === 'bottom').patch, fadeHidden: false });
        else actions.patchStyle({ fadeHidden: false });
      },
    },
  };
  const styleBoxes = {}, styleSections = {};
  for (const [name, g] of Object.entries(STYLE_GROUPS)) {
    styleBoxes[name] = el('div');
    styleSections[name] = section(name, styleBoxes[name], null, `section:style:${name}`, { onSwitch: g.set || null });
    boardBox.append(styleSections[name]);
  }
  // 偏好页
  const prefsBox = el('div');
  panes.prefs.append(section('操作习惯', prefsBox, null, 'section:prefs'));
  // 界面主题：跟随系统 / 深色 / 浅色（存在本机，不属于项目）
  const themeBox = el('div');
  panes.prefs.append(section('界面', themeBox, null, 'section:prefs-theme'));
  const updateTheme = buildControls(themeBox, [{ key: 'theme', label: '主题', type: 'select', default: 'auto', options: THEMES }], { theme: themePref() }, (_, v) => setThemePref(v));
  onThemeChange(() => updateTheme({ theme: themePref() }));
  // 界面语言：跟随系统 / 简体中文 / 语言文件里的语言（lang/*.xml）/ 自己导入的。换了以后刷新页面
  const langBox = el('div');
  themeBox.append(langBox);
  const langOptions = [...languages().map(l => ({ value: l.code, label: l.custom ? `${l.name}（导入的）` : l.name })), { value: 'auto', label: '跟随系统' }];
  const pref = languagePref();
  buildControls(langBox, [{ key: 'lang', label: '语言', type: 'select', segmented: false, default: DEFAULT_LANG, options: langOptions }],
    { lang: langOptions.some(o => o.value === pref) ? pref : DEFAULT_LANG }, (_, v) => setLanguage(v, { beforeReload }));
  // 导入语言文件（XML）：存在这台电脑上，马上换过去；下载英文语言文件：翻译新语言时照着改
  const langInput = el('input', { type: 'file', accept: '.xml,text/xml,application/xml', hidden: true });
  langInput.addEventListener('change', async () => {
    const file = langInput.files[0];
    langInput.value = '';
    if (!file) return;
    try {
      const { code } = importLanguage(await file.text());
      await setLanguage(code, { beforeReload });
    } catch (err) {
      notify(`导入失败：${err.message || err}`);
    }
  });
  const langFileBtn = el('button', { class: 'btn small', type: 'button', title: '导入一个 XML 语言文件（存在这台电脑上），界面马上换成这种语言' }, icon('upload', 13), '导入语言文件…');
  langFileBtn.addEventListener('click', () => langInput.click());
  const langTemplateBtn = el('button', { class: 'btn small', type: 'button', title: '下载英文的语言文件：翻译新语言时复制一份，改 code、name 和每条译文' }, icon('download', 13), '下载语言文件模板');
  langTemplateBtn.addEventListener('click', async () => {
    try {
      const blob = new Blob([await languageFileText('en.xml')], { type: 'application/xml' });
      const a = el('a', { href: URL.createObjectURL(blob), download: 'en.xml' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (err) {
      notify(`下载失败：${err.message || err}`);
    }
  });
  // 导入过的语言：每个一个「移除」按钮（正在用的那个移除后回到跟随系统）
  const langRemoveBtns = languages().filter(l => l.custom).map(l => {
    const btn = el('button', { class: 'btn small lang-remove', type: 'button', 'data-code': l.code, title: '从这台电脑上移除这个导入的语言文件' }, icon('trash-2', 13), `移除「${l.name}」`);
    btn.addEventListener('click', () => {
      removeLanguage(l.code);
      setLanguage(pref === l.code ? null : pref, { beforeReload });
    });
    return btn;
  });
  themeBox.append(el('div', { class: 'lang-actions' }, langFileBtn, langTemplateBtn, ...langRemoveBtns, langInput),
    el('p', { class: 'note' }, '默认跟随系统语言（系统不是中文时用英文）；顶栏右边的语言按钮也可以直接切换。界面语言来自 XML 语言文件：每条是「中文原文 → 译文」。换语言后页面会刷新一次（项目会先保存）。'));

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
  const styleUpdaters = Object.keys(STYLE_GROUPS).map(name =>
    buildControls(styleBoxes[name], groupItems(name), s0.style, actions.setStyle, imageCtx));
  styleUpdaters.push(buildControls(cardStyleBox, groupItems('卡片'), s0.style, actions.setStyle, imageCtx));
  const updateStyle = st => {
    styleUpdaters.forEach(u => u(st));
    for (const [name, g] of Object.entries(STYLE_GROUPS)) if (g.isOn) styleSections[name].setOn(g.isOn(st));
  };
  const updatePrefs = buildControls(prefsBox, wheelModeSchema, s0, actions.setPref);
  let updateParams = () => {};
  let currentLayout = null;

  function update(s) {
    if (s.layoutId !== currentLayout) {
      currentLayout = s.layoutId;
      const layout = getLayout(currentLayout);
      updateParams = buildControls(paramsBox, layout.params, s.params[currentLayout], actions.setParam, { albums: () => store.get().albums, markChanged: true, seeds: seedsOf(currentLayout) });
      diceBtn.hidden = !layout.params.some(d => d.type === 'seed');
      // 已并入其他版式的旧版式：只有当前画板还在用时才显示在列表里
      layoutButtons.forEach((b, id) => { b.classList.toggle('active', id === currentLayout); b.hidden = !!getLayout(id).legacy && id !== currentLayout; });
      curIcon.innerHTML = layout.icon;
      curName.textContent = layout.name;
      curMeta.textContent = layout.legacy ? `已并入「${getLayout(layout.legacy).name}」` : `${layout.category === '3d' ? '3D 透视' : '平面'}版式${layout.long ? ' · 支持长图' : ''}`;
      curMeta.title = layout.legacy ? `这个旧版式和「${getLayout(layout.legacy).name}」是同一种，版式列表里只保留了后者；这个画板照常显示` : '';
    }
    const cam = s.camera || {};
    const changed = [
      Math.abs((cam.zoom ?? 1) - 1) > 1e-3 ? `缩放 ${Math.round((cam.zoom ?? 1) * 100)}%` : '',
      Math.abs(cam.panX || 0) > 1e-3 || Math.abs(cam.panY || 0) > 1e-3 ? '平移' : '',
      Math.abs(cam.yaw || 0) > 1e-3 || Math.abs(cam.pitch || 0) > 1e-3 || (cam.q && Math.abs(cam.q[3]) < 0.99999) ? '3D 角度' : '',
      cam.proj === 'ortho' ? '正交投影' : cam.proj === 'persp' ? '透视投影' : '',
    ].filter(Boolean);
    cameraSection.hidden = !changed.length;
    cameraNote.textContent = `已调整：${changed.join('、')}（构图工具 O、画布右上角的立方体视图）`;
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

  // 定位到设计页的某一组（工具条背景 / 遮罩面板的「更多设置」、图层列表里点渐隐遮罩）：展开、滚动到那里、闪一下。
  // 设计页正在显示选中对象的属性时，调用的一方先取消选择（main.js）
  function revealStyleGroup(name) {
    const sec = styleSections[name] || (name === '卡片' ? cardSection : styleSections.背景);
    onBoardRequest?.();
    showMain('params');
    sec.expand();
    sec.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    sec.classList.add('flash');
    setTimeout(() => sec.classList.remove('flash'), 900);
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
    currentTab: () => Object.keys(panes).find(k => !panes[k].hidden),
    // 设计页显示选中对象的属性（true）还是画板设置（false）
    setSelectionMode(on) { selectionSlot.hidden = !on; boardBox.hidden = on; designFooter.hidden = on; },
    // 打开「版式」页的某个子标签（导入版式文件时用）
    showTab: name => { showMain('layouts'); showLayoutTab(name); },
    tabBar: root.querySelector('.rp-top'),
    showMain,
    setPresetCount: n => { mineCount.textContent = n ? String(n) : ''; },
  };
}
