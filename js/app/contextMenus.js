import { store, actions, selectionOf } from '../state.js';
import { showContextMenu } from '../ui/contextMenu.js';
import { is3D } from './boards.js';
import { setSelection } from './uiState.js';

/**
 * 工作区右键菜单：
 *   空白处 → 工作区菜单；画板上 → 画板菜单；卡片上 → 卡片菜单 + 画板菜单
 * 右键点到的画板不在选中集合里时只选它（与 Illustrator 一致）。
 */
export function createContextMenus({ ws, boards, importing, exporting, panels, slidesPanel, bgPicker, setTool }) {
  const mod = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl+';

  return function onContextMenu({ clientX, clientY, board }) {
    const s = store.get();
    if (!board) {
      showContextMenu(clientX, clientY, [
        { title: '工作区' },
        { label: '新建画板', icon: 'plus', action: () => boards.addBoard({ duplicate: false }) },
        { label: '粘贴图片为新幻灯片', icon: 'clipboard-paste', shortcut: `${mod}V`, action: () => importing.pasteFromClipboard(null) },
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
      const adjusted = !!(store.get().adjust[store.get().layoutId] || {})[card.order];
      items.push(
        { title: `第 ${card.slideIndex + 1} 张 · ${real ? slide.name : '空位'}` },
        { label: real ? '替换图片…' : '放入图片…', icon: 'image-plus', action: () => importing.pickReplacement(card.slideIndex) },
        { label: real ? '用剪贴板图片替换' : '粘贴剪贴板图片', icon: 'clipboard-paste', shortcut: `${mod}V`, action: () => importing.pasteFromClipboard(card.slideIndex) },
        flat && { label: '选中这张卡片', icon: 'mouse-pointer-2', action: () => { setTool('select'); setSelection([card.order]); } },
        flat && adjusted && { label: '复位这张卡片', icon: 'undo-2', action: () => actions.resetItemAdjust(card.order) },
        real && { label: '在左侧列表中定位', icon: 'locate', action: () => { panels.setHidden('left', false); slidesPanel.highlight(card.slideIndex); } },
        real && { label: '从项目中移除这张图', icon: 'trash-2', danger: true, action: () => actions.removeSlide(slide.id) },
        { sep: true },
      );
    }
    items.push(
      { title: multi ? `已选 ${sel.length} 个画板` : b.name },
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
