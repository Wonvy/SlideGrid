import { el } from './dom.js';
import { icon } from './icons.js';
import { albumOf, selectionOf } from '../state.js';
import { showContextMenu } from './contextMenu.js';

/**
 * 左栏顶部的图集：一排「叠放」（类似 macOS 程序坞的叠放 / 相册）——每个图集用前几张图片叠成一摞，
 * 下面是名称和张数；当前画板的图集高亮。点一摞 = 当前画板换成这个图集（多选画板时一起换），
 * 右键一摞：重命名、删除；最后一个「+」新建图集。
 */
const THUMB_W = 64, THUMB_H = 50, DPR = 2;

// 一摞：最多 3 张，后面的往两边转一点，最前面的正放（图片按比例缩进卡片里）
function drawStack(canvas, slides) {
  canvas.width = THUMB_W * DPR;
  canvas.height = THUMB_H * DPR;
  const g = canvas.getContext('2d');
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, THUMB_W, THUMB_H);
  const list = slides.filter(x => !x.placeholder).slice(0, 3).reverse(); // 第一张在最上面
  const cw = 46, ch = 32;
  if (!list.length) {
    g.setLineDash([3, 3]);
    g.strokeStyle = 'rgba(255,255,255,.28)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.roundRect((THUMB_W - cw) / 2, (THUMB_H - ch) / 2, cw, ch, 5);
    g.stroke();
    return;
  }
  const poses = { 1: [[0, 0, 0]], 2: [[-8, -2, -3], [0, 0, 0]], 3: [[-10, -3, -4], [9, -2, 3], [0, 0, 0]] }[list.length];
  list.forEach((slide, i) => {
    const [rot, dx, dy] = poses[i];
    g.save();
    g.translate(THUMB_W / 2 + dx, THUMB_H / 2 + dy + 2);
    g.rotate((rot * Math.PI) / 180);
    g.shadowColor = 'rgba(0,0,0,.45)';
    g.shadowBlur = 5;
    g.shadowOffsetY = 1.5;
    g.beginPath();
    g.roundRect(-cw / 2, -ch / 2, cw, ch, 4);
    g.fillStyle = '#f3f4f6';
    g.fill();
    g.shadowColor = 'transparent';
    g.clip();
    const img = slide.thumb || slide.preview;
    if (img?.width) {
      const k = Math.max(cw / img.width, ch / img.height);
      g.drawImage(img, -img.width * k / 2, -img.height * k / 2, img.width * k, img.height * k);
    }
    g.restore();
    // 白色细边，像照片
    g.save();
    g.translate(THUMB_W / 2 + dx, THUMB_H / 2 + dy + 2);
    g.rotate((rot * Math.PI) / 180);
    g.beginPath();
    g.roundRect(-cw / 2, -ch / 2, cw, ch, 4);
    g.strokeStyle = 'rgba(255,255,255,.85)';
    g.lineWidth = 1.2;
    g.stroke();
    g.restore();
  });
}

export function createAlbumBar(root, { store, actions, toast }) {
  const strip = el('div', { class: 'album-strip', role: 'listbox', 'aria-label': '图集' });
  root.append(strip);

  const real = a => a.slides.filter(x => !x.placeholder).length;
  const rename = a => {
    const v = prompt('图集名称', a.name)?.trim();
    if (v && v !== a.name) actions.renameAlbum(a.id, v);
  };
  const remove = a => {
    if (store.get().albums.length <= 1) { toast('至少保留一个图集', { error: true }); return; }
    if (!confirm(`删除图集「${a.name}」？用它的画板会换成别的图集（已单独设置图片的画板不受影响）`)) return;
    if (actions.removeAlbum(a.id)) toast(`已删除图集「${a.name}」`);
  };
  const create = () => {
    const s = store.get();
    const v = prompt('图集名称', `图集 ${s.albums.length + 1}`)?.trim();
    if (v == null) return;
    actions.addAlbum(v || undefined);
    toast('已新建图集：把图片或文件夹拖进来；拖入文件夹会自动新建图集');
  };

  // 只在图集的图片、名称、当前图集变化时重画（缩略图画在小画布上）
  let key = '';
  function render(s) {
    const cur = albumOf(s);
    const k = [cur?.id, s.slidesOwn, selectionOf(s).length, ...s.albums.map(a => `${a.id}:${a.name}:${a.slides.slice(0, 3).map(x => x.id).join('.')}:${a.slides.length}`)].join('|');
    if (k === key) return;
    key = k;
    const n = selectionOf(s).length;
    strip.replaceChildren(...s.albums.map(a => {
      const canvas = el('canvas', { class: 'album-stack' });
      drawStack(canvas, a.slides);
      const active = a.id === cur?.id;
      const b = el('button', {
        class: `album-tile${active ? ' active' : ''}${active && s.slidesOwn ? ' own' : ''}`, role: 'option', 'aria-selected': String(active),
        title: `${a.name} · ${real(a)} 张${active ? (s.slidesOwn ? '（当前画板单独设置了图片）' : '（当前画板）') : n > 1 ? `\n点击：所选的 ${n} 个画板换成这个图集` : '\n点击：当前画板换成这个图集'}\n右键：重命名 / 删除`,
      }, canvas, el('span', { class: 'album-label' }, a.name), el('span', { class: 'album-meta' }, `${real(a)} 张`));
      b.addEventListener('click', () => {
        if (active && !s.slidesOwn) return;
        actions.setBoardAlbum(a.id);
        toast(`已换成图集「${a.name}」`);
      });
      b.addEventListener('contextmenu', e => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          { title: a.name },
          !active && { label: n > 1 ? `所选的 ${n} 个画板换成这个图集` : '当前画板换成这个图集', icon: 'images', action: () => actions.setBoardAlbum(a.id) },
          { label: '重命名…', icon: 'pencil', action: () => rename(a) },
          { label: '新建图集…', icon: 'plus', action: create },
          { sep: true },
          { label: '删除图集', icon: 'trash-2', danger: true, action: () => remove(a) },
        ]);
      });
      return b;
    }), (() => {
      const add = el('button', { class: 'album-tile add', title: '新建图集（拖入文件夹也会自动新建）' },
        el('span', { class: 'album-add' }, icon('plus', 18)), el('span', { class: 'album-label' }, '新建'), el('span', { class: 'album-meta' }, ' '));
      add.addEventListener('click', create);
      return add;
    })());
  }

  render(store.get());
  return { update: render };
}
