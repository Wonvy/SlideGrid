import { el } from './dom.js';
import { icon } from './icons.js';
import { createMenu } from './menu.js';
import { albumOf, selectionOf } from '../state.js';

/**
 * 左栏顶部的图集切换：显示当前画板的图集，点开是全部图集（点一个 = 当前画板换成这个图集，
 * 多选画板时一起换），以及新建、重命名、删除图集。
 */
export function createAlbumBar(root, { store, actions, toast }) {
  const name = el('span', { class: 'album-name' });
  const count = el('span', { class: 'album-count' });
  const btn = el('button', { class: 'album-btn', title: '切换图集：当前画板显示哪一组图片' },
    icon('images', 15), name, count, icon('chevron-down', 13));
  root.append(btn);

  const real = a => a.slides.filter(x => !x.placeholder).length;
  const menu = createMenu(btn, {
    className: 'album-menu',
    render(pop, close) {
      const s = store.get();
      const cur = albumOf(s);
      const n = selectionOf(s).length;
      const item = (ic, label, meta, fn, { checked = false, danger = false, disabled = false } = {}) => {
        const b = el('button', { class: `menu-item${danger ? ' danger' : ''}`, disabled },
          el('span', { class: 'menu-check' }, checked ? icon('check', 14) : ic ? icon(ic, 14) : null),
          el('span', { class: 'menu-label' }, label),
          meta != null ? el('span', { class: 'menu-meta' }, meta) : null);
        b.addEventListener('click', () => { close(); fn(); });
        return b;
      };
      pop.replaceChildren(
        el('div', { class: 'menu-title' }, n > 1 ? `图集（${n} 个画板一起换）` : '图集（当前画板显示哪一组）'),
        ...s.albums.map(a => item(null, a.name, `${real(a)} 张`, () => {
          if (a.id === cur.id && !s.slidesOwn) return;
          actions.setBoardAlbum(a.id);
          toast(`已换成图集「${a.name}」`);
        }, { checked: a.id === cur.id })),
        el('div', { class: 'menu-sep' }),
        item('plus', '新建图集…', null, () => {
          const v = prompt('图集名称', `图集 ${s.albums.length + 1}`)?.trim();
          if (v == null) return;
          actions.addAlbum(v || undefined);
          toast('已新建图集：把图片或文件夹拖进来；拖入文件夹会自动新建图集');
        }),
        item('pencil', '重命名当前图集…', null, () => {
          const v = prompt('图集名称', cur.name)?.trim();
          if (v && v !== cur.name) actions.renameAlbum(cur.id, v);
        }),
        item('trash-2', '删除当前图集', null, () => {
          if (!confirm(`删除图集「${cur.name}」？用它的画板会换成别的图集（已单独设置图片的画板不受影响）`)) return;
          if (actions.removeAlbum(cur.id)) toast(`已删除图集「${cur.name}」`);
        }, { danger: true, disabled: s.albums.length <= 1 }),
      );
    },
  });

  function update(s) {
    const a = albumOf(s);
    name.textContent = a ? a.name : '图集';
    count.textContent = a && s.albums.length > 1 ? `${s.albums.indexOf(a) + 1} / ${s.albums.length}` : '';
    btn.title = `图集「${a?.name || ''}」：点击切换、新建或重命名图集`;
    if (menu.isOpen()) menu.refresh();
  }
  update(store.get());
  return { update, open: () => menu.show() };
}
