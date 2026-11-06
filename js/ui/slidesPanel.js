import { el } from './dom.js';
import { icon } from './icons.js';

const VIEW_KEY = 'slidegrid:slides-view';

/**
 * 左侧幻灯片面板：网格 / 列表两种视图、拖动排序、移除，以及与预览区的悬停联动。
 *
 *   onRemove(id) / onMove(from, to)
 *   onHover(index | null)   鼠标移到某张上 → 在预览区高亮对应卡片
 */
export function createSlidesPanel({ listEl, countEl, emptyEl, dropzone, footEl, viewButtons, onRemove, onMove, onHover = () => {}, onPick }) {
  let dragFrom = -1;
  let view = 'grid';
  try { view = localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { /* 忽略 */ }

  function setView(v) {
    view = v;
    listEl.className = `slide-list ${v}`;
    viewButtons.grid.classList.toggle('active', v === 'grid');
    viewButtons.list.classList.toggle('active', v === 'list');
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* 忽略 */ }
  }
  viewButtons.grid.addEventListener('click', () => setView('grid'));
  viewButtons.list.addEventListener('click', () => setView('list'));
  setView(view);

  // 有图片后拖放区收成一行，点击即可添加
  dropzone.addEventListener('click', e => {
    if (dropzone.classList.contains('compact') && !e.target.closest('button')) onPick();
  });

  const clearMarks = () =>
    listEl.querySelectorAll('.drop-before, .drop-after').forEach(n => n.classList.remove('drop-before', 'drop-after'));

  function render(slides) {
    listEl.innerHTML = '';
    const images = slides.filter(s => !s.placeholder).length;
    countEl.textContent = slides.length ? String(images) : '';
    if (emptyEl) emptyEl.hidden = slides.length > 0;
    dropzone.classList.toggle('compact', slides.length > 0);
    footEl.textContent = slides.length
      ? `共 ${images} 张${slides.length > images ? `（另有 ${slides.length - images} 个空位）` : ''} · 拖动排序 · 悬停在预览中定位`
      : '';

    slides.forEach((slide, i) => {
      const meta = slide.placeholder ? '空位' : slide.width && slide.height ? `${slide.width} × ${slide.height}` : '';
      const remove = el('button', { class: 'icon-btn remove', title: '移除', 'aria-label': '移除' }, icon('x', 13));
      remove.addEventListener('click', e => { e.stopPropagation(); onRemove(slide.id); });

      const li = el('li', {
        class: `slide-item${slide.placeholder ? ' placeholder' : ''}`,
        draggable: 'true',
        title: slide.placeholder ? '空位：把图片拖到预览区这张卡片上即可放入' : slide.path || slide.name,
      },
        el('div', { class: 'slide-thumb' }, slide.thumb, el('span', { class: 'slide-num' }, String(i + 1))),
        el('div', { class: 'slide-info' },
          el('span', { class: 'slide-name' }, slide.placeholder ? `空位 · ${slide.name}` : slide.name),
          meta ? el('span', { class: 'slide-meta' }, meta) : null),
        remove,
      );

      li.addEventListener('mouseenter', () => { if (dragFrom < 0) onHover(i); });
      li.addEventListener('mouseleave', () => onHover(null));

      li.addEventListener('dragstart', e => {
        dragFrom = i;
        onHover(null);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/x-slidegrid', String(i));
        li.classList.add('dragging');
      });
      li.addEventListener('dragend', () => {
        dragFrom = -1;
        li.classList.remove('dragging');
        clearMarks();
      });
      li.addEventListener('dragover', e => {
        if (dragFrom < 0) return;
        e.preventDefault();
        const r = li.getBoundingClientRect();
        // 网格视图按左右判断插入位置，列表视图按上下
        const after = view === 'grid' ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
        clearMarks();
        li.classList.add(after ? 'drop-after' : 'drop-before');
      });
      li.addEventListener('drop', e => {
        if (dragFrom < 0) return;
        e.preventDefault();
        e.stopPropagation();
        const after = li.classList.contains('drop-after');
        let to = i + (after ? 1 : 0);
        if (dragFrom < to) to--;
        const from = dragFrom;
        dragFrom = -1;
        clearMarks();
        onMove(from, to);
      });

      listEl.append(li);
    });
  }

  // 预览区悬停某张时，同步高亮列表里对应的那一项
  function highlight(index) {
    listEl.querySelectorAll('.slide-item.hl').forEach(n => n.classList.remove('hl'));
    if (index == null) return;
    const li = listEl.children[index];
    if (!li) return;
    li.classList.add('hl');
    li.scrollIntoView({ block: 'nearest' });
  }

  return { render, highlight };
}
