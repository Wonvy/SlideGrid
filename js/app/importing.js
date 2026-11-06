import { store, actions } from '../state.js';
import { createSlides, createAsset } from '../slides/slideFactory.js';
import { collectFromDrop, collectFromInput } from '../slides/importer.js';
import { isPresetsFile } from '../persist/presets.js';
import { toast } from '../ui/toast.js';
import { placeholders } from './boards.js';
import { ui, setUi } from './uiState.js';

/**
 * 把图片放进项目的所有途径：
 *   - 左栏按钮选择文件 / 文件夹
 *   - 拖入：落在卡片上 → 放入 / 替换这一张；落在「背景」上 → 背景图；.slidegrid → 导入项目；版式文件 → 导入版式；其他 → 追加
 *   - ⌘V / Ctrl+V 粘贴剪贴板里的图片：选中卡片时替换它，否则追加
 *
 * ws：工作区（boardAt / pickOn / lastScene）
 * onProjectFile(file)、onLayoutFile(file)：拖入项目 / 版式文件时调用
 */
const isProjectFile = f => /\.slidegrid$/i.test(f.name);
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
const isTyping = t => /^(INPUT|TEXTAREA)$/.test(t?.tagName) || t?.isContentEditable;

const hiddenInput = accept => {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept, hidden: true });
  document.body.append(input);
  return input;
};

export function createImporting({ ws, fileInput, folderInput, overlay, dropLabel, onProjectFile, onLayoutFile }) {
  async function runImport(listPromise, { replaceIndex = null } = {}) {
    let list;
    try {
      list = await listPromise;
    } catch (err) {
      console.error(err);
      toast('读取文件失败', { error: true });
      return;
    }
    if (!list.length) {
      toast('没有找到可用的图片', { error: true });
      return;
    }
    toast(`正在导入 0 / ${list.length}`, { sticky: true });
    const slides = await createSlides(list, (done, total) => toast(`正在导入 ${done} / ${total}`, { sticky: true }));
    const failed = list.length - slides.length;
    const tail = failed ? `，${failed} 张无法读取` : '';
    const current = store.get().slides;
    const base = current.length ? current : placeholders; // 还没有图片时，示例卡片就是空位
    const target = replaceIndex != null ? base[replaceIndex] : null;
    if (target && slides.length) {
      actions.replaceSlide(replaceIndex, slides, current.length ? null : placeholders);
      const verb = target.placeholder ? '放入' : '替换';
      const extra = slides.length > 1 ? `，并在其后插入 ${slides.length - 1} 张` : '';
      toast(`已${verb}第 ${replaceIndex + 1} 张${extra}${tail}`, { error: failed > 0 });
    } else {
      actions.fillSlots(slides);
      toast(`已导入 ${slides.length} 张${tail}`, { error: failed > 0 });
    }
  }

  /* ---------------- 背景图 ---------------- */

  async function setBackgroundFile(file) {
    if (!file) return;
    try {
      toast('正在载入背景图…', { sticky: true });
      actions.setBackgroundImage(await createAsset({ file }));
      toast('已设置背景图');
    } catch (err) {
      console.error(err);
      toast('无法读取这张图片', { error: true });
    }
  }
  const bgInput = hiddenInput('image/*');
  bgInput.addEventListener('change', () => { setBackgroundFile(bgInput.files[0]); bgInput.value = ''; });

  /* ---------------- 拖入文件 ---------------- */

  let dragDepth = 0;
  let dropHit = null;
  let dropOnBackground = null;
  function endFileDrag() {
    dragDepth = 0;
    dropHit = null;
    overlay.classList.remove('show');
    document.body.classList.remove('file-drag');
    dropOnBackground?.classList.remove('drop-hover');
    dropOnBackground = null;
    setUi('dropTarget', null);
  }

  window.addEventListener('dragenter', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    overlay.classList.add('show');
    document.body.classList.add('file-drag');
  });
  window.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const bgRow = e.target.closest?.('[data-drop="background"]') || null;
    if (bgRow !== dropOnBackground) {
      dropOnBackground?.classList.remove('drop-hover');
      bgRow?.classList.add('drop-hover');
      dropOnBackground = bgRow;
    }
    if (bgRow) {
      dropHit = null;
      setUi('dropTarget', null);
      dropLabel.textContent = '松开设为背景图';
      return;
    }
    // 幻灯片是所有画板共用的，落在任何画板的卡片上都可以放入 / 替换
    const board = ws.boardAt(e.clientX, e.clientY);
    dropHit = board ? ws.pickOn(board, e.clientX, e.clientY) : null;
    setUi('dropTarget', dropHit && board === store.get().activeBoard ? dropHit.order : null);
    dropLabel.textContent = !dropHit
      ? '松开以导入图片、文件夹、.slidegrid 项目或版式文件'
      : dropHit.slide.placeholder
        ? `松开放入第 ${dropHit.slideIndex + 1} 张`
        : `松开替换第 ${dropHit.slideIndex + 1} 张（${dropHit.slide.name}）`;
  });
  window.addEventListener('dragleave', e => {
    if (!hasFiles(e)) return;
    if (--dragDepth <= 0) endFileDrag();
  });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const target = dropHit;
    const toBackground = !!dropOnBackground;
    endFileDrag();
    const files = [...(e.dataTransfer.files || [])];
    if (toBackground) {
      setBackgroundFile(files.find(f => f.type.startsWith('image/')));
      return;
    }
    const project = files.find(isProjectFile);
    if (project) { onProjectFile(project); return; }
    const layoutFile = files.find(isPresetsFile);
    if (layoutFile) { onLayoutFile(layoutFile); return; }
    // collectFromDrop 必须在事件里同步调用
    runImport(collectFromDrop(e.dataTransfer), { replaceIndex: target ? target.slideIndex : null });
  });

  /* ---------------- 选择文件 ---------------- */

  for (const input of [fileInput, folderInput]) {
    input.addEventListener('change', () => {
      runImport(Promise.resolve(collectFromInput(input.files)));
      input.value = '';
    });
  }
  // 替换某一张：单独的文件选择框（取消选择不会影响普通导入）
  let replaceIndex = null;
  const replaceInput = hiddenInput('image/*');
  replaceInput.addEventListener('change', () => {
    if (replaceInput.files.length && replaceIndex != null) runImport(Promise.resolve(collectFromInput(replaceInput.files)), { replaceIndex });
    replaceInput.value = '';
  });
  function pickReplacement(index) {
    replaceIndex = index;
    replaceInput.click();
  }

  /* ---------------- 粘贴剪贴板图片 ---------------- */

  const pastedName = type => {
    const t = new Date();
    const ext = (type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    return `粘贴的图片-${[t.getHours(), t.getMinutes(), t.getSeconds()].map(n => String(n).padStart(2, '0')).join('')}.${ext}`;
  };
  // 选中卡片时替换它，否则追加为新幻灯片
  const selectedSlideIndex = () => (ui.selected == null ? null : ws.findItem(ui.selected)?.slideIndex ?? null);
  function importPasted(files, replaceAt = selectedSlideIndex()) {
    const list = files.map(f => ({ file: new File([f], pastedName(f.type), { type: f.type }), path: '' }));
    runImport(Promise.resolve(list), { replaceIndex: replaceAt });
  }
  // ⌘V / Ctrl+V：浏览器的 paste 事件直接带有剪贴板里的图片，不需要额外授权
  document.addEventListener('paste', e => {
    if (isTyping(e.target)) return;
    const files = [...(e.clipboardData?.items || [])]
      .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
      .map(it => it.getAsFile()).filter(Boolean);
    if (!files.length) {
      if (selectedSlideIndex() != null) toast('剪贴板里没有图片', { error: true });
      return;
    }
    e.preventDefault();
    importPasted(files);
  });
  // 右键菜单里的「粘贴」：用异步剪贴板接口读取（浏览器可能会请求授权）
  async function pasteFromClipboard(replaceAt) {
    try {
      const items = await navigator.clipboard.read();
      const files = [];
      for (const it of items) {
        const type = it.types.find(x => x.startsWith('image/'));
        if (type) files.push(await it.getType(type));
      }
      if (!files.length) { toast('剪贴板里没有图片', { error: true }); return; }
      importPasted(files, replaceAt);
    } catch (err) {
      console.warn(err);
      toast('无法读取剪贴板，请改用 ⌘V / Ctrl+V 粘贴', { error: true, duration: 4000 });
    }
  }

  return {
    runImport,
    importFiles: (files, opts) => runImport(Promise.resolve(collectFromInput(files)), opts),
    pickFiles: () => fileInput.click(),
    pickFolder: () => folderInput.click(),
    pickBackground: () => bgInput.click(),
    pickReplacement,
    pasteFromClipboard,
  };
}
