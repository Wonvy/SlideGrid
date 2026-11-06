import { store, actions, selectionOf } from '../state.js';
import { showContextMenu } from '../ui/contextMenu.js';
import { is3D } from './boards.js';
import { BOOLEAN_OPS } from '../layers/boolean.js';
import { setSelection } from './uiState.js';

/**
 * 工作区右键菜单：
 *   空白处 → 工作区菜单；画板上 → 画板菜单；卡片上 → 卡片菜单 + 画板菜单
 * 右键点到的画板不在选中集合里时只选它（与 Illustrator 一致）。
 */
export function createContextMenus({ ws, boards, importing, exporting, panels, slidesPanel, bgPicker, setTool, layerTools, ui }) {
  const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';

  return function onContextMenu({ clientX, clientY, board }) {
    const s = store.get();
    // 图层（在卡片上面）：图层菜单
    const layer = layerTools?.layerAtClient(clientX, clientY); // 图层可能在画板外
    if (layer) {
      if (!ui.layerSel.includes(layer.id)) layerTools.select([layer.id]);
      const ids = ui.layerSel;
      const n = ids.length;
      showContextMenu(clientX, clientY, [
        { title: n > 1 ? `已选 ${n} 个图层` : layer.name },
        layer.type === 'text' && n === 1 && { label: '编辑文字', icon: 'type', action: () => layerTools.startEdit(layer.id) },
        layer.type === 'path' && n === 1 && { label: '编辑锚点', icon: 'mouse-pointer', shortcut: 'A', action: () => setTool('direct') },
        { label: '复制', icon: 'copy', shortcut: `${mod}D`, action: () => layerTools.duplicate() },
        ...(layerTools.booleanCount() >= 2 ? [{ sep: true }, ...BOOLEAN_OPS.map(o => ({ label: o.label, icon: o.icon, action: () => layerTools.booleanOp(o.id) }))] : []),
        { sep: true },
        { label: '上移一层', icon: 'arrow-up', shortcut: `${mod}]`, action: () => layerTools.reorder(1) },
        { label: '下移一层', icon: 'arrow-down', shortcut: `${mod}[`, action: () => layerTools.reorder(-1) },
        { label: '置于顶层', shortcut: `⇧${mod}]`, action: () => layerTools.reorder(1, true) },
        { label: '置于底层', shortcut: `⇧${mod}[`, action: () => layerTools.reorder(-1, true) },
        { sep: true },
        { label: '锁定', icon: 'lock', action: () => { actions.updateLayers(ids, { locked: true }); layerTools.clear(); } },
        { label: '隐藏', icon: 'eye-off', action: () => { actions.updateLayers(ids, { hidden: true }); layerTools.clear(); } },
        { label: n > 1 ? `删除 ${n} 个图层` : '删除', icon: 'trash-2', danger: true, shortcut: 'Delete', action: () => layerTools.remove([...ids]) },
      ]);
      return;
    }

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
    const card = ws.pickOn(board, clientX, clientY);
    if (board !== s.activeBoard || !inSelection) boards.activateBoard(board, { fit: false, keepSelection: inSelection });
    const sel = selectionOf(store.get());
    const multi = sel.length > 1;
    const b = store.get().artboards.find(x => x.id === board);
    const flat = !is3D();

    const items = [];
    if (card) {
      const slide = card.slide;
      const real = !slide.placeholder;
      const adj = (store.get().adjust[store.get().layoutId] || {})[card.order];
      const adjusted = !!adj;
      const contain = adj?.fit === 'contain';
      const cropped = !contain && ((adj?.cropZ || 1) !== 1 || adj?.cropX || adj?.cropY);
      items.push(
        { title: `第 ${card.slideIndex + 1} 张 · ${real ? slide.name : '空位'}` },
        { label: real ? '替换图片…' : '放入图片…', icon: 'image-plus', action: () => importing.pickReplacement(card.slideIndex) },
        { label: real ? '用剪贴板图片替换' : '粘贴剪贴板图片', icon: 'clipboard-paste', shortcut: `${mod}V`, action: () => importing.pasteFromClipboard(card.slideIndex) },
        flat && { label: '选中这张卡片', icon: 'mouse-pointer-2', action: () => { setTool('select'); setSelection([card.order]); } },
        { label: '裁切图片', icon: 'crop', shortcut: 'C', action: () => { setTool('crop'); setSelection([card.order]); } },
        { label: contain ? '填满卡片（裁切）' : '完整显示图片', icon: 'scan', action: () => actions.setItemAdjust(card.order, { fit: contain ? 'cover' : 'contain' }) },
        cropped && { label: '复位裁切', icon: 'rotate-ccw', action: () => actions.resetCrop(card.order) },
        flat && adjusted && { label: '复位这张卡片', icon: 'undo-2', action: () => actions.resetItemAdjust(card.order) },
        real && { label: '在左侧列表中定位', icon: 'locate', action: () => { panels.setHidden('left', false); slidesPanel.highlight(card.slideIndex); } },
        real && { label: '从此画板移除这张图', icon: 'trash-2', danger: true, action: () => actions.removeSlide(slide.id, 'board') },
        { sep: true },
      );
    }
    items.push(
      { title: multi ? `已选 ${sel.length} 个画板` : b.name },
      !card && { label: '粘贴为图层（图片 / SVG）', icon: 'clipboard-paste', shortcut: `${mod}V`, action: () => importing.pasteAsLayers() },
      !multi && { label: '适合窗口', icon: 'scan', shortcut: `${mod}0`, action: () => ws.fitBoard(board) },
      !multi && { label: '重命名…', icon: 'pencil', action: () => boards.renameBoard(board) },
      { label: '画板背景…', icon: 'images', action: () => bgPicker.open() },
      { label: multi ? `复制所选的 ${sel.length} 个画板` : '复制画板', icon: 'copy', action: boards.duplicateSelected },
      { label: multi ? `导出所选的 ${sel.length} 个画板（ZIP）` : '导出此画板', icon: 'download', action: () => exporting.doExport(sel) },
      { sep: true },
      s.artboards.length > 1 && { label: multi ? `删除所选的 ${sel.length} 个画板` : '删除画板', icon: 'trash-2', danger: true, action: () => boards.deleteBoards(sel) },
    );
    showContextMenu(clientX, clientY, items);
  };
}
