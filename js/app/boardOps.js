import { store, actions, boardsOf, selectionOf } from '../state.js';
import { toast } from '../ui/toast.js';
import { boardWorldRect } from './boards.js';

/**
 * 画板的新建 / 复制 / 重命名 / 删除 / 切换。新画板放在最右侧画板的右边。
 * ws：工作区（适合窗口、清理背景缓存）
 */
const GAP = 160;

export function createBoardOps(ws) {
  const rightEdge = s => Math.max(...boardsOf(s).map(b => { const r = boardWorldRect(s, b); return r.x + r.w; })) + GAP;

  function activateBoard(id, { fit = true, keepSelection = false } = {}) {
    actions.setActiveBoard(id, { keepSelection });
    if (fit) ws.fitBoard(id);
  }

  function addBoard({ duplicate = false } = {}) {
    const s = store.get();
    const cur = s.artboards.find(b => b.id === s.activeBoard);
    const board = actions.addArtboard({ x: rightEdge(s), y: cur.y, duplicate });
    ws.fitBoard(board.id);
    toast(duplicate ? `已复制为「${board.name}」` : `已新建「${board.name}」`);
  }

  function renameBoard(id) {
    const b = store.get().artboards.find(x => x.id === id);
    const name = prompt('画板名称', b?.name)?.trim();
    if (name && name !== b.name) actions.renameArtboard(id, name);
  }

  // 删除画板（默认删除所有选中的画板），至少保留一个
  function deleteBoards(ids = selectionOf(store.get())) {
    const s = store.get();
    if (s.artboards.length <= 1) { toast('至少保留一个画板', { error: true }); return; }
    if (ids.length >= s.artboards.length) ids = ids.filter(id => id !== s.activeBoard); // 保留当前画板
    const names = s.artboards.filter(b => ids.includes(b.id)).map(b => `「${b.name}」`);
    if (!names.length || !confirm(`删除画板 ${names.join('、')}？`)) return;
    const n = actions.removeArtboards(ids);
    ids.forEach(ws.forgetBoard);
    toast(`已删除 ${n} 个画板`);
  }

  // 复制所有选中的画板，副本依次放在最右侧，并选中这些副本
  function duplicateSelected() {
    const s = store.get();
    const ids = selectionOf(s);
    if (ids.length <= 1) { addBoard({ duplicate: true }); return; }
    let x = rightEdge(s);
    const created = [];
    for (const id of ids) {
      const b = boardsOf(store.get()).find(v => v.id === id);
      const r = boardWorldRect(store.get(), b);
      created.push(actions.addArtboard({ x, y: b.y, duplicate: true, from: id }).id);
      x += r.w + GAP;
    }
    actions.selectBoards(created);
    ws.fitAll();
    toast(`已复制 ${created.length} 个画板`);
  }

  return { activateBoard, addBoard, renameBoard, deleteBoards, deleteBoard: id => deleteBoards([id]), duplicateSelected };
}
