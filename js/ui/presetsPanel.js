import { getLayout } from '../layouts/index.js';
import { presetFromState } from '../state.js';
import { listPresets, putPreset, createPresetRecord, deletePreset, exportPresetsFile, importPresetsFile } from '../persist/presets.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { askText, askConfirm } from './dialogs.js';

const safeName = s => String(s).replace(/[\\/:*?"<>|]/g, '_');

/**
 * 「我的版式」面板：保存当前版式（含缩略图）、套用、覆盖更新、重命名、导出、删除、导入。
 * snapshot(width) → Promise<Blob>：当前画面的缩略图
 * saveFooter：「保存当前版式」按钮和保存表单放在设计页底部
 */
export function createPresetsPanel(container, { store, actions, snapshot, toast, download, onCount = () => {}, saveFooter }) {
  const grid = el('div', { class: 'preset-grid' });
  const empty = el('div', { class: 'preset-empty' }, '还没有保存的版式。在「设计」页底部点「保存当前版式」。');
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true });

  // 保存表单
  const nameInput = el('input', { type: 'text', class: 'text-input', placeholder: '版式名称', maxlength: 40 });
  const withStyle = el('input', { type: 'checkbox', class: 'switch' });
  const withAspect = el('input', { type: 'checkbox', class: 'switch' });
  const form = el('div', { class: 'preset-form', hidden: true },
    nameInput,
    el('label', { class: 'check-row' }, withStyle, '同时保存样式（背景、圆角、投影）'),
    el('label', { class: 'check-row' }, withAspect, '同时保存画布比例'),
    el('div', { class: 'form-actions' },
      el('button', { class: 'btn small', onclick: () => { form.hidden = true; } }, '取消'),
      el('button', { class: 'btn primary small', onclick: () => saveNew() }, '保存')),
  );
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveNew();
    if (e.key === 'Escape') form.hidden = true;
  });

  const saveBtn = el('button', {
      class: 'btn small', title: '把当前版式、参数、卡片调整和视图保存为模板',
      onclick: () => {
        form.hidden = !form.hidden;
        if (!form.hidden) {
          nameInput.value = `${getLayout(store.get().layoutId).name} ${new Date().toLocaleDateString()}`;
          nameInput.select();
          nameInput.focus();
        }
      },
    }, icon('bookmark-plus', 14), '保存当前版式');
  const toolbar = el('div', { class: 'preset-toolbar' },
    el('button', { class: 'icon-btn visible', title: '导入版式文件（.json）', 'aria-label': '导入版式文件（.json）', onclick: () => fileInput.click() }, icon('upload', 15)),
    el('button', { class: 'icon-btn visible', title: '导出全部版式', 'aria-label': '导出全部版式', onclick: () => exportAll() }, icon('download', 15)),
    fileInput,
  );

  saveFooter.append(form, el('div', { class: 'preset-toolbar' }, saveBtn));
  container.append(toolbar, grid, empty);

  async function thumb() {
    try { return await snapshot(320); } catch { return null; }
  }

  async function saveNew() {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const data = presetFromState(store.get(), { includeStyle: withStyle.checked, includeAspect: withAspect.checked });
    await putPreset(createPresetRecord({ name, ...data, thumb: await thumb() }));
    form.hidden = true;
    toast(`已保存版式「${name}」`);
    refresh();
  }

  async function exportAll() {
    const all = await listPresets();
    if (!all.length) { toast('还没有可导出的版式', { error: true }); return; }
    download(await exportPresetsFile(all), 'slidegrid-版式.json');
  }

  async function importFile(file) {
    try {
      const added = await importPresetsFile(file);
      toast(`已导入 ${added.length} 个版式`);
      refresh();
      return added;
    } catch (err) {
      toast(`导入失败：${err.message}`, { error: true });
      return [];
    }
  }
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (f) importFile(f);
  });

  const urls = [];
  async function refresh() {
    const presets = await listPresets();
    urls.splice(0).forEach(u => URL.revokeObjectURL(u));
    grid.innerHTML = '';
    empty.hidden = presets.length > 0;
    onCount(presets.length);

    for (const p of presets) {
      const base = getLayout(p.layoutId);
      const th = el('div', { class: 'preset-thumb' });
      if (p.thumb instanceof Blob) {
        const url = URL.createObjectURL(p.thumb);
        urls.push(url);
        th.append(el('img', { src: url, alt: '' }));
      }
      const tags = [base ? base.name : '未知版式', p.style ? '含样式' : null, p.aspect ? (p.aspect === 'long' ? '长图' : p.aspect) : null].filter(Boolean);
      const action = (name, title, fn) => el('button', {
        class: 'icon-btn visible', title, 'aria-label': title,
        onclick: e => { e.stopPropagation(); fn(); },
      }, icon(name, 14));

      const card = el('div', { class: 'preset-card', title: `套用「${p.name}」` },
        th,
        el('div', { class: 'preset-meta' },
          el('div', { class: 'preset-name' }, p.name),
          el('div', { class: 'preset-sub' }, tags.join(' · '))),
        el('div', { class: 'preset-actions' },
          action('refresh-cw', '用当前设置覆盖此版式', async () => {
            if (!await askConfirm({ title: '覆盖版式', message: `用当前的版式设置覆盖「${p.name}」？`, okText: '覆盖' })) return;
            const data = presetFromState(store.get(), { includeStyle: !!p.style, includeAspect: !!p.aspect });
            await putPreset({ ...p, ...data, thumb: (await thumb()) || p.thumb, updatedAt: Date.now() });
            toast(`已更新「${p.name}」`);
            refresh();
          }),
          action('pencil', '重命名', async () => {
            const name = await askText({ title: '重命名版式', label: '版式名称', value: p.name });
            if (!name || name === p.name) return;
            await putPreset({ ...p, name, updatedAt: Date.now() });
            refresh();
          }),
          action('download', '导出此版式', async () => {
            download(await exportPresetsFile([p]), `${safeName(p.name)}.slidegrid-layout.json`);
          }),
          action('trash-2', '删除', async () => {
            if (!await askConfirm({ title: '删除版式', message: `删除版式「${p.name}」？此操作无法撤销。`, okText: '删除', danger: true })) return;
            await deletePreset(p.id);
            refresh();
          }),
        ),
      );
      card.addEventListener('click', () => {
        const r = actions.applyPreset(p);
        toast(r.ok ? `已套用「${p.name}」` : r.reason, { error: !r.ok });
      });
      grid.append(card);
    }
  }

  refresh();
  return { refresh, importFile };
}
