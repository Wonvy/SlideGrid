import { boardsOf } from '../state.js';

/**
 * 撤销 / 重做。
 *
 * store 里的数据都是「改了就换新对象」，所以一个快照只需要保存这些字段的引用，开销很小。
 * 记录规则：
 *   - 作品相关的变化才记录：幻灯片、背景图、各画板的版式 / 参数 / 样式 / 比例 / 构图 / 卡片调整、画板增删移动改名
 *   - 切换当前画板、多选画板只是「在看哪里」，不记录
 *   - 连续的同类修改（拖滑块、拖卡片、滚轮调参）合并成一步；松开鼠标算一步结束
 *   - 切换项目时清空
 */
const DOC_FIELDS = ['slides', 'assets', 'artboards', 'activeBoard', 'layoutId', 'params', 'style', 'aspect', 'camera', 'adjust'];
const LABELS = {
  slides: '幻灯片', assets: '背景图', layoutId: '更换版式', params: '版式参数',
  style: '样式', aspect: '画布比例', camera: '构图', adjust: '卡片调整',
};
const MERGE_MS = 800;

const snapshot = s => Object.fromEntries(DOC_FIELDS.map(k => [k, s[k]]));
const boardIds = s => s.artboards.map(b => b.id).join(',');

// 判断这次变化是什么；返回 null 表示不需要记录
function classify(prev, s) {
  const changed = ['slides', 'assets', 'layoutId', 'params', 'style', 'aspect', 'camera', 'adjust'].filter(k => prev[k] !== s[k]);
  const boardsChanged = prev.artboards !== s.artboards;
  const sameBoards = boardIds(prev) === boardIds(s);

  // 只是切换当前画板（顶层设置随之换成另一个画板的）——不记录
  if (prev.activeBoard !== s.activeBoard && sameBoards && prev.slides === s.slides && prev.assets === s.assets) return null;
  if (!changed.length && !boardsChanged) return null;

  let label;
  if (!sameBoards) {
    // 画板增删优先（新建 / 删除时当前画板的设置也会随之变化）
    label = s.artboards.length > prev.artboards.length ? '新建画板' : '删除画板';
  } else if (changed.length) {
    label = LABELS[changed.find(k => k !== 'camera' || changed.length === 1)] || LABELS[changed[0]];
  } else {
    const moved = s.artboards.some((b, i) => b.x !== prev.artboards[i].x || b.y !== prev.artboards[i].y);
    const renamed = s.artboards.some((b, i) => b.name !== prev.artboards[i].name);
    if (!moved && !renamed && s.artboards.every((b, i) => b.settings === prev.artboards[i].settings)) return null; // 内容没变
    label = moved ? '移动画板' : renamed ? '重命名画板' : '画板设置';
  }
  return { label, sig: `${changed.join('+')}|${boardsChanged ? (sameBoards ? 'b' : 'B') : ''}|${label}` };
}

export function createHistory(store, { limit = 100, onChange = () => {} } = {}) {
  const undoStack = [];
  const redoStack = [];
  let prev = store.get();
  let applying = false;
  let boundary = true;
  let last = { sig: '', time: 0 };

  store.subscribe(s => {
    if (applying) { prev = s; return; }
    if (s.project?.id !== prev.project?.id) { // 切换项目：清空
      undoStack.length = 0;
      redoStack.length = 0;
      boundary = true;
      prev = s;
      onChange();
      return;
    }
    const change = classify(prev, s);
    if (change) {
      const now = performance.now();
      const merge = !boundary && change.sig === last.sig && now - last.time < MERGE_MS;
      if (!merge) {
        undoStack.push({ snap: snapshot(prev), label: change.label });
        if (undoStack.length > limit) undoStack.shift();
        redoStack.length = 0;
      }
      last = { sig: change.sig, time: now };
      boundary = false;
      onChange();
    }
    prev = s;
  });

  // 松开鼠标 = 一次操作结束（拖动滑块、拖动卡片等）
  window.addEventListener('pointerup', () => { boundary = true; }, true);
  window.addEventListener('keyup', () => { boundary = true; }, true);

  // 恢复快照；当前画板若仍存在就保持不变（撤销不会把你带到别的画板）
  function apply(snap) {
    const cur = store.get();
    const boards = boardsOf(snap);
    const activeId = boards.some(b => b.id === cur.activeBoard) ? cur.activeBoard : snap.activeBoard;
    const active = boards.find(b => b.id === activeId);
    const selected = (cur.selectedBoards || []).filter(id => boards.some(b => b.id === id));
    applying = true;
    try {
      store.set({
        slides: snap.slides,
        assets: snap.assets,
        artboards: boards,
        activeBoard: activeId,
        selectedBoards: selected.includes(activeId) ? selected : [activeId],
        ...active.settings,
      });
    } finally {
      applying = false;
    }
    boundary = true;
    onChange();
  }

  function undo() {
    const entry = undoStack.pop();
    if (!entry) return null;
    redoStack.push({ snap: snapshot(store.get()), label: entry.label });
    apply(entry.snap);
    return entry.label;
  }

  function redo() {
    const entry = redoStack.pop();
    if (!entry) return null;
    undoStack.push({ snap: snapshot(store.get()), label: entry.label });
    apply(entry.snap);
    return entry.label;
  }

  return {
    undo,
    redo,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    undoLabel: () => undoStack.at(-1)?.label || '',
    redoLabel: () => redoStack.at(-1)?.label || '',
    clear() { undoStack.length = 0; redoStack.length = 0; onChange(); },
  };
}
