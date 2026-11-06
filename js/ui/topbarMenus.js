import { ASPECTS, aspectValue, aspectLabel, isLongAspect, parseRatio } from '../config.js';
import { boardsOf } from '../state.js';
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
 * 顶栏中间：画板切换器 + 画布比例。
 *   onActivate(id)、onAdd({ duplicate })、onRename(id)、onDelete(id)、onFitAll()
 */
export function createTopbarMenus(root, { store, actions, onActivate, onAdd, onRename, onDelete, onFitAll }) {
  /* ---------- 画板 ---------- */
  const boardName = el('span', { class: 'tb-board-name' });
  const boardBtn = el('button', { class: 'topbar-btn', 'aria-haspopup': 'menu', title: '画板：切换、新建、复制、重命名、删除' },
    icon('frame', 15), boardName, icon('chevron-down', 13));

  const boardMenu = createMenu(boardBtn, {
    className: 'board-menu',
    render(pop, close) {
      const s = store.get();
      pop.innerHTML = '';
      pop.append(el('div', { class: 'menu-title' }, `画板（${s.artboards.length}）`));
      for (const b of boardsOf(s)) {
        const active = b.id === s.activeBoard;
        const act = (name, title, fn, danger = false) => el('button', {
          class: `icon-btn visible${danger ? ' danger' : ''}`, title, 'aria-label': title,
          onclick: e => { e.stopPropagation(); close(); fn(); },
        }, icon(name, 13));
        const row = el('div', { class: `menu-item board-item${active ? ' active' : ''}`, role: 'menuitem', title: '切换到此画板并居中显示' },
          el('span', { class: 'menu-check' }, active ? icon('check', 14) : null),
          ratioShape(b.settings.aspect, 16),
          el('span', { class: 'menu-label' }, b.name),
          el('span', { class: 'menu-meta' }, aspectLabel(b.settings.aspect)),
          el('span', { class: 'menu-actions' },
            act('pencil', '重命名', () => onRename(b.id)),
            act('copy', '复制画板', () => { onActivate(b.id); onAdd({ duplicate: true }); }),
            s.artboards.length > 1 ? act('trash-2', '删除画板', () => onDelete(b.id), true) : null),
        );
        row.addEventListener('click', () => { close(); onActivate(b.id); });
        pop.append(row);
      }
      pop.append(el('div', { class: 'menu-sep' }),
        el('button', { class: 'menu-item', onclick: () => { close(); onAdd({ duplicate: false }); } },
          el('span', { class: 'menu-check' }, icon('plus', 14)), el('span', { class: 'menu-label' }, '新建画板')),
        el('button', { class: 'menu-item', onclick: () => { close(); onAdd({ duplicate: true }); } },
          el('span', { class: 'menu-check' }, icon('copy', 14)), el('span', { class: 'menu-label' }, '复制当前画板')),
        el('button', { class: 'menu-item', onclick: () => { close(); onFitAll(); } },
          el('span', { class: 'menu-check' }, icon('maximize', 14)), el('span', { class: 'menu-label' }, '查看全部画板'), el('span', { class: 'menu-meta' }, '⌘⌥0')),
      );
    },
  });

  /* ---------- 比例 ---------- */
  const ratioShapeSlot = el('span', { class: 'ratio-slot' });
  const ratioText = el('span', { class: 'tb-ratio-text' });
  const ratioBtn = el('button', { class: 'topbar-btn', 'aria-haspopup': 'menu', title: '当前画板的画布比例（悬停滚轮切换）' },
    ratioShapeSlot, ratioText, icon('chevron-down', 13));

  const ratioMenu = createMenu(ratioBtn, {
    className: 'ratio-menu',
    render(pop, close) {
      const cur = store.get().aspect;
      pop.innerHTML = '';
      pop.append(el('div', { class: 'menu-title' }, '画布比例'));
      const grid = el('div', { class: 'ratio-grid' });
      for (const a of ASPECTS) {
        const chip = el('button', { class: `ratio-chip${a.id === cur ? ' active' : ''}`, title: a.value ? `${a.id}` : '长图：宽度固定，高度随内容' },
          el('span', { class: 'ratio-box' }, ratioShape(a.id, 26)),
          el('span', {}, a.label || a.id));
        chip.addEventListener('click', () => { close(); actions.setAspect(a.id); });
        grid.append(chip);
      }
      // 自定义比例
      const known = ASPECTS.some(a => a.id === cur);
      const [cw, ch] = !known && parseRatio(cur) ? cur.split(':') : ['5', '4'];
      const w = el('input', { type: 'number', class: 'num-input', min: 0.1, step: 'any', value: cw, 'aria-label': '宽' });
      const h = el('input', { type: 'number', class: 'num-input', min: 0.1, step: 'any', value: ch, 'aria-label': '高' });
      const apply = () => {
        const id = `${Number(w.value)}:${Number(h.value)}`;
        if (!parseRatio(id)) { w.focus(); return; }
        close();
        actions.setAspect(id);
      };
      for (const inp of [w, h]) inp.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
      pop.append(grid, el('div', { class: 'menu-sep' }),
        el('div', { class: `ratio-custom${!known ? ' active' : ''}` },
          el('span', { class: 'menu-label' }, '自定义'), w, el('span', { class: 'ratio-colon' }, ':'), h,
          el('button', { class: 'btn small primary', onclick: apply }, '应用')));
    },
  });

  // 滚轮切换预设比例
  attachWheel(ratioBtn, steps => {
    const cur = store.get().aspect;
    const idx = Math.max(0, ASPECTS.findIndex(a => a.id === cur));
    const next = ASPECTS[Math.min(ASPECTS.length - 1, Math.max(0, idx - steps))];
    if (next.id !== cur) actions.setAspect(next.id);
  });

  root.append(el('div', { class: 'topbar-group' }, boardBtn, el('span', { class: 'topbar-divider' }), ratioBtn));

  return {
    update(s) {
      const board = s.artboards.find(b => b.id === s.activeBoard);
      boardName.textContent = board?.name || '画板';
      ratioShapeSlot.replaceChildren(ratioShape(s.aspect, 14));
      ratioText.textContent = aspectLabel(s.aspect);
      boardMenu.refresh();
      ratioMenu.refresh();
    },
  };
}
