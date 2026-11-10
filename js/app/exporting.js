import { store, actions, boardsOf, selectionOf } from '../state.js';
import { renderToBlob, renderToCanvas, downloadBlob } from '../export/exporter.js';
import { resolveScale, exportSize } from '../export/schema.js';
import { copyPngToClipboard } from '../export/clipboard.js';
import { createZip } from '../persist/zip.js';
import { createExportPopover } from '../ui/exportPopover.js';
import { toast } from '../ui/toast.js';
import { boardInput, sceneInput, canvasOf, safeName } from './boards.js';

/**
 * 导出图片 / 复制到剪贴板 / 离屏预览。
 *   尺寸：每个画板的像素尺寸 × 导出倍率；导出面板里勾选要导出的画板（多个打包成 ZIP）
 *   预览（导出面板、项目缩略图、我的版式缩略图）用内存里的预览图离屏渲染，速度快
 */
export function createExporting({ copyBtn, exportBtn }) {
  let busy = false;

  const exportOptions = (s, overrides = {}) => {
    const o = s.exportOpts;
    return { scale: resolveScale(o), format: o.format, quality: o.quality, transparent: o.format === 'png' && !!o.transparent, ...overrides };
  };

  // 某个画板导出的像素
  const boardSize = (s, b) => exportSize(canvasOf({ ...s, ...b.settings }), { scale: resolveScale(s.exportOpts) });
  // 导出面板用：每个画板的名称和输出像素；ids 为要导出的画板时的默认文件名
  function exportInfo(s, ids = [s.activeBoard]) {
    const base = safeName(s.project?.name || 'slidegrid');
    const boards = boardsOf(s).map(b => ({ id: b.id, name: b.name, ...boardSize(s, b) }));
    const pick = boards.filter(b => ids.includes(b.id));
    const one = pick[0];
    return {
      boards,
      defaultName: pick.length > 1 ? `${base}-${pick.length}个画板` : one ? `${base}-${safeName(one.name)}-${one.width}x${one.height}` : base,
    };
  }

  /* ---------------- 预览 ---------------- */

  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
  // 导出面板的预览：连续修改参数（拖滑块、滚轮）时合并成最后一次再画
  let previewToken = 0;
  let previewTimer = 0;
  let lastPreviewAt = 0;
  function drawPreview(canvas, opts) {
    const token = ++previewToken;
    clearTimeout(previewTimer);
    const wait = performance.now() - lastPreviewAt < 250 ? 120 : 0; // 刚画过就稍等，否则立即画
    previewTimer = setTimeout(() => {
      lastPreviewAt = performance.now();
      paintPreview(canvas, opts, token).catch(err => console.error(err));
    }, wait);
  }
  async function paintPreview(canvas, { maxW = 300, maxH = 200, whiteFill = false } = {}, token) {
    if (token !== previewToken) return;
    const s = store.get();
    const { W, H } = canvasOf(s);
    const a = W / H;
    let w = maxW, h = w / a;
    if (h > maxH) { h = maxH; w = h * a; }
    const longSide = Math.round(Math.max(w, h) * dpr());
    const transparent = s.exportOpts.format === 'png' && !!s.exportOpts.transparent;
    const { canvas: src } = await renderToCanvas(sceneInput(s), { longSide, preview: true, transparent, fill: whiteFill ? '#ffffff' : null });
    if (token !== previewToken) return; // 已有更新的请求
    canvas.width = src.width;
    canvas.height = src.height;
    canvas.style.width = `${Math.round(w)}px`;
    canvas.style.height = `${Math.round(h)}px`;
    canvas.getContext('2d').drawImage(src, 0, 0);
  }
  // 当前画板的 JPG 快照（项目缩略图、我的版式缩略图）
  const snapshot = async width =>
    (await renderToBlob(sceneInput(store.get()), { longSide: Math.round(width * 1.6), format: 'jpg', quality: 0.85, preview: true })).blob;

  const popover = createExportPopover({ anchor: exportBtn, store, actions, drawPreview, info: exportInfo, defaultIds: s => selectionOf(s) });

  /* ---------------- 导出 ---------------- */

  async function withBusy(task) {
    if (busy) throw new Error('正在处理上一个任务');
    busy = true;
    copyBtn.disabled = true;
    exportBtn.disabled = true;
    try {
      return await task();
    } finally {
      busy = false;
      copyBtn.disabled = false;
      exportBtn.disabled = false;
    }
  }

  const progress = label => p => {
    popover.setProgress(p);
    toast(`${label}… ${Math.round(p * 100)}%`, { sticky: true });
  };

  // 导出指定画板：一个画板直接下载图片，多个打包成 ZIP
  async function exportBoards(ids, name) {
    const s = store.get();
    const boards = boardsOf(s).filter(b => ids.includes(b.id));
    const ext = s.exportOpts.format === 'jpg' ? 'jpg' : 'png';
    const base = safeName(s.project?.name || 'slidegrid');
    if (boards.length === 1) {
      const b = boards[0];
      const { blob, width, height } = await renderToBlob(boardInput(s, b.settings), exportOptions(s, { onProgress: progress('正在导出') }));
      const file = name || `${base}-${safeName(b.name)}-${width}x${height}.${ext}`;
      downloadBlob(blob, file);
      toast(`已导出 ${file}（${width} × ${height}）`);
      return;
    }
    const entries = [];
    for (let i = 0; i < boards.length; i++) {
      const b = boards[i];
      const { blob, width, height } = await renderToBlob(boardInput(s, b.settings), exportOptions(s, {
        onProgress: p => progress(`正在导出 ${i + 1}/${boards.length}`)((i + p) / boards.length),
      }));
      entries.push({ name: `${String(i + 1).padStart(2, '0')}-${safeName(b.name)}-${width}x${height}.${ext}`, data: blob });
    }
    const file = name || `${base}-${boards.length}个画板.zip`;
    downloadBlob(await createZip(entries), file);
    toast(`已导出 ${boards.length} 个画板（${file}）`);
  }

  // ids 不传时导出面板里勾选的画板（面板没打开时为所选画板）
  async function doExport(ids = null) {
    if (busy) return;
    popover.setBusy(true);
    try {
      await withBusy(async () => {
        if (ids) { await exportBoards(ids); return; } // 右键菜单：导出指定画板
        const target = popover.targets();
        if (!target.length) throw new Error('没有勾选要导出的画板');
        await exportBoards(target, popover.filename(target));
      });
    } catch (err) {
      console.error(err);
      popover.setError(`导出失败：${err.message}`);
      toast(`导出失败：${err.message}`, { error: true, duration: 5000 });
    } finally {
      popover.setBusy(false);
    }
  }

  // 复制当前画板：剪贴板只支持 PNG。clipboard.write 必须在点击事件里同步发起。
  function doCopy() {
    if (busy) return;
    const s = store.get();
    let size = null;
    // 复制有自己独立的透明开关（与导出设置无关）
    const opts = exportOptions(s, { format: 'png', transparent: !!s.exportOpts.copyTransparent, onProgress: progress('正在生成') });
    const blobPromise = renderToBlob(sceneInput(s), opts).then(r => { size = r; return r.blob; });
    withBusy(() => copyPngToClipboard(blobPromise))
      .then(() => toast(`已复制 ${size.width} × ${size.height}${opts.transparent ? '（透明背景）' : ''} 到剪贴板`))
      .catch(err => {
        console.error(err);
        toast(`复制失败：${err.message}`, { error: true, duration: 5000 });
      });
  }

  copyBtn.addEventListener('click', doCopy);
  exportBtn.addEventListener('click', () => doExport());

  return {
    popover,
    snapshot,
    doExport,
    doCopy,
    renderToBlob: opts => renderToBlob(sceneInput(store.get()), opts),
    download: downloadBlob,
  };
}
