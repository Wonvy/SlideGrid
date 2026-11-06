import { el } from './dom.js';
import { icon } from './icons.js';
import { createMenu } from './menu.js';
import { FADE_PRESETS, fadeCss } from '../style/schema.js';

/**
 * 工具条上的「渐隐遮罩」：一键套用预设（底部渐隐、四周渐隐…），细调在「设计 → 样式 → 渐隐遮罩」。
 * 遮罩让幻灯片层逐渐透明、融进背景；多选画板时一起修改。
 */
export function createFadePicker(parent, { store, actions, onMore }) {
  const btn = el('button', { class: 'tb-btn tb-fade', 'aria-label': '渐隐遮罩' }, icon('fade', 16));
  parent.append(btn);

  let chips = [];
  const menu = createMenu(btn, {
    className: 'bg-menu fade-menu',
    align: 'center',
    render(pop, close) {
      pop.innerHTML = '';
      chips = FADE_PRESETS.map(p => {
        const preview = el('span', { class: 'fade-preview' });
        preview.style.setProperty('--mask', p.id === 'none' ? 'none' : fadeCss(p.patch));
        const b = el('button', { class: 'fade-chip', title: p.label }, preview, el('span', {}, p.label));
        b.addEventListener('click', () => actions.patchStyle(p.patch));
        return { b, p };
      });
      pop.append(
        el('div', { class: 'menu-title' }, '渐隐遮罩'),
        el('p', { class: 'fade-note' }, '让幻灯片逐渐透明，融进背景'),
        el('div', { class: 'fade-grid' }, chips.map(x => x.b)),
        el('div', { class: 'menu-sep' }),
        el('button', { class: 'menu-item', onclick: () => { close(); onMore(); } },
          el('span', { class: 'menu-check' }, icon('settings-2', 14)),
          el('span', { class: 'menu-label' }, '调整方向、范围和不透明度…')),
      );
      fill(store.get());
    },
  });

  const same = (st, patch) => Object.entries(patch).every(([k, v]) => st[k] === v);
  function fill(s) {
    for (const { b, p } of chips) b.classList.toggle('active', p.id === 'none' ? s.style.fadeType === 'none' : same(s.style, p.patch));
  }

  function update(s) {
    const on = s.style.fadeType && s.style.fadeType !== 'none';
    btn.classList.toggle('active-soft', on);
    btn.title = on ? '渐隐遮罩：已开启（点击更换或关闭）' : '渐隐遮罩：一键让幻灯片边缘渐隐到背景';
    if (menu.isOpen()) fill(s);
  }

  update(store.get());
  return { update };
}
