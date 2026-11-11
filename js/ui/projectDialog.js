import { el } from './dom.js';
import { icon } from './icons.js';
import { createMenu } from './menu.js';
import { aspectValue, isLongAspect } from '../config.js';
import { askText, askConfirm, askOptions } from './dialogs.js';

function relativeTime(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 字节 → 易读的大小
export function formatBytes(n) {
  if (!(n > 0)) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// 新建项目时可选的画板尺寸（之后可以随时在顶栏修改）
const NEW_SIZES = [
  { id: '1920x1080', label: '横版 16:9', note: '1920 × 1080' },
  { id: '1600x1200', label: '横版 4:3', note: '1600 × 1200' },
  { id: '1080x1080', label: '方形 1:1', note: '1080 × 1080' },
  { id: '1080x1350', label: '竖版 4:5', note: '1080 × 1350' },
  { id: '1242x1660', label: '竖版 3:4', note: '1242 × 1660' },
  { id: '1080x1920', label: '竖屏 9:16', note: '1080 × 1920' },
  { id: 'long', label: '长图', note: '高度随内容' },
];
const DEFAULT_SIZE = '1920x1080';

// 按比例画一个小矩形，表示画板的形状
function sizeShape(id, max = 34) {
  const a = isLongAspect(id) ? 0.45 : aspectValue(id);
  const w = a >= 1 ? max : max * a, h = a >= 1 ? max / a : max;
  return el('span', { class: `ratio-shape${isLongAspect(id) ? ' long' : ''}`, style: `width:${w.toFixed(1)}px;height:${h.toFixed(1)}px` });
}

/**
 * 项目：顶栏的项目菜单 + 项目窗口（新建项目 / 全部项目两页）。
 *   菜单（点项目名）：重命名、复制、导出当前项目；新建、导入、全部项目；最近的几个项目（点击打开）
 *   窗口：左边一列切换「新建项目」「全部项目」，下面是「导入项目文件」
 *     新建项目：名称 + 画板尺寸（横版 / 竖版 / 方形 / 长图）
 *     全部项目：搜索、排序（最近修改 / 名称 / 占用空间），卡片上显示占用空间，悬停出现重命名 / 复制 / 导出 / 删除
 *     左下角：占用空间（所有项目合计、浏览器还能用多少）和「清理空间…」（用不到的文件、没有内容的项目）
 * controller：project/controller.js；download(blob, name)；toast(msg, opts)；setAspect(id)：设置新项目的画板尺寸
 */
export function createProjectDialog({ anchor, store, controller, download, toast, setAspect, clearHistory }) {
  const fileInput = el('input', { type: 'file', accept: '.slidegrid,application/zip', hidden: true });
  const busyNote = el('div', { class: 'dialog-status' });

  /* ---------------- 共用的操作 ---------------- */

  let busy = false;
  async function act(task, label = '') {
    if (busy) return;
    busy = true;
    busyNote.textContent = label;
    busyNote.classList.remove('error');
    try {
      await task();
    } catch (err) {
      console.error(err);
      busyNote.textContent = err.message || String(err);
      busyNote.classList.add('error');
      if (!dialog.open) toast(err.message || String(err), { error: true });
      return;
    } finally {
      busy = false;
    }
    busyNote.textContent = '';
    if (dialog.open) refresh();
  }
  const current = () => store.get().project;
  const renameProject = async p => {
    const name = await askText({ title: '重命名项目', label: '项目名称', value: p.name });
    if (name && name !== p.name) act(() => controller.rename(p.id, name));
  };
  const duplicateProject = p => act(async () => {
    const copy = await controller.duplicate(p.id);
    toast(`已复制为「${copy.name}」`);
  }, '正在复制…');
  const exportProject = p => act(async () => {
    const { blob, filename } = await controller.exportFile(p.id);
    download(blob, filename);
    toast(`已导出「${filename}」`);
  }, '正在打包…');
  const removeProject = async p => {
    const ok = await askConfirm({ title: '删除项目', message: `删除项目「${p.name}」和它的全部图片？此操作无法撤销，建议先导出备份。`, okText: '删除', danger: true });
    if (!ok) return;
    act(async () => {
      const { created } = await controller.remove(p.id);
      // 删掉了最后一个项目：会新建一个空的（不然没有地方放东西），说清楚，免得以为没删掉
      toast(created ? `已删除「${p.name}」。这是最后一个项目，已新建一个空项目` : `已删除「${p.name}」`);
    }, '正在删除…');
  };
  const openProject = p => {
    if (p.id === current()?.id) { dialog.close(); return; }
    act(async () => {
      const { failed } = await controller.open(p.id);
      dialog.close();
      toast(failed ? `已打开「${p.name}」，${failed} 张图片无法读取` : `已打开「${p.name}」`, { error: failed > 0 });
    }, '正在打开…');
  };
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    act(async () => {
      const { record, failed } = await controller.importFile(file);
      dialog.close();
      toast(failed ? `已导入项目「${record.name}」，${failed} 张图片无法读取` : `已导入项目「${record.name}」`, { error: failed > 0 });
    }, '正在导入…');
  });

  // 缩略图（Blob → URL，用完释放）
  function thumbOf(p, urls) {
    const thumb = el('div', { class: 'project-thumb' });
    if (p.thumb instanceof Blob) {
      const url = URL.createObjectURL(p.thumb);
      urls.push(url);
      thumb.append(el('img', { src: url, alt: '' }));
    } else {
      thumb.append(el('span', {}, p.slideCount ? '暂无预览' : '空项目'));
    }
    return thumb;
  }

  /* ---------------- 新建项目 ---------------- */

  let newSize = DEFAULT_SIZE;
  const nameInput = el('input', { type: 'text', class: 'text-input project-name-input', placeholder: '未命名项目', maxlength: 60, spellcheck: 'false', 'aria-label': '项目名称' });
  const sizeCards = NEW_SIZES.map(sz => {
    const b = el('button', { type: 'button', class: 'size-card', title: `${sz.label}（${sz.note}）` },
      el('span', { class: 'size-card-shape' }, sizeShape(sz.id)),
      el('span', { class: 'size-card-label' }, sz.label),
      el('span', { class: 'size-card-note' }, sz.note));
    b.addEventListener('click', () => { newSize = sz.id; syncSizes(); });
    b.addEventListener('dblclick', create);
    return { id: sz.id, b };
  });
  const syncSizes = () => sizeCards.forEach(c => c.b.classList.toggle('active', c.id === newSize));
  function create() {
    act(async () => {
      const rec = await controller.createNew(nameInput.value.trim() || '未命名项目');
      if (newSize !== DEFAULT_SIZE) setAspect(newSize);
      clearHistory?.(); // 新项目从干净的撤销记录开始
      dialog.close();
      toast(`已新建项目「${rec.name}」`);
    }, '正在新建…');
  }
  nameInput.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') create(); });
  const newPage = el('div', { class: 'pm-page pm-new' },
    el('h3', { class: 'pm-title' }, '新建项目'),
    el('label', { class: 'pm-field' }, el('span', { class: 'pm-label' }, '名称'), nameInput),
    el('div', { class: 'pm-field' },
      el('span', { class: 'pm-label' }, '画板尺寸'),
      el('div', { class: 'size-cards' }, sizeCards.map(c => c.b))),
    el('p', { class: 'note pm-note' }, '画板尺寸之后可以随时在顶栏修改，一个项目里可以有多个不同尺寸的画板。卡片的比例默认跟随图片（竖版、4:3 的图片不用另外设置），也可以在「设计 → 卡片」里固定。'),
    el('div', { class: 'pm-actions' },
      el('button', { class: 'btn primary', type: 'button', onclick: create }, icon('plus'), '创建项目')),
  );

  /* ---------------- 全部项目 ---------------- */

  let query = '', sort = 'recent', projects = [], usage = null;
  const search = el('input', { type: 'search', class: 'text-input project-search', placeholder: '搜索项目', spellcheck: 'false', 'aria-label': '搜索项目' });
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); renderGrid(); });
  search.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });
  const sortBtns = [['recent', '最近修改'], ['name', '名称'], ['size', '占用空间']].map(([id, label]) => {
    const b = el('button', { type: 'button', class: 'seg-btn' }, label);
    b.addEventListener('click', () => { sort = id; renderGrid(); });
    return { id, b };
  });
  const grid = el('div', { class: 'project-grid' });
  const allPage = el('div', { class: 'pm-page pm-all' },
    el('div', { class: 'project-toolbar' },
      el('h3', { class: 'pm-title' }, '全部项目'),
      el('span', { class: 'bar-spacer' }),
      search,
      el('div', { class: 'seg project-sort' }, sortBtns.map(x => x.b))),
    grid,
  );

  const urls = [];
  function renderGrid() {
    urls.splice(0).forEach(u => URL.revokeObjectURL(u));
    sortBtns.forEach(x => x.b.classList.toggle('active', x.id === sort));
    const currentId = current()?.id;
    const list = projects.filter(p => !query || p.name.toLowerCase().includes(query));
    const sizeOf = p => usage?.sizes.get(p.id) || 0;
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    else if (sort === 'size') list.sort((a, b) => sizeOf(b) - sizeOf(a));
    else list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    grid.replaceChildren();
    // 第一格：新建项目
    if (!query) {
      const add = el('button', { type: 'button', class: 'project-card project-add', title: '新建项目' },
        el('div', { class: 'project-thumb' }, icon('plus', 22)),
        el('div', { class: 'project-meta' }, el('div', { class: 'project-name' }, '新建项目'), el('div', { class: 'project-sub' }, '选择名称和画板尺寸')));
      add.addEventListener('click', () => showPage('new'));
      grid.append(add);
    }
    for (const p of list) {
      const isCurrent = p.id === currentId;
      const action = (iconName, title, fn, danger = false) => el('button', {
        class: `icon-btn visible${danger ? ' danger' : ''}`, title, 'aria-label': title,
        onclick: e => { e.stopPropagation(); fn(p); },
      }, icon(iconName, 14));
      const card = el('div', { class: `project-card${isCurrent ? ' current' : ''}`, tabindex: '0', role: 'button', title: isCurrent ? '当前项目' : `打开「${p.name}」` },
        thumbOf(p, urls),
        el('div', { class: 'project-actions' },
          action('pencil', '重命名', renameProject),
          action('copy', '复制为新项目', duplicateProject),
          action('download', '导出为 .slidegrid 文件', exportProject),
          action('trash-2', '删除项目', removeProject, true)),
        el('div', { class: 'project-meta' },
          el('div', { class: 'project-name' }, el('span', { class: 'project-name-text' }, p.name), isCurrent ? el('span', { class: 'badge' }, '当前') : null),
          el('div', { class: 'project-sub' }, [`${p.slideCount || 0} 张`, usage ? formatBytes(sizeOf(p)) : null, relativeTime(p.updatedAt)].filter(Boolean).join(' · '),
            // 有图片、从没导出过：标出来
            p.slideCount && !p.exportedAt ? el('span', { class: 'project-nobackup', title: '这个项目还没有导出过备份' }, '未备份') : null)),
      );
      card.addEventListener('click', () => openProject(p));
      card.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === card) openProject(p); });
      grid.append(card);
    }
    if (query && !list.length) grid.append(el('p', { class: 'note project-empty' }, `没有名称里带「${search.value.trim()}」的项目`));
    countBadge.textContent = projects.length || '';
    renderStorage();
  }

  /* ---------------- 占用空间 / 清理 ---------------- */

  const storageText = el('div', { class: 'storage-text' });
  const storageFill = el('span', { class: 'storage-fill' });
  const storageNote = el('div', { class: 'storage-note' });
  const persistNote = el('div', { class: 'storage-note', hidden: true });
  let persisted = null;
  const cleanBtn = el('button', { type: 'button', class: 'btn small storage-clean', title: '清理用不到的文件和没有内容的项目' }, icon('trash-2', 13), '清理空间…');
  const storageBox = el('div', { class: 'storage-box' },
    el('div', { class: 'storage-head' }, el('span', { class: 'storage-title' }, '占用空间'), storageText),
    el('div', { class: 'storage-bar' }, storageFill),
    storageNote, persistNote, cleanBtn);
  function renderStorage() {
    if (!usage) { storageText.textContent = '…'; storageNote.textContent = ''; return; }
    storageText.textContent = formatBytes(usage.total);
    const q = usage.quota;
    const ratio = q?.quota ? Math.min(1, (q.usage || usage.total) / q.quota) : 0;
    storageFill.style.width = `${Math.max(ratio * 100, usage.total ? 2 : 0)}%`;
    storageFill.classList.toggle('warn', ratio > 0.8);
    const free = q?.quota ? Math.max(0, q.quota - (q.usage || 0)) : null;
    const waste = usage.unused.count ? `，其中 ${formatBytes(usage.unused.bytes)} 用不到` : '';
    storageNote.textContent = `${projects.length} 个项目${waste}${free != null ? ` · 浏览器还可用约 ${formatBytes(free)}` : ''}`;
    persistNote.textContent = persisted === true ? '已设为持久保存：浏览器不会自动清理' : persisted === false ? '浏览器空间紧张时可能清理这些数据，重要的项目请导出备份' : '';
    persistNote.hidden = persisted == null;
  }
  cleanBtn.addEventListener('click', async () => {
    const u = usage || await controller.usage();
    const currentId = current()?.id;
    const empties = u.empty.filter(p => p.id !== currentId);
    const picked = await askOptions({
      title: '清理空间',
      message: '只清理确定用不到的东西。要腾出更多空间，按「占用空间」排序后删除不需要的项目（建议先导出备份）。',
      okText: '清理', danger: true,
      options: [
        {
          id: 'unused', label: '用不到的文件', checked: u.unused.count > 0, disabled: !u.unused.count,
          note: u.unused.count ? `${u.unused.count} 个，${formatBytes(u.unused.bytes)}（不属于任何项目，或项目里已经不用的图片）` : '没有',
        },
        {
          id: 'empty', label: '没有内容的项目', checked: false, disabled: !empties.length,
          note: empties.length ? `${empties.length} 个：${empties.slice(0, 4).map(p => `「${p.name}」`).join('、')}${empties.length > 4 ? '…' : ''}（没有图片也没有图层；当前项目除外）` : '没有',
        },
      ],
    });
    if (!picked?.length) return;
    act(async () => {
      const r = await controller.cleanup(picked);
      const parts = [r.files ? `${r.files} 个文件（${formatBytes(r.bytes)}）` : null, r.projects ? `${r.projects} 个空项目` : null].filter(Boolean);
      toast(parts.length ? `已清理 ${parts.join('、')}` : '没有需要清理的');
    }, '正在清理…');
  });

  /* ---------------- 窗口 ---------------- */

  const countBadge = el('span', { class: 'tab-count' });
  const navBtn = (id, ic, label, extra = null) => {
    const b = el('button', { type: 'button', class: 'pm-nav-btn', 'data-page': id }, icon(ic, 16), el('span', { class: 'pm-nav-label' }, label), extra);
    b.addEventListener('click', () => showPage(id));
    return b;
  };
  const navBtns = [navBtn('new', 'plus', '新建项目'), navBtn('all', 'folder-kanban', '全部项目', countBadge)];
  const importBtn = el('button', { type: 'button', class: 'pm-nav-btn', title: '导入 .slidegrid 项目文件（也可以直接拖进窗口）', onclick: () => fileInput.click() },
    icon('upload', 16), el('span', { class: 'pm-nav-label' }, '导入项目文件…'));
  // 备份全部：每个项目一个 .slidegrid，打成一个 zip
  const backupAllBtn = el('button', { type: 'button', class: 'pm-nav-btn', title: '把所有项目各导出一个 .slidegrid 文件，打包成一个 zip 下载（恢复时把里面的文件逐个导入）' },
    icon('download', 16), el('span', { class: 'pm-nav-label' }, '备份全部项目'));
  backupAllBtn.addEventListener('click', () => act(async () => {
    const { blob, filename, count } = await controller.exportAll(t => { busyNote.textContent = `正在打包… ${Math.round(t * 100)}%`; });
    download(blob, filename);
    toast(`已备份 ${count} 个项目：「${filename}」`);
  }, '正在打包…'));
  const pages = { new: newPage, all: allPage };
  let page = 'all';
  function showPage(id) {
    page = id in pages ? id : 'all';
    for (const [k, node] of Object.entries(pages)) node.hidden = k !== page;
    navBtns.forEach(b => b.classList.toggle('active', b.dataset.page === page));
    if (page === 'new') {
      syncSizes();
      if (dialog.open) nameInput.focus();
    }
  }

  const dialog = el('dialog', { class: 'modal projects-modal' },
    el('div', { class: 'modal-head' },
      el('h2', {}, '项目'),
      busyNote,
      el('button', { class: 'icon-btn visible', title: '关闭', 'aria-label': '关闭', onclick: () => dialog.close() }, icon('x', 16))),
    el('div', { class: 'pm-body' },
      el('nav', { class: 'pm-nav' },
        ...navBtns,
        el('div', { class: 'menu-sep' }),
        importBtn,
        backupAllBtn,
        el('span', { class: 'bar-spacer' }),
        storageBox,
        el('p', { class: 'note pm-nav-note' }, '项目保存在这个浏览器里。换电脑、换浏览器请先导出 .slidegrid 文件，再到那边导入。'),
        fileInput),
      el('div', { class: 'pm-main' }, newPage, allPage)),
  );
  document.body.append(dialog);
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => urls.splice(0).forEach(u => URL.revokeObjectURL(u)));

  async function refresh() {
    projects = await controller.list();
    renderGrid();
    // 占用空间要读一遍所有文件，稍慢：先把列表显示出来，算好了再补上
    try { usage = await controller.usage(); } catch (err) { console.warn(err); usage = null; }
    if (persisted == null && projects.some(p => p.slideCount)) persisted = await controller.persist(); // 有内容了：请浏览器别自动清理
    projects = await controller.list();
    renderGrid();
  }
  async function open(target = 'all') {
    if (target === 'new') { nameInput.value = ''; newSize = DEFAULT_SIZE; }
    showPage(target);
    await refresh();
    if (!dialog.open) dialog.showModal();
    (target === 'new' ? nameInput : search).focus(); // 全部项目：打开就可以直接输入搜索
  }

  /* ---------------- 顶栏的项目菜单 ---------------- */

  const menuUrls = [];
  const menu = anchor && createMenu(anchor, {
    className: 'project-menu',
    render(pop, close) {
      menuUrls.splice(0).forEach(u => URL.revokeObjectURL(u));
      const p = current() || { name: '未命名项目' };
      const item = (ic, label, fn, meta = null) => el('button', { class: 'menu-item', role: 'menuitem', onclick: () => { close(); fn(); } },
        el('span', { class: 'menu-check' }, icon(ic, 14)), el('span', { class: 'menu-label' }, label), meta ? el('span', { class: 'menu-meta' }, meta) : null);
      const recent = el('div', { class: 'pm-recent' });
      pop.replaceChildren(
        el('div', { class: 'menu-title' }, `当前项目 · ${p.name}`),
        item('pencil', '重命名…', () => renameProject(p)),
        item('copy', '复制为新项目', () => duplicateProject(p)),
        item('download', '导出项目文件', () => exportProject(p), '.slidegrid'),
        el('div', { class: 'menu-sep' }),
        item('plus', '新建项目…', () => open('new')),
        item('upload', '导入项目文件…', () => fileInput.click()),
        item('folder-kanban', '全部项目…', () => open('all')),
        recent,
      );
      // 最近的几个项目（不含当前）：异步读出来再补上
      controller.list().then(list => {
        if (!menu.isOpen()) return;
        const others = list.filter(x => x.id !== p.id).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 4);
        if (!others.length) return;
        recent.append(el('div', { class: 'menu-sep' }), el('div', { class: 'menu-title' }, '最近的项目'), ...others.map(x => {
          const row = el('button', { class: 'menu-item pm-recent-item', role: 'menuitem', title: `打开「${x.name}」` },
            thumbOf(x, menuUrls), el('span', { class: 'menu-label' }, x.name), el('span', { class: 'menu-meta' }, relativeTime(x.updatedAt)));
          row.addEventListener('click', () => { close(); openProject(x); });
          return row;
        }));
      }).catch(() => {});
    },
  });

  return {
    open,
    refresh: () => (dialog.open ? refresh() : null),
  };
}
