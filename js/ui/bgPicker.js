import { createMenu } from './menu.js';
import { el } from './dom.js';
import { icon } from './icons.js';

// 预设：常用纯色与精选渐变
const SOLIDS = [
  '#ffffff', '#f1f3f5', '#dee2e6', '#adb5bd', '#495057', '#2b3040',
  '#16181d', '#000000', '#fff4e6', '#e7f5ff', '#ebfbee', '#fff0f6',
];
const GRADIENTS = [
  { bgType: 'radial', bg1: '#2b3040', bg2: '#0d0f14' },
  { bgType: 'radial', bg1: '#ffffff', bg2: '#dfe3e8' },
  { bgType: 'linear', bg1: '#667eea', bg2: '#764ba2', bgAngle: 135 },
  { bgType: 'linear', bg1: '#ff9a9e', bg2: '#fad0c4', bgAngle: 135 },
  { bgType: 'linear', bg1: '#a1c4fd', bg2: '#c2e9fb', bgAngle: 160 },
  { bgType: 'linear', bg1: '#f6d365', bg2: '#fda085', bgAngle: 135 },
  { bgType: 'linear', bg1: '#0f2027', bg2: '#2c5364', bgAngle: 160 },
  { bgType: 'linear', bg1: '#11998e', bg2: '#38ef7d', bgAngle: 135 },
];
const TYPES = [
  { value: 'transparent', label: '透明' },
  { value: 'solid', label: '纯色' },
  { value: 'linear', label: '线性' },
  { value: 'radial', label: '径向' },
  { value: 'image', label: '图片' },
  { value: 'slide', label: '幻灯片' },
];
const CHECKER = 'repeating-conic-gradient(#c8ccd4 0 25%, #ffffff 0 50%) 0 0 / 8px 8px';

// 背景样式 → CSS 背景，用于色块预览
const thumbUrls = new WeakMap();
export function bgCss(style, assets = {}) {
  switch (style.bgType) {
    case 'transparent': return CHECKER;
    case 'linear': return `linear-gradient(${style.bgAngle ?? 180}deg, ${style.bg1}, ${style.bg2})`;
    case 'radial': return `radial-gradient(circle at 50% 42%, ${style.bg1}, ${style.bg2})`;
    case 'image': {
      const a = assets[style.bgImageId];
      if (!a?.thumb) return style.bg1;
      if (!thumbUrls.has(a.thumb)) thumbUrls.set(a.thumb, a.thumb.toDataURL('image/jpeg', 0.7));
      return `center / cover url(${thumbUrls.get(a.thumb)})`;
    }
    case 'slide': return 'linear-gradient(135deg, #8a92a3, #3a3f4b)';
    default: return style.bg1;
  }
}

/**
 * 工具条上的「画板背景」按钮 + 快捷面板（只改当前画板）。
 *   pickImage()：打开背景图选择；onMore()：在右侧面板展开完整的背景设置
 */
export function createBgPicker(parent, { store, actions, pickImage, onMore }) {
  const swatch = el('span', { class: 'bg-swatch' });
  const btn = el('button', { class: 'tb-btn tb-bg', 'aria-label': '画板背景', title: '画板背景（当前画板）' },
    swatch, icon('chevron-down', 11));
  parent.append(btn);

  let refs = null;
  const menu = createMenu(btn, {
    className: 'bg-menu',
    align: 'center',
    render(pop, close) {
      pop.innerHTML = '';
      refs = build(pop, close);
      fill(store.get());
    },
  });

  function build(pop, close) {
    const title = el('div', { class: 'menu-title' });
    const types = new Map();
    const typeRow = el('div', { class: 'bg-types' });
    for (const t of TYPES) {
      const b = el('button', { class: 'bg-type' }, t.label);
      b.addEventListener('click', () => {
        const s = store.get();
        if (t.value === 'image' && !s.assets[s.style.bgImageId]) { close(); pickImage(); return; }
        actions.patchStyle({ bgType: t.value });
      });
      types.set(t.value, b);
      typeRow.append(b);
    }

    const solids = SOLIDS.map(c => {
      const b = el('button', { class: 'bg-chip', title: c, style: `background:${c}` });
      b.addEventListener('click', () => actions.patchStyle({ bgType: 'solid', bg1: c }));
      return { b, match: st => st.bgType === 'solid' && st.bg1.toLowerCase() === c };
    });
    const grads = GRADIENTS.map(g => {
      const b = el('button', { class: 'bg-chip', title: `${g.bg1} → ${g.bg2}`, style: `background:${bgCss({ bgAngle: 180, ...g })}` });
      b.addEventListener('click', () => actions.patchStyle({ bgAngle: 180, ...g }));
      return { b, match: st => st.bgType === g.bgType && st.bg1.toLowerCase() === g.bg1 && st.bg2.toLowerCase() === g.bg2 };
    });

    // 自定义颜色：拖动取色时实时生效（只更新数值，不重建面板，取色器不会被打断）
    const c1 = el('input', { type: 'color', title: '起始色 / 颜色' });
    const c2 = el('input', { type: 'color', title: '结束色' });
    c1.addEventListener('input', () => {
      const st = store.get().style;
      actions.patchStyle({ bg1: c1.value, ...(st.bgType === 'transparent' ? { bgType: 'solid' } : {}) });
    });
    c2.addEventListener('input', () => actions.patchStyle({ bg2: c2.value }));
    const c2wrap = el('span', { class: 'bg-c2' }, el('span', { class: 'bg-arrow' }, '→'), c2);
    const customLabel = el('span', { class: 'menu-label' }, '自定义');

    const imageRow = el('div', { class: 'bg-image-row' },
      el('button', { class: 'btn small', onclick: () => { close(); pickImage(); } }, icon('image-plus', 13), '更换背景图…'));

    pop.append(
      title, typeRow,
      el('div', { class: 'bg-sub' }, '纯色'),
      el('div', { class: 'bg-grid' }, solids.map(x => x.b)),
      el('div', { class: 'bg-sub' }, '渐变'),
      el('div', { class: 'bg-grid grads' }, grads.map(x => x.b)),
      el('div', { class: 'bg-custom' }, customLabel, c1, c2wrap),
      imageRow,
      el('div', { class: 'menu-sep' }),
      el('button', { class: 'menu-item', onclick: () => { close(); onMore(); } },
        el('span', { class: 'menu-check' }, icon('settings-2', 14)),
        el('span', { class: 'menu-label' }, '更多背景设置（模糊、压暗、暗角…）')),
    );
    return { title, types, solids, grads, c1, c2, c2wrap, customLabel, imageRow };
  }

  // 刷新工具条上的色块；面板打开时同步面板内容
  function update(s) {
    swatch.style.background = bgCss(s.style, s.assets);
    const board = s.artboards.find(b => b.id === s.activeBoard);
    btn.title = `画板背景（${board?.name || '当前画板'}）`;
    if (refs && menu.isOpen()) fill(s);
  }

  // 只更新面板里的状态和数值，不重建元素（拖动取色器时不会被打断）
  function fill(s) {
    const st = s.style;
    const board = s.artboards.find(b => b.id === s.activeBoard);
    refs.title.textContent = `画板背景 · ${board?.name || ''}`;
    refs.types.forEach((b, v) => b.classList.toggle('active', v === st.bgType));
    for (const x of [...refs.solids, ...refs.grads]) x.b.classList.toggle('active', x.match(st));
    if (document.activeElement !== refs.c1) refs.c1.value = st.bg1;
    if (document.activeElement !== refs.c2) refs.c2.value = st.bg2;
    const gradient = st.bgType === 'linear' || st.bgType === 'radial';
    refs.c2wrap.hidden = !gradient;
    refs.customLabel.textContent = gradient ? '自定义渐变' : st.bgType === 'image' || st.bgType === 'slide' ? '底色' : '自定义颜色';
    refs.imageRow.hidden = st.bgType !== 'image';
  }

  update(store.get());
  return { update, open: () => menu.show() };
}
