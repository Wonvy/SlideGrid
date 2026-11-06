import { el } from './dom.js';

/**
 * 工具条上可折叠的按钮组：宽度够时整排显示按钮，放不下时折叠成一个下拉按钮。
 *   inline：整排显示的按钮；trigger：折叠后显示的下拉按钮（自己绑定菜单）
 *   priority：越小越先折叠
 */
export function foldGroup({ inline, trigger, priority = 1 }) {
  trigger.classList.add('tb-fold-menu');
  return el('div', { class: 'tb-fold', 'data-fold': priority }, el('div', { class: 'tb-fold-inline' }, ...inline), trigger);
}

/** 先全部展开，再按优先级逐个折叠，直到工具条不再溢出 */
export function fitFolds(bar) {
  const folds = [...bar.querySelectorAll('.tb-fold')].sort((a, b) => a.dataset.fold - b.dataset.fold);
  folds.forEach(f => f.classList.remove('folded'));
  for (const f of folds) {
    if (bar.scrollWidth <= bar.clientWidth + 1) break;
    if (f.getClientRects().length) f.classList.add('folded');
  }
}
