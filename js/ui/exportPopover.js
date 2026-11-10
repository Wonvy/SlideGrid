import { formatSchema } from '../export/schema.js';
import { buildControls } from './controls.js';
import { el } from './dom.js';

/**
 * 导出面板：鼠标移到「导出」按钮上时展开——勾选要导出的画板（每个画板显示输出像素 = 画板像素 × 倍率），
 * 格式、质量、透明背景、文件名、预览。点击按钮按勾选的画板导出（多个画板打包成 ZIP）。
 * 面板内有输入焦点或正在导出时不会收起。每次展开时默认勾选当前选中的画板。
 *
 * info(s, ids) → { boards: [{ id, name, width, height }], defaultName }；defaultIds(s) → 默认勾选的画板
 */
export function createExportPopover({ anchor, store, actions, drawPreview, info, defaultIds }) {
  const preview = el('canvas', { class: 'export-preview' });
  const boardList = el('div', { class: 'export-boards' });
  const quick = el('div', { class: 'export-quick' });
  const controlsBox = el('div');
  const nameInput = el('input', { type: 'text', class: 'text-input', spellcheck: 'false' });
  const ext = el('span', { class: 'filename-ext' });
  const bar = el('div', { class: 'progress-bar' });
  const progress = el('div', { class: 'progress', hidden: true }, bar);
  const status = el('div', { class: 'dialog-status' });
  const hint = el('div', { class: 'popover-hint' });

  const pop = el('div', { class: 'popover export-popover', role: 'dialog', 'aria-label': '导出' },
    el('div', { class: 'popover-title' }, '导出'),
    el('div', { class: 'preview-wrap small' }, preview),
    el('div', { class: 'export-section-head' }, el('span', {}, '画板'), quick),
    boardList,
    controlsBox,
    el('div', { class: 'ctrl' },
      el('label', { class: 'ctrl-label' }, '文件名'),
      el('div', { class: 'filename-row' }, nameInput, ext)),
    progress,
    status,
    hint,
  );
  document.body.append(pop);

  let checked = new Set();
  let nameEdited = false;
  let busy = false;
  let hideTimer = 0;
  nameInput.addEventListener('input', () => { nameEdited = true; });

  const updateControls = buildControls(controlsBox, formatSchema, store.get().exportOpts, actions.setExport);

  const isOpen = () => pop.classList.contains('show');
  const ids = () => store.get().artboards.map(b => b.id).filter(id => checked.has(id));

  function position() {
    const r = anchor.getBoundingClientRect();
    pop.style.top = `${Math.round(r.bottom + 8)}px`;
    pop.style.right = `${Math.round(window.innerWidth - r.right)}px`;
  }

  // 快捷勾选：当前 / 所选 / 全部
  const pickBtn = (label, title, fn) => {
    const b = el('button', { class: 'btn ghost small', title }, label);
    b.addEventListener('click', () => { checked = new Set(fn(store.get())); update(); });
    return b;
  };
  quick.append(
    pickBtn('当前', '只导出当前画板', s => [s.activeBoard]),
    pickBtn('所选', '导出选中的画板', s => defaultIds(s)),
    pickBtn('全部', '导出全部画板', s => s.artboards.map(b => b.id)),
  );

  let listKey = '';
  function renderBoards(s, boards) {
    const key = JSON.stringify([boards, [...checked], s.activeBoard]);
    if (key === listKey) return;
    listKey = key;
    boardList.replaceChildren(...boards.map(b => {
      const box = el('input', { type: 'checkbox' });
      box.checked = checked.has(b.id);
      box.addEventListener('change', () => {
        if (box.checked) checked.add(b.id); else checked.delete(b.id);
        update();
      });
      return el('label', { class: `export-board${b.id === s.activeBoard ? ' current' : ''}` },
        box, el('span', { class: 'eb-name' }, b.name), el('span', { class: 'eb-px' }, `${b.width} × ${b.height}`));
    }));
  }

  function update(s = store.get()) {
    if (!isOpen()) return;
    const o = s.exportOpts;
    updateControls(o);
    for (const id of [...checked]) if (!s.artboards.some(b => b.id === id)) checked.delete(id);
    const pick = ids();
    const { boards, defaultName } = info(s, pick);
    renderBoards(s, boards);
    const multi = pick.length > 1;
    if (!nameEdited) nameInput.value = defaultName;
    ext.textContent = multi ? '.zip' : o.format === 'jpg' ? '.jpg' : '.png';
    const transparent = s.style.bgType === 'transparent' || (o.transparent && o.format === 'png');
    preview.classList.toggle('checker', transparent && o.format === 'png');
    hint.textContent = !pick.length ? '请勾选要导出的画板'
      : multi ? `将导出 ${pick.length} 个画板，打包为 ZIP（每个画板按自己的像素尺寸 × 倍率）`
        : transparent
          ? (o.format === 'png' ? '背景透明：导出 PNG 时保留透明' : 'JPG 不支持透明，背景将以白色填充')
          : '倍率在左侧按钮里选择 · 画板像素在顶栏中间设置 · 点击「导出」开始';
    hint.classList.toggle('warn', !pick.length || (transparent && o.format === 'jpg'));
    drawPreview(preview, { maxW: 300, maxH: 170, whiteFill: transparent && o.format === 'jpg' });
  }

  function show() {
    clearTimeout(hideTimer);
    if (isOpen()) return;
    checked = new Set(defaultIds(store.get()));
    listKey = '';
    position();
    pop.classList.add('show');
    status.textContent = '';
    status.classList.remove('error');
    update();
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (busy || pop.contains(document.activeElement)) return;
      pop.classList.remove('show');
      nameEdited = false;
    }, 220);
  }

  for (const node of [anchor, pop]) {
    node.addEventListener('mouseenter', show);
    node.addEventListener('mouseleave', scheduleHide);
  }
  pop.addEventListener('focusout', () => { if (!pop.matches(':hover')) scheduleHide(); });
  window.addEventListener('resize', () => { if (isOpen()) position(); });

  // 要导出的画板：面板打开时为勾选的，否则为当前选中的画板
  const targets = () => (isOpen() ? ids() : defaultIds(store.get()));
  const filename = (list = targets()) => {
    const s = store.get();
    const base = (isOpen() && nameEdited ? nameInput.value.trim() : '').replace(/\.(png|jpe?g|zip)$/i, '') || info(s, list).defaultName;
    return `${base}.${list.length > 1 ? 'zip' : s.exportOpts.format === 'jpg' ? 'jpg' : 'png'}`;
  };

  return {
    update,
    filename,
    targets,
    isOpen,
    setBusy(b) {
      busy = b;
      progress.hidden = !b;
      if (b) { bar.style.width = '0%'; status.textContent = ''; status.classList.remove('error'); }
      else if (!pop.matches(':hover') && !anchor.matches(':hover')) scheduleHide();
    },
    setProgress(p) { bar.style.width = `${Math.round(p * 100)}%`; },
    setError(msg) {
      status.textContent = msg;
      status.classList.add('error');
    },
  };
}
