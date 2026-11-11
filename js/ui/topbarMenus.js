import { ASPECTS, PIXEL_PRESETS, aspectValue, aspectLabel, isLongAspect, parsePixels } from '../config.js';
import { boardsOf, selectionOf } from '../state.js';
import { createMenu } from './menu.js';
import { attachWheel } from './wheel.js';
import { el } from './dom.js';
import { icon } from './icons.js';

// 按比例画一个小矩形，用来直观表示画布形状
function ratioShape(id, max = 18) {
  if (isLongAspect(id)) return el('span', { class: 'ratio-shape long', style: `width:${max * 0.5}px;height:${max}px` });
  const a = aspectValue(id);
  const w = a >= 1 ? max : max * a, h = a >= 1 ? max / a : max;
  return el('span', { class: 'ratio-shape', style: `width:${w.toFixed(1)}px;height:${h.toFixed(1)}px` });
}

/**
 * 顶栏中间：画板切换器 + 画板尺寸（像素）。
 *   onActivate(id)、onAdd({ duplicate })、onRename(id)、onDelete(id)、onFitAll()
 */
export function createTopbarMenus(root, { store, actions, onActivate, onAdd, onDuplicateSelected, onRename, onDelete, onDeleteSelected, onFitAll }) {
  /* ---------- 画板 ---------- */
  const boardName = el('span', { class: 'tb-board-name' });
  const boardBtn = el('button', { class: 'topbar-btn', 'aria-haspopup': 'menu', title: '画板：切换、新建、复制、重命名、删除' },
    icon('frame', 15), boardName, icon('chevron-down', 13));

  const boardMenu = createMenu(boardBtn, {
    className: 'board-menu',
    render(pop, close) {
      const s = store.get();
      const sel = new Set(selectionOf(s));
      pop.innerHTML = '';
      pop.append(el('div', { class: 'menu-title' }, `画板（${s.artboards.length}）· Shift/⌘ + 单击多选`));
      for (const b of boardsOf(s)) {
        const active = b.id === s.activeBoard;
        const selected = sel.has(b.id);
        const act = (name, title, fn, danger = false) => el('button', {
          class: `icon-btn visible${danger ? ' danger' : ''}`, title, 'aria-label': title,
          onclick: e => { e.stopPropagation(); close(); fn(); },
        }, icon(name, 13));
        const row = el('div', { class: `menu-item board-item${active ? ' active' : ''}${selected && !active ? ' selected' : ''}`, role: 'menuitem', title: '单击切换并居中 · Shift/⌘ + 单击加选 / 减选' },
          el('span', { class: 'menu-check' }, selected ? icon('check', 14) : null),
          ratioShape(b.settings.aspect, 16),
          el('span', { class: 'menu-label' }, b.name),
          el('span', { class: 'menu-meta' }, aspectLabel(b.settings.aspect)),
          el('span', { class: 'menu-actions' },
            act('pencil', '重命名', () => onRename(b.id)),
            act('copy', '复制画板', () => { onActivate(b.id); onAdd({ duplicate: true }); }),
            s.artboards.length > 1 ? act('trash-2', '删除画板', () => onDelete(b.id), true) : null),
        );
        row.addEventListener('click', e => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) { actions.toggleBoardSelection(b.id); return; } // 多选时菜单保持打开
          close();
          onActivate(b.id);
        });
        pop.append(row);
      }
      const n = sel.size;
      const item = (ic, label, fn, meta = null) => el('button', { class: 'menu-item', onclick: () => { close(); fn(); } },
        el('span', { class: 'menu-check' }, icon(ic, 14)), el('span', { class: 'menu-label' }, label), meta ? el('span', { class: 'menu-meta' }, meta) : null);
      pop.append(el('div', { class: 'menu-sep' }),
        item('plus', '新建画板', () => onAdd({ duplicate: false })),
        item('copy', n > 1 ? `复制所选的 ${n} 个画板` : '复制当前画板', onDuplicateSelected),
        n > 1 && n < s.artboards.length ? item('trash-2', `删除所选的 ${n} 个画板`, onDeleteSelected) : null,
        item('check', '全选画板', () => actions.selectAllBoards(), '⌘A'),
        el('button', { class: 'menu-item', onclick: () => { close(); onFitAll(); } },
          el('span', { class: 'menu-check' }, icon('fit-all', 14)), el('span', { class: 'menu-label' }, '查看全部画板'), el('span', { class: 'menu-meta' }, '⌘⌥0')),
      );
    },
  });

  /* ---------- 画板尺寸（像素） ---------- */
  // 画板尺寸统一用像素：宽 × 高输入框、常用比例（保持当前短边）、平台尺寸、长图开关
  const ratioShapeSlot = el('span', { class: 'ratio-slot' });
  const ratioText = el('span', { class: 'tb-ratio-text' });
  const ratioBtn = el('button', { class: 'topbar-btn', 'aria-haspopup': 'menu', title: '当前画板的尺寸（像素；悬停滚轮切换比例）' },
    ratioShapeSlot, ratioText, icon('chevron-down', 13));

  const RATIOS = ASPECTS.filter(a => a.value);
  const ratioMatch = (id, a) => { const p = parsePixels(id); return !!p && Math.abs(p.w / p.h - a.value) < 0.002; };

  const ratioMenu = createMenu(ratioBtn, {
    className: 'ratio-menu',
    render(pop, close) {
      const cur = store.get().aspect;
      const long = isLongAspect(cur);
      const px = parsePixels(cur) || { w: 1920, h: 1080 };
      pop.innerHTML = '';

      // 1. 宽 × 高（像素）
      const w = el('input', { type: 'number', class: 'num-input', min: 16, max: 16000, step: 1, value: px.w, 'aria-label': '宽（像素）' });
      const h = el('input', { type: 'number', class: 'num-input', min: 16, max: 16000, step: 1, value: px.h, 'aria-label': '高（像素）' });
      const apply = (keepOpen = false) => {
        const id = `${Math.round(Number(w.value))}x${Math.round(Number(h.value))}`;
        if (!parsePixels(id)) { w.focus(); return; }
        if (id !== store.get().aspect) actions.setAspect(id);
        if (!keepOpen) close();
      };
      for (const inp of [w, h]) {
        inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') apply(); });
        inp.addEventListener('change', () => apply(true));
      }
      const swap = el('button', { class: 'icon-btn visible', title: '横竖互换', 'aria-label': '横竖互换' }, icon('arrow-left-right', 14));
      swap.addEventListener('click', () => { [w.value, h.value] = [h.value, w.value]; apply(true); });
      pop.append(
        el('div', { class: 'menu-title' }, long ? '画板尺寸（当前为长图）' : '画板尺寸'),
        el('div', { class: 'size-row' },
          el('label', { class: 'size-field' }, el('span', {}, '宽'), w),
          el('span', { class: 'size-times' }, '×'),
          el('label', { class: 'size-field' }, el('span', {}, '高'), h),
          el('span', { class: 'size-unit' }, 'px'),
          swap),
        el('div', { class: 'size-note' }, '导出 1× 时就是这个像素；倍率在右上角选择'),
      );

      // 2. 常用比例：保持当前短边
      const grid = el('div', { class: 'ratio-grid' });
      for (const a of RATIOS) {
        const active = !long && ratioMatch(cur, a);
        const chip = el('button', { class: `ratio-chip${active ? ' active' : ''}`, title: `${a.id}（保持短边 ${Math.min(px.w, px.h)} px）` },
          el('span', { class: 'ratio-box' }, ratioShape(a.id, 24)),
          el('span', {}, a.id));
        chip.addEventListener('click', () => { close(); actions.setAspect(a.id); });
        grid.append(chip);
      }
      pop.append(el('div', { class: 'menu-sep' }), el('div', { class: 'menu-title' }, '常用比例'), grid);

      // 3. 平台尺寸
      const list = el('div', { class: 'px-grid' }, PIXEL_PRESETS.map(p => {
        const [pw, ph] = p.id.split('x');
        const b = el('button', { class: `px-chip${p.id === cur ? ' active' : ''}`, title: `${pw} × ${ph} 像素` },
          el('span', { class: 'ratio-box' }, ratioShape(p.id, 18)),
          el('span', { class: 'px-size' }, `${pw} × ${ph}`),
          el('span', { class: 'px-note' }, p.note));
        b.addEventListener('click', () => { close(); actions.setAspect(p.id); });
        return b;
      }));
      pop.append(el('div', { class: 'menu-sep' }), el('div', { class: 'menu-title' }, '平台尺寸'), list);

      // 4. 长图
      const longBtn = el('button', { class: `menu-item${long ? ' active' : ''}`, title: '宽度固定，高度随内容（导出 1× 宽 1920）' },
        el('span', { class: 'menu-check' }, long ? icon('check', 14) : el('span', { class: 'ratio-box' }, ratioShape('long', 14))),
        el('span', { class: 'menu-label' }, '长图'),
        el('span', { class: 'menu-meta' }, '高度随内容'));
      longBtn.addEventListener('click', () => { close(); actions.setAspect(long ? '1920x1080' : 'long'); });
      pop.append(el('div', { class: 'menu-sep' }), longBtn);
    },
  });

  // 滚轮切换常用比例（保持短边）
  attachWheel(ratioBtn, steps => {
    const cur = store.get().aspect;
    const idx = Math.max(0, RATIOS.findIndex(a => ratioMatch(cur, a)));
    const next = RATIOS[Math.min(RATIOS.length - 1, Math.max(0, idx - steps))];
    if (!ratioMatch(cur, next)) actions.setAspect(next.id);
  });

  root.append(el('div', { class: 'topbar-group' }, boardBtn, el('span', { class: 'topbar-divider' }), ratioBtn));

  return {
    update(s) {
      const board = s.artboards.find(b => b.id === s.activeBoard);
      const n = selectionOf(s).length;
      boardName.textContent = n > 1 ? `${board?.name || '画板'} 等 ${n} 个` : board?.name || '画板';
      ratioShapeSlot.replaceChildren(ratioShape(s.aspect, 14));
      ratioText.textContent = aspectLabel(s.aspect);
      boardMenu.refresh();
      ratioMenu.refresh();
    },
  };
}
