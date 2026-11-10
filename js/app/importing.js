import { store, actions, albumOf, albumSlides } from '../state.js';
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

export function createImporting({ ws, fileInput, folderInput, overlay, dropLabel, onProjectFile, onLayoutFile, onLayersAdded = () => {}, deviceAt = () => null, onDeviceChanged = () => {} }) {
  async function runImport(listPromise, { replaceIndex = null } = {}) {
    let list;
    try {
      list = await listPromise;
    } catch (err) {
      console.error(err);
      toast(err.userMessage || '读取文件失败', { error: true, duration: err.userMessage ? 6000 : undefined });
      return;
    }
    if (!list.length) {
      toast('没有找到可用的图片', { error: true });
      return;
    }
    // 拖入 / 选择的是文件夹：每个文件夹成为一个图集（名称就是文件夹名），见 importAlbums
    const groups = replaceIndex == null ? groupByFolder(list) : null;
    if (groups) { await importAlbums(groups, list.length); return; }
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

  // 按最外层文件夹分组：[{ name, items }]；散的图片 name 为 null。没有任何文件夹时返回 null（按普通图片导入）
  function groupByFolder(list) {
    const groups = new Map();
    for (const it of list) {
      const i = it.path.indexOf('/');
      const name = i > 0 ? it.path.slice(0, i) : null;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(it);
    }
    if (![...groups.keys()].some(k => k)) return null;
    return [...groups].map(([name, items]) => ({ name, items }));
  }

  /**
   * 导入文件夹：散的图片加到当前图集；每个文件夹新建一个图集，当前画板换成第一个新图集。
   * 当前图集还没有图片（只有示例）时，第一个文件夹直接放进当前图集，并把图集改成文件夹名。
   */
  async function importAlbums(groups, total) {
    let done = 0, failed = 0, created = 0, first = true;
    const progress = () => toast(`正在导入 ${done} / ${total}`, { sticky: true });
    progress();
    for (const g of groups) {
      const slides = await createSlides(g.items, () => { done++; progress(); });
      failed += g.items.length - slides.length;
      if (!slides.length) continue;
      const s = store.get();
      const album = albumOf(s);
      const empty = !s.slidesOwn && !albumSlides(s).some(x => !x.placeholder);
      if (!g.name) {
        actions.fillSlots(slides);
      } else if (first && empty) {
        actions.fillSlots(slides);
        actions.renameAlbum(album.id, g.name);
        created++;
        first = false;
      } else {
        actions.addAlbum(g.name, slides, { switchBoards: first });
        created++;
        first = false;
      }
    }
    const tail = failed ? `，${failed} 张无法读取` : '';
    toast(created > 1 ? `已导入 ${created} 个图集（共 ${total - failed} 张）${tail}，在左栏顶部切换图集` : `已导入图集「${albumOf(store.get()).name}」（${total - failed} 张）${tail}`, { error: failed > 0, duration: 4000 });
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

  /* ---------------- 样机屏幕的图片 ---------------- */

  // 样机屏幕换成一张图片（样机自己的素材，不加入幻灯片列表）
  async function setDeviceImageFile(target, file) {
    if (!file) return;
    try {
      if (target.board !== store.get().activeBoard) actions.setActiveBoard(target.board);
      toast('正在载入图片…', { sticky: true });
      actions.setDeviceImage(target.layer.id, await createAsset({ file }));
      onDeviceChanged(target.layer.id);
      toast(`已把图片放进「${target.layer.name}」`);
    } catch (err) {
      console.error(err);
      toast('无法读取这张图片', { error: true });
    }
  }
  let deviceImageTarget = null;
  const deviceInput = hiddenInput('image/*');
  deviceInput.addEventListener('change', () => {
    if (deviceInput.files[0] && deviceImageTarget) setDeviceImageFile(deviceImageTarget, deviceInput.files[0]);
    deviceInput.value = '';
  });
  function pickDeviceImage(layer) {
    deviceImageTarget = { board: store.get().activeBoard, layer };
    deviceInput.click();
  }

  // 从左栏把幻灯片拖到样机上：屏幕改为显示这一张（左栏是当前画板的图片，只认当前画板上的样机）
  const isSlideDrag = e => [...(e.dataTransfer?.types || [])].includes('text/x-slidegrid');
  let slideDropDevice = null;
  const deviceOnActive = e => {
    const hit = deviceAt(e.clientX, e.clientY);
    return hit && hit.board === store.get().activeBoard ? hit : null;
  };
  window.addEventListener('dragover', e => {
    if (!isSlideDrag(e)) return;
    const hit = deviceOnActive(e);
    if ((hit?.layer.id || null) !== (slideDropDevice?.layer.id || null)) setUi('layerHover', hit?.layer.id || null);
    slideDropDevice = hit;
    if (!hit) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move'; // 左栏拖动只允许 move
  });
  window.addEventListener('drop', e => {
    if (!isSlideDrag(e) || !slideDropDevice) return;
    e.preventDefault();
    const index = Number(e.dataTransfer.getData('text/x-slidegrid'));
    const target = slideDropDevice;
    slideDropDevice = null;
    setUi('layerHover', null);
    if (!Number.isInteger(index)) return;
    actions.setDeviceImage(target.layer.id, null, index + 1);
    onDeviceChanged(target.layer.id);
    toast(`「${target.layer.name}」改为显示第 ${index + 1} 张`);
  });
  window.addEventListener('dragend', () => { if (slideDropDevice) { slideDropDevice = null; setUi('layerHover', null); } });

  /* ---------------- 拖入文件 ---------------- */

  let dragDepth = 0;
  let dropHit = null;
  let dropDevice = null;
  let dropOnBackground = null;
  function endFileDrag() {
    dragDepth = 0;
    dropHit = null;
    if (dropDevice) setUi('layerHover', null);
    dropDevice = null;
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
    // 落在样机上：图片放进样机的屏幕（样机在卡片上面，优先）
    const dev = deviceAt(e.clientX, e.clientY);
    if ((dev?.layer.id || null) !== (dropDevice?.layer.id || null)) setUi('layerHover', dev?.layer.id || null);
    dropDevice = dev;
    if (dev) {
      dropHit = null;
      setUi('dropTarget', null);
      dropLabel.textContent = `松开把图片放进「${dev.layer.name}」`;
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
    const toDevice = dropDevice;
    endFileDrag();
    const files = [...(e.dataTransfer.files || [])];
    if (toDevice) {
      const img = files.find(f => f.type.startsWith('image/'));
      if (img) { setDeviceImageFile(toDevice, img); return; }
    }
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

  // 剪贴板里的 image/svg+xml 数据（PowerPoint、Office 复制图形时会同时放 PNG 和 SVG）。
  // paste 事件里浏览器只给 PNG，SVG 要通过异步剪贴板接口读取（可能请求一次授权；拒绝时返回 null）
  async function readClipboardSvg() {
    if (!navigator.clipboard?.read) return null;
    try {
      const perm = await navigator.permissions?.query({ name: 'clipboard-read' }).catch(() => null);
      if (perm?.state === 'denied') return null;
      for (const it of await navigator.clipboard.read()) {
        if (it.types.includes('image/svg+xml')) return extractSvg(await (await it.getType('image/svg+xml')).text());
      }
    } catch (err) { console.warn(err); }
    return null;
  }

  // ⌘V / Ctrl+V：浏览器的 paste 事件直接带有剪贴板内容，不需要额外授权
  //   SVG 代码（Illustrator / Figma 复制的矢量）、.svg 文件、剪贴板里的 image/svg+xml 数据 → 矢量图层
  //   图片：选中卡片时替换它的图片，否则作为图片图层放到当前画板（剪贴板同时有 SVG 时优先用 SVG）
  document.addEventListener('paste', async e => {
    if (isTyping(e.target)) return;
    const dt = e.clipboardData;
    if (!dt) return;
    const files = [...dt.items].filter(it => it.kind === 'file').map(it => it.getAsFile()).filter(Boolean);
    const svgFile = files.find(f => f.type === 'image/svg+xml' || /\.svg$/i.test(f.name || ''));
    const images = files.filter(f => f.type.startsWith('image/') && f !== svgFile);
    // 只选中了一个样机：图片放进它的屏幕
    const selDevice = ui.layerSel.length === 1 ? (store.get().layers || []).find(l => l.id === ui.layerSel[0] && l.type === 'device') : null;
    if (selDevice && images.length) {
      e.preventDefault();
      setDeviceImageFile({ board: store.get().activeBoard, layer: selDevice }, images[0]);
      return;
    }
    const replacing = selectedSlideIndex() != null && !ui.layerSel.length; // 选中了卡片：用图片替换它
    let svg = extractSvg(dt.getData('image/svg+xml')) || extractSvg(dt.getData('text/plain')) || extractSvg(dt.getData('text/html'));
    if (svg || svgFile || images.length) e.preventDefault();
    if (!svg && svgFile) svg = extractSvg(await svgFile.text());
    if (!svg && images.length && !replacing) svg = await readClipboardSvg();
    if (svg) { addSvg(svg); return; }
    if (!images.length) {
      if (selectedSlideIndex() != null) toast('剪贴板里没有图片', { error: true });
      return;
    }
    if (replacing) importPasted(images);
    else addImageLayers(images);
  });

  // 读取剪贴板（右键菜单用，浏览器可能会请求授权）→ { images, svg }
  async function readClipboard() {
    const items = await navigator.clipboard.read();
    const images = [];
    let svg = null;
    for (const it of items) {
      if (it.types.includes('image/svg+xml')) { svg = extractSvg(await (await it.getType('image/svg+xml')).text()); if (svg) continue; }
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
    pickDeviceImage,
    createAsset,
    addImageLayers,
    addSvg,
  };
}
