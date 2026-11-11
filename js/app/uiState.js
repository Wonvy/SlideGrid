/**
 * 交互状态：只影响工作区显示，不进 store（不保存、不进撤销历史）。
 * 修改后通知订阅者（工作区重画、对齐按钮刷新等）。
 */
export const ui = {
  hover: null,       // 悬停的 item（order）
  dragSource: null,  // 正在拖动的幻灯片序号
  dropTarget: null,  // 拖放目标 item（order）
  selected: null,    // 主选中的卡片（order），缩放手柄跟随它
  selection: [],     // 所有选中的卡片（order），可多选
  listHover: null,   // 左侧列表悬停的幻灯片序号
  tool: 'select',    // 当前工具，见 ui/toolbar.js
  tempHand: false,   // 按住空格临时抓手
  layerSel: [],      // 选中的图层 id（当前画板）
  layerHover: null,  // 悬停的图层 id
  browseAlbum: null, // 左栏正在查看的图集 id（null = 当前画板的图集）；只是查看，不会改变画板
  boardPicked: false, // 画板本身被选中（点了画板名称、右键画板空白处、框选 / 全选画板）：画板描边高亮，Delete 删除所选画板
};

const listeners = new Set();
export const onUiChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = key => listeners.forEach(fn => fn(key));

export function setUi(key, value) {
  if (ui[key] === value) return;
  ui[key] = value;
  emit(key);
}

// 设置卡片选择：orders 为全部选中的卡片，primary 为主选中（默认最后一个）
export function setSelection(orders, primary = orders[orders.length - 1] ?? null) {
  ui.selection = [...new Set(orders)];
  ui.selected = ui.selection.includes(primary) ? primary : ui.selection[ui.selection.length - 1] ?? null;
  emit('selection');
}
export const clearSelection = () => setSelection([]);

// 换版式 / 换画板 / 换项目后，原来的卡片序号不再有意义
export function resetCardState() {
  Object.assign(ui, { hover: null, dropTarget: null, selected: null, selection: [], layerSel: [], layerHover: null });
  emit('selection');
}
