import { formatSchema } from '../export/schema.js';
import { buildControls } from './controls.js';
import { el } from './dom.js';

/**
 * 导出参数悬停面板：鼠标移到「导出图片」按钮上时展开，显示预览、格式、质量、透明背景、文件名。
 * 点击按钮直接按当前参数导出。面板内有输入焦点或正在导出时不会收起。
 *
 * info(s) → { width, height, defaultName }
 */
export function createExportPopover({ anchor, store, actions, drawPreview, info }) {
  const preview = el('canvas', { class: 'export-preview' });
  const controlsBox = el('div');
  const sizeInfo = el('div', { class: 'export-info' });
  const nameInput = el('input', { type: 'text', class: 'text-input', spellcheck: 'false' });
  const ext = el('span', { class: 'filename-ext' });
  const bar = el('div', { class: 'progress-bar' });
  const progress = el('div', { class: 'progress', hidden: true }, bar);
  const status = el('div', { class: 'dialog-status' });
  const hint = el('div', { class: 'popover-hint' });

  const pop = el('div', { class: 'popover export-popover', role: 'dialog', 'aria-label': '导出参数' },
    el('div', { class: 'popover-title' }, '导出参数'),
    el('div', { class: 'preview-wrap small' }, preview),
    controlsBox,
    el('div', { class: 'ctrl' },
      el('label', { class: 'ctrl-label' }, '文件名'),
      el('div', { class: 'filename-row' }, nameInput, ext)),
    sizeInfo,
    progress,
    status,
    hint,
  );
  document.body.append(pop);

  let nameEdited = false;
  let busy = false;
  let hideTimer = 0;
  nameInput.addEventListener('input', () => { nameEdited = true; });

  const updateControls = buildControls(controlsBox, formatSchema, store.get().exportOpts, actions.setExport);

  const isOpen = () => pop.classList.contains('show');

  function position() {
    const r = anchor.getBoundingClientRect();
    pop.style.top = `${Math.round(r.bottom + 8)}px`;
    pop.style.right = `${Math.round(window.innerWidth - r.right)}px`;
  }

  function update(s = store.get()) {
    if (!isOpen()) return;
    const o = s.exportOpts;
    updateControls(o);
    const { width, height, defaultName } = info(s);
    sizeInfo.textContent = o.scope === 'all' ? `当前画板：${width} × ${height} px` : `输出尺寸：${width} × ${height} px`;
    if (!nameEdited) nameInput.value = defaultName;
    ext.textContent = o.scope === 'all' ? '.zip' : o.format === 'jpg' ? '.jpg' : '.png';
    const transparent = s.style.bgType === 'transparent';
    preview.classList.toggle('checker', transparent && o.format === 'png');
    hint.textContent = o.scope === 'all'
      ? `将导出全部 ${s.artboards.length} 个画板，打包为 ZIP（各画板按自己的比例）`
      : transparent
        ? (o.format === 'png' ? '背景透明：导出 PNG 时保留透明' : 'JPG 不支持透明，背景将以白色填充')
        : '尺寸在左侧下拉框中选择 · 点击「导出」开始导出';
    hint.classList.toggle('warn', transparent && o.format === 'jpg');
    drawPreview(preview, { maxW: 300, maxH: 200, whiteFill: transparent && o.format === 'jpg' });
  }

  function show() {
    clearTimeout(hideTimer);
    if (isOpen()) return;
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

  const filename = () => {
    const s = store.get();
    const base = (isOpen() && nameEdited ? nameInput.value.trim() : '').replace(/\.(png|jpe?g|zip)$/i, '') || info(s).defaultName;
    return `${base}.${s.exportOpts.scope === 'all' ? 'zip' : s.exportOpts.format === 'jpg' ? 'jpg' : 'png'}`;
  };

  return {
    update,
    filename,
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
