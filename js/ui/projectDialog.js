import { el } from './dom.js';
import { icon } from './icons.js';

function relativeTime(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 项目面板：列出所有项目，支持新建、打开、重命名、复制、导出、删除、导入。
 * controller：project/controller.js；download(blob, name)；toast(msg, opts)
 */
export function createProjectDialog({ store, controller, download, toast }) {
  const grid = el('div', { class: 'project-grid' });
  const fileInput = el('input', { type: 'file', accept: '.slidegrid,application/zip', hidden: true });
  const busyNote = el('div', { class: 'dialog-status' });

  const dialog = el('dialog', { class: 'modal projects-modal' },
    el('div', { class: 'modal-head' },
      el('h2', {}, '项目'),
      el('button', { class: 'icon-btn visible', title: '关闭', onclick: () => dialog.close() }, icon('x', 16))),
    el('div', { class: 'project-toolbar' },
      el('button', { class: 'btn primary', onclick: () => act(async () => { await controller.createNew(); dialog.close(); toast('已新建项目'); }) }, icon('plus'), '新建项目'),
      el('button', { class: 'btn', title: '导入 .slidegrid 项目文件（也可以直接拖进窗口）', onclick: () => fileInput.click() }, icon('upload'), '导入项目…'),
      busyNote,
      fileInput),
    grid,
  );
  document.body.append(dialog);
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

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
      return;
    } finally {
      busy = false;
    }
    busyNote.textContent = '';
    if (dialog.open) refresh();
  }

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

  const urls = [];
  async function refresh() {
    const projects = await controller.list();
    urls.splice(0).forEach(u => URL.revokeObjectURL(u));
    const currentId = store.get().project?.id;
    grid.innerHTML = '';

    for (const p of projects) {
      const thumb = el('div', { class: 'project-thumb' });
      if (p.thumb instanceof Blob) {
        const url = URL.createObjectURL(p.thumb);
        urls.push(url);
        thumb.append(el('img', { src: url, alt: '' }));
      } else {
        thumb.append(el('span', {}, p.slideCount ? '暂无预览' : '空项目'));
      }
      const isCurrent = p.id === currentId;

      const menuBtn = (iconName, title, fn) => el('button', {
        class: 'icon-btn visible', title, 'aria-label': title,
        onclick: e => { e.stopPropagation(); fn(); },
      }, icon(iconName, 15));

      const card = el('div', { class: `project-card${isCurrent ? ' current' : ''}`, title: isCurrent ? '当前项目' : '打开此项目' },
        thumb,
        el('div', { class: 'project-meta' },
          el('div', { class: 'project-name' }, p.name, isCurrent ? el('span', { class: 'badge' }, '当前') : null),
          el('div', { class: 'project-sub' }, `${p.slideCount || 0} 张 · ${relativeTime(p.updatedAt)}`)),
        el('div', { class: 'project-actions' },
          menuBtn('pencil', '重命名', () => {
            const name = prompt('项目名称', p.name);
            if (name && name.trim() && name.trim() !== p.name) act(() => controller.rename(p.id, name));
          }),
          menuBtn('copy', '复制为新项目', () => act(async () => {
            const copy = await controller.duplicate(p.id);
            toast(`已复制为「${copy.name}」`);
          }, '正在复制…')),
          menuBtn('download', '导出为 .slidegrid 文件', () => act(async () => {
            const { blob, filename } = await controller.exportFile(p.id);
            download(blob, filename);
            toast(`已导出「${filename}」`);
          }, '正在打包…')),
          menuBtn('trash-2', '删除项目', () => {
            if (confirm(`删除项目「${p.name}」？此操作无法撤销，建议先导出备份。`)) {
              act(async () => { await controller.remove(p.id); toast(`已删除「${p.name}」`); });
            }
          }),
        ),
      );
      card.addEventListener('click', () => {
        if (isCurrent) { dialog.close(); return; }
        act(async () => {
          const { failed } = await controller.open(p.id);
          dialog.close();
          toast(failed ? `已打开「${p.name}」，${failed} 张图片无法读取` : `已打开「${p.name}」`, { error: failed > 0 });
        }, '正在打开…');
      });
      grid.append(card);
    }
  }

  return {
    async open() {
      await refresh();
      if (!dialog.open) dialog.showModal();
    },
    refresh: () => (dialog.open ? refresh() : null),
  };
}
