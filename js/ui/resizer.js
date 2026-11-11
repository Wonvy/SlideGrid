import { clamp } from '../core/utils.js';
import { el } from './dom.js';
import { icon } from './icons.js';

/**
 * 左右两栏：拖动分隔条调整宽度（双击恢复默认），可折叠隐藏。
 *   Tab：隐藏 / 显示左右两栏（类似 Photoshop）；Shift + Tab：只切换右栏
 * 宽度和折叠状态保存到 localStorage。
 */
const KEY = 'slidegrid:panels:v1';
const DEFAULTS = { left: 248, right: 312, leftHidden: false, rightHidden: false };
const LIMITS = { left: [200, 560], right: [264, 640] };
const MIN_STAGE = 360;

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return { ...DEFAULTS }; }
}

export function initResizers(app) {
  const st = load();
  for (const side of ['left', 'right']) st[side] = clamp(st[side], ...LIMITS[side]); // 旧版本保存的宽度可能太窄
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* 忽略 */ } };

  // 收起后贴在屏幕边缘的展开按钮
  const edges = {
    left: el('button', { class: 'edge-tab edge-left', title: '显示左栏（Tab）', 'aria-label': '显示左栏' }, icon('panel-left-open', 15)),
    right: el('button', { class: 'edge-tab edge-right', title: '显示右栏（Tab / Shift+Tab）', 'aria-label': '显示右栏' }, icon('panel-right-open', 15)),
  };
  edges.left.addEventListener('click', () => setHidden('left', false));
  edges.right.addEventListener('click', () => setHidden('right', false));
  app.append(edges.left, edges.right);

  // 实际显示的宽度：窗口变窄时先收窄右栏、再收窄左栏（不低于最小宽度），尽量给工作区留出 MIN_STAGE
  // 只影响显示，保存的宽度不变，窗口变宽后自动恢复
  const effective = () => {
    let l = st.leftHidden ? 0 : st.left, r = st.rightHidden ? 0 : st.right;
    let over = l + r - (app.clientWidth - MIN_STAGE);
    if (over > 0 && r) { const d = Math.min(over, r - LIMITS.right[0]); r -= d; over -= d; }
    if (over > 0 && l) { const d = Math.min(over, l - LIMITS.left[0]); l -= d; }
    return [l, r];
  };
  const apply = () => {
    const [l, r] = effective();
    app.style.setProperty('--left-w', `${l}px`);
    app.style.setProperty('--right-w', `${r}px`);
    app.classList.toggle('left-hidden', st.leftHidden);
    app.classList.toggle('right-hidden', st.rightHidden);
    edges.left.hidden = !st.leftHidden;
    edges.right.hidden = !st.rightHidden;
  };
  apply();
  window.addEventListener('resize', apply);

  function setHidden(side, hidden) {
    st[`${side}Hidden`] = hidden;
    apply();
    save();
  }
  const toggle = side => setHidden(side, !st[`${side}Hidden`]);
  // Tab：有任意一栏显示着就全部隐藏，否则全部显示
  const toggleAll = () => {
    const hide = !(st.leftHidden && st.rightHidden);
    st.leftHidden = hide;
    st.rightHidden = hide;
    apply();
    save();
  };

  window.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName) || t?.isContentEditable) return;
    if (document.querySelector('dialog[open], .menu.show')) return;
    e.preventDefault();
    if (e.shiftKey) toggle('right'); else toggleAll();
  });

  for (const side of ['left', 'right']) {
    const gutter = el('div', { class: `gutter gutter-${side}`, title: '拖动调整宽度，双击恢复默认' });
    app.append(gutter);

    gutter.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      gutter.setPointerCapture(e.pointerId);
      const startX = e.clientX, start = st[side];
      gutter.classList.add('active');
      document.body.classList.add('resizing');

      const move = ev => {
        const dx = ev.clientX - startX;
        const other = side === 'left' ? (st.rightHidden ? 0 : st.right) : (st.leftHidden ? 0 : st.left);
        const max = Math.min(LIMITS[side][1], app.clientWidth - other - MIN_STAGE);
        st[side] = Math.round(clamp(side === 'left' ? start + dx : start - dx, LIMITS[side][0], max));
        apply();
      };
      const up = () => {
        gutter.removeEventListener('pointermove', move);
        gutter.removeEventListener('pointerup', up);
        gutter.removeEventListener('pointercancel', up);
        gutter.classList.remove('active');
        document.body.classList.remove('resizing');
        save();
      };
      gutter.addEventListener('pointermove', move);
      gutter.addEventListener('pointerup', up);
      gutter.addEventListener('pointercancel', up);
    });

    gutter.addEventListener('dblclick', () => {
      st[side] = DEFAULTS[side];
      apply();
      save();
    });
  }

  // 面板标题里的「收起」按钮
  const collapseButton = side => {
    const b = el('button', {
      class: 'icon-btn visible panel-collapse', title: side === 'left' ? '收起左栏（Tab）' : '收起右栏（Shift+Tab）',
      'aria-label': side === 'left' ? '收起左栏' : '收起右栏',
    }, icon(side === 'left' ? 'panel-left-close' : 'panel-right-close', 15));
    b.addEventListener('click', () => setHidden(side, true));
    return b;
  };

  return { toggle, toggleAll, setHidden, collapseButton, isHidden: side => st[`${side}Hidden`] };
}
