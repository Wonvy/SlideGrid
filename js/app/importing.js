import { store, actions } from '../state.js';
import { createSlides, createAsset } from '../slides/slideFactory.js';
import { collectFromDrop, collectFromInput } from '../slides/importer.js';
import { isPresetsFile } from '../persist/presets.js';
import { toast } from '../ui/toast.js';
import { placeholders, canvasOf } from './boards.js';
import { createLayer, mapToFrame } from '../layers/model.js';
import { svgToLayers, extractSvg } from '../layers/svgImport.js';
import { ui, setUi } from './uiState.js';

/**
 * 把图片放进项目的所有途径：
 *   - 左栏按钮选择文件 / 文件夹
 *   - 拖入：落在卡片上 → 放入 / 替换这一张；落在「背景」上 → 背景图；.slidegrid → 导入项目；版式文件 → 导入版式；其他 → 追加
 *   - ⌘V / Ctrl+V 粘贴：选中卡片时替换它的图片；否则图片作为图片图层、SVG 转成可编辑的矢量图层
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

export function createImporting({ ws, fileInput, folderInput, overlay, dropLabel, onProjectFile, onLayoutFile, onLayersAdded = () => {} }) {
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
    if (dropHit) dropHit = { ...dropHit, board };
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
    // 落在其他画板的卡片上：先切换到那个画板（每个画板有自己的图片顺序）
    if (target && target.board !== store.get().activeBoard) actions.setActiveBoard(target.board);
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
  /* ---------------- 粘贴为图层：图片、SVG ---------------- */

  // 放到当前画板中间：图片最长边不超过画板的一半
  async function addImageLayers(files) {
    toast('正在载入图片…', { sticky: true });
    const assets = [];
    for (const f of files) {
      const file = f instanceof File ? f : new File([f], pastedName(f.type), { type: f.type });
      try { assets.push(await createAsset({ file })); } catch (err) { console.warn(err); }
    }
    if (!assets.length) { toast('无法读取这张图片', { error: true }); return; }
    const { W, H } = canvasOf(store.get());
    const list = [...(store.get().layers || [])];
    const layers = assets.map((a, k) => {
      const s = Math.min(1, (W * 0.5) / a.width, (H * 0.5) / a.height, 1);
      const w = Math.max(1, a.width * s), h = Math.max(1, a.height * s);
      const l = createLayer('image', { x: (W - w) / 2 + k * 24, y: (H - h) / 2 + k * 24, w, h, assetId: a.id, name: a.name.replace(/\.[^.]+$/, '') }, list);
      list.push(l);
      return l;
    });
    actions.addAssetLayers(assets, layers);
    onLayersAdded(layers.map(l => l.id));
    toast(layers.length > 1 ? `已粘贴 ${layers.length} 张图片` : '已粘贴图片');
  }

  // SVG → 可编辑的矢量图层；太大缩到画板的 60%，太小（图标）放大到 300，放在画板中间
  function addSvg(text) {
    const res = svgToLayers(text, store.get().layers || []);
    if (!res) { addImageLayers([new File([text], '粘贴的SVG.svg', { type: 'image/svg+xml' })]); return; } // 转不了：当图片
    const { W, H } = canvasOf(store.get());
    const b = res.bounds;
    const long = Math.max(b.w, b.h) || 1;
    const k = long > Math.min(W, H) * 0.8 ? (Math.min(W, H) * 0.6) / long : long < 120 ? 300 / long : 1;
    const from = { cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w || 1, h: b.h || 1, rotation: 0 };
    const to = { cx: W / 2, cy: H / 2, w: (b.w || 1) * k, h: (b.h || 1) * k, rotation: 0 };
    const layers = res.layers.map(l => {
      const m = mapToFrame(l, from, to);
      return l.strokeWidth ? { ...m, strokeWidth: l.strokeWidth * k } : m;
    });
    actions.setLayers([...(store.get().layers || []), ...layers]);
    onLayersAdded(layers.map(l => l.id));
    toast(`已粘贴 SVG：${layers.length} 个可编辑图层`);
  }

  // ⌘V / Ctrl+V：浏览器的 paste 事件直接带有剪贴板内容，不需要额外授权
  //   SVG 代码（Illustrator / Figma 复制的矢量）或 .svg 文件 → 矢量图层
  //   图片：选中卡片时替换它的图片，否则作为图片图层放到当前画板
  document.addEventListener('paste', async e => {
    if (isTyping(e.target)) return;
    const dt = e.clipboardData;
    if (!dt) return;
    const files = [...dt.items].filter(it => it.kind === 'file').map(it => it.getAsFile()).filter(Boolean);
    const svgText = extractSvg(dt.getData('text/plain')) || extractSvg(dt.getData('text/html'));
    const svgFile = files.find(f => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name || ''));
    const images = files.filter(f => f.type.startsWith('image/') && f !== svgFile);
    if (svgText || svgFile) {
      e.preventDefault();
      addSvg(svgText || await svgFile.text());
      return;
    }
    if (!images.length) {
      if (selectedSlideIndex() != null) toast('剪贴板里没有图片', { error: true });
      return;
    }
    e.preventDefault();
    if (selectedSlideIndex() != null && !ui.layerSel.length) importPasted(images); // 选中了卡片：替换它
    else addImageLayers(images);
  });

  // 读取剪贴板（右键菜单用，浏览器可能会请求授权）→ { images, svg }
  async function readClipboard() {
    const items = await navigator.clipboard.read();
    const images = [];
    let svg = null;
    for (const it of items) {
      if (it.types.includes('image/svg+xml')) { svg = await (await it.getType('image/svg+xml')).text(); continue; }
      const type = it.types.find(x => x.startsWith('image/'));
      if (type) { images.push(await it.getType(type)); continue; }
      if (it.types.includes('text/plain')) svg ||= extractSvg(await (await it.getType('text/plain')).text());
    }
    return { images, svg };
  }
  const clipboardError = err => {
    console.warn(err);
    toast('无法读取剪贴板，请改用 ⌘V / Ctrl+V 粘贴', { error: true, duration: 4000 });
  };

  // 右键菜单「粘贴图片」：放入 / 替换卡片，或追加为新幻灯片
  async function pasteFromClipboard(replaceAt) {
    try {
      const { images } = await readClipboard();
      if (!images.length) { toast('剪贴板里没有图片', { error: true }); return; }
      importPasted(images, replaceAt);
    } catch (err) { clipboardError(err); }
  }
  // 右键菜单「粘贴为图层」：图片 / SVG
  async function pasteAsLayers() {
    try {
      const { images, svg } = await readClipboard();
      if (svg) addSvg(svg);
      else if (images.length) addImageLayers(images);
      else toast('剪贴板里没有图片或 SVG', { error: true });
    } catch (err) { clipboardError(err); }
  }

  return {
    runImport,
    importFiles: (files, opts) => runImport(Promise.resolve(collectFromInput(files)), opts),
    pickFiles: () => fileInput.click(),
    pickFolder: () => folderInput.click(),
    pickBackground: () => bgInput.click(),
    pickReplacement,
    pasteFromClipboard,
    pasteAsLayers,
    addImageLayers,
    addSvg,
  };
}
