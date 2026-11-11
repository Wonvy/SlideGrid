import { store, actions, selectionOf, albumOf } from '../state.js';
import { showContextMenu } from '../ui/contextMenu.js';
import { is3D } from './boards.js';
import { hasAdjust } from '../render/scene.js';
import { BOOLEAN_OPS } from '../layers/boolean.js';
import { setSelection, setUi } from './uiState.js';
import { stackCards, canStack, stackChanged, resetStack } from './cardOrder.js';
import { toast } from '../ui/toast.js';
import { getLayout } from '../layouts/index.js';

/**
 * 工作区右键菜单：
 *   空白处 → 工作区菜单；画板上 → 画板菜单；卡片上 → 卡片菜单 + 画板菜单；图层上 → 图层菜单
 * 返回的函数上还带着 layerMenu(x, y, layer, { rename })、cardMenu(x, y, card)：图层列表里右键用同一套菜单。
 * 右键点到的画板不在选中集合里时只选它（与 Illustrator 一致）。
 */
export function createContextMenus({ ws, boards, importing, exporting, panels, slidesPanel, bgPicker, setTool, layerTools, ui, leftTabs }) {
  const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';

  // 图层菜单（画布上右键图层、图层列表里右键图层共用）。右键点到的图层不在选中的图层里时只选它。
  // rename(layer)：重命名的方式（图层列表里是就地改名，画布上弹出输入框）
  function layerMenu(clientX, clientY, layer, { rename = renameLayer } = {}) {
    if (!ui.layerSel.includes(layer.id)) { setSelection([]); layerTools.select([layer.id]); }
    const ids = [...ui.layerSel];
    const n = ids.length;
    const sel = store.get().layers.filter(l => ids.includes(l.id));
    const allLocked = sel.every(l => l.locked), allHidden = sel.every(l => l.hidden);
    const note = ok => { if (!ok) toast('前后顺序没有变化'); };
    showContextMenu(clientX, clientY, [
      { title: n > 1 ? `已选 ${n} 个图层` : layer.name },
      layer.type === 'text' && n === 1 && !layer.locked && !layer.hidden && { label: '编辑文字', icon: 'type', action: () => layerTools.startEdit(layer.id) },
      layer.type === 'path' && n === 1 && !layer.locked && !layer.hidden && { label: '编辑锚点', icon: 'mouse-pointer', shortcut: 'A', action: () => setTool('direct') },
      n === 1 && { label: '重命名…', icon: 'pencil', action: () => rename(layer) },
      { label: '复制', icon: 'copy', shortcut: `${mod}D`, action: () => layerTools.duplicate() },
      ...(layerTools.booleanCount() >= 2 ? [{ sep: true }, ...BOOLEAN_OPS.map(o => ({ label: o.label, icon: o.icon, action: () => layerTools.booleanOp(o.id) }))] : []),
      { sep: true },
      { label: '置于顶层', icon: 'arrow-up-to-line', shortcut: `⇧${mod}]`, action: () => note(layerTools.reorder(1, true)) },
      { label: '上移一层', icon: 'arrow-up', shortcut: `${mod}]`, action: () => note(layerTools.reorder(1)) },
      { label: '下移一层', icon: 'arrow-down', shortcut: `${mod}[`, action: () => note(layerTools.reorder(-1)) },
      { label: '置于底层', icon: 'arrow-down-to-line', shortcut: `⇧${mod}[`, action: () => note(layerTools.reorder(-1, true)) },
      sel.some(l => !l.under)
        ? { label: '移到幻灯片下面（卡片后面）', icon: 'images', action: () => layerTools.moveUnderSlides(true) }
        : { label: '移到幻灯片上面', icon: 'images', action: () => layerTools.moveUnderSlides(false) },
      { sep: true },
      allLocked
        ? { label: '解锁', icon: 'lock-open', action: () => actions.updateLayers(ids, { locked: false }) }
        : { label: '锁定', icon: 'lock', action: () => { actions.updateLayers(ids, { locked: true }); layerTools.clear(); } },
      allHidden
        ? { label: '显示', icon: 'eye', action: () => actions.updateLayers(ids, { hidden: false }) }
        : { label: '隐藏', icon: 'eye-off', action: () => { actions.updateLayers(ids, { hidden: true }); layerTools.clear(); } },
      { label: n > 1 ? `删除 ${n} 个图层` : '删除', icon: 'trash-2', danger: true, shortcut: 'Delete', action: () => layerTools.remove(ids) },
    ]);
  }
  function renameLayer(layer) {
    const name = prompt('图层名称', layer.name)?.trim();
    if (name && name !== layer.name) actions.updateLayers([layer.id], { name });
  }

  // 卡片的菜单项（画布上右键卡片、图层列表里右键卡片共用）。card：场景里的卡片（slide、slideIndex、order）
  function cardItems(card) {
    const flat = !is3D();
    const slide = card.slide;
    const real = !slide.placeholder;
    const adj = (store.get().adjust[store.get().layoutId] || {})[card.order];
    const adjusted = hasAdjust(adj);
    const pinned = adj?.slide != null;
    const contain = adj?.fit === 'contain';
    const cropped = !contain && ((adj?.cropZ || 1) !== 1 || adj?.cropX || adj?.cropY);
    return [
      { title: `第 ${card.slideIndex + 1} 张 · ${real ? slide.name : '空位'}` },
      { label: real ? '替换图片…' : '放入图片…', icon: 'image-plus', action: () => importing.pickReplacement(card.slideIndex) },
      { label: real ? '用剪贴板图片替换' : '粘贴剪贴板图片', icon: 'clipboard-paste', shortcut: `${mod}V`, action: () => importing.pasteFromClipboard(card.slideIndex) },
      flat && { label: '选中这张卡片', icon: 'mouse-pointer-2', action: () => { setTool('select'); setSelection([card.order]); } },
      { label: '裁切图片', icon: 'crop', shortcut: 'C', action: () => { setTool('crop'); setSelection([card.order]); } },
      { label: contain ? '填满卡片（裁切）' : '完整显示图片', icon: 'scan', action: () => actions.setItemAdjust(card.order, { fit: contain ? 'cover' : 'contain' }) },
      cropped && { label: '复位裁切', icon: 'rotate-ccw', action: () => actions.resetCrop(card.order) },
      flat && adjusted && { label: '复位这张卡片', icon: 'undo-2', action: () => actions.resetItemAdjust(card.order) },
      pinned && { label: '恢复这张卡片原来的图片', icon: 'rotate-ccw', action: () => actions.unpinCard(card.order) },
      // 等距展台 / 分组展台：抬起 / 放平（选中的卡片一起改），细调在「设计」页的「抬起」
      ...(getLayout(store.get().layoutId).cardParams ? (() => {
        const orders = ui.selection.includes(card.order) ? [...ui.selection] : [card.order];
        const set = raise => () => { setSelection(orders, card.order); actions.setItemAdjusts(orders.map(order => ({ order, patch: { raise } }))); };
        const cur = adj?.raise || 'auto';
        return [
          { sep: true },
          cur !== 'up' && { label: orders.length > 1 ? `抬起这 ${orders.length} 张` : '抬起这张', icon: 'arrow-up-to-line', action: set('up') },
          cur !== 'flat' && { label: orders.length > 1 ? `放平这 ${orders.length} 张` : '放平这张', icon: 'arrow-down-to-line', action: set('flat') },
          cur !== 'auto' && { label: '跟随版式（自动）', icon: 'rotate-ccw', action: set('auto') },
          { label: '选中，调整角度…', icon: 'mouse-pointer-2', action: () => { setTool('select'); setSelection(orders, card.order); } },
        ];
      })() : []),
      ...(canStack() ? (() => {
        // 右键点到的卡片在选中的卡片里：一起调；否则只调这一张
        const orders = ui.selection.includes(card.order) ? [...ui.selection] : [card.order];
        const run = (dir, toEnd) => () => { if (!stackCards(orders, dir, toEnd)) toast(dir > 0 ? '已经在最上面了' : '已经在最下面了'); };
        return [
          { sep: true },
          { label: '置于顶层', icon: 'arrow-up-to-line', shortcut: `⇧${mod}]`, action: run(1, true) },
          { label: '上移一层', icon: 'arrow-up', shortcut: `${mod}]`, action: run(1) },
          { label: '下移一层', icon: 'arrow-down', shortcut: `${mod}[`, action: run(-1) },
          { label: '置于底层', icon: 'arrow-down-to-line', shortcut: `⇧${mod}[`, action: run(-1, true) },
          stackChanged() && { label: '恢复版式默认的前后', icon: 'rotate-ccw', action: () => resetStack() },
          { sep: true },
        ];
      })() : []),
      real && { label: '在左侧列表中定位', icon: 'locate', action: () => { panels.setHidden('left', false); leftTabs?.show('slides'); slidesPanel.highlight(card.slideIndex); } },
      real && { label: '从此画板移除这张图', icon: 'trash-2', danger: true, action: () => actions.removeSlide(slide.id, 'board') },
    ];
  }
  const cardMenu = (clientX, clientY, card) => showContextMenu(clientX, clientY, cardItems(card));

  function onContextMenu({ clientX, clientY, board, onLabel = false }) {
    const s = store.get();
    // 图层（在卡片上面）：图层菜单（右键画板名称时不找图层）
    const layer = !onLabel && layerTools?.layerAtClient(clientX, clientY); // 图层可能在画板外
    if (layer) { layerMenu(clientX, clientY, layer); return; }

    if (!board) {
      showContextMenu(clientX, clientY, [
        { title: '工作区' },
        { label: '新建画板', icon: 'plus', action: () => boards.addBoard({ duplicate: false }) },
        { label: '粘贴为图层（图片 / SVG）', icon: 'clipboard-paste', shortcut: `${mod}V`, action: () => importing.pasteAsLayers() },
        { label: '粘贴图片为新幻灯片', icon: 'images', action: () => importing.pasteFromClipboard(null) },
        { sep: true },
        { label: '适合全部画板', icon: 'maximize', shortcut: `${mod}⌥0`, action: ws.fitAll },
        { label: '全选画板', icon: 'check', shortcut: `${mod}A`, action: () => actions.selectAllBoards() },
      ]);
      return;
    }

    const inSelection = selectionOf(s).includes(board);
    const card = onLabel ? null : ws.pickOn(board, clientX, clientY);
    if (board !== s.activeBoard || !inSelection) boards.activateBoard(board, { fit: false, keepSelection: inSelection });
    // 右键画板名称 / 画板空白处：选中画板本身（之后按 Delete 也能删除）
    if (!card) { layerTools?.clear(); setUi('boardPicked', true); }
    const sel = selectionOf(store.get());
    const multi = sel.length > 1;
    const b = store.get().artboards.find(x => x.id === board);
    const items = [];
    if (card) items.push(...cardItems(card), { sep: true });
    const last = s.artboards.length <= 1;
    items.push(
      { title: multi ? `已选 ${sel.length} 个画板` : `画板 · ${b.name}` },
      // 最常用的放前面：重命名、复制、删除
      !multi && { label: '重命名…', icon: 'pencil', action: () => boards.renameBoard(board) },
      { label: multi ? `复制所选的 ${sel.length} 个画板` : '复制画板', icon: 'copy', shortcut: `${mod}D`, action: boards.duplicateSelected },
      {
        label: last ? '删除画板（至少保留一个）' : multi ? `删除所选的 ${sel.length} 个画板` : '删除画板',
        icon: 'trash-2', danger: !last, disabled: last, shortcut: last ? null : '⌫', action: () => boards.deleteBoards(sel),
      },
      { sep: true },
      !card && { label: '粘贴为图层（图片 / SVG）', icon: 'clipboard-paste', shortcut: `${mod}V`, action: () => importing.pasteAsLayers() },
      !multi && { label: '适合窗口', icon: 'scan', shortcut: `${mod}0`, action: () => ws.fitBoard(board) },
      { label: '画板背景…', icon: 'images', action: () => bgPicker.open() },
      { label: multi ? `导出所选的 ${sel.length} 个画板（ZIP）` : '导出此画板', icon: 'download', action: () => exporting.doExport(sel) },
      !multi && Object.values(store.get().adjust[store.get().layoutId] || {}).some(a => a.slide != null)
        && { label: '恢复图片顺序（取消所有交换）', icon: 'rotate-ccw', action: () => actions.resetSwaps() },
      // 换图集：当前画板（多选时所选画板）改为跟随另一个图集
      ...(s.albums.length > 1 ? [
        { sep: true },
        { title: multi ? '所选画板换图集' : '换图集' },
        ...s.albums.map(a => ({
          label: a.name, icon: a.id === albumOf(store.get())?.id && !store.get().slidesOwn ? 'check' : 'images',
          action: () => actions.setBoardAlbum(a.id),
        })),
      ] : []),
    );
    showContextMenu(clientX, clientY, items);
  }
  return Object.assign(onContextMenu, { layerMenu, cardMenu });
}
